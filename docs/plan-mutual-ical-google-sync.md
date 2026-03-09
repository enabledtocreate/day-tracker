# Plan: Mutual sync (Day Tracker ↔ Google Calendar)

**Phase:** Next phase — when ready, implement so Google Calendar can show tasks created in the app, and the app can optionally avoid reading back its own events.

---

## Goal

- **App → Google:** Day Tracker tasks/slots appear in Google Calendar (user can see them there).
- **Google → App:** Already done (app subscribes to iCal URL and shows Google events).
- **Read-back:** If the same calendar is used both ways, the app will fetch events it originally created; plan for that (separate calendar or deduplication).

---

## Todo list

- [ ] **Choose approach**
  - [ ] **Option A – Publish iCal feed from app:** Expose a tokenized (or public) iCal URL that returns the user’s schedule/slots as VEVENTs. User adds this URL in Google Calendar (“Add by URL”). No OAuth. Google polls the URL.
  - [ ] **Option B – Push via Google Calendar API:** OAuth + Google Calendar API to create/update/delete events in a chosen Google Calendar when user creates/updates/deletes tasks or slots. Tighter integration, more implementation work.

- [ ] **Implement chosen approach**
  - [ ] If Option A: Add API endpoint (or extend existing ical feed) that outputs slots/tasks as valid iCal (VCALENDAR/VEVENT) for the authenticated user (token or session).
  - [ ] If Option B: Add Google OAuth flow, store refresh token, implement sync (create/update/delete events on task/slot changes; handle conflict/rate limits).

- [ ] **Handle read-back**
  - [ ] **Option 1 – Separate calendar:** Push/publish Day Tracker events to a dedicated calendar (e.g. “Day Tracker”); in the app, user only subscribes to other calendars. App never fetches its own events.
  - [ ] **Option 2 – Same calendar + dedupe:** If using the same calendar for both directions, recognize app-created events in the iCal feed (e.g. custom UID prefix or X-PROP) and either hide them in the feed view or merge with task view to avoid double display.

- [ ] **Admin / UX**
  - [ ] If Option A: Document or UI for “Subscribe in Google: use this URL” (and token management).
  - [ ] If Option B: Admin or user settings for “Connect Google Calendar”, choose target calendar, and sync direction.

- [ ] **Testing**
  - [ ] Create task/slot in app → verify it appears in Google (feed or API).
  - [ ] Subscribe to that calendar in app → verify read-back behavior and any deduplication.

---

## Notes

- Existing app behavior: one-way pull from Google (iCal subscription). This plan adds the reverse direction and optional read-back handling.
- See conversation summary: “mutual sync” = app publishes iCal feed or uses Calendar API so Google can show tasks; “read back” = app may fetch those same events when subscribing to that calendar—acceptable if deduped or using a separate calendar.
