# Browser Testing

trellis-exec can optionally verify that browser-based UI renders and functions correctly using Playwright. Browser testing operates in two tiers:

1. **Per-phase smoke check** (deterministic, no LLM) — fast sanity check after each UI phase
2. **End-of-build acceptance tests** (LLM-driven, runs once) — thorough spec-based verification after all phases complete

Both tiers gracefully skip when Playwright is not available, no dev server can be started, or the project has no UI phases.

## Prerequisites

Playwright is an optional peer dependency. Install it in the target project to enable browser testing:

```bash
npm install --save-dev playwright
npx playwright install chromium
```

Browser testing will be silently skipped if Playwright is not installed.

## How it works

### Tier 1: Per-Phase Smoke Check

Phases flagged with `requiresBrowserTest: true` in `tasks.json` receive an automated smoke check after the orchestrator completes and before the judge evaluates the work.

The smoke check is a fixed Playwright script (no LLM involved) that:

1. Starts the dev server
2. Navigates to the app's root URL
3. Waits for network idle
4. Checks the page isn't blank (looks for text content or common app root elements)
5. Finds interactive elements (buttons, internal links, form controls)
6. Clicks each element (up to 20) and checks nothing crashes
7. Collects console errors and uncaught exceptions
8. Takes a screenshot

Results are passed to the judge as additional evidence. The judge decides what's actionable — the smoke check is an evidence gatherer, not a decision maker.

### Tier 2: End-of-Build Acceptance Tests

After all phases complete and pass, a specialist `browser-tester` agent (Opus) reads the full spec and generates targeted Playwright tests against the acceptance criteria. If any tests fail:

1. A `browser-fixer` agent (Sonnet) analyzes the failures and fixes the application code
2. The `browser-tester` re-runs the failing tests
3. This loop repeats up to 3 times (configurable)

The browser-tester generates resilient tests using accessible selectors (`getByRole`, `getByText`, `getByLabel`) rather than brittle CSS selectors.

Generated tests can be saved to the project's test directory with `--save-e2e-tests`.

## Configuration

| Flag | Env Variable | Default | Description |
|------|-------------|---------|-------------|
| `--dev-server <cmd>` | `TRELLIS_EXEC_DEV_SERVER` | *(auto-detected)* | Dev server start command |
| `--save-e2e-tests` | — | `false` | Save generated acceptance tests to `tests/e2e/` |
| `--browser-test-retries <n>` | `TRELLIS_EXEC_BROWSER_TEST_RETRIES` | `3` | Max retries for the end-of-build acceptance loop |

## Dev Server Autodiscovery

When `--dev-server` is not provided, trellis-exec attempts to detect the start command from the project structure. Detection is language-agnostic and checks (in order):

1. `package.json` — `scripts.dev` (`npm run dev`) or `scripts.start` (`npm start`)
2. `Procfile` — `web:` entry
3. `manage.py` — `python manage.py runserver` (Django)
4. `Gemfile` + `bin/rails` — `bin/rails server` (Rails)
5. `main.go` — `go run .` (Go)
6. `docker-compose.yml` — `docker compose up`

The dev server's port is detected from stdout/stderr output patterns. If no port is detected, common ports (3000, 5173, 8080, 4000, 8000) are probed.

## Compiler Integration

The `requiresBrowserTest` flag on phases is set by the compiler:

- **LLM decomposition path**: The prompt instructs the LLM to set `requiresBrowserTest: true` on phases that produce visible UI output (pages, components, views, layouts, routes, templates).
- **Deterministic parser path**: A heuristic scans task titles, descriptions, and target paths for UI-related keywords and file extensions (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.ejs`, `.hbs`, `.erb`).

## Graceful Degradation

| Condition | Behavior |
|-----------|----------|
| Playwright not installed | Both tiers skip silently |
| Playwright browsers not installed | Skip with message: "Run `npx playwright install chromium`" |
| No dev server command found | Skip silently |
| Dev server fails to start | Skip with error message |
| No `requiresBrowserTest` phases | Both tiers skip |
| Port already in use | Dev server start fails with clear error |

## Examples

### Node/React app

```bash
# Auto-detects: npm run dev → http://localhost:5173
trellis-exec run tasks.json
```

### Python/Django

```bash
# Auto-detects: python manage.py runserver → http://localhost:8000
trellis-exec run tasks.json
```

### Explicit dev server

```bash
# Override with a custom command
trellis-exec run tasks.json --dev-server "bundle exec rails s -p 4000"
```

### Save generated tests

```bash
# Run acceptance tests and keep them in the project
trellis-exec run tasks.json --save-e2e-tests
# Tests saved to: tests/e2e/acceptance.spec.ts
```
