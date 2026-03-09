# Google Calendar: Full Exhaustive Functionality of Drag/Drop for Events

This document describes how drag-and-drop works for **events** in Google Calendar, as observed and documented in support articles, community threads, and product behavior. It covers both web (desktop) and mobile where behavior differs.

---

## 1. Where Drag-and-Drop Is Available

### 1.1 Views that support drag-and-drop

- **Day view** – Move an event to a different time on the same day.
- **3-day view** – Move events to different times and to different days within the visible three days.
- **Week view** – Move events to different times and to different days within the visible week. On some platforms (e.g. mobile), dragging to the **edge of the screen** can move the event to an adjacent week (or month).

### 1.2 Views that do **not** support drag-and-drop

- **Month view** – Dragging events to reschedule is **not** supported. Users must open the event and edit the date/time.
- **Schedule view** – Drag-and-drop for moving events is **not** supported; rescheduling is done via the event editor.

### 1.3 Platforms

- **Web (desktop)** – Drag-and-drop is supported in Day, 3-day, and Week views. Some users report it not working in certain browsers or after updates; this is typically treated as a bug or environment issue rather than an intentional limitation.
- **Android** – Supported in Day, 3-day, and Week views (e.g. since Calendar app version 5.7.25, June 2017). Long-press an event, then drag.
- **iOS** – Behavior is similar to Android where the same views support drag-and-drop.

---

## 2. What Drag-and-Drop Does (Move vs Resize)

### 2.1 Moving an event (change time and/or date)

- **Action:** User starts a drag from the event (click-and-drag on web, long-press then drag on mobile).
- **Effect:** The event is **moved** to the drop location. Start time (and thus end time, if duration is preserved) changes to the dropped time slot.
- **Duration:** The event’s **duration is preserved** by default. Only start (and thus end) time changes.
- **Time granularity:** Times snap to **15-minute increments**. Finer control (e.g. 5 minutes) requires editing the event in the event editor.
- **Visual feedback:**
  - The **original** time slot is shown as **transparent** (or otherwise de-emphasized) while dragging.
  - A **preview** of the event follows the pointer until drop.
  - The event “hovers” over the calendar until released.

### 2.2 Resizing an event (change duration by dragging)

- **Changing duration by dragging:** In many calendar UIs, dragging the **bottom edge** of an event changes the end time (and thus duration). Dragging the **top edge** (when supported) changes the start time. Google Calendar’s **exact** support for edge-drag resizing is not fully spelled out in public help; some users report that changing duration by dragging does not work or is inconsistent. When available, it would typically be in the same views that support move (Day, 3-day, Week).
- **Creating an event by drag:** On **web**, you can **create** an event by clicking an empty time and **dragging down** to define the duration. This is a “draw to create” gesture, not moving an existing event.

---

## 3. Recurring Events

### 3.1 Dragging a single occurrence

- When the user **drops** a recurring event after dragging it to a new time/date, Google Calendar shows a **dialog** asking the scope of the change:
  - **This event** – Only that occurrence is moved (the series is split or an exception is created).
  - **All events** (or “This and following events”) – The whole series (or from that occurrence onward) is moved by the same time/days delta.

### 3.2 Moving recurring events between calendars

- Moving a recurring event to **another calendar** (via Edit event → Calendar) applies to **all future instances**; you cannot move only one occurrence to another calendar via that flow.

---

## 4. All-Day Events

- **All-day section ↔ time grid:** Dragging an **all-day** event **into** a specific time slot (or the reverse) is either unsupported or not clearly documented as a standard feature. Some third-party calendar libraries note that “drag from all-day to time grid and back” is not supported; Google Calendar’s behavior in this specific case is best verified in the product.
- **All-day events in supported views:** Where drag-and-drop is supported, all-day events can typically be dragged to **other days** in the same view (e.g. in Week view). Behavior may differ from timed events (e.g. no 15-minute snapping).

---

## 5. Permissions and Editability

### 5.1 Who can drag-and-drop

- Drag-and-drop **moves or resizes** an event, so it is an **edit** operation.
- Only users who can **edit** the event can use drag-and-drop on it:
  - **Calendar access:** User must have **“Make changes to events”** (or equivalent) / **writer** (or **owner**) role on the calendar.
  - **Event-level:** For shared events, if “Modify event” is **unchecked** for guests, those guests cannot edit (and thus cannot move events by drag-and-drop).
- **Read-only** (view-only) calendars or events do **not** allow drag-and-drop.

### 5.2 Moving between calendars

- Moving an event **to another calendar** (change of calendar/organizer) is done via **Edit event → Calendar**, not by dragging onto a different calendar in the UI. The Calendar API has an **events.move** endpoint for moving an event to another calendar; the user-facing flow is edit-based.

---

## 6. Undo and Feedback

### 6.1 Undo after drag-and-drop

- After a drag-and-drop move (and possibly resize), a temporary **Undo** control is shown (e.g. top-left of the event panel or as a snackbar).
- **Time window:** Undo is typically available for a short period (often cited as about **30 seconds to 1 minute**); after that, the option disappears or is disabled.
- **Limitations:** Once the change is “published” (e.g. invitations sent, or after the window), undo may no longer be offered to avoid conflicting updates.

### 6.2 Visual and interaction feedback

- **During drag:** Original slot transparent/ghosted; drag preview follows cursor; valid drop targets are implied by the grid.
- **After drop:** Event appears in the new position; undo appears briefly.
- **Errors:** If the move fails (e.g. permissions, network), the UI typically reverts or shows an error; exact behavior is product-dependent.

---

## 7. Cross-Day and Cross-Week Navigation While Dragging

### 7.1 Moving to another day in the same view

- In **3-day** and **Week** views, the user can drop the event on **another day** in the same visible range. The event’s **date** changes to the drop day; time (and duration) can be preserved or snapped to the drop slot depending on implementation.

### 7.2 Moving to another week or month

- **Mobile (e.g. Android):** Dragging an event to the **edge of the screen** can trigger navigation to the **next** (or previous) week or month, so the event can be dropped there.
- **Web:** Public documentation does not clearly describe **edge auto-scroll** or “drag to edge to change week/month.” Some sources indicate that Google Calendar does **not** provide automatic scrolling when dragging toward the view edge; navigating to another week/month may require using the mini calendar or week/month controls, then dragging again in the new range.

---

## 8. Time Grid and Snapping

- **Snap interval:** Event start (and end when duration is preserved) snap to **15-minute** boundaries when dropped.
- **Finer adjustment:** To set times that are not on 15-minute boundaries, the user must **edit the event** and set the time manually.
- **All-day:** All-day events are not snapped to time slots; they are placed on a **day**.

---

## 9. Summary Table


| Aspect                       | Behavior                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ |
| **Views**                    | Day, 3-day, Week: yes. Month, Schedule: no.                              |
| **Action**                   | Move event to new time/date; duration preserved by default.              |
| **Resize by edge-drag**      | Not clearly documented; may be limited or inconsistent.                  |
| **Time granularity**         | 15-minute increments; finer only via edit.                               |
| **Recurring**                | Dialog: “This event” vs “All / This and following.”                      |
| **All-day ↔ timed**          | Not clearly documented as supported.                                     |
| **Permissions**              | Requires edit (write) access; no drag for read-only.                     |
| **Between calendars**        | Via Edit event → Calendar, not drag.                                     |
| **Undo**                     | Short-lived (e.g. 30–60 s) after move.                                   |
| **Edge scroll (week/month)** | Mobile: drag to edge can change week/month; web: not clearly documented. |


---

## 10. References and Notes

- Google Calendar Help (e.g. “Create an event”) describes **creating** events by dragging on an empty time; it does not exhaustively document every drag-and-drop move/resize rule.
- Community threads (e.g. Google Calendar Help Community) report drag-and-drop not working in certain browsers or after updates, indicating the feature exists but can be sensitive to environment.
- Android app release notes (e.g. 5.7.25) explicitly added drag-and-drop for moving events across times and days in Day, 3-day, and Week views.
- Calendar API “events.move” is documented for moving an event to another calendar (API), not for in-calendar drag-and-drop behavior.
- This document is a **functional specification** of observed and documented behavior for reference (e.g. when implementing a similar calendar); it is not an official Google product specification.

