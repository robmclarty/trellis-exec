# Plan: Habit Tracker

**Spec**: `.specs/habit-tracker/spec.md`
**Date**: 2026-03-13

---

## S1 — Technical Summary

The habit tracker is a client-side React SPA built with Vite, using React Router v6 for routing, React Context + `useReducer` for state management, and CSS Modules for styling. All data lives in `localStorage` via a dedicated adapter — no backend exists at any layer. Business logic (streak calculation, strength scoring, due-today determination, check-in mutation rules) lives in pure behavior modules under `/behaviors/habits/`. UI reads and writes through repository hooks that consume the global `AppContext`. Habit IDs are UUIDv7 for time-ordered uniqueness. The app ships as a Docker image (multi-stage Vite build served by nginx). The layered architecture is: adapters → repositories → views, with behaviors called by both repositories and views as needed, and no layer reaching across its boundary.

---

## S2 — Architecture

### Component diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                            Browser                                 │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                       React App                            │    │
│  │                                                            │    │
│  │  ┌────────────────────────────────────────────────────┐    │    │
│  │  │                   Views Layer                      │    │    │
│  │  │  Dashboard.page  HabitList.page  HabitDetail.page  │    │    │
│  │  │  Settings.page   HabitForm.page  Nav component     │    │    │
│  │  └───────────────┬────────────────────────────────────┘    │    │
│  │                  │ calls hooks + pure fns                  │    │
│  │                  │                                         │    │
│  │  ┌───────────────▼──────────────┐  ┌────────────────────┐  │    │
│  │  │      Repositories Layer      │  │ Behaviors Layer    │  │    │
│  │  │  useHabitsRepository         │  │ (pure functions)   │  │    │
│  │  │  (consumes AppContext,       │  │                    │  │    │
│  │  │   dispatches actions)        │  │ streakCalculator   │  │    │
│  │  └───────────────┬──────────────┘  │ strengthCalculator │  │    │
│  │                  │ dispatches to   │ scheduleRules      │  │    │
│  │  ┌───────────────▼──────────────┐  │ completionRules    │  │    │
│  │  │   AppContext + appReducer    │  │ habitFactory       │  │    │
│  │  │   (in-memory state tree)     │  │ importValidator    │  │    │
│  │  └───────────────┬──────────────┘  └────────────────────┘  │    │
│  │                  │ persists via                            │    │
│  │  ┌───────────────▼──────────────────────────────────────┐  │    │
│  │  │              Adapters Layer                          │  │    │
│  │  │         localStorageAdapter.js                       │  │    │
│  │  │  (preSaveHook / postLoadHook passthrough)            │  │    │
│  │  └───────────────┬──────────────────────────────────────┘  │    │
│  └──────────────────│─────────────────────────────────────────┘    │
│              ┌──────▼─────────┐                                    │
│              │ localStorage   │                                    │
│              │ "habitTracker" │                                    │
│              └────────────────┘                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Key dependency rules:**
- Views call repository hooks for state reads/writes, and call behavior pure functions directly for computed values (streak, strength, due-today).
- Repositories consume `AppContext` (defined in its own file, not `App.jsx`) and dispatch to the reducer.
- The reducer calls `completionRules` (behavior) for mutation logic and `localStorageAdapter` (adapter) for persistence.
- Behaviors never import from views, repositories, or adapters. They are pure functions with no side effects.

### Component responsibilities

| Component | Technology | Responsibility | Boundary |
|---|---|---|---|
| Views | React + CSS Modules | Render UI, handle user events, call repository hooks, call behavior pure functions for computed values | Must not read `localStorage` directly; must not perform state mutations directly |
| Repositories | React hooks + `useContext` | Expose named read/write functions over `AppContext`; translate dispatch calls | Must not render JSX; must not access `localStorage` directly |
| AppContext / appReducer | React Context + `useReducer` | Single in-memory state tree; handles all mutations; persists after each action via adapter | Defined in `src/context/AppContext.js` (standalone module, not inside `App.jsx`); depends on adapter for persistence and completionRules for mutation logic |
| Adapters | Plain JS | Wrap `localStorage` with `preSaveHook` / `postLoadHook`; detect unavailability | Must not import from React or any view/repository module |
| Behaviors | Plain JS pure functions | All business logic: streak, strength, due-today, check-in mutation rules, factory, import validation | Must not import from views, repositories, or adapters; no side effects; no DOM interaction |

### Integration with existing systems

This is a greenfield project. There are no existing systems. The only external integration is the browser's `localStorage` API, accessed exclusively through `localStorageAdapter.js`.

---

## S3 — Technology Decisions

Guidelines define the full stack. This section covers only choices that are specific to the habit tracker feature or that require elaboration given the feature's requirements.

| Decision | Choice | Rationale |
|---|---|---|
| Habit ID generation | UUIDv7 | Time-ordered — IDs sort chronologically by creation time, which matches natural list order (spec §10 open Q2 defaults to creation order). Unique across imports and resets. Implemented via a small inline generator rather than a library dependency. |
| UUIDv7 implementation | Inline `generateUUIDv7` helper in `habitFactory.js` | Avoids a third-party dependency for a ~20-line function. UUIDv7 structure: 48-bit ms timestamp + version bits + 74 random bits. |
| Calendar heatmap | Custom CSS Grid component | recharts has no heatmap primitive. A bespoke `CalendarHeatmap.js` using CSS Grid is 60–80 lines and avoids evaluating third-party calendar libraries. Interactivity limited to click-to-checkin and hover tooltip per pitch guidance. |
| Date arithmetic | Native `Date` + ISO string manipulation | No date library (no date-fns, no dayjs). The behavior layer owns all date math using `Date.UTC` and ISO 8601 strings (YYYY-MM-DD). This keeps the bundle small and keeps dates predictable. |
| Week boundary | ISO 8601 (Monday = start of week) | Spec §6.5 mandates Monday–Sunday weeks. Implementation uses `getDay()` with a modulo-7 offset so Monday = 0, Sunday = 6. |
| State persistence strategy | Write-on-every-dispatch inside `habitsReducer` (via adapter) | Spec §6.7 requires immediate persistence after each action. The reducer calls `localStorageAdapter.save()` after computing next state. This is synchronous and fits the <300ms performance constraint because `localStorage` writes for this data volume complete in <1ms. |
| localStorage key | `"habitTracker"` | Single key holds the full `AppState` JSON blob. Simpler than per-habit keys; matches spec §4 top-level shape. |
| Dark mode | CSS custom properties on `:root` + `data-theme` attribute | A `data-theme="dark"` attribute on `<html>` toggles a `:root[data-theme="dark"]` CSS variable block. No JS-in-CSS. Preference read from `AppState.preferences.darkMode` on init. |
| Modal/dialog | Native `<dialog>` element | Used for import confirmation and reset confirmation. No library needed. Styled via CSS Module on a shared `Modal.js` component. |
| recharts usage | `BarChart` for strength summary panel only | recharts is in the stack for charts. Its use is limited to the dashboard summary bar chart showing counts per strength level. The heatmap is custom (see above). |

**Rejected alternatives:**

- **uuid npm package** for ID generation: Adds a dependency for a trivial function. Inline UUIDv7 is preferred.
- **date-fns / dayjs**: Adds ~13–20 KB to the bundle. All date operations needed here (diff in days, ISO string extraction, ISO week start) are achievable with `Date` and arithmetic in under 100 lines.
- **Third-party calendar heatmap** (e.g., `react-calendar-heatmap`): Evaluated per pitch guidance. The package adds ~30 KB and customizing it to match the app's interaction model (click to retroactive check-in, color by status type) is harder than building a grid from scratch.
- **Zustand / Redux** for state: Guidelines explicitly prohibit external state management libraries. Context + `useReducer` is the mandated pattern.

---

## S4 — Data Access Patterns

There is no database. All data is a single JSON blob in `localStorage`. This section covers how the `AppState` shape is read, mutated, and persisted.

### Storage key and shape

```js
// localStorageAdapter.js
const STORAGE_KEY = 'habitTracker'

const DEFAULT_STATE = {
  habits: [],
  preferences: { darkMode: false },
  schemaVersion: 1,
}
```

### Read pattern (app initialization)

Called once on mount in `App.jsx`. Returns `AppState` or `null` on failure.

```js
// /adapters/localStorage/localStorageAdapter.js

const postLoadHook = (raw) => raw  // v1: identity passthrough

const load = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const processed = postLoadHook(raw)
    return JSON.parse(processed)
  } catch (err) {
    return null
  }
}
```

### Write pattern (after every dispatch)

```js
// /adapters/localStorage/localStorageAdapter.js

const preSaveHook = (data) => data  // v1: identity passthrough

const save = (state) => {
  try {
    const serialized = JSON.stringify(state)
    const processed = preSaveHook(serialized)
    localStorage.setItem(STORAGE_KEY, processed)
    return true
  } catch (err) {
    return false
  }
}
```

### Availability check (called at init before load)

```js
const isAvailable = () => {
  try {
    const testKey = '__habitTracker_test__'
    localStorage.setItem(testKey, '1')
    localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}
```

### Reducer + persistence integration

The reducer calls `save` after computing next state. This satisfies spec §6.7 (immediate persistence after every action).

**Relationship between reducer and `completionRules.js`:** The reducer is a thin dispatcher. Each case delegates to a pure function from `completionRules.js` (behaviors layer) that receives the current state and payload, and returns a new state object. The reducer itself contains no mutation logic — it only orchestrates calling the right behavior function, persisting the result, and returning the new state.

```js
// /repositories/habits/habitsReducer.js
import { save } from '../../adapters/localStorage/localStorageAdapter'
import {
  addHabit, updateHabit, archiveHabit, unarchiveHabit,
  resetHabit, markComplete, markSkip, undoCheckin, setPreference,
} from '../../behaviors/habits/completionRules'

const habitsReducer = (state, action) => {
  const nextState = applyAction(state, action)
  save(nextState)
  return nextState
}

const applyAction = (state, action) => {
  switch (action.type) {
    case 'ADD_HABIT':       return addHabit(state, action.payload)
    case 'UPDATE_HABIT':    return updateHabit(state, action.payload)
    case 'ARCHIVE_HABIT':   return archiveHabit(state, action.payload)
    case 'UNARCHIVE_HABIT': return unarchiveHabit(state, action.payload)
    case 'RESET_HABIT':     return resetHabit(state, action.payload)
    case 'MARK_COMPLETE':   return markComplete(state, action.payload)
    case 'MARK_SKIP':       return markSkip(state, action.payload)
    case 'UNDO_CHECKIN':    return undoCheckin(state, action.payload)
    case 'SET_PREFERENCE':  return setPreference(state, action.payload)
    case 'REPLACE_STATE':   return action.payload  // used by import
    default:                return state
  }
}
```

### Key query patterns

All queries operate on in-memory `state.habits` — there is no database to query. These patterns are used within the repository and views:

| Operation | Pattern |
|---|---|
| Get all active habits | `state.habits.filter(h => h.archivedAt === null)` |
| Get habits due today | Call `isHabitDueToday(habit, today)` from `scheduleRules.js` per habit |
| Get habit by ID | `state.habits.find(h => h.id === id) ?? null` |
| Get completions in date range | `habit.completions.filter(d => d >= fromDate && d <= toDate)` |
| Get completions in ISO week | Filter by ISO week bounds (Monday–Sunday) |

### Shape validation (used by import)

```js
// /behaviors/habits/importValidator.js

const isValidAppState = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return false
  if (!Array.isArray(parsed.habits)) return false
  if (!parsed.preferences || typeof parsed.preferences !== 'object') return false
  if (typeof parsed.schemaVersion !== 'number') return false
  return true
}
```

### Migration strategy

No migrations at v1. The `schemaVersion: 1` field is written on every save so a future migration system can detect it. If a loaded state has `schemaVersion` missing or mismatched, it is treated as corrupt (spec §7.2).

---

## S5 — Interface Implementation

The app has no external API. The interfaces are: the four main UI routes, the import/export file contract, and the persistence hooks.

### Route organization

Routes are defined in `App.jsx` as the root layout. Child sections and pages define their own sub-routes via layout files.

```
/                        → Dashboard.page
/habits                  → Habits.section → HabitList.page
/habits/new              → Habits.section → HabitForm.page (create mode)
/habits/:habitId         → Habits.section → HabitDetail.page
/habits/:habitId/edit    → Habits.section → HabitForm.page (edit mode)
/settings                → Settings.page
```

```js
// /views/App.jsx (route structure only)
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from '../context/AppContext'
import { DashboardPage } from './Dashboard.page'
import { HabitsSection } from './Habits.section'
import { SettingsPage } from './Settings.page'
import Nav from './Nav'

const App = () => (
  <BrowserRouter>
    <AppProvider>
      <div className={styles.app}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/habits/*" element={<HabitsSection />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        <Nav />
      </div>
    </AppProvider>
  </BrowserRouter>
)
```

### Interface 5.1 — Export

Triggered from `Settings.page`. Serialization is a pure function in `behaviors/habits/importValidator.js`. The DOM interaction (blob creation, download trigger) lives in the view layer — behaviors never touch the DOM.

```js
// /behaviors/habits/importValidator.js (pure — no DOM)

const serializeAppState = (state) => JSON.stringify(state, null, 2)

const buildExportFilename = (today) => `habit-tracker-export-${today}.json`
```

```js
// /views/Settings.page/Settings.layout.js (DOM interaction lives here)
import { serializeAppState, buildExportFilename } from '../../behaviors/habits/importValidator'

const triggerDownload = (json, filename) => {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const handleExport = () => {
  if (!state) {
    setExportError('Could not export: no data found.')
    return
  }
  try {
    const today = new Date().toISOString().slice(0, 10)
    const json = serializeAppState(state)
    triggerDownload(json, buildExportFilename(today))
  } catch {
    setExportError('Export failed. Please try again.')
  }
}
```

### Interface 5.2 — Import

Full multi-step flow managed by `ImportFlow.js` inside `Settings.page`. State machine: `idle → confirm-backup → file-pick → validating → confirm-replace → done | error`.

```js
// /views/Settings.page/ImportFlow.js
const ImportFlow = () => {
  const [step, setStep] = useState('idle')
  const [error, setError] = useState(null)
  const { replaceState } = useHabitsRepository()

  const handleFileSelected = (file) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      let parsed
      try {
        parsed = JSON.parse(e.target.result)
      } catch {
        setError('The selected file is not valid JSON. No changes were made.')
        setStep('error')
        return
      }
      if (!isValidAppState(parsed)) {
        setError('The file format is not recognized. No changes were made.')
        setStep('error')
        return
      }
      setPending(parsed)
      setStep('confirm-replace')
    }
    reader.onerror = () => {
      setError('Could not read the file. No changes were made.')
      setStep('error')
    }
    reader.readAsText(file)
  }

  const handleConfirmReplace = () => {
    replaceState(pending)
    setStep('idle')
  }

  // ... render step-specific UI
}
```

### Interface 5.3 — Persistence hooks (scaffolding)

`preSaveHook` and `postLoadHook` are defined at the top of `localStorageAdapter.js` as identity functions. To add encryption at a later date, replace these two functions only — no other file changes required.

```js
// v1 passthroughs — replace to add encryption
const preSaveHook = (serializedString) => serializedString
const postLoadHook = (rawString) => rawString
```

### Dashboard interface

Shows habits due today with check-in controls. All due-today logic is computed from in-memory state on render — no derived data is stored.

```js
// /views/Dashboard.page/Dashboard.layout.js
import { useHabitsRepository } from '../../repositories/habits/habitsRepository'
import { isHabitDueToday } from '../../behaviors/habits/scheduleRules'
import { calculateCurrentStreak } from '../../behaviors/habits/streakCalculator'
import { calculateStrength } from '../../behaviors/habits/strengthCalculator'
import HabitCheckInRow from './HabitCheckInRow'
import SummaryPanel from './SummaryPanel'
import styles from './Dashboard.css'

const DashboardPage = () => {
  const { getAll, markComplete, markSkip, undoCheckin } = useHabitsRepository()
  const today = new Date().toISOString().slice(0, 10)
  const activeHabits = getAll().filter((h) => h.archivedAt === null)
  const dueHabits = activeHabits.filter((h) => isHabitDueToday(h, today))

  return (
    <main className={styles.dashboard}>
      <SummaryPanel habits={activeHabits} today={today} />
      <ul className={styles.checkInList}>
        {dueHabits.map((habit) => (
          <HabitCheckInRow
            key={habit.id}
            habit={habit}
            today={today}
            streak={calculateCurrentStreak(habit, today)}
            strength={calculateStrength(habit, today)}
            onComplete={() => markComplete(habit.id, today)}
            onSkip={() => markSkip(habit.id, today)}
            onUndo={() => undoCheckin(habit.id, today)}
          />
        ))}
      </ul>
    </main>
  )
}
```

### Habit Detail interface

Shows calendar heatmap, streaks, strength, and controls. Retroactive check-ins route through the same repository functions with a date parameter.

Key implementation notes:
- The `CalendarHeatmap` component renders a CSS Grid of day cells for the past 60 days. Each cell shows status (completed / skipped / missed / not-scheduled / future) via a `data-status` attribute targeted by CSS.
- Cells older than 60 days render as read-only (no click handler).
- Each cell click calls `markComplete(id, date)`, `markSkip(id, date)`, or `undoCheckin(id, date)` depending on current cell state.

### Settings interface

Two sections: dark mode toggle and import/export. Dark mode toggle dispatches `SET_PREFERENCE` (preferences are part of the single `AppContext` — there is no separate preferences repository). Export calls `serializeAppState` + `triggerDownload` (view-local helper). Import launches `ImportFlow`.

### Navigation

A persistent `<Nav>` component rendered in `App.jsx` outside the route `<Routes>`. Fixed to the bottom on mobile via CSS.

```js
// /views/Nav/Nav.js
import { NavLink } from 'react-router-dom'
import styles from './Nav.css'

const Nav = () => (
  <nav className={styles.nav}>
    <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : undefined}>
      Dashboard
    </NavLink>
    <NavLink to="/habits" className={({ isActive }) => isActive ? styles.active : undefined}>
      Habits
    </NavLink>
    <NavLink to="/settings" className={({ isActive }) => isActive ? styles.active : undefined}>
      Settings
    </NavLink>
  </nav>
)
```

### Initialization and error boundary

`AppContext.js` owns the context, reducer, and initialization logic. It checks `isAvailable()` before mounting. If unavailable, it renders the full-page storage error. If `load()` returns corrupt data, it renders the recovery prompt. `App.jsx` imports `AppProvider` — it does not define the context itself. This avoids a circular dependency between repositories (which consume the context) and views (which define `App.jsx`).

```js
// /context/AppContext.js
import { createContext, useState, useReducer } from 'react'
import { isAvailable, load } from '../adapters/localStorage/localStorageAdapter'
import { isValidAppState } from '../behaviors/habits/importValidator'
import { habitsReducer } from '../repositories/habits/habitsReducer'

const AppContext = createContext(null)

const DEFAULT_STATE = {
  habits: [],
  preferences: { darkMode: false },
  schemaVersion: 1,
}

const AppProvider = ({ children }) => {
  const [initError, setInitError] = useState(null)
  const [state, dispatch] = useReducer(habitsReducer, null, () => {
    if (!isAvailable()) {
      setInitError('unavailable')
      return DEFAULT_STATE
    }
    const loaded = load()
    if (loaded === null) return DEFAULT_STATE  // first run
    if (!isValidAppState(loaded)) {
      setInitError('corrupt')
      return DEFAULT_STATE
    }
    return loaded
  })

  if (initError === 'unavailable') return <StorageUnavailableError />
  if (initError === 'corrupt') return <CorruptDataRecovery dispatch={dispatch} />

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export { AppContext, AppProvider }
```
```

---

## S6 — File Structure

```
habit-tracker/
├── Dockerfile
├── package.json
├── vite.config.js
├── index.html
│
├── config/                          # Build and environment configuration
│   └── nginx.conf                   # nginx config for Docker image
│
├── docs/                            # Developer documentation (architecture notes, etc.)
│
├── public/                          # Static assets served as-is by Vite
│   └── favicon.ico
│
├── src/
│   ├── main.jsx                     # React entry point; mounts <App />
│   │
│   ├── context/
│   │   ├── AppContext.js               # AppContext, AppProvider (useReducer + init logic)
│   │   └── __tests__/
│   │       └── AppContext.test.js
│   │
│   ├── adapters/
│   │   └── localStorage/
│   │       ├── localStorageAdapter.js   # save(), load(), isAvailable(), preSaveHook, postLoadHook
│   │       └── __tests__/
│   │           └── localStorageAdapter.test.js
│   │
│   ├── behaviors/
│   │   └── habits/
│   │       ├── completionRules.js       # addHabit, updateHabit, archiveHabit, unarchiveHabit, resetHabit, markComplete, markSkip, undoCheckin, setPreference (all pure state→state fns)
│   │       ├── habitFactory.js          # createHabit(), generateUUIDv7()
│   │       ├── importValidator.js       # isValidAppState(), serializeAppState(), buildExportFilename()
│   │       ├── scheduleRules.js         # isHabitDueToday(), getScheduledDaysInRange()
│   │       ├── strengthCalculator.js    # calculateStrength()
│   │       ├── streakCalculator.js      # calculateCurrentStreak(), calculateLongestStreak()
│   │       └── __tests__/
│   │           ├── completionRules.test.js
│   │           ├── habitFactory.test.js
│   │           ├── importValidator.test.js
│   │           ├── scheduleRules.test.js
│   │           ├── strengthCalculator.test.js
│   │           └── streakCalculator.test.js
│   │
│   ├── repositories/
│   │   └── habits/
│   │       ├── habitsReducer.js         # applyAction() switch; delegates to completionRules; calls save() after each action
│   │       ├── habitsRepository.js      # useHabitsRepository() hook (consumes AppContext)
│   │       └── __tests__/
│   │           └── habitsReducer.test.js
│   │
│   └── views/
│       ├── App.jsx                      # Root: HabitsProvider, BrowserRouter, routes, Nav
│       ├── App.css                      # Root layout, CSS custom properties (light + dark themes)
│       │
│       ├── Nav/
│       │   ├── Nav.js
│       │   └── Nav.css
│       │
│       ├── shared/                      # Reusable components used across multiple pages
│       │   ├── Modal/
│       │   │   ├── Modal.js             # Wraps <dialog>; accepts title, children, onClose
│       │   │   └── Modal.css
│       │   ├── StreakBadge/
│       │   │   ├── StreakBadge.js
│       │   │   └── StreakBadge.css
│       │   ├── StrengthBadge/
│       │   │   ├── StrengthBadge.js    # Renders fragile/forming/solid/locked_in pill
│       │   │   └── StrengthBadge.css
│       │   └── CalendarHeatmap/
│       │       ├── CalendarHeatmap.js  # CSS Grid heatmap; accepts habit + onCellClick
│       │       ├── CalendarHeatmap.css
│       │       └── __tests__/
│       │           └── CalendarHeatmap.test.js
│       │
│       ├── Dashboard.page/
│       │   ├── index.js                 # export { DashboardPage }
│       │   ├── Dashboard.layout.js      # Page component
│       │   ├── Dashboard.css
│       │   ├── HabitCheckInRow.js       # Per-habit row with complete/skip/undo controls
│       │   ├── SummaryPanel.js          # Total active, completed/due counts, strength breakdown
│       │   └── __tests__/
│       │       ├── Dashboard.test.js
│       │       └── SummaryPanel.test.js
│       │
│       ├── Habits.section/
│       │   ├── index.js                 # export { HabitsSection }
│       │   ├── Habits.layout.js         # Routes: /habits, /habits/new, /habits/:id, /habits/:id/edit
│       │   │
│       │   ├── HabitList.page/
│       │   │   ├── index.js
│       │   │   ├── HabitList.layout.js  # Filter bar, habit rows, "New Habit" button
│       │   │   ├── HabitList.css
│       │   │   ├── HabitRow.js          # Single row: name, schedule desc, streak, strength
│       │   │   └── __tests__/
│       │   │       ├── HabitList.test.js
│       │   │       └── HabitRow.test.js
│       │   │
│       │   ├── HabitDetail.page/
│       │   │   ├── index.js
│       │   │   ├── HabitDetail.layout.js  # Full detail: heatmap, stats, controls
│       │   │   ├── HabitDetail.css
│       │   │   ├── HabitStats.js          # Streak, longest streak, strength, completion rate
│       │   │   └── __tests__/
│       │   │       └── HabitDetail.test.js
│       │   │
│       │   └── HabitForm.page/
│       │       ├── index.js
│       │       ├── HabitForm.layout.js    # Create + Edit form (same component, mode prop)
│       │       ├── HabitForm.css
│       │       ├── SchedulePicker.js      # Schedule type selector + sub-controls
│       │       ├── ColorPicker.js         # Color swatch selector
│       │       └── __tests__/
│       │           └── HabitForm.test.js
│       │
│       └── Settings.page/
│           ├── index.js
│           ├── Settings.layout.js       # Dark mode toggle + ImportFlow + export button
│           ├── Settings.css
│           ├── ImportFlow.js            # Multi-step import state machine
│           └── __tests__/
│               └── Settings.test.js
│
└── test/
    ├── testUtils.js                     # renderWithProviders helper (wraps components in AppContext)
    └── habits/
        ├── habitsRepository.integration.test.js
        └── __fixtures__/
            └── habits.js                # Shared habit fixtures for integration tests
```

---

## S7 — Error Handling Strategy

### Error taxonomy

| Error class | Where caught | How surfaced |
|---|---|---|
| `localStorage` unavailable | `App.jsx` init | Full-page `StorageUnavailableError` component; app does not render |
| Corrupt/unparseable stored data | `App.jsx` init | `CorruptDataRecovery` component with Import and Reset All actions |
| Serialization failure on save | `localStorageAdapter.save()` returns `false` | Repository logs to console; no user-facing alert at v1 (silent failure acceptable — data is still in memory) |
| Import file read failure | `ImportFlow.js` FileReader `onerror` | Inline error message within the settings flow; no state modified |
| Import JSON parse failure | `ImportFlow.js` catch block | Inline error message: "The selected file is not valid JSON. No changes were made." |
| Import shape validation failure | `isValidAppState()` returns false | Inline error message: "The file format is not recognized. No changes were made." |
| Export serialization failure | try/catch in `handleExport` | Inline error message in Settings |
| Retroactive check-in outside 60-day window | `completionRules.js` guard | Returns `null` (no-op); UI disables the control — error never reaches user |
| Duplicate date in completions/skips | `completionRules.js` deduplication | Silent no-op; no user-facing message |

### Error propagation rules

- Behaviors return `null` or a result object on invalid inputs — they never throw.
- Repositories catch errors from the adapter and log them; they do not re-throw.
- Components handle their own error display inline rather than propagating to a global handler.
- The `App.jsx` initialization is the one place errors cause a full-render replacement (unavailable storage, corrupt data). All other errors are inline and local to their UI section.

### Logging

```js
// Convention: errors in adapters/repositories log at console.error with context
const save = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, preSaveHook(JSON.stringify(state)))
    return true
  } catch (err) {
    console.error('[localStorageAdapter] save failed:', err)
    return false
  }
}
```

No external logging service at v1.

### Guard clause convention

All behavior functions use early-return guard clauses per guidelines:

```js
const markComplete = (habit, date, today) => {
  if (!habit) return null
  if (!date) return null
  const cutoff = getDaysBefore(today, 60)
  if (date < cutoff) return null  // outside 60-day window
  // ... proceed
}
```

---

## S8 — Testing Strategy

### What gets tested

| Layer | Coverage approach |
|---|---|
| `behaviors/habits/*` | Full unit test coverage. Every function in streakCalculator, strengthCalculator, scheduleRules, completionRules, habitFactory, importValidator. All spec §8 automated test cases map 1:1 to unit tests here. |
| `adapters/localStorage/*` | Unit tests with `vi.fn()` mocking of `localStorage`. Tests for: successful save/load round-trip, unavailability detection, hook passthrough. |
| `repositories/habits/habitsReducer` | Unit tests for each action type. Verifies state shape after mutation. |
| `views/*` (pages + components) | Component tests with `@testing-library/react` for the four primary pages plus `CalendarHeatmap`. Tests focus on rendered output and user interaction (click handlers call correct repository functions). |
| Integration (`test/habits/`) | Repository + context interaction: renders a context-wrapped component, dispatches actions, verifies state and rendered output. Covers spec §8 integration test cases. |
| End-to-end | None at v1 (guidelines: no E2E at this stage). |

### Test file locations

Unit tests are colocated in `__tests__/` folders within their module's directory. Integration tests live in `/test/habits/`.

### Spec §8 test case mapping

All spec §8 automated test cases map directly to unit tests in behavior modules:

| Spec test | File | Function under test |
|---|---|---|
| Streak — daily habit (7 days) | `streakCalculator.test.js` | `calculateCurrentStreak` |
| Streak — daily with skip | `streakCalculator.test.js` | `calculateCurrentStreak` |
| Streak — daily with gap | `streakCalculator.test.js` | `calculateCurrentStreak` |
| Streak — days-of-week | `streakCalculator.test.js` | `calculateCurrentStreak` |
| Streak — days-of-week missed middle | `streakCalculator.test.js` | `calculateCurrentStreak` |
| Streak — times-per-week satisfied | `streakCalculator.test.js` | `calculateCurrentStreak` |
| Streak — times-per-week prior week missed | `streakCalculator.test.js` | `calculateCurrentStreak` |
| Strength — all four levels + zero scheduled | `strengthCalculator.test.js` | `calculateStrength` |
| Due-today — all schedule types + archived | `scheduleRules.test.js` | `isHabitDueToday` |
| Check-in mutual exclusion | `completionRules.test.js` | `markComplete`, `markSkip` |
| Reset clears history only | `completionRules.test.js` | `resetHabit` |
| Export serialization | `importValidator.test.js` | `serializeAppState`, `buildExportFilename` (pure — no DOM mocking needed) |
| Import malformed JSON rejected | `importValidator.test.js` | `isValidAppState` |
| Import valid file replaces state | `habitsRepository.integration.test.js` | `replaceState` + reducer |
| Retroactive check-in within/outside window | `completionRules.test.js` | `markComplete` with date guards |
| Retroactive undo | `completionRules.test.js` | `undoCheckin` |

### Fixtures

```js
// /test/habits/__fixtures__/habits.js
export const dailyHabitFixture = {
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Morning run',
  description: null,
  schedule: { type: 'daily' },
  color: 'blue',
  completions: [],
  skips: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
}

export const daysOfWeekHabitFixture = {
  ...dailyHabitFixture,
  id: '01900000-0000-7000-8000-000000000002',
  name: 'Gym',
  schedule: { type: 'days_of_week', days: ['monday', 'wednesday', 'friday'] },
}

export const timesPerWeekHabitFixture = {
  ...dailyHabitFixture,
  id: '01900000-0000-7000-8000-000000000003',
  name: 'Read',
  schedule: { type: 'times_per_week', n: 3 },
}
```

### Integration test setup

Integration tests use `@testing-library/react` with a `renderWithProviders` helper (defined in `test/testUtils.js`) that wraps components in a fully initialized `AppContext` with a pre-seeded state. `localStorage` is mocked via `vi.stubGlobal('localStorage', storageMock)`.

```js
// /test/habits/habitsRepository.integration.test.js
import { renderWithProviders } from '../testUtils'
import { dailyHabitFixture } from './__fixtures__/habits'

describe('habitsRepository integration', () => {
  it('markComplete adds date to completions and persists', () => {
    const { result } = renderWithProviders({ habits: [dailyHabitFixture] })
    act(() => result.current.markComplete(dailyHabitFixture.id, '2026-03-13'))
    const habit = result.current.getById(dailyHabitFixture.id)
    expect(habit.completions).toContain('2026-03-13')
  })
})
```

### Component tests

Use `@testing-library/react`. Test user-visible behavior, not implementation details.

```js
// /views/Dashboard.page/__tests__/Dashboard.test.js
import { render, screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../../test/testUtils'
import { DashboardPage } from '../Dashboard.layout'

describe('DashboardPage', () => {
  it('shows only due habits in the check-in list', () => {
    // ... set up state with one due, one not-due, one archived habit
    renderWithProviders(<DashboardPage />, { initialState: stateFixture })
    expect(screen.getByText('Morning run')).toBeInTheDocument()
    expect(screen.queryByText('Not Due Today')).not.toBeInTheDocument()
  })
})
```

---

## S9 — Deployment and Infrastructure

### Build process

```dockerfile
# Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY config/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### nginx configuration

The SPA requires nginx to serve `index.html` for all routes (React Router handles client-side routing).

```nginx
# config/nginx.conf
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### Vite configuration

```js
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
  },
})
```

### Environment variables

No `VITE_*` variables are required at v1. The app is entirely client-side with no external service URLs. If variables are added in future, they go in `.env.local` (gitignored).

### Health checks

nginx serves static files. Container health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ || exit 1
```

### Performance constraint

All UI actions must complete in under 300ms. This is satisfied by the architecture:

- All state reads are in-memory (React Context).
- All writes are synchronous `localStorage.setItem` calls on a JSON blob that will be well under 1 MB for typical usage.
- Streak and strength calculations are O(n) over the completions array. For a habit with 365 days of history, this is ~365 iterations — negligible.
- No network calls exist.
- CSS transitions are limited to high-value interactions (check-in confirmation, nav transitions) using `transition: transform 150ms ease-out` patterns — well within the 300ms budget.

### No CI/CD at v1

The Dockerfile is the artifact of record per spec §9 operational constraints. No pipeline configuration is created.

---

## S10 — Migration Path

N/A — greenfield feature, no migration concerns.

The `schemaVersion: 1` field is written on every save to enable a future migration system to detect the version. No migration logic is implemented at v1. See spec §9 open question Q6.
