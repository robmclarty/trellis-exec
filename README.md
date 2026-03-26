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
| `--dry-run` | Print execution plan without running |
| `--resume` | Resume from last incomplete task |
| `--check <command>` | Override check command |
| `--concurrency <n>` | Max parallel sub-agents (default: 3) |
| `--model <model>` | Override orchestrator model |
| `--max-retries <n>` | Max phase retries (default: 2) |
| `--project-root <path>` | Override project root from tasks.json |
| `--spec <path>` | Override spec path from tasks.json |
| `--plan <path>` | Override plan path from tasks.json |
| `--guidelines <path>` | Override guidelines path from tasks.json |
| `--judge <mode>` | Judge mode: `always`, `on-failure`, `never` (default: `always`) |
| `--judge-model <model>` | Override judge model (default: adaptive) |
| `--headless` | Disable interactive prompts |
| `--verbose` | Print stream-json debug output |

### `trellis-exec compile <plan.md>`

Compile a plan.md into tasks.json.

| Flag | Description |
|------|-------------|
| `--spec <spec.md>` | Path to the spec (required) |
| `--guidelines <path>` | Path to project guidelines (optional) |
| `--project-root <path>` | Project root relative to output (default: `.`) |
| `--output <path>` | Output path (default: `./tasks.json`) |
| `--enrich` | Run LLM enrichment to fill ambiguous fields |
| `--timeout <ms>` | Timeout for LLM calls (default: 600000) |

### `trellis-exec status <tasks.json>`

Show execution status for all phases and tasks.

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
                     ▼
            judge assessment
           merged into report
                     │
            ┌────────▼──────────┐
            │  advance phase?   │
            │  retry? halt?     │
            └────────┬──────────┘
                     │
                     ▼
                 next phase
```

The system has four layers:

1. **Plan Compiler** -- Parses `plan.md` into `tasks.json` using a deterministic TypeScript parser with targeted LLM enrichment (Haiku) for ambiguous fields, falling back to full LLM decomposition (Opus) for freeform plans.

2. **Phase Runner** -- A deterministic Node.js loop that owns the phase queue and iterative refinement cycle. It advances phases, handles retries with corrective tasks, dispatches the judge → fix correction loop (with adaptive model selection) after each phase, manages per-task and per-phase git commits, and writes a `trajectory.jsonl` log.

3. **Phase Orchestrator** -- An LLM agent launched once per phase via a single `claude --print` subprocess. It receives the phase's task list and shared state, works through tasks using Claude's native tools (Read, Write, Edit, Bash, Glob, Grep), dispatches sub-agents for complex tasks, and writes a `.trellis-phase-report.json` file to signal completion.

4. **Sub-agents** -- Claude Code agent files (`agents/*.md`) dispatched for discrete tasks. Each receives a focused context bundle and returns a result. Different agent types can use different models.

Data flows top-to-bottom: `plan.md` -> Plan Compiler -> `tasks.json` -> Phase Runner -> Phase Orchestrator -> Sub-agents -> phase report -> judge → fix loop -> action decision -> next phase.

For a detailed explanation of the architecture and its evolution, see [docs/native-tools-architecture.md](docs/native-tools-architecture.md).

## Configuration

All environment variables are optional.

| Variable | Purpose | Default |
|----------|---------|---------|
| `TRELLIS_EXEC_MODEL` | Default orchestrator model override | *(none)* |
| `TRELLIS_EXEC_MAX_RETRIES` | Max phase retries before halting | `2` |
| `TRELLIS_EXEC_CONCURRENCY` | Max parallel sub-agents per phase | `3` |
| `TRELLIS_EXEC_JUDGE_MODE` | Judge mode (`always`, `on-failure`, `never`) | `always` |
| `TRELLIS_EXEC_JUDGE_MODEL` | Override judge model | *(adaptive)* |

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
  your-agent.md          # add your own
```

Each agent file uses Claude Code agent frontmatter to declare its name, description, model, and allowed tools. The phase orchestrator dispatches agents via `claude --agent`.

## License

MIT
