# UI identification hooks (`dt-`)

Day Tracker uses a **`dt-` prefix** (Day Tracker) on **classes**, **`id`s**, and optional **`data-dt-*`** attributes so you can name product regions in discussions, screenshots, support, and automation without relying on visual-only or layout-only class names.

## Rules

| Mechanism | When to use |
|-----------|-------------|
| **`id="…"`** | **Globally unique** within the page. Use for top-level shells and primary panel columns. Values are centralized in `DT_ID` in `lib/uiIdentifiers.ts`. |
| **`class="dt-…"`** | **Repeatable** regions (every task list section, schedule host, etc.). **Additive**—always keep existing styling and behavior classes (`panel-slide`, `schedule-content`, `task-list-section`, …). |
| **`data-dt-*`** | Optional **structured metadata** when the same component pattern repeats—for example `data-dt-section` on task buckets. Safe for tests and analytics; does not fight Tailwind or CSS modules. |

**Do not remove** existing identifiers that shipped before this layer (`id="app"`, `id="app-bar"`, `id="main-panels"`, `data-task-id`, `data-drop-zone`, `#login-form`, `.schedule-content`, etc.). New hooks are **additive**.

## TypeScript source of truth

Import **`DT`** (class tokens) and **`DT_ID`** (unique id string values) from **`lib/uiIdentifiers.ts`** in components so renames stay consistent.

The **`Modal`** component accepts an optional **`className`** prop; semantic `dt-*` classes are merged after its base modal classes (see completed summary modal).

## `DT_ID` — unique element ids

These strings are the actual **`id` attribute values** in the DOM.

| Constant | `id` value | Applied to |
|----------|------------|------------|
| `appShell` | `dt-app-shell` | Logged-in shell wrapper in `MainApp` (contains `AppBar` + `AppPanels`). |
| `sessionLoading` | `dt-session-loading` | Session fetch loading state in `MainApp` (replaces the shell until `fetchMe` resolves). |
| `panelTasksSchedule` | `dt-panel-tasks-schedule` | Main **Tasks + schedule** column: `panel-slide-tasks` in `TaskListAndSchedule` (same node also has `DT.panelMainColumn`). |
| `panelSmartPlanning` | `dt-panel-smart-planning` | **Smart Planning** column: `panel-slide-ai` in `TaskListAndSchedule`. |

## `DT` — repeatable / additive classes

These are **`className` tokens** (not necessarily unique in the document).

| Constant | Class | Applied to |
|----------|-------|------------|
| `appMount` | `dt-app-mount` | Root mount: `#app` in `app/layout.tsx`. |
| `page` | `dt-page` | Hydrated page wrapper in `app/page.tsx`. |
| `pageBootstrapping` | `dt-page-bootstrapping` | Pre-hydration placeholder in `app/page.tsx`. |
| `loginRoot` | `dt-login-root` | Outer `LoginScreen` container (with `login-screen`). |
| `mainPanels` | `dt-main-panels` | Panel strip `#main-panels` in `AppPanels`. |
| `userSettingsContainer` | `dt-user-settings-container` | `#user-settings-view` wrapper in `AppPanels`. |
| `adminSettingsContainer` | `dt-admin-settings-container` | `#admin-settings-view` wrapper in `AppPanels`. |
| `userSettingsInner` | `dt-user-settings-inner` | `settings-inner` in `UserSettingsView`. |
| `adminSettingsInner` | `dt-admin-settings-inner` | `settings-inner` in `AdminSettingsView` (all branches). |
| `appBar` | `dt-app-bar` | `AppBar` `<header>` (also `id="app-bar"`). |
| `panelCompletedSlide` | `dt-panel-completed` | Completed strip in `CompletedPanel` (`panel-slide-completed`). |
| `panelMainColumn` | `dt-panel-main-column` | Same node as `DT_ID.panelTasksSchedule`. |
| `scheduleColumn` | `dt-schedule-column` | Schedule column shell: `left-bottom` in `TaskListAndSchedule`. |
| `scheduleContent` | `dt-schedule-content` | Schedule scroll host (keeps **`schedule-content`** for existing code and selectors such as `.left-bottom .schedule-content`). |
| `smartPlanningShell` | `dt-smart-planning-shell` | `AIPanel` root (`right-panel`). |
| `taskNewRow` | `dt-task-new-row` | “New task…” and “New template…” rows (`add-task-row`). |
| `taskListToolbar` | `dt-task-list-toolbar` | Sort / search row (`task-list-sort-row`). |
| `taskListSections` | `dt-task-list-sections` | Container `#task-list-sections` (with `task-list-sections`). |
| `taskListSection` | `dt-task-list-section` | Each Unassigned / Pending / Common wrapper (`task-list-section`). |
| `modalCompletedSummary` | `dt-modal-completed-summary` | **Completed time summary** dialog: `CompletedSummaryModal` → `Modal`. |

## `data-dt-section` — task list buckets

On each **Unassigned**, **Pending**, and **Common Tasks** section wrapper (alongside `data-drop-zone` where drag uses it):

| Attribute | Values |
|-----------|--------|
| `data-dt-section` | `unassigned` · `pending` · `common` |

**Examples (Playwright):** `page.locator('[data-dt-section="pending"]')`, or `page.locator('.dt-task-list-section[data-dt-section="unassigned"]')`.

## Legacy and product ids (do not remove)

These predate or complement `dt-*` and remain **stable hooks** for behavior, tests, and scripts:

| Hook | Role |
|------|------|
| `#app` | React mount; `data-baseurl` for API paths. |
| `#app-bar` | Top bar. |
| `#main-panels` | Horizontal panel strip. |
| `#user-settings-view`, `#admin-settings-view` | Settings overlays. |
| `#task-list-sections` | Task list + swipe container. |
| `#task-schedule-resize` | Task/schedule split resize handle. |
| `#completed-panel`, `#completed-list` | Completed tasks UI. |
| `#login-form`, `#register-form`, `#login-message` | Auth. |
| `#chat-input`, `#ai-transcript`, `#chat-advice` | Smart Planning chat (where present). |
| `data-task-id`, `data-drop-zone`, `data-schedule-*` | Drag/drop and schedule behavior. |

When adding features, prefer **`dt-*` / `data-dt-*`** for **new** cross-cutting identification; extend `lib/uiIdentifiers.ts` and this document in the same change.

## Next.js / styling

- Names describe **what** a region is (product language), not appearance.
- Coexist with presentational classes and future **Tailwind** utilities: keep **`dt-*`** as a stable semantic layer on the same nodes.

## Maintenance

Update **`lib/uiIdentifiers.ts`** and **this file** together when adding or renaming hooks. Run **`npm run build`** after client changes so `release/` stays aligned.
