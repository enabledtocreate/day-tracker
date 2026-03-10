# TODO

## 1. Next phase: Mutual sync (Day Tracker ↔ Google Calendar)

- See **[plan-mutual-ical-google-sync.md](./plan-mutual-ical-google-sync.md)** for the full todo list (publish iCal feed or Google Calendar API, read-back handling, admin/UX).

## 2. Drag & drop (from Google Calendar doc)

- **#7 – Edge drag to change day/week**: When dragging a task (from list or schedule) near the left/right edge of the schedule or calendar, optionally auto-advance the visible date (e.g. next/previous day) after a short hover so the user can drop on another day without releasing and changing date first. *Needs product review before implementation.*

## 3. Features

- Tasks can have one category, one subcategory, and multiple tags to a task.  A subcategory can only be added to after a category is added. Tags can be added add hock.  When adding tags, a user has the ability to write a new tag, but an autocomplete will appear below that is populated from previously added tags, and if its new (created here) a random color is assigned to it.
- Categories and subcategory appear underneath the task description in font size of the task added date.  Tags appear in the same font size to the right of task description. 
- Add an organization icon with green superscript + sign, this is where the category, subcategory, and tags can be added to a task.
- Add a search bar above the text box for adding tasks with a search icon.  This filters out tasks by description, link description, or task item
- User-> User Settings: Create a hierarchical view of options.  Add "Profile" and move username and password there. Add "Subscriptions" and move Calendar feed and Subscribed calendards there. Add "Schedule Settings" and move Increment and Timezone from the Schedule view there. Add "Organization" and have the ability to add/edit/delete categories, subcategories, and tags.  As well as set colors.
- Change the icon 
- in task view for the list items modal, only show the modal on mobile mode, it doesn't need to show on desktop mode, but leave the add list button in both desktop and mobile.
- Have ability to exclude an ical task by UID.  Put the icon function on the task next to the task complete button.
- For admin settings button, Change the word to an admin icon.
- For admin, add an option to how often the application syncs the ical calendars.

## 4. Bugs

- Current: in the task view, collapse/expand icon is black and background not transparent. Correct: collapse/expand should be white, background should be transparent
- Current: in the task view, collapse/expand icon is above the links. Correct: The collpase/expand icon should be to the left at all times, and the links should be listed on teh right.
- Current: in the task view, collpase/expand, when expanded, the word "Links" is still there and the links show inline. Correct: it should only show as "Links..." in collapse mode, in expand mode, links show be listed to the right of the collapse/expand button.
- Current: Integrity constraint violation: 19 UNIQUE constraint failed: task_links.task_id, task_links.url {"file":"/homepages/46/d4299385394/htdocs/DayTracker/api/links.php","line":39,"trace":"#0 /homepages/46/d4299385394/htdocs/DayTracker/api/links.php(39): PDOStatement->execute()\n#1 {main}"} - this happens when I try to add a link that has already been added.  Correct: a validation error should show on the modal instead that says "url previous added to task".
- Current: in task view, the links when collapsed that appear next to the collapse icon are underscored as a link. Correct: There should be no underscore.
- Current: No subtasks, links, or subtasks are completely showing.
- Current: in schdule view calendar, the prev next date line scrolls with the calendar.  Correct: Move it to the header row, but only show it for the calendar.
- Apply the same corrections that are being done to links for the ui for how list and subtasks have represent themselves as well.
- Current: task view, the lists cannot change from bullets. Correct: The ui should change based on bullet or checklist, and the bullet/checklist selection should be to the right of the collapse/expand icon when its expanded, when it's collapsed it should just say "Tasks..." (nothing else inline here)
- Current: in task view the subtasks do not appear the same way parent tasks appear.  Correct: A subtask ui should look exactly like the parent task.
- Current: in task view, list add icon the "+" is subscript. Correct: make it superscript instead and make it green.
- Current: Task descriptions are too small. Correct: Task description should be .85rem.
- Current: Schdule view end range is partially hidden. Correct: IT should be be able to fit all text selections.
- Current: If a recurring task is rescheduled (the time changed), it is optomistic.  Correct: When a recurring task is moved, it should be pessimistic, in that it should ask you if you want to make changes to the time or make this a unique task, etc, whatever other choices are appropriate.
- Regression Description: Tasks overlap ical tasks. Correct: They should be able to share the space like tasks do with other tasks.
- Current: I can drag an unassigned or pending task into the incomplete area.  Correct: I should only be able to drag partially completed tasks made during schedule view into it.  This still marks completed tasks as complete, but they are not removed from the task.  If a completed task is moved out of the task, a request will ask if they want to archive it - this can only happen to subtasks.  If this action happens, and the parent task has no more completed task, the task is automatically moved to pending.
- Current: Schdule view, the drawer for functions has a "<" icon.  Correct: make it a triangle icon instead. 
- Current: Schedule view, when the drawer is open and the drawer button becomes ">", it appears under the button. Correct: the drawer should appear to the left of the button, and use the triangle icon instead.
- Current: Schedule view, the drawer appears within the task container.  Correct: It should float over it so that when pressing buttons the modals that users interact with should show completely.
- Current: The function icons are misaligned. Correct: All the function icons for a task should be aligned to the horizontal center.

## 5. Start AI

- Structure what form the initial contact with the AI agent needs to be for feedback.  We need to figure out a workflow
