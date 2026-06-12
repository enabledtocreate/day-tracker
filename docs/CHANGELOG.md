# CHANGELOG: Day Tracker

> Managed document. Must comply with template CHANGELOG.template.md.

<!-- APM:DATA
{
  "docType": "changelog",
  "version": 1,
  "markdown": "",
  "editorState": {
    "overview": {
      "summary": "Change log for Day Tracker is still being defined.",
      "versionDate": "2026-04-09T22:42:27.383Z",
      "stableId": "changelog-overview-summary-executive-summary",
      "sourceRefs": []
    },
    "entries": [],
    "openQuestions": [],
    "fragmentHistory": []
  }
}
-->

## 1. Executive Summary

<!--
APM-ID: changelog-overview-summary-executive-summary
APM-LAST-UPDATED: 2026-04-09
-->

Change log for Day Tracker is still being defined.

## 2. Change Entries

### 2026-06-03 — Contact links, map links, summary table, mobile fixes

- **Contact links (restore):** Task links accept bare email addresses and phone numbers (normalized to `mailto:` / `tel:`). Link modal uses a text field (not browser URL validation). Contact links show ✉️ / 📞 / 💬 glyphs; **Schedule Settings → Contact links** chooses email compose handler (mailto, Gmail, Outlook web, Yahoo web) and phone handler (tel vs sms), plus Gmail account slot when using Gmail.
- **Map links:** Map provider URLs and `geo:` links show 🗺️ and open via native maps handling where supported (`lib/mapLinks.ts`, `lib/taskLinks.ts`).
- **Completed summary table:** **Table** opens an in-app spreadsheet modal (same columns as Export); **Open in new tab** uses a blob URL (avoids false popup-blocker alerts).
- **Mobile bucket carousel:** Fixed swipe skipping buckets / landing on Favorites when empty buckets were hidden via CSS `display: none`.

### 2026-06-10 — Auto Block, favorites/bulk task details, schedule drafts, group rollover, mobile layout

- **Auto Block:** Tasks may assign a default block type and duration (in schedule increment steps) in Task details. Each bucket header has an Auto Block button (grid icon) that opens a modal to place unscheduled bucket tasks into matching schedule blocks for the view date, with sort order: added (old/new), priority, or due date.
- **Favorites → bucket:** Favorite templates expose **Add to bucket** (plus icon) opening a modal pre-filled from the template (bucket defaults to first bucket; title, priority, due date, auto settings, default block editable). Links and checklist items copy via `copy_from`.
- **Bulk Add:** Quick Add supports shared bucket, priority, and optional due date for all pasted titles.
- **Schedule click-to-create:** New schedule tasks stay local until a title is entered; clicking away or leaving the title empty discards the draft (no DB row).
- **Group / rollover (fix):** Rollover ungroups only **completed** past-day group members; incomplete members stay grouped. Groups with incomplete work remain visible in their bucket even when the root was completed on a prior day.
- **Mobile portrait:** Task bucket area and schedule split vertically (~42% / ~58%) so the task list is no longer overlapped by the schedule grid.


## 3. Applied Fragments

No applied fragments yet.

## 4. Open Questions

No open questions yet.
