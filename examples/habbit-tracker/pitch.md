# Pitch: Habit Tracker

## Problem

People trying to build lasting habits are caught between two bad options: heavyweight apps that demand an account, push notifications, and cloud sync just to check off "drink water," and bare-bones tools — spreadsheets, paper — that offer no meaningful feedback on whether the habit is actually sticking.

The friction of account creation and the anxiety of cloud-stored personal data causes many people to abandon existing apps before they ever form a habit. And when they do stick with a tool, raw streak counts aren't enough — a streak of 14 days tells you nothing about whether you're 90% consistent or just barely hanging on. People want to know not just that they're doing a thing, but that the thing is becoming part of who they are.

There's also a gap in how most tools handle imperfection. Missing a day because you were sick or traveling shouldn't feel like your progress was erased. Without a way to mark a skip as intentional, a single bad day ends a streak and often ends the habit entirely.

## Appetite

This is a focused greenfield build for a single developer. The scope is a complete, shippable v1 — not a proof of concept and not an enterprise platform. The complexity ceiling is: one developer, enough time to do it right without gold-plating it.

The deliverable is a local-only React app with no backend. All data lives in the user's browser via localStorage. Distribution is a Docker image serving the static Vite build.

## Shape

The app is a client-side React SPA built with Vite, using React Router for navigation, React Context + `useReducer` for state, and CSS Modules for styling. All persistence goes through a `localStorageAdapter` so the rest of the app never touches `localStorage` directly. Charts use recharts.

The route structure has three primary destinations: a daily check-in view (the default landing), a habit detail page with a calendar heatmap, and a stats dashboard. A global nav links between them.

Habits are stored as objects with a schedule descriptor (daily / specific days of week / N times per week), a flat array of completion date strings, a flat array of skip date strings, and an `archivedAt` timestamp that is `null` while the habit is active. Completions and skips are separate so streak logic can treat them differently without ambiguity.

Streak calculation lives in a pure behavior module (`streakCalculator.js`). A skip date is treated as a neutral day — it doesn't extend the streak but it doesn't break it either. The streak resumes from the last non-skipped completion.

Habit strength is a separate metric from streak. It accumulates based on overall long-term consistency rather than the most recent run — something like a rolling completion rate weighted toward recent weeks, expressed as a level or score. The exact formula is intentionally left loose at this stage; the spec will nail it down, but the constraint is: it must be explainable in one sentence to a non-technical user.

Dark mode is implemented via a CSS custom property theme applied to the document root, toggled by a preference stored in localStorage alongside habit data.

Import/export is a single button that serializes the entire localStorage state to JSON and downloads it, and a file picker that reads a JSON file and merges or replaces state. No migration logic at v1 — the import format is the internal format.

The layered architecture from `guidelines.md` applies throughout: views call repositories, repositories expose context-backed functions, behaviors are pure functions, adapters wrap localStorage.

## No-Gos

- No backend, server, or API of any kind
- No user accounts, login, or authentication
- No cloud sync or multi-device support
- No push notifications or reminders
- No hard deletion of habits — archive only, history is always preserved
- No social features, sharing, or exported "reports" beyond raw JSON
- No migration system for import format changes at v1
- No offline service worker or PWA packaging — the Docker-served static bundle is sufficient

## Rabbit Holes

**The habit strength algorithm.** It is tempting to research behavioral psychology literature, weight recency exponentially, factor in schedule difficulty, and build a configurable scoring engine. This would consume weeks and ship nothing. The pragmatic path: define a simple formula in the spec — likely a rolling 4-week completion rate expressed as a percentage or binned into 4–5 levels — validate it feels right with a few example habits, and ship it. It can be revised in a later pitch if users find it misleading.

**Flexible schedule edge cases.** "X times per week" schedules create genuinely thorny streak semantics: what counts as a week boundary, what happens when a user adds a completion on Sunday for a habit they started tracking mid-week? It is tempting to build a fully general scheduling engine. The pragmatic path: define the behavior clearly in the spec for the three supported schedule types and write behavior unit tests against those definitions. Don't build more scheduling flexibility than those three types need.

**The calendar heatmap.** Recharts does not ship a calendar heatmap out of the box. Building a fully interactive, animated, GitHub-style contribution graph from scratch is a significant undertaking. The pragmatic path: implement a simple grid of colored cells per day using CSS Grid, driven by the completions array. Interactivity (hover tooltip showing the date and status) is the only enhancement worth adding at v1. A third-party calendar heatmap library is an acceptable alternative if evaluation shows it saves meaningful time.

**Import conflict resolution.** When a user imports a JSON file, there are questions about what to do if habit IDs clash, if the schema is slightly different, or if they want to merge rather than replace. Building a diff-and-merge import flow is a project in itself. The pragmatic path: v1 import is a full replace with a single confirmation prompt. Document this behavior clearly in the UI.

**Transitions and animation polish.** "Snappy with nice transitions" is in scope, but it can become a time sink. The pragmatic path: use CSS transitions on a small set of high-value interactions (checking off a habit, navigating between views) and stop there. No physics-based animations, no orchestrated sequences.
