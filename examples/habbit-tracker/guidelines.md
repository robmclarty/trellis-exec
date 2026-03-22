# Project Guidelines: habit-tracker

## Stack

| Layer | Choice |
|---|---|
| Build tool | Vite |
| UI framework | React |
| Language | JavaScript (no TypeScript) |
| Routing | React Router |
| Styling | CSS Modules |
| State management | React Context + `useReducer` |
| Charts | recharts |
| Testing | vitest |
| Distribution | Docker (Dockerfile) |

No UI component library. No Tailwind. No external state management library (no Redux, Zustand, Jotai, etc.). Plain JS throughout — no `.ts` or `.tsx` files.

---

## Architecture

The project uses a **layered, functional architecture** with a clear separation between UI (views), business logic (behaviors), data access (repositories), and external integrations (adapters).

### Top-level layout

```
/src
  /views          # React components, organized by route hierarchy
  /behaviors      # Business logic — pure functions, no UI
  /repositories   # State and data access (repository pattern)
  /adapters       # Thin wrappers around external dependencies
```

### Views directory structure

Views mirror the route hierarchy. Sections contain pages (or other sections). Pages are leaf nodes.

```
/views
  App.jsx
  /Habits.section
    index.js
    Habits.layout.js        # react-router route definitions for this section
    /HabitList.page
      index.js              # barrel export
      HabitList.layout.js   # optional: sub-routes if needed
      HabitList.css         # CSS module
      HabitList.test.js
      HabitRow.js           # local helper component
      formatStreak.js       # local helper function
    /HabitDetail.page
      index.js
      HabitDetail.layout.js
      HabitDetail.css
      HabitDetail.test.js
  /Dashboard.page
    index.js
    Dashboard.css
    Dashboard.test.js
    WeeklySummary.js
```

**Naming conventions for views:**

- `*.section` — folder suffix for a section (groups pages/sections, owns a layout with child routes)
- `*.page` — folder suffix for a page (leaf route)
- `*.layout.js` — file where React Router `<Route>` elements are defined for that section or page
- `index.js` — barrel file; re-exports the primary component so the import path stays stable

**Sections** are Higher-order Components that compose pages or nested sections. **Pages** are the rendered leaf views. Both can be a single file or a folder with a barrel, depending on complexity. The import call site never changes:

```js
// Always import from the folder name, never from a specific inner file
import { HabitDetail } from './HabitDetail.page'
```

### Behaviors

Behaviors contain business logic as collections of plain functions. No React, no side effects.

```
/behaviors
  /habits
    streakCalculator.js
    streakCalculator.test.js
    completionRules.js
    completionRules.test.js
```

### Repositories

Repositories encapsulate all reads and writes to state (via Context) or any persistent data source. They expose a consistent interface to pages and behaviors so those layers never touch raw state directly.

```
/repositories
  /habits
    habitsRepository.js
    habitsRepository.test.js
```

### Adapters

Adapters wrap external dependencies (APIs, localStorage, third-party SDKs) so the rest of the app is insulated from their implementation details.

```
/adapters
  /localStorage
    localStorageAdapter.js
    localStorageAdapter.test.js
  /api
    apiAdapter.js
    apiAdapter.test.js
```

---

## Conventions

### Language and style

- Plain JavaScript. No TypeScript.
- Functional style throughout. Arrow functions everywhere.
- No class components.
- No `function` keyword declarations for components or utilities — use `const` + arrow function.

```js
// Correct
const formatStreak = (days) => {
  if (days === 0) return 'No streak yet'
  return `${days} day${days === 1 ? '' : 's'}`
}

// Wrong
function formatStreak(days) { ... }
```

### Naming

| Thing | Convention | Example |
|---|---|---|
| Files (components) | PascalCase | `HabitRow.js` |
| Files (utilities/logic) | camelCase | `streakCalculator.js` |
| Directories (views) | PascalCase + suffix | `HabitDetail.page`, `Habits.section` |
| Directories (other) | camelCase | `behaviors`, `repositories` |
| React components | PascalCase | `const HabitRow = () => { ... }` |
| Functions | camelCase | `const calculateStreak = () => { ... }` |
| Context objects | PascalCase with `Context` suffix | `HabitsContext` |
| Reducer functions | camelCase with `Reducer` suffix | `habitsReducer` |
| CSS module classes | camelCase | `.streakBadge`, `.listContainer` |

### Imports

Order imports in this sequence, separated by blank lines:

1. React and React Router
2. Third-party libraries (recharts, etc.)
3. Project-level modules (`/behaviors`, `/repositories`, `/adapters`)
4. Local siblings (relative paths)
5. CSS module

```js
import { useState, useContext } from 'react'
import { useNavigate } from 'react-router-dom'

import { BarChart, Bar, XAxis } from 'recharts'

import { habitsRepository } from '../../repositories/habits/habitsRepository'
import { calculateStreak } from '../../behaviors/habits/streakCalculator'

import HabitRow from './HabitRow'

import styles from './HabitList.css'
```

### Error handling

- Use early returns and guard clauses rather than deeply nested conditionals.
- At component boundaries, handle errors explicitly rather than letting them propagate silently.
- In behaviors and repositories, return `null` or a structured result object when an operation fails — do not throw unless the error is truly unrecoverable.

```js
// Preferred: guard clause with early return
const getHabitById = (habits, id) => {
  if (!id) return null
  return habits.find((h) => h.id === id) ?? null
}

// Avoid: nested conditionals
const getHabitById = (habits, id) => {
  if (id) {
    const habit = habits.find((h) => h.id === id)
    if (habit) {
      return habit
    }
  }
  return null
}
```

---

## Patterns

### Defining a route layout

Layout files define React Router `<Route>` elements and connect sections or pages to URL paths. They do not contain JSX beyond route structure.

```js
// /views/Habits.section/Habits.layout.js
import { Routes, Route } from 'react-router-dom'

import { HabitsPage } from './HabitList.page'
import { HabitDetailPage } from './HabitDetail.page'

const HabitsLayout = () => (
  <Routes>
    <Route index element={<HabitsPage />} />
    <Route path=":habitId" element={<HabitDetailPage />} />
  </Routes>
)

export { HabitsLayout }
```

```js
// /views/Habits.section/index.js
export { HabitsLayout as HabitsSection } from './Habits.layout'
```

### Defining a repository

Repositories consume a Context and expose named functions. Components call repository functions — they never read context directly.

```js
// /repositories/habits/habitsRepository.js
import { useContext } from 'react'

import { HabitsContext } from '../../views/App.jsx'

const useHabitsRepository = () => {
  const { state, dispatch } = useContext(HabitsContext)

  const getAll = () => state.habits

  const getById = (id) => state.habits.find((h) => h.id === id) ?? null

  const add = (habit) => {
    dispatch({ type: 'ADD_HABIT', payload: habit })
  }

  const markComplete = (id, date) => {
    dispatch({ type: 'MARK_COMPLETE', payload: { id, date } })
  }

  return { getAll, getById, add, markComplete }
}

export { useHabitsRepository }
```

### Defining a behavior module

Behavior modules are collections of pure functions. They take plain data in and return plain data out. No React, no context, no imports from `/views`.

```js
// /behaviors/habits/streakCalculator.js

const MS_PER_DAY = 86_400_000

const toDateString = (date) => new Date(date).toISOString().slice(0, 10)

const calculateCurrentStreak = (completions) => {
  if (!completions || completions.length === 0) return 0

  const sorted = [...completions].sort((a, b) => new Date(b) - new Date(a))
  const today = toDateString(Date.now())
  const yesterday = toDateString(Date.now() - MS_PER_DAY)

  if (sorted[0] !== today && sorted[0] !== yesterday) return 0

  let streak = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diff = (prev - curr) / MS_PER_DAY
    if (diff === 1) {
      streak++
    } else {
      break
    }
  }

  return streak
}

export { calculateCurrentStreak }
```

### Defining a page component

Pages are functional components that use repositories for data and behaviors for logic. They own their CSS module and local helper components.

```js
// /views/Habits.section/HabitList.page/index.js
export { HabitListPage } from './HabitList.layout'
```

```js
// /views/Habits.section/HabitList.page/HabitList.layout.js
import { useHabitsRepository } from '../../../repositories/habits/habitsRepository'
import { calculateCurrentStreak } from '../../../behaviors/habits/streakCalculator'

import HabitRow from './HabitRow'

import styles from './HabitList.css'

const HabitListPage = () => {
  const { getAll } = useHabitsRepository()
  const habits = getAll()

  return (
    <ul className={styles.list}>
      {habits.map((habit) => (
        <HabitRow
          key={habit.id}
          habit={habit}
          streak={calculateCurrentStreak(habit.completions)}
        />
      ))}
    </ul>
  )
}

export { HabitListPage }
```

### CSS module usage

CSS class names are camelCase in the module file and accessed via the `styles` object. Never use global class names for component-specific styling.

```css
/* HabitList.css */
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.emptyState {
  color: var(--color-muted);
  text-align: center;
}
```

```js
// In the component
import styles from './HabitList.css'

// Correct
<ul className={styles.list}>

// Wrong — no string class names for component styles
<ul className="list">
```

---

## Testing

### Philosophy

All functions and components should have unit tests. Key business logic in `/behaviors` must be covered. Coverage percentage is not tracked as a goal — the measure is whether the critical paths are tested.

No end-to-end tests at this stage.

### Unit tests

Unit tests are colocated with the module they test, collected in `__tests__` folders within the same directory.

```
/behaviors/habits/
  streakCalculator.js
  __tests__/
    streakCalculator.test.js
```

```
/views/Habits.section/HabitList.page/
  HabitList.layout.js
  HabitRow.js
  __tests__/
    HabitList.test.js
    HabitRow.test.js
```

Test files use the `*.test.js` naming convention.

### Integration tests

If a test requires a data store (repository + context interaction), it belongs in a shared integration test folder rather than alongside the unit tests.

```
/test
  /habits
    habitsRepository.integration.test.js
```

### Test structure

Use `describe` blocks to group related cases. Prefer explicit, readable test descriptions.

```js
// /behaviors/habits/__tests__/streakCalculator.test.js
import { describe, it, expect } from 'vitest'

import { calculateCurrentStreak } from '../streakCalculator'

describe('calculateCurrentStreak', () => {
  it('returns 0 when there are no completions', () => {
    expect(calculateCurrentStreak([])).toBe(0)
  })

  it('returns 1 when only today is completed', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(calculateCurrentStreak([today])).toBe(1)
  })

  it('returns the correct streak for consecutive days', () => {
    const dates = ['2026-03-13', '2026-03-12', '2026-03-11']
    expect(calculateCurrentStreak(dates)).toBe(3)
  })

  it('stops counting at the first gap', () => {
    const dates = ['2026-03-13', '2026-03-12', '2026-03-10']
    expect(calculateCurrentStreak(dates)).toBe(2)
  })
})
```

### Mocks and fixtures

Use vitest's built-in `vi.fn()` for mocks. Define shared fixtures inline or in a `__fixtures__` folder alongside the test when they are reused across multiple test files.

```js
// __fixtures__/habits.js
export const habitFixture = {
  id: 'abc123',
  name: 'Morning run',
  completions: ['2026-03-13', '2026-03-12'],
}
```

### Component tests

Test components with `@testing-library/react`. Wrap components in any required context providers via a local `renderWithContext` helper.

---

## Infrastructure

### Distribution

The application is distributed as a Docker image. A `Dockerfile` at the project root builds a production-ready static bundle using Vite and serves it.

Typical Dockerfile shape:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

The hosting environment is assumed to be any platform capable of running Docker containers. No platform-specific configuration is included in the codebase.

### Environment variables

Vite exposes environment variables prefixed with `VITE_` to the client bundle. Define environment-specific values in `.env` files and never commit secrets.

```
VITE_API_BASE_URL=https://api.example.com
```

### CI/CD

Not configured at this stage. The Dockerfile is the artifact of record.
