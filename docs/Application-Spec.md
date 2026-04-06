## Day Tracker – Application Specification

### 1. Introduction & scope

- **Purpose**: This document describes the **current behavior and architecture** of the Day Tracker application as implemented in this repository. It is the reference for how the app works today, and the target that future changes should continue to satisfy (or deliberately evolve).
- **Audience**: Developers and product owners working on Day Tracker.
- **Sources of truth**:
  - **Database schema**: `contracts/schema.dbml` (DBML contract) and the user/master migrations in `migrations/`.
  - **Backend behavior**: PHP APIs under `api/` and shared helpers under `lib/`.
  - **Frontend behavior**: Next.js app under `app/`, React components in `components/`, and the TypeScript client in `lib/api.ts`.

This spec focuses on *what* the app does (observable behavior and rules) rather than low-level implementation details.

---

### 2. High-level architecture

- **Frontend**: Next.js 14 app (`app/page.tsx`) that renders a single-page experience:
  - `MainApp` handles authentication state (`/api/auth.php?action=me`) and switches between `LoginScreen` and the main app.
  - `AppBar` shows user/admin controls and logout.
  - `AppPanels` manages the three main panels (Completed, Tasks + Schedule, AI) and mobile swipe navigation.
  - `TaskListAndSchedule` is the core tasks/schedule view.
  - `CompletedPanel` and `AIPanel` are rendered as side panels within `TaskListAndSchedule`.

- **Backend**:
  - PHP endpoints in `api/*.php`, all of which (except `auth.php`, `auth_callback.php`) go through `api/common.php`’s `requireAuth()` and logging.
  - Per-user SQLite database chosen from the master DB (`users.db_name`) via `lib/db.php::getCurrentUserDbPath()` and `getPdo()`, with migrations under `migrations/`.
  - Master SQLite database (`getMasterDbPath()`) stores users, SSO accounts, global app settings, and iCal exclusion metadata.

- **Demo account**:
  - Username/password: `demo` / `demo`.
  - On first login, `ensureDemoUserExists()` creates a dedicated `daytracker_demo.sqlite` user DB.
  - On each calendar day (and on demo login/logout), `resetDemoUser()` reseeds the demo DB with tasks, schedule, links, checklists, and organization data.

---

### 3. Data model (overview)

The full schema is defined in **`contracts/schema.dbml`**, which is the authoritative contract for database structure. The key entities are:

- **User DB (per user)**:
  - `tasks`: core task records; fields include `title`, `priority` (commitment/high/medium/low), `recurring` (flag), optional `recurrence_rule` (JSON), `parent_id` for subtasks, `list_state` (`unassigned` or `pending`), and `list_style` (`bullet` or `checklist`).
  - `task_links`: URLs attached to tasks (unique by `(task_id, url)`).
  - `task_list_items`: list/checklist items per task, with `order_index` and `completed` flags.
  - `day_record`: calendar of days the app knows about (`date` as `YYYY-MM-DD`).
  - `scheduled_slots`: scheduled instances of tasks on specific days, with optional `start_time` / `end_time`, `completed` flag, and `order_index`.
  - `app_settings` (user DB): per-user schedule settings (start/end hour, increment, timezone, etc.).
  - `ical_subscriptions`: external iCal feed URLs the user has subscribed to, with `enabled` flag and `last_synced_at`.
  - `ical_feed_events`: parsed, stored occurrences from external iCal feeds, including `user_completed` and `event_type`.
  - **Organization tables**:
    - `task_categories`: named categories with optional color.
    - `task_subcategories`: names scoped to a parent category.
    - `task_tags`: named tags with optional color.
    - `task_category`, `task_subcategory`, `task_tag`: join tables assigning at most one category, at most one subcategory, and many tags per task.

- **Master DB (shared)**:
  - `users`: login accounts, each with a `db_name` for their user DB and flags `is_admin` / `force_password_reset`.
  - `sso_accounts`: linked OAuth accounts (e.g. Google, Outlook) keyed by master user.
  - `app_settings` (master): global settings (debug, `ai_enabled`, iCal sync config, etc.).
  - `ical_feed_tokens`: one token per user, used to build the user’s own iCal feed URL.
  - `ical_excluded_events`: list of excluded external iCal events by UID, with friendly titles; combined with the `ical_omit_uids` setting.

See `contracts/schema.dbml` for exact columns, constraints, and relationships.

---

### 4. Core features & behavior

#### 4.1 Authentication & accounts

- The frontend calls `api/auth.php?action=me` on load to determine the current user and whether AI is enabled.
- **Login / register**: `api/auth.php?action=login|register` accepts JSON `{username, password}`; usernames are sanitized to `[a-zA-Z0-9_-]`.
- Registration is disabled for `demo` (must use login).
- On login:
  - For non-demo users, the master DB is checked; if their per-user DB file is missing, it is created and all migrations are applied.
  - For `demo`, `ensureDemoUserExists()` + `resetDemoUser()` + `setDemoLastResetDate()` run before session is established.
- Logout:
  - For `demo`, logout also triggers `resetDemoUser()` so the next visitor gets a fresh demo state.

#### 4.2 Tasks: list, organization, and subtasks

- Tasks are fetched from `api/tasks.php`:
  - `GET /api/tasks.php` returns all tasks ordered with parents before children.
  - `GET /api/tasks.php?list_state=unassigned|pending` filters by list.
  - `GET /api/tasks.php?view=incomplete&day=YYYY-MM-DD` returns tasks that were partially completed yesterday (some subtasks or slots done, not all).
  - `with` query parameter allows eager-loading:
    - `with=links` → `linksByTaskId`.
    - `with=list_items` → `listItemsByTaskId`.
    - `with=organization` → `category_id`, `subcategory_id`, `tag_ids` injected into each task.
- Creation:
  - `POST /api/tasks.php` requires `title`; optional `priority`, `recurring`, `parent_id`, and `list_style`.
  - When `recurring` is true and the `recurrence_rule` column exists, a default daily rule (`{"freq":"daily","time":"09:00"}`) is set if none is provided.
- Update:
  - `PATCH /api/tasks.php` can update `title`, `priority`, `recurring`, `recurrence_rule`, `parent_id`, `list_state`, and list style.
  - When `category_id`, `subcategory_id`, or `tag_ids` are provided, the handler updates the organization join tables even if no other columns change.
- Deletion:
  - `DELETE /api/tasks.php?id=` removes the task and cascades to links, list items, slots, and organization joins via foreign keys.

**Subtasks**:
- Represented by `tasks.parent_id` pointing to a parent task.
- The UI shows subtasks nested under their parent in both the task list and, when scheduled, as child blocks under a schedule slot.

**Task groups (root + members)**
- A "task group" is represented by the same parent/child relationship:
  - The group root is a task with `tasks.parent_id IS NULL`.
  - Group members are tasks whose `tasks.parent_id` points to the group root.
- Group member ordering within the root is stable and uses `tasks.group_order` (sibling ordering for grouped children).
- When editing a group root in the task list:
  - Changing priority on the root applies to the root and its direct group members (so children show the same priority icon).
  - Ungrouping a group root's members clears `parent_id` for those descendants, moving them back to the root task list.
- When rendering the schedule:
  - Scheduling (or dragging/resizing/moving) a group root updates the schedule for the whole group:
    - The root schedule block spans the full group duration.
    - Member schedule blocks are distributed sequentially within that duration.
    - Group-aware clamping ensures the group cannot be resized to violate minimum duration constraints.

**Organization (categories, subcategories, tags)**:
- CRUD is exposed via `api/organization.php`:
  - `GET` returns `categories`, `subcategories`, and `tags` (empty if tables don’t exist).
  - `POST` with `type: 'category' | 'subcategory' | 'tag'` creates respective records; tag creation auto-assigns a random color if none is provided.
  - `PATCH` and `DELETE` update or remove categories, subcategories, and tags; foreign-key rules cascade subcategories and tag assignments.
- Tasks can have:
  - Exactly **one** `task_category` (or none).
  - Exactly **one** `task_subcategory` (or none).
  - Zero or more `task_tag` rows.
- The frontend:
  - Fetches organization definitions at load and when the Organization section in User Settings is open.
  - Shows category/subcategory inline under the task title and tags as small pills to the right in both list and schedule views.

#### 4.3 Task list & search

- The main task list (left panel in `TaskListAndSchedule`) shows:
  - **Unassigned**, **Pending**, and **Incomplete** views (incomplete based on yesterday’s partial completion rules).
  - Sorting by `date_added` (created_at), `priority`, or `title`, with ascending/descending controls.
  - A search box that filters tasks by:
    - Task title.
    - Link descriptions / URLs.
    - Task list item content.
- Tasks support:
  - Changing priority (commitment/high/medium/low).
  - Changing list style (bullet vs checklist).
  - Adding subtasks (via parent/child relationship).
  - Attaching links and list items via modals.

#### 4.4 Schedule & calendar

- The schedule view is the core of `TaskListAndSchedule`:
  - **Today view**: vertical time grid (controlled by `start_hour`, `end_hour`, `increment_value`, `increment_unit` from settings).
  - **Calendar view**: month grid built from `day_record` plus `scheduled_slots` and iCal events.
- `scheduled_slots` rules:
  - Slots are ordered by time, with untimed slots grouped at the top for a day.
  - Each slot references a single task but tasks can be scheduled on multiple days via multiple slots.
  - `completed` on a slot marks that scheduled occurrence done; recurring tasks have special handling (copy-on-day-end, “this occurrence vs all” dialogs).
- Completion logic:
  - Toggling completion for a root slot can:
    - Optionally cascade to child slots or prompt for recurring behavior (complete this occurrence vs series).
    - Detect partial completion vs all-complete conditions when subtasks/child slots exist.
  - “Incomplete” view for yesterday is derived from combinations of root/child slot `completed` flags as defined in `api/tasks.php`.
- Task groups in schedule view
  - When a scheduled root task has direct group members, the schedule renders a stacked group:
    - The root slot spans the full group duration.
    - Each member slot represents a contiguous slice of the group duration, distributed sequentially.
  - Group-aware resizing/moving updates `start_time` and `end_time` for all group members together, while preserving the group duration constraints and step snapping.
- Drag & drop:
  - Tasks can be dragged from Unassigned/Pending into the schedule to create slots.
  - Dragging within the schedule can move or resize slots, subject to recurrence and future-date rules (e.g. modals for completing in the future).
  - There are visual drop zones and debug rectangles (when `adminDebug` is enabled).

#### 4.5 Completed view

- `CompletedPanel` uses `api/accomplished.php`:
  - `listAll` groups completed items by date, with optional subtasks under each entry.
  - The backend derives completed data from `scheduled_slots` (post–`011_drop_accomplished`), not the legacy `accomplished` table.
  - The panel shows per-day headings, titles, and approximate durations (based on slot times).

#### 4.6 User settings

- `UserSettingsView` organizes settings into sections:
  - **Profile**:
    - Shows username and linked SSO accounts.
    - Allows changing password (except for `demo`, where it is locked).
    - Permits disconnecting SSO by setting a new password via API.
  - **Subscriptions**:
    - Shows the user’s outbound calendar feed URL (built from `ical_feed_tokens` and `api/ical.php`).
    - Manages subscribed external iCal feeds via `api/ical_subscriptions.php` (add/remove, enable/disable).
    - Manages excluded external events via `api/ical_excluded.php` and the master `ical_excluded_events` table.
  - **Schedule Settings**:
    - Reads and writes `start_hour`, `end_hour`, `increment_value`, `increment_unit`, and `timezone` using `api/settings.php` and the user DB’s `app_settings` table.
  - **Organization**:
    - Full CRUD for categories, subcategories, and tags (including color picking for categories/tags).
    - Any change triggers `onOrganizationChange`, which refreshes organization data in `TaskListAndSchedule`.

#### 4.7 Admin features

- `AdminSettingsView` consumes `api/admin.php`, which provides:
  - Global toggles for `debug` and `ai_enabled`.
  - iCal sync configuration: fetch timeouts, polling vs manual, sync interval minutes, event range, and save-folder options.
  - A raw error-log viewer (`error_log` action).
  - User listing with basic metadata and SSO providers (no direct UI editing beyond what is defined in the component).

#### 4.8 AI assistant

- `AIPanel` is an optional right-hand panel:
  - Uses `api.chat.send()` with:
    - The user’s freeform message.
    - A structured context built from:
      - Today’s accomplished items (`api/accomplished.listByDate`).
      - The full task list (`api.tasks.list()`).
      - Today’s schedule (`api.day.getOrCreate` + `api.slots.list`).
  - The backend (`api/chat.php`) expects this context to generate:
    - An `advice` string.
    - Optional `suggestedTasks` (title + priority + suggested slot time).
  - The panel allows:
    - Adding suggested tasks to the list only.
    - Adding suggested tasks directly into today’s schedule as new slots.

---

### 5. API overview (selected endpoints)

This is a brief summary; for behavior details see the sections above and implementation in `api/*.php`.

- `api/auth.php`: `me`, `login`, `register`, `logout`, `sso` redirects.
- `api/user.php`: profile-related actions (password change, SSO disconnect).
- `api/tasks.php`: list/create/update/delete tasks; supports `with=links,list_items,organization` and `view=incomplete`.
- `api/slots.php`: list slots for day or date range, create, update (resize, complete), delete; handles recurring occurrences.
- `api/accomplished.php`: list completed tasks by date or all.
- `api/links.php`: CRUD for `task_links`.
- `api/task_list_items.php`: CRUD for `task_list_items` and order.
- `api/organization.php`: CRUD for categories, subcategories, tags.
- `api/settings.php`: get/patch schedule/timezone settings.
- `api/ical_subscriptions.php`: manage external iCal feeds and stream/preview them.
- `api/ical_events.php`: sync-and-store external events into `ical_feed_events`, and read them by date range.
- `api/ical_excluded.php`: manage excluded external iCal event UIDs.
- `api/ical.php`: serves the user’s own iCal feed from their scheduled slots (for subscribing elsewhere).
- `api/admin.php`: global admin settings, user list, iCal fetch debug info.
- `api/chat.php`: AI assistant endpoint.
- `api/day.php`: get-or-create `day_record` for a date.
- `api/rollover.php`: rollover rules for end-of-day handling (incomplete tasks and recurring behavior).

---

### 6. UX & interaction patterns (selected)

- **Panels**:
  - Main horizontal slide between Completed, Tasks, and AI. On mobile, horizontal swipes near screen edges change panels.
- **Task editing**:
  - Single-click selects, double-click on task titles (in list or schedule) enters inline edit mode.
  - Checkboxes for checklist items and schedule blocks toggle completion, with special prompts for recurring tasks.
- **Drag & drop**:
  - Tasks can be reordered or moved between Unassigned/Pending/Incomplete and the schedule.
  - Dragging to specific zones triggers different behaviors (e.g. moving into the “Incomplete” area, constrained by rules).
- **Dark theme**:
  - Global design is dark-mode by default; colors in `app/globals.css` define the main palette, including task priorities and category/tag colors.

---

### 7. Demo account profile

On demo login (username `demo`, password `demo`), the app:

- Ensures the demo user exists and its DB has all migrations applied.
- Clears and reseeds the demo DB via `lib/demo_seed.php`:
  - Creates two weeks of `day_record` entries around today.
  - Inserts a curated set of tasks (review priorities, exercise, Project Alpha tasks, weekly planning, etc.) with mixed priorities, list states, and list styles.
  - Defines subtasks for certain tasks (e.g. Project Alpha and Weekly planning).
  - Adds links to several tasks (tickets, docs, Figma, API docs).
  - Adds list items (checklists) for design and weekly planning tasks.
  - Seeds `scheduled_slots` for yesterday, today, tomorrow, and a few other days, with a mix of completed/incomplete slots.
  - Seeds organization data:
    - Categories: Work, Personal, Health.
    - Subcategories: Meetings, Deep work, Chores, Exercise.
    - Tags: urgent, this-week, focus.
    - Assigns sample tasks to categories/subcategories/tags (e.g. Fix bug #42 as Work/urgent; Exercise as Health/Exercise/focus; Weekly planning as Work/Deep work/this-week).
  - Regenerates the demo user’s iCal feed token (`ical_feed_tokens`) so old public URLs no longer work.

This seeded state is what a new visitor to the demo environment should see.

---

### 8. Known limitations / notes

- The app currently uses SQLite both for master and per-user DBs; `contracts/schema.dbml` models this, but future ports to other databases should preserve table and column semantics.
- Some features (e.g. mutual app ↔ Google Calendar sync) are specified in docs but not yet fully implemented in code; those future features are **not** part of this current-behavior spec.
- Legacy tables (like `accomplished` from the initial schema) have been removed by migrations; they do not appear in the DBML and should not be reintroduced.

Going forward, any schema changes should:

1. Be expressed as new migrations under `migrations/`.
2. Be mirrored in `contracts/schema.dbml`.
3. Be reflected, where relevant, in this specification document.

