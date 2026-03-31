# trellis-exec

```text
╔═════════════════════════════════════════════════════════════╗
║                                                             ║
║    █  ░  ~     ~       ║═╬═║═╬═║═╬═║       ┌──┐ ┌──┐ ┌──┐   ║
║      ~░░  ~█           ╬═║═╬═║═╬═║═╬       │▓▓│ │▓▓│ │▓▓│   ║
║   █░  ~     ░ ~   ───▷ ║═╬═║═╬═║═╬═║  ───▷ │▓▓└─┘▓▓└─┘▓▓│   ║
║    ~ ░ ██              ╬═║═╬═║═╬═║═╬       │▓▓▓▓▓▓▓▓▓▓▓▓│   ║
║     ~   ░~ █ ~         ║═╬═║═╬═║═╬═║       └────────────┘   ║
║                                                             ║
║       ideas             the trellis         working code    ║
╚═════════════════════════════════════════════════════════════╝
```

A phased execution harness for coding agents. It sits above Claude Code and orchestrates spec-driven implementation: compiling a `plan.md` into structured `tasks.json`, then executing tasks phase-by-phase using an orchestrator subprocess with Claude's native tools and specialized sub-agents. Each phase gets its own context window, eliminating the context rot that degrades long-running single-session agents. A generator-evaluator judge loop verifies each phase's output against the spec before advancing.

## Installation

### npm (standalone CLI)

```bash
npm install -g trellis-exec
trellis-exec --help
```

### Claude Code plugin

```bash
claude plugin install github:robmclarty/trellis-exec
```

This provides skill-based commands (`/trellis-exec:run`, `/trellis-exec:compile`, `/trellis-exec:status`), agent files, and orchestrator skills.

## Quick Start

```bash
# 1. Compile a plan into tasks
trellis-exec compile plan.md --spec spec.md

# 2. Run the tasks (interactive by default)
trellis-exec run tasks.json

# 3. Check progress
trellis-exec status tasks.json
```

## CLI Reference

### `trellis-exec run <tasks.json>`

Execute phases from a tasks.json file.

| Flag | Description |
|------|-------------|
| `--phase <id>` | Run a specific phase only |
| `--dry-run` | Print execution plan without running (default: `false`) |
| `--resume` | Resume from last incomplete task (default: `false`) |
| `--check <command>` | Override check command (default: auto-detected) |
| `--concurrency <n>` | Max parallel sub-agents (default: `3`) |
| `--model <model>` | Override orchestrator model (default: `opus`) |
| `--max-retries <n>` | Max phase retries (default: `2`) |
| `--project-root <path>` | Override project root from tasks.json |
| `--spec <path>` | Override spec path from tasks.json |
| `--plan <path>` | Override plan path from tasks.json |
| `--guidelines <path>` | Override guidelines path from tasks.json |
| `--judge <mode>` | Judge mode: `always`, `on-failure`, `never` (default: `always`) |
| `--judge-model <model>` | Override judge model (default: adaptive) |
| `--unsafe` | Legacy: skip all permission restrictions (default: `false`) |
| `--container` | Run inside Docker with OS-level isolation (default: `false`) |
| `--max-phase-budget <usd>` | Per-phase USD spending cap |
| `--max-run-budget <usd>` | Cumulative USD cap across the entire run |
| `--max-run-tokens <n>` | Cumulative token cap across the entire run |
| `--headless` | Disable interactive prompts (default: `false`) |
| `--timeout <ms>` | Override phase timeout in milliseconds (wins over `--long-run`) |
| `--long-run` | Set 2-hour timeout for complex phases (default: `false`) |
| `--verbose` | Print debug output (default: `false`) |
| `--dev-server <cmd>` | Dev server start command for browser testing (default: auto-detected) |
| `--save-e2e-tests` | Save generated acceptance tests to project (default: `false`) |
| `--browser-test-retries <n>` | Max retries for browser acceptance loop (default: `3`) |
| `--container-network <mode>` | Docker network mode (default: `none`) |
| `--container-cpus <n>` | CPU limit for container (default: `4`) |
| `--container-memory <size>` | Memory limit for container (default: `8g`) |
| `--container-image <image>` | Custom Docker image for container mode |

### `trellis-exec compile <plan.md>`

Compile a plan.md into tasks.json.

| Flag | Description |
|------|-------------|
| `--spec <spec.md>` | Path to the spec (required) |
| `--guidelines <path>` | Path to project guidelines (optional) |
| `--project-root <path>` | Project root relative to output (default: `.`) |
| `--output <path>` | Output path (default: `./tasks.json`) |
| `--enrich` | Run LLM enrichment to fill ambiguous fields (default: `false`) |
| `--timeout <ms>` | Timeout for LLM calls (default: `600000`) |

### `trellis-exec init-safety [project-root]`

Generate reference safety configuration files for interactive Claude Code sessions. Creates `.claude/settings.safe-mode-reference.json` and `.claude/hooks/repo-jail.sh` in the target project. These are for manual adoption -- trellis-exec applies its own permissions via CLI flags automatically.

### `trellis-exec status <tasks.json>`

Show execution status for all phases and tasks.

## Safe Mode

By default, trellis-exec runs in **safe mode**: agents operate with restricted permissions, git checkpoints are created before each phase, and budget limits can cap spending. This prevents agent misjudgment during unsupervised runs -- no accidental `git push`, no `rm -rf`, no unlimited token burn.

Three execution modes are available:

| Mode | Flag | Behavior |
|------|------|----------|
| **Safe** | *(default)* | Granular allow/deny via `--permission-mode dontAsk` |
| **Container** | `--container` | Full tools inside Docker; OS-level isolation |
| **Unsafe** | `--unsafe` | Legacy `--dangerously-skip-permissions` behavior |

Role-constrained agents (judge, reporter) are **read-only in all modes**.

### Git checkpoints

Before each phase, trellis-exec commits any uncommitted changes and tags the commit (`trellis/checkpoint/<phaseId>/<timestamp>`). If a phase fails, the recovery tag is printed so you can `git reset --hard` to the last known-good state.

### Budget enforcement

```bash
# Cap each phase at $5 and the total run at $25
trellis-exec run tasks.json --max-phase-budget 5.00 --max-run-budget 25.00

# Cap total tokens across the run
trellis-exec run tasks.json --max-run-tokens 5000000
```

For full details, see [docs/safe-mode.md](docs/safe-mode.md).

## Architecture

```text
                          plan.md + spec.md
                                │
                    ┌───────────▼───────────┐
                    │    PLAN COMPILER      │
                    │  src/compile/         │
                    │                       │
                    │  planParser.ts        │  Stage 1: deterministic
                    │  planEnricher.ts      │  Stage 2: LLM enrichment
                    │  compilePlan.ts       │  Stage 3: full LLM decomposition (Opus)
                    │  detectWebApp.ts      │  Auto-detect browser apps
                    └───────────┬───────────┘
                                │
                           tasks.json
                                │
                    ┌───────────▼───────────┐
                    │    PHASE RUNNER       │
                    │  src/runner/          │
                    │                       │
                    │  phaseRunner.ts       │  Deterministic loop
                    │  stateManager.ts      │  Load/save state.json
                    │  scheduler.ts         │  Dependency validation
                    └───────────┬───────────┘
                                │
               ┌────────────────┼────────────────┐
               │                │                │
               ▼                ▼                ▼
        state.json    trajectory.jsonl    .trellis-phase-report.json
                                │
          ┌─────────────────────▼───────────────────────┐
          │         PHASE ORCHESTRATOR                  │
          │  agents/phase-orchestrator.md               │
          │                                             │
          │  Single claude --print invocation per phase │
          │  Uses native tools:                         │
          │    Read, Write, Edit, Bash, Glob, Grep      │
          │                                             │
          │  Writes .trellis-phase-report.json on exit  │
          └──────────────┬──────────────────────────────┘
                         │
         ┌───────────────┼──────────────┐
         │               │              │
         ▼               ▼              ▼
   ┌────────────┐ ┌───────────┐ ┌─────────────┐
   │ implement  │ │ scaffold  │ │ test-writer │
   │  (Sonnet)  │ │  (Haiku)  │ │   (Sonnet)  │
   └─────┬──────┘ └──────┬────┘ └───────┬─────┘
         │               │              │
         └───────────────┼──────────────┘
                         │
                    phase report
                         │
          ┌──────────────▼──────────────────────┐
          │    BROWSER SMOKE TEST (optional)    │
          │  src/verification/browserSmoke.ts   │
          │                                     │
          │  Deterministic Playwright check:    │
          │  - Console errors & exceptions      │
          │  - Blank-page detection             │
          │  - Interactive element click-through│
          │  - Screenshot capture               │
          └──────────────┬──────────────────────┘
                         │
          ┌──────────────▼──────────────────────┐
          │      JUDGE → FIX LOOP               │
          │  (dispatched by Phase Runner)       │
          │                                     │
          │  ┌───────────────┐  ┌────────────┐  │
          │  │    judge      │  │    fix     │  │
          │  │  (adaptive)   │──▶  (Sonnet)  │  │
          │  │  assess diff  │  │ apply fix  │  │
          │  └───────┬───────┘  └─────┬──────┘  │
          │          │◀───────────────┘         │
          │          │  (retry if issues remain)│
          └──────────┼──────────────────────────┘
                     │
          ┌──────────▼──────────────────────┐
          │    COMPLETION VERIFICATION      │
          │  src/verification/              │
          │                                 │
          │  completionVerifier.ts          │
          │    - Target path existence      │
          │    - TODO/FIXME/HACK scan       │
          │  checkRunner.ts                 │
          │    - User-provided check cmd    │
          │    - Auto-detected test suite   │
          └──────────┬──────────────────────┘
                     │
            ┌────────▼──────────┐
            │  advance phase?   │
            │  retry? halt?     │
            └────────┬──────────┘
                     │
                     ▼
                 next phase
                     ·
                     ·  (after all phases complete)
                     ·
          ┌──────────▼────────────────────────────┐
          │  BROWSER ACCEPTANCE LOOP (optional)   │
          │  src/verification/browserAcceptance.ts│
          │                                       │
          │  ┌────────────────┐ ┌──────────────┐  │
          │  │ browser-tester │ │ browser-fixer│  │
          │  │   (Opus)       │ │   (Sonnet)   │  │
          │  │ generate tests │ │ fix app code │  │
          │  │ from spec      │ │ re-run tests │  │
          │  └───────┬────────┘ └──────┬───────┘  │
          │          │◀────────────────┘          │
          │          │  (retry until all pass)    │
          └──────────┴────────────────────────────┘
```

The system has five layers:

1. **Plan Compiler** -- Parses `plan.md` into `tasks.json` using a deterministic TypeScript parser with targeted LLM enrichment (Haiku) for ambiguous fields, falling back to full LLM decomposition (Opus) for freeform plans. Auto-detects browser apps (see below) and propagates `requiresBrowserTest` flags across phases.

2. **Phase Runner** -- A deterministic Node.js loop that owns the phase queue and iterative refinement cycle. It advances phases, handles retries with corrective tasks, dispatches the judge → fix correction loop (with adaptive model selection) after each phase, manages per-task and per-phase git commits, and writes a `trajectory.jsonl` log.

3. **Phase Orchestrator** -- An LLM agent launched once per phase via a single `claude --print` subprocess. It receives the phase's task list and shared state, works through tasks using Claude's native tools (Read, Write, Edit, Bash, Glob, Grep), dispatches sub-agents for complex tasks, and writes a `.trellis-phase-report.json` file to signal completion.

4. **Sub-agents** -- Claude Code agent files (`agents/*.md`) dispatched for discrete tasks. Each receives a focused context bundle and returns a result. Different agent types can use different models.

5. **Browser Testing** -- A two-tier system for web application projects. Browser smoke tests run deterministically per-phase via Playwright. End-of-build browser acceptance tests use an LLM-powered generate-and-fix loop to verify the spec's acceptance criteria against the running app (see below).

Data flows top-to-bottom: `plan.md` -> Plan Compiler -> `tasks.json` -> Phase Runner -> Phase Orchestrator -> Sub-agents -> phase report -> browser smoke -> judge → fix loop -> completion verification -> action decision -> next phase -> browser acceptance loop.

For a detailed explanation of the architecture and its evolution, see [docs/native-tools-architecture.md](docs/native-tools-architecture.md).

### Auto-detection

The runner automatically detects several project characteristics to minimize configuration:

**Web app detection** (`src/compile/detectWebApp.ts`) -- During plan compilation, the system checks whether the target project is a browser application by looking for:

- Frontend build-tool configs (vite, webpack, next, nuxt, svelte, astro)
- HTML entry points (`index.html`, `public/index.html`, `src/index.html`)
- Frontend framework dependencies in `package.json` (react, vue, svelte, angular, solid, etc.)

When a web app is detected, `requiresBrowserTest` flags are propagated with sticky semantics: once a phase enables browser testing, all subsequent phases inherit it, and the final phase always gets it.

**Test suite detection** -- The phase runner auto-detects the project's test command when no `--check` flag is provided:

1. `package.json` `"test"` script (if not the default `"no test specified"`)
2. `vitest.config.*` → `npx vitest run`
3. `jest.config.*` → `npx jest`

**Dev server detection** (`src/verification/devServer.ts`) -- For browser testing, the dev server start command is auto-detected from:

- Node.js: `npm run dev` or `npm start` from `package.json`
- Python: Django `manage.py runserver`
- Ruby: Rails `bin/rails server`
- Go: `go run .`
- Docker Compose: `docker compose up`
- Procfile: web process entry

### Browser testing

Browser testing is optional and requires Playwright as a peer dependency. It activates automatically for detected web app projects or when phases have `requiresBrowserTest: true`.

**Tier 1: Smoke tests** -- Run deterministically (no LLM) after each phase that touches UI code. Playwright loads the dev server URL and checks:

- No console errors or uncaught exceptions
- Page is not blank (has text content or app root elements)
- Up to 20 interactive elements can be clicked without crashing
- Screenshot captured for debugging

**Tier 2: Acceptance tests** -- Run once after all phases complete. An LLM-powered loop:

1. The **browser-tester** agent (Opus) generates Playwright tests from the spec's acceptance criteria
2. Tests are executed against the running dev server
3. If failures exist, the **browser-fixer** agent (Sonnet) fixes the application code (not the tests)
4. Tests re-run to verify fixes
5. Loop repeats up to `--browser-test-retries` times (default: 3)

Use `--save-e2e-tests` to persist the generated acceptance tests into the project.

### Verification pipeline

After each phase, three verification layers run in sequence:

1. **Completion verifier** -- Checks that all completed tasks have their `targetPath` files on disk and scans new files for `TODO`/`FIXME`/`HACK` markers
2. **Check runner** -- Executes the check command (auto-detected or `--check` override) with a 120-second timeout
3. **Browser smoke** -- Per-phase Playwright smoke test for web app phases (see above)

## Configuration

All environment variables are optional.

| Variable | Purpose | Default |
|----------|---------|---------|
| `TRELLIS_EXEC_MODEL` | Default orchestrator model override | *(none)* |
| `TRELLIS_EXEC_MAX_RETRIES` | Max phase retries before halting | `2` |
| `TRELLIS_EXEC_CONCURRENCY` | Max parallel sub-agents per phase | `3` |
| `TRELLIS_EXEC_JUDGE_MODE` | Judge mode (`always`, `on-failure`, `never`) | `always` |
| `TRELLIS_EXEC_JUDGE_MODEL` | Override judge model | *(adaptive)* |
| `TRELLIS_EXEC_TIMEOUT` | Override phase timeout in milliseconds | *(none)* |
| `TRELLIS_EXEC_LONG_RUN` | Enable long-run mode (2-hour timeout) | *(off)* |
| `TRELLIS_EXEC_DEV_SERVER` | Dev server start command | *(auto-detect)* |
| `TRELLIS_EXEC_BROWSER_TEST_RETRIES` | Max browser acceptance retries | `3` |
| `TRELLIS_EXEC_UNSAFE` | Enable unsafe mode (skip permission restrictions) | `false` |
| `TRELLIS_EXEC_CONTAINER` | Enable container mode | `false` |
| `TRELLIS_EXEC_MAX_PHASE_BUDGET` | Per-phase USD spending cap | *(none)* |
| `TRELLIS_EXEC_MAX_RUN_BUDGET` | Cumulative USD cap across the run | *(none)* |
| `TRELLIS_EXEC_MAX_RUN_TOKENS` | Cumulative token cap across the run | *(none)* |

`CLAUDE_PLUGIN_ROOT` is set automatically by Claude Code in plugin contexts.

## Custom Agents

Add a new specialist agent by dropping a `.md` file in `agents/`:

```text
agents/
  phase-orchestrator.md  # main orchestrator (launched by phase runner)
  implement.md           # general implementation tasks
  test-writer.md         # test file creation
  scaffold.md            # project scaffolding
  judge.md               # read-only code review
  fix.md                 # targeted issue fixes
  reporter.md            # summary reporting fallback
  browser-tester.md      # generate Playwright acceptance tests from spec
  browser-fixer.md       # fix app code for failing browser tests
  your-agent.md          # add your own
```

Each agent file uses Claude Code agent frontmatter to declare its name, description, and model. Tool permissions are controlled by the execution mode (safe, unsafe, or container) via CLI flags -- not by agent frontmatter. The phase orchestrator dispatches agents via `claude --agent`.

## License

MIT
