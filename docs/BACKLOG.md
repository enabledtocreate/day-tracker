# Day Tracker — product backlog

**Single backlog for open work.** Implemented behavior: [`Application-Spec.md`](Application-Spec.md). Intended / testable requirements: [`Application-SRS.md`](Application-SRS.md).

**Schema narrative:** If `docs/DATABASE_SCHEMA.md` is regenerated from APM, merge human pointers from [`.apm/DATABASE_SCHEMA_FRAGMENT.md`](../.apm/DATABASE_SCHEMA_FRAGMENT.md).

---

## Reference (stable docs)

| Topic | Document |
|--------|----------|
| AI assistant behavior | [`Application-Spec.md`](Application-Spec.md) §4.8 / §5.2, [`Application-SRS.md`](Application-SRS.md) §3.8 |
| AI JSON envelope / protocol | [`Application-Spec.md`](Application-Spec.md) §5.2, [`contracts/ai/`](../contracts/ai/) |
| Architecture overview | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Roadmap shell / templates | [`ROADMAP.md`](ROADMAP.md), [`ROADMAP.template.md`](ROADMAP.template.md) |

---

## Open bugs

### Schedule — resize / geometry

- **Single-slot blocks:** dragging the **top** edge **down** cannot move the start later without violating minimum duration (one interval); use **bottom** handle to shorten, or move **top** **up** to lengthen. If we want “shrink from top” for one-interval tasks, that is a product change.
- **Overcrowded groups** (group span &lt; members × interval): clamp logic uses `currentStartMin` so the handle does not jump to an inconsistent earlier snap; verify in real data after multi-member grouping.
- **Desktop narrow columns / window resize:** when overlap makes blocks narrow, the actions **popover** must stay visible (`overflow: visible` when drawer open); re-test after **viewport resize** and multi-monitor moves.

### Regression watch

- **Recurring** edge cases: normative behavior is [`Application-SRS.md`](Application-SRS.md) §3.4.4. File new backlog items only for **measured gaps** vs that section.

---

## Near-term product / UX (2026-04)

- **Anthropic + admin config parity**: Claude via **Vercel** (in addition to OpenAI). **Admin** should mirror **install-time** settings. **Claude API key** (and similar): API/UI expose **last 5 characters** only; **add** or **replace** only, not in-place edit.
- **SSL + OAuth**: Fix deployment **SSL** so **Google / Outlook** SSO can be finished reliably.
- **Schedule — grouped tasks (follow-up)**: confirm stacked **Group** row + segments match expectations on **mobile**; optional **remove** duplicate root **Ungroup** if redundant.
- **Demo seed**: Refresh [`lib/demo_seed.php`](../lib/demo_seed.php) (and release sync) for groups, templates, AI-related stories, org, schedule.
- **Common Tasks**: Optional **folder / hierarchy** for templates.

---

## Integrations & platform

- **SSL** (see above) — prerequisite for OAuth reliability.

### Calendar: outbound feed (implemented) vs full mutual sync (remaining)

**Already shipped (baseline “Option A” publish):** Tokenized **outbound iCal** per user (`ical_feed_tokens` + `api/ical.php`); user can add the URL in Google Calendar (“Add by URL”) so tasks/slots appear there. Inbound: app subscribes to external iCal URLs.

**Still open / decide:**

- **Google Calendar API push (“Option B”)**: OAuth, refresh token, create/update/delete events on task/slot changes; rate limits and conflict handling.
- **Read-back / dedupe**: If the user subscribes inside the app to the **same** calendar that also receives app-published events, avoid double display — e.g. dedicated “Day Tracker” calendar only, **or** UID prefix / `X-PROP` tagging and merge/dedupe in the app (see [`Application-SRS.md`](Application-SRS.md) §3.6.2).
- **Admin / UX**: Surface outbound URL clearly (partially in Settings); Option B settings for “Connect Google” + target calendar.

### Interaction research (no separate doc)

- **Edge drag (#7)**: Near left/right edge of schedule/calendar, optional auto-advance **day/week** after short hover so drops can land on adjacent days. *Product review before build.* (Compare with common calendar clients: duration preservation and snap rules vary.)

---

## AI

- **User feedback workflow**: Define how users give structured feedback to the agent (instrumentation vs surveys vs in-app prompts).
- **Thread conflict UX (future)**: optional conflict indicator/merge UI if multi-tab edits require stronger guarantees than v1 last-write-wins.
- **AI context snapshots (future)**: evaluate redacted debug/export snapshots only if supportability requires them.

---

## Ideas (unscheduled)

- **Category icons** associated with tasks/categories.
- **Schedule zoom**.
- **Duplicate task** action.

---

## Historical note

Former scratch lists (`.apm/TODO.md` waves) are **implemented** for task groups, Common Tasks, mobile swipe, iCal completion persistence, bulk schedule actions, etc. Details live in **Application-Spec** and **Application-SRS**; this file holds **open** items only.
