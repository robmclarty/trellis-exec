# CLI Reference

`trellis-exec` is the command-line interface for the Trellis RLM Executor. It provides three subcommands for compiling plans, executing tasks, and inspecting execution state.

## Installation

After building (`npm run build`), the CLI is available as `trellis-exec` via the `bin` field in `package.json`. For global use:

```bash
npm install -g @robmclarty/trellis-exec
```

Or run directly from the project:

```bash
node dist/cli.js <command> [options]
```

## Commands

### `run` — Execute phases

```bash
trellis-exec run <tasks.json> [options]
```

Reads a `tasks.json` file and executes its phases through the phase runner. By default, execution is **interactive**: the runner pauses after each phase, displays the phase report, and prompts for a decision (continue, retry, skip, or quit). Use `--headless` to run all phases without pausing.

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--phase <id>` | string | *(all)* | Run a single phase by ID instead of all remaining phases |
| `--dry-run` | boolean | `false` | Print the execution plan (phases, tasks, dependencies) without running anything |
| `--resume` | boolean | `false` | Resume from the last incomplete task by reading existing `state.json` |
| `--check <command>` | string | *(from config)* | Override the check command (e.g. `"npm run lint && npm test"`) |
| `--isolation <mode>` | string | `"worktree"` | Isolation strategy: `"worktree"` creates a git worktree; `"none"` runs in place |
| `--concurrency <n>` | number | `3` | Maximum parallel sub-agents within a phase |
| `--model <model>` | string | *(none)* | Override the default orchestrator model |
| `--max-retries <n>` | number | `2` | Maximum phase retries before halting |
| `--headless` | boolean | `false` | Run without interactive prompts between phases |
| `--verbose` | boolean | `false` | Print REPL interactions to stdout |

**Examples:**

```bash
# Run all phases interactively
trellis-exec run tasks.json

# Dry run to preview the execution plan
trellis-exec run tasks.json --dry-run

# Run a single phase in headless mode
trellis-exec run tasks.json --phase phase-2 --headless

# Resume a previous run with a custom check command
trellis-exec run tasks.json --resume --check "npm test"

# Run without git worktree isolation
trellis-exec run tasks.json --isolation none --concurrency 5
```

**Exit codes:**

- `0` — all phases completed successfully
- `1` — one or more phases failed, or a runtime error occurred

---

### `compile` — Compile a plan into tasks

```bash
trellis-exec compile <plan.md> --spec <spec.md> [options]
```

Reads a `plan.md` file and runs the deterministic plan parser (Stage 1) to produce a `tasks.json` file. The `--spec` flag is required so the compiler can record the spec reference in the output.

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--spec <path>` | string | *(required)* | Path to the spec file |
| `--output <path>` | string | `./tasks.json` | Output path for the generated tasks file |

**Examples:**

```bash
# Compile with default output
trellis-exec compile plan.md --spec spec.md

# Compile to a custom output path
trellis-exec compile plan.md --spec spec.md --output .specs/feature/tasks.json
```

**Output:**

On success, prints a summary line:

```text
Compiled 3 phases, 12 tasks → ./tasks.json
```

If the parser flags fields that need LLM enrichment (Stage 2), a note is printed:

```text
Note: 4 field(s) flagged for enrichment.
```

**Exit codes:**

- `0` — compilation succeeded
- `1` — parsing failed (errors are printed to stderr)

---

### `status` — Inspect execution state

```bash
trellis-exec status <tasks.json>
```

Reads the `state.json` file adjacent to the given `tasks.json` and prints a summary of execution progress. No options are required.

**Output includes:**

- **Current phase** — which phase the runner is on or stopped at
- **Completed phases** — list of phases that finished successfully
- **Retry counts** — how many times each phase has been retried (if any)
- **Phase reports** — status, summary, and task breakdown for each completed phase
- **Modified files** — count of files changed during execution

**Example output:**

```text
Current phase: phase-3
Completed phases: phase-1, phase-2

Retry counts:
  phase-2: 1

Phase reports:
  phase-1: complete — Scaffolding and project setup
    Completed: task-1-1, task-1-2, task-1-3
  phase-2: complete — Core API implementation
    Completed: task-2-1, task-2-2
    Failed: task-2-3

Modified files: 14
```

If no `state.json` exists (i.e. no run has been started), prints:

```text
No execution state found. Run 'trellis-exec run' first.
```

---

## Environment Variables

Environment variables serve as fallbacks when CLI flags are not provided. CLI flags always take precedence.

| Variable | Maps to | Default | Description |
|----------|---------|---------|-------------|
| `TRELLIS_EXEC_MODEL` | `--model` | *(none)* | Default orchestrator model |
| `TRELLIS_EXEC_TURN_LIMIT` | *(no flag)* | `200` | Max REPL turns per phase |
| `TRELLIS_EXEC_REPL_OUTPUT_LIMIT` | *(no flag)* | `8192` | Max characters returned from REPL per turn |
| `TRELLIS_EXEC_MAX_RETRIES` | `--max-retries` | `2` | Max phase retries before halting |
| `TRELLIS_EXEC_CONCURRENCY` | `--concurrency` | `3` | Max parallel sub-agents per phase |
| `TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS` | *(no flag)* | `5` | Consecutive REPL errors before halting a phase |
| `TRELLIS_EXEC_COMPACTION_THRESHOLD` | *(no flag)* | `80` | Context usage percentage that triggers compaction |
| `CLAUDE_PLUGIN_ROOT` | *(no flag)* | `process.cwd()` | Plugin directory root (auto-set by Claude Code) |

**Precedence order:** CLI flag > environment variable > built-in default.

**Example:**

```bash
# Set defaults via environment, override concurrency on the command line
export TRELLIS_EXEC_MODEL=sonnet
export TRELLIS_EXEC_MAX_RETRIES=3
trellis-exec run tasks.json --concurrency 8
# Result: model=sonnet, maxRetries=3, concurrency=8
```

---

## Error Handling

The CLI exits with code `1` and prints a message to stderr in these cases:

- **No subcommand** — prints full help text
- **Unknown subcommand** — prints `Unknown command: <name>` followed by help text
- **Missing required argument** — prints a specific error (e.g. `Error: <tasks.json> path is required for 'run' command.`)
- **File not found** — prints the underlying `ENOENT` error
- **Invalid tasks.json** — prints schema validation errors
- **Compilation failure** — prints each parse error as a bulleted list
- **Phase runner failure** — prints which phases completed and which failed

All unhandled errors are caught at the top level, printed, and result in exit code `1`.

## Help

```bash
trellis-exec --help
trellis-exec -h
```

Prints the full usage summary with all commands, options, and environment variables.
