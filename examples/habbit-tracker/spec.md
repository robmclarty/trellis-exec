# Spec: Habit Tracker

**Pitch**: `.specs/habit-tracker/pitch.md`
**Date**: 2026-03-13

---

## §1 — Context

People trying to build lasting habits are caught between heavyweight apps that require accounts and cloud sync, and bare-bones tools that provide no meaningful feedback on whether a habit is actually sticking. This spec defines a local-only, single-user habit tracking web application that runs entirely in the browser, requires no account, and stores all data in the user's browser via localStorage. The app provides streak tracking, habit strength scoring, skip/excuse handling, import/export, and archiving — all without a backend.

The project is a focused greenfield v1 for a single developer. The complexity ceiling is deliberate: do it right, do not gold-plate it.

---

## §2 — Functional Overview

### Landing: Daily Dashboard

When the user opens the app, they land on the Dashboard. The Dashboard shows:

- All active habits that are due today (based on each habit's schedule)
- A one-tap check-in control per habit (mark complete or mark as skipped)
- Current streak and habit strength level for each due habit
- A summary panel showing: total active habits, habits completed today / habits due today, and count of habits at each strength level (fragile, forming, solid, locked_in)

Habits not due today do not appear in the dashboard's due list but may appear in a summary section.

### Habit List

A dedicated Habits list page shows all habits (active and optionally archived). The user can:

- Filter by status: active, archived, all
- See each habit's name, schedule description, current streak, and strength level
- Tap a habit to navigate to its detail page
- Create a new habit via a button on this page

### Habit Detail

Each habit has a detail page showing:

- The habit's name, description (optional), and schedule
- A calendar heatmap showing the full history of completions, skips, and missed days
- Current streak, longest streak, and habit strength level
- A completion rate percentage for the rolling 28-day window
- Controls: mark complete (if due today), mark as skipped (if due today), retroactively check in past dates (within 60-day window via heatmap), edit habit, archive/unarchive, reset

### Creating and Editing a Habit

The user can create a habit by providing:

- Name (required)
- Description (optional)
- Schedule: one of Daily, Specific days of week (multi-select Mon–Sun), or N times per week
- Color label (for visual grouping in the list and dashboard)

The same form is used to edit an existing habit. Editing does not affect historical completions or skips.

### Check-In

From the Dashboard, the user can:

- Mark a habit complete for today
- Mark a habit as skipped for today (intentional skip — does not break streak)
- Undo a check-in for today (revert to unchecked state for that day only)

From the habit detail page, the user can additionally:

- Retroactively mark a habit complete or skipped for any past date within the most recent 60 calendar days (via the calendar heatmap or a date-specific control)
- Undo a retroactive check-in for any date within the 60-day window

A habit can only be in one state per day: unchecked, completed, or skipped.

### Archive and Reset

- **Archive**: Sets the habit to inactive. It disappears from the dashboard and is hidden by default in the list. All history is preserved. The habit can be unarchived at any time and resumes from where it left off.
- **Unarchive**: Returns the habit to active status. Full history is immediately available again.
- **Reset**: Clears all completions, skips, and streak data for the habit. The habit definition (name, schedule, color) is preserved. Useful when stored data has become stale or corrupt (e.g., after a data format change). Reset does not archive the habit — it remains active.

Hard deletion of habits is not supported.

### Import / Export

- **Export**: A single action that serializes the entire app state (all habits, all completions, all skips, preferences) to a JSON file and downloads it to the user's device.
- **Import (full replace)**: A file picker that reads a JSON file. Before applying the import, the app prompts the user to export their current data as a safety net. After the user acknowledges the prompt, the current state is fully replaced by the imported data. There is no merge or diff — it is a full replace.

### Preferences

A settings area where the user can toggle dark mode. The preference is persisted in localStorage.

### Navigation

A persistent bottom navigation bar links to: Dashboard, Habits (list), and Settings. The app is responsive and mobile-friendly.

---

## §3 — Actors and Permissions

There is a single actor: the **user** (the person running the app in their browser). There is no authentication, no accounts, and no multi-user support.

The user can:

- Create, edit, archive, unarchive, and reset any habit
- Mark any active habit as complete or skipped for today (from Dashboard or detail page)
- Retroactively mark any active habit as complete or skipped for any date within the past 60 days (from detail page only)
- Undo a check-in for today or any date within the 60-day retroactive window
- Export all app data as JSON
- Import a JSON file to fully replace all app data
- Toggle dark mode

There are no roles, no access controls, and no notion of ownership beyond "this is your browser's localStorage."

---

## §4 — Data Model

All data is stored in localStorage as a single serialized JSON object. The top-level shape is:

```
AppState {
  habits: Habit[]
  preferences: Preferences
  schemaVersion: number      // integer; v1 = 1
}
```

### Habit

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string | no | Unique identifier. Stable after creation. |
| `name` | string | no | Display name. 1–100 characters. |
| `description` | string | yes | Optional free-text note. Max 500 characters. |
| `schedule` | Schedule | no | See Schedule type below. |
| `color` | string | no | One of the allowed color labels. See Color enum. |
| `completions` | string[] | no | ISO 8601 date strings (YYYY-MM-DD). One entry per completed day. No duplicates. |
| `skips` | string[] | no | ISO 8601 date strings (YYYY-MM-DD). One entry per skipped day. No duplicates. |
| `createdAt` | string | no | ISO 8601 datetime string. Set on creation. Never updated. |
| `archivedAt` | string | yes | ISO 8601 datetime string. `null` when active. Set when archived. Cleared on unarchive. |

A date string may not appear in both `completions` and `skips` simultaneously. That constraint is enforced by the application, not the storage format.

### Schedule

Schedule is a tagged union with three variants:

**Daily**
```
{ type: "daily" }
```
The habit is due every calendar day.

**Specific days of week**
```
{ type: "days_of_week", days: DayOfWeek[] }
```
`days` is a non-empty array of `DayOfWeek` values. The habit is due on those days each week.

**N times per week**
```
{ type: "times_per_week", n: number }
```
`n` is an integer between 1 and 7 inclusive. The habit is due `n` times within a calendar week (Monday–Sunday). The user chooses which days to complete it.

### DayOfWeek enum

Exhaustive set: `"monday"`, `"tuesday"`, `"wednesday"`, `"thursday"`, `"friday"`, `"saturday"`, `"sunday"`

### Color enum

Exhaustive set: `"red"`, `"orange"`, `"green"`, `"teal"`, `"blue"`, `"purple"`, `"pink"`

### HabitStrengthLevel enum

Exhaustive set (ordered weakest to strongest): `"fragile"`, `"forming"`, `"solid"`, `"locked_in"`

### Preferences

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `darkMode` | boolean | no | `true` if dark theme is active. Default `false`. |

---

## §5 — Interfaces

The app has no external API. All interfaces are user-facing UI flows and the import/export file contract.

### 5.1 — Export

**Trigger**: User taps the Export button in Settings.

**Behavior**:
1. Serialize the current `AppState` to JSON (pretty-printed).
2. Trigger a browser file download with filename `habit-tracker-export-YYYY-MM-DD.json` where the date is the current local date.
3. No confirmation dialog required.

**Output file shape**: The full `AppState` object as defined in §4.

**Errors**:
- If serialization fails (e.g., data is undefined), display an inline error message. Do not crash.

### 5.2 — Import

**Trigger**: User taps the Import button in Settings and selects a `.json` file.

**Behavior**:
1. Before opening the file picker, display a modal prompt: "Before importing, we recommend exporting your current data as a backup. Export now?" with two actions: "Export and continue" and "Skip and continue." If "Export and continue" is chosen, perform the export flow (5.1) and then proceed. If "Skip and continue" is chosen, proceed directly.
2. Open the file picker limited to `.json` files.
3. Read the selected file.
4. Parse the JSON. If parsing fails, display an error: "The selected file is not valid JSON. No changes were made."
5. Validate that the parsed object matches the expected `AppState` shape (presence of `habits` array, `preferences` object, `schemaVersion` number). If validation fails, display an error: "The file format is not recognized. No changes were made."
6. Display a final confirmation: "This will replace all your current data. This cannot be undone. Continue?" with "Replace data" and "Cancel" actions.
7. If confirmed, replace the entire `AppState` in localStorage with the imported object.
8. Reload app state from localStorage so the UI reflects the imported data without a full page reload.

**Errors**:
- File read failure: "Could not read the file. No changes were made."
- JSON parse failure: "The selected file is not valid JSON. No changes were made."
- Shape validation failure: "The file format is not recognized. No changes were made."

**Notes**: There is no migration logic. The import format is the internal format. A file exported from a different `schemaVersion` is not guaranteed to work. This is explicitly out of scope at v1.

### 5.3 — Encryption hook (scaffolding only)

The persistence layer exposes a pre-save hook point where an encryption function can be plugged in. At v1, this hook is a passthrough (no-op). The interface is:

- `save(state)` calls `preSaveHook(state)` before writing to localStorage. The hook receives the serialized state and returns the value to write.
- At v1, `preSaveHook` is `(data) => data` (identity function).
- Similarly, `load()` calls `postLoadHook(raw)` after reading from localStorage, before parsing. At v1, `postLoadHook` is `(data) => data`.

No encryption is implemented. The hooks exist so encryption can be inserted at a single point when needed.

---

## §6 — Business Rules

### 6.1 — Determining if a habit is due today

Given a habit and a current date:

- **Daily**: Due every day. Always due unless archived.
- **Days of week**: Due if the current day of the week is in `schedule.days`.
- **Times per week**: Due on any day of the current Monday–Sunday week until `n` completions have been recorded in that week. Once `n` completions exist in the current week, the habit is not due for the remainder of that week.
  - Extra completions beyond `n` in a given week are allowed and recorded but the habit is considered "satisfied" once `n` is reached.
  - Example: schedule `n=3`, completions on Mon/Tue/Wed → habit is not due on Thu–Sun, but the user may still mark it complete on those days.

Archived habits are never due.

### 6.2 — Streak calculation

A streak is the count of consecutive scheduled days on which the habit was either completed or skipped (where skip is treated as neutral — it does not contribute to the streak count but does not break it).

**Definitions**:
- A **scheduled day** is any day on which the habit would be due per its schedule (ignoring whether it is archived).
- A **completed day** is a day with an entry in `completions`.
- A **skipped day** is a day with an entry in `skips`.
- A **missed day** is a scheduled day that is neither completed nor skipped and is in the past.

**Current streak algorithm**:
1. Starting from today and going backwards through scheduled days only:
2. If today is a scheduled day and it is neither completed nor skipped: the current streak starts from yesterday's assessment (today is still pending, not missed).
3. For each scheduled day going backwards: if the day is completed or skipped, continue. If the day is missed, stop.
4. The streak count is the number of consecutive non-missed scheduled days ending at the most recent completed or skipped scheduled day.

**Schedule-specific streak semantics**:
- **Daily**: Consecutive calendar days.
- **Days of week**: Consecutive occurrences of the habit's scheduled days. For a Mon/Wed/Fri habit, the streak sequence is ...Mon, Wed, Fri, Mon, Wed, Fri... Missing Wednesday breaks the streak even if Monday and Friday are completed.
- **Times per week**: A "week" (Mon–Sun) counts as a completed week if at least `n` completions occurred within it. Weeks are the unit of streak counting. A missed week (fewer than `n` completions, week is in the past) breaks the streak.

**Longest streak**: The maximum streak value ever recorded for the habit. Computed from the full history at calculation time. Persisted as a computed value is not required — it is derived on demand.

### 6.3 — Habit strength calculation

Habit strength is a rolling 28-day completion rate, binned into four named levels.

**Calculation**:
1. Count the number of scheduled days that fall within the most recent 28 calendar days (not counting future days). Call this `scheduledCount`.
2. Count the number of those days that have a completion entry (skips do not count toward completions). Call this `completedCount`.
3. If `scheduledCount` is 0, return `"fragile"`.
4. Compute `rate = completedCount / scheduledCount`.
5. Bin by rate:
   - `rate < 0.40` → `"fragile"`
   - `0.40 ≤ rate < 0.65` → `"forming"`
   - `0.65 ≤ rate < 0.85` → `"solid"`
   - `rate ≥ 0.85` → `"locked_in"`

**Rationale**: The formula is a simple rolling percentage. It is explainable in one sentence: "Your strength is how often you've completed this habit over the past 4 weeks."

Strength is always computed on demand from the completions array. It is not stored.

### 6.4 — Check-in rules

- A user may mark a habit complete or skipped for today's date from the Dashboard or the detail page.
- A user may retroactively mark a habit complete or skipped for any past date within the most recent 60 calendar days. Dates older than 60 days cannot be modified. Retroactive check-ins are available from the habit detail page (via the calendar heatmap or a date-specific control), not from the Dashboard.
- A date may not simultaneously appear in both `completions` and `skips`.
- Marking a habit complete removes that date from `skips` if present (and vice versa).
- Undoing a check-in removes the date from whichever array it is in. Undo is available for any editable date (today or any date within the 60-day retroactive window).
- A habit due 0 times today (e.g., a days-of-week habit on a non-scheduled day) can still be marked complete if the user explicitly chooses to (extra completion). This extra completion is recorded but does not affect streak (since that day is not a scheduled day) and does count toward the 28-day rate for `times_per_week` habits.

### 6.5 — Times-per-week week boundary

The calendar week is Monday–Sunday. Week boundaries follow ISO 8601 week definitions. A completion on Sunday counts toward the week ending that Sunday, not the following week.

### 6.6 — Archive and reset

**Archive**: Sets `archivedAt` to the current datetime. Habit is excluded from dashboard and hidden by default in the list.

**Unarchive**: Sets `archivedAt` to `null`. Streak and strength resume calculation from full history. No data is modified.

**Reset**: Clears `completions` to `[]` and `skips` to `[]`. `archivedAt` is unchanged. `createdAt` is unchanged. The habit definition is preserved. This is a destructive action and requires a confirmation dialog: "Reset this habit? All completion history will be permanently deleted. This cannot be undone."

### 6.7 — Data persistence

All state changes are persisted to localStorage immediately after each action. There is no deferred write or batching. Reads are done at app initialization (once, on mount); subsequent reads come from in-memory state (React Context).

The `preSaveHook` and `postLoadHook` (see §5.3) are called on every write and read respectively.

---

## §7 — Failure Modes

### 7.1 — localStorage is unavailable

**Scenario**: The browser blocks localStorage access (e.g., private browsing mode in some browsers, or storage quota exceeded).

**Expected behavior**: On initialization, the app detects the failure and displays a full-page error state: "Your browser is blocking local storage. This app requires local storage to function. Try a different browser or disable private browsing." The app does not attempt to continue in a degraded mode.

**How to verify**: Mock `localStorage.setItem` to throw a `SecurityError`. Verify the app renders the error state rather than crashing or silently losing data.

### 7.2 — Corrupt or unrecognized data in localStorage

**Scenario**: The data in localStorage cannot be parsed as JSON or does not match the expected shape (e.g., after a manual edit or a failed import).

**Expected behavior**: On initialization, if `postLoadHook` returns data that fails JSON parsing or shape validation, the app displays an inline warning: "Your saved data could not be loaded and may be corrupted. You can import a backup file or reset all data." Two actions are offered: "Import backup" (triggers the import flow) and "Reset all data" (clears localStorage and starts fresh after a confirmation). The app does not crash.

**How to verify**: Write an invalid JSON string to the app's localStorage key. Verify the app displays the recovery prompt and does not render a blank screen or throw an uncaught exception.

### 7.3 — Import file is malformed

**Scenario**: The user selects a file that is not valid JSON or does not match the AppState shape.

**Expected behavior**: The import flow (§5.2 steps 4–5) displays a specific, inline error message. No state is modified. The user can try again or cancel.

**How to verify**: Attempt to import a file containing `"not json at all"`. Verify the error message appears and localStorage is unchanged.

### 7.4 — Habit check-in on non-due day

**Scenario**: A user attempts to check in a habit on a day when it is not scheduled (e.g., a Mon/Wed/Fri habit on a Tuesday).

**Expected behavior**: The check-in control is not shown in the dashboard (since the habit is not due). On the detail page, an "extra completion" option is available but clearly labeled as off-schedule. Completing it records the date in `completions` but streak calculation skips it.

**How to verify**: Create a Mon/Wed/Fri habit. On a Tuesday, verify the habit does not appear in the due list. On the detail page, verify the extra completion is recordable and does not increment the streak.

### 7.5 — Duplicate date in completions or skips

**Scenario**: A code path attempts to add a date that already exists in `completions` or `skips`.

**Expected behavior**: The repository layer deduplicates on write. Adding a date already present in an array is a no-op. No error is surfaced to the user.

**How to verify**: Dispatch `MARK_COMPLETE` twice for the same date. Verify `completions` contains the date exactly once.

### 7.6 — Import replaces data, user regrets it

**Scenario**: The user completes a full-replace import and immediately wishes they had not.

**Expected behavior**: The pre-import prompt (§5.2 step 1) prompted them to export first. There is no undo for the import. The only recovery path is re-importing a backup. This is expected and documented behavior, not a bug.

---

## §8 — Success Criteria

### Automated tests

**Streak — daily habit**
- Setup: A daily habit with completions on the 7 days prior to today, no skips.
- Action: Call `calculateCurrentStreak`.
- Expected: Returns 7.

**Streak — daily habit with skip**
- Setup: A daily habit with completions on days -7 to -2 (relative to today) and a skip on day -1.
- Action: Call `calculateCurrentStreak`.
- Expected: Returns 7 (skip does not break streak, contributes 0 to count but preserves continuity).

**Streak — daily habit with gap**
- Setup: A daily habit with completions on days -7 to -5 and -3 to today. Day -4 is missed.
- Action: Call `calculateCurrentStreak`.
- Expected: Returns 4 (streak starting from day -3).

**Streak — days-of-week habit**
- Setup: A Mon/Wed/Fri habit. Completions on Monday and Friday of the current week, skip on Wednesday.
- Action: Call `calculateCurrentStreak` on Friday.
- Expected: Returns 3 (Mon counted as 1, Wed as 1 (skipped), Fri as 1).

**Streak — days-of-week habit, missed middle day**
- Setup: A Mon/Wed/Fri habit. Completion on Monday. Wednesday is missed. Completion on Friday.
- Action: Call `calculateCurrentStreak` on Friday.
- Expected: Returns 1 (streak broken by Wednesday miss; only Friday counted).

**Streak — times-per-week habit, week satisfied**
- Setup: A `times_per_week, n=3` habit. Completions on Mon/Wed/Fri of the prior week. No completions this week so far (current day is Tuesday).
- Action: Call `calculateCurrentStreak`.
- Expected: Returns 1 (prior week satisfied; current week still in progress — not yet missed).

**Streak — times-per-week habit, prior week missed**
- Setup: A `times_per_week, n=3` habit. Completions: 2 completions in the prior week (below target). Current week has 3 completions.
- Action: Call `calculateCurrentStreak`.
- Expected: Returns 1 (prior week is a missed week; current week streak = 1).

**Habit strength — locked_in**
- Setup: A daily habit with completions on all 28 days of the rolling window.
- Expected: `calculateStrength` returns `"locked_in"`.

**Habit strength — fragile**
- Setup: A daily habit with completions on 10 of 28 scheduled days (rate ≈ 0.357).
- Expected: `calculateStrength` returns `"fragile"`.

**Habit strength — forming**
- Setup: A daily habit with completions on 15 of 28 days (rate ≈ 0.536).
- Expected: `calculateStrength` returns `"forming"`.

**Habit strength — solid**
- Setup: A daily habit with completions on 21 of 28 days (rate = 0.75).
- Expected: `calculateStrength` returns `"solid"`.

**Habit strength — no scheduled days**
- Setup: A days-of-week habit (Mon only) evaluated on a 28-day window containing no Mondays (edge case if habit was just created).
- Expected: `calculateStrength` returns `"fragile"`.

**Due-today — daily**
- Setup: A daily active habit.
- Expected: `isHabitDueToday` returns `true` for any day.

**Due-today — days-of-week, matching day**
- Setup: A Mon/Wed/Fri habit. Current day is Wednesday.
- Expected: `isHabitDueToday` returns `true`.

**Due-today — days-of-week, non-matching day**
- Setup: A Mon/Wed/Fri habit. Current day is Tuesday.
- Expected: `isHabitDueToday` returns `false`.

**Due-today — times-per-week, quota not yet reached**
- Setup: A `n=3` habit. 2 completions in the current week.
- Expected: `isHabitDueToday` returns `true`.

**Due-today — times-per-week, quota reached**
- Setup: A `n=3` habit. 3 completions in the current week.
- Expected: `isHabitDueToday` returns `false`.

**Due-today — archived habit**
- Setup: Any habit with `archivedAt` set.
- Expected: `isHabitDueToday` returns `false`.

**Check-in — adding completion removes skip for same date**
- Setup: A habit with a skip on today's date.
- Action: Dispatch `MARK_COMPLETE` for today.
- Expected: `completions` contains today, `skips` does not contain today.

**Check-in — adding skip removes completion for same date**
- Setup: A habit with a completion on today's date.
- Action: Dispatch `MARK_SKIP` for today.
- Expected: `skips` contains today, `completions` does not contain today.

**Reset — clears history only**
- Setup: A habit with completions, skips, a name, and a schedule.
- Action: Call `resetHabit`.
- Expected: `completions` is `[]`, `skips` is `[]`. `name`, `schedule`, `id`, `createdAt` are unchanged.

**Export — file download**
- Setup: App state with at least two habits.
- Action: Trigger export.
- Expected: A JSON file is downloaded containing a valid `AppState` with `schemaVersion: 1`.

**Import — malformed JSON rejected**
- Setup: A file with content `"this is not json"`.
- Action: Attempt import.
- Expected: Error message displayed. localStorage unchanged.

**Import — valid file replaces state**
- Setup: App state with habit A. Import file containing habit B only.
- Action: Confirm the import flow.
- Expected: `getAll()` returns `[habit B]` only. Habit A is gone.

**Retroactive check-in — within 60-day window**
- Setup: A daily habit with no completion on a date 30 days ago.
- Action: Mark that date as complete via retroactive check-in.
- Expected: The date appears in `completions`. Streak and strength recalculate to reflect it.

**Retroactive check-in — outside 60-day window**
- Setup: A daily habit with no completion on a date 61 days ago.
- Action: Attempt to mark that date as complete.
- Expected: The action is rejected. The date is not added to `completions`.

**Retroactive undo — within window**
- Setup: A habit with a completion on a date 15 days ago.
- Action: Undo the check-in for that date.
- Expected: The date is removed from `completions`.

### Integration tests

**Dashboard shows only due habits**
- Render the Dashboard with a mix of active habits (some due today, some not) and one archived habit.
- Verify only active, due-today habits appear in the check-in list.

**Habit detail shows full history**
- Create a habit with completions spanning multiple months.
- Navigate to its detail page.
- Verify the calendar heatmap renders cells for each historical month and the correct cells are colored as completed.

**Settings: dark mode toggle**
- Toggle dark mode on.
- Verify the `darkMode: true` preference is persisted in localStorage.
- Reload the app.
- Verify the dark theme is applied on startup.

**Import safety prompt**
- Trigger the import flow.
- Verify the export-first prompt appears before the file picker opens.
- Choose "Skip and continue."
- Verify the file picker opens and the import proceeds normally.

### Architectural checks

- No component in `/views` reads from or writes to localStorage directly. All access goes through the adapter layer.
- No behavior module in `/behaviors` imports from `/views`, `/repositories`, or `/adapters`.
- The `preSaveHook` and `postLoadHook` functions are called in the localStorage adapter on every write and read respectively, and swapping them for identity functions does not change observable behavior at v1.
- All streak and strength calculations are pure functions with no side effects.
- No habit's date appears simultaneously in both `completions` and `skips`.

---

## §9 — Constraints

### Scope constraints (from pitch no-gos)

- No backend, server, or API of any kind.
- No user accounts, login, or authentication.
- No cloud sync or multi-device support.
- No push notifications or reminders.
- No hard deletion of habits — archive only. History is always preserved (reset is the only data-clearing action, and it is explicit).
- No social features, sharing, or exported reports beyond raw JSON.
- No migration system for import format changes at v1. Import format is identical to the internal storage format.
- No offline service worker or PWA packaging. The Docker-served static bundle is sufficient.

### Scope constraints (from this spec)

- No per-habit notification or reminder configuration.
- Retroactive check-ins are limited to the most recent 60 calendar days. Dates older than 60 days are read-only.
- The encryption hooks (§5.3) are scaffolding only. No encryption is implemented at v1.

### Technical constraints

- Follows all conventions and architecture in `.specs/guidelines.md` without exception.
- All persistence goes through the `localStorageAdapter`. No other part of the app reads or writes `localStorage` directly.
- Habit strength and streak values are always computed on demand from the raw `completions` and `skips` arrays. They are not stored as derived fields.
- The app must function correctly in the latest stable versions of Chrome, Firefox, and Safari. No IE or legacy browser support is required.
- The app must be usable on a 375px-wide mobile viewport without horizontal scrolling.

### Operational constraints

- Distributed as a Docker image (nginx serving the Vite static build). No other distribution format.
- No CI/CD pipeline at v1. The Dockerfile is the artifact of record.
- localStorage capacity limits apply. No guardrails are required at v1, but the user is not warned if they approach the browser's storage limit.

---

## §10 — Open Questions

**Q1: Retroactive check-in** — *Resolved*
Retroactive check-ins are supported for the most recent 60 calendar days via the habit detail page. See §6.4.

**Q2: Habit reordering**
The spec defines no ordering for habits in the list or dashboard. Will habits appear in creation order? Should users be able to drag-reorder them?
*Deferred*: Creation order is the assumed default. Manual reordering is out of scope for v1 but is a likely request.

**Q3: `times_per_week` extra completions and streak**
The spec states that for a `times_per_week` habit, a "week" counts as satisfied if `n` completions occurred. Extra completions beyond `n` in a single week are recorded. It is unspecified whether extra completions in a missed week can partially satisfy the next week's count.
*Deferred*: The assumption is completions are counted within their calendar week only and do not roll over. This should be confirmed against user expectations.

**Q4: Habit color meaning**
The spec defines a Color enum for visual grouping but does not define how color is used in the UI beyond visual differentiation. Is there any behavior tied to color (filtering, grouping, sorting)?
*Deferred*: At v1, color is purely cosmetic. If filtering-by-color is desired, it belongs in a follow-on pitch.

**Q5: Dashboard summary panel content** — *Resolved*
The summary panel displays: total active habits, habits completed today / habits due today, and count of habits at each strength level. See §2.

**Q6: Import `schemaVersion` mismatch**
At v1, importing a file with a different `schemaVersion` fails shape validation and is rejected. As the schema evolves, there will be pressure to add migration logic. The no-migration constraint is explicit for v1, but the `schemaVersion` field is included precisely to enable this later.
*Deferred*: Migration strategy is a future pitch. The field must be written correctly so migration tooling can detect it.

**Q7: Habit name uniqueness**
The spec does not require habit names to be unique. Two habits named "Morning run" are technically permitted. Should a uniqueness constraint be enforced?
*Deferred*: No uniqueness constraint at v1. The `id` field is the stable identifier. Duplicate names are allowed but may confuse users; consider a soft warning in a later iteration.

**Q8: Maximum habit count**
No limit is placed on the number of habits a user can create. localStorage has a practical capacity ceiling (typically 5–10 MB). Very large completion histories or many habits could approach this limit.
*Deferred*: No guardrail at v1. If this becomes a real problem, a storage-usage indicator or pruning feature belongs in a later pitch.
