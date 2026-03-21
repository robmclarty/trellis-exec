---
name: run
description: Use when executing a compiled plan — runs the Trellis phase runner on tasks.json
---

# Run

Launches the Trellis phase runner to execute implementation tasks.

## Usage

```bash
npx trellis-exec run <tasks.json> [options]
```

If no `tasks.json` path is given, looks for `.specs/**/tasks.json` in the current project.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--phase <id>` | all remaining | Run a specific phase only |
| `--dry-run` | — | Print execution plan without running |
| `--resume` | — | Resume from last incomplete task |
| `--check <command>` | from config | Check command to run after each task |
| `--isolation <mode>` | `worktree` | `"worktree"` or `"none"` |
| `--concurrency <n>` | 3 | Max parallel sub-agents per phase |
| `--model <model>` | — | Override orchestrator model |
| `--max-retries <n>` | 2 | Max phase retries before halting |
| `--headless` | — | Run without pausing between phases |
| `--verbose` | — | Print REPL interactions to stdout |

## Interactive Mode (Default)

After each phase completes, the runner pauses and shows the phase report:

```text
Phase 1 complete.

[Enter] continue  [r] retry  [s] skip  [q] quit
```

Use `--headless` to skip prompts and run all phases automatically.

## Monitoring Progress

While the runner is executing, you can monitor progress:

- **State:** `cat .specs/<feature>/state.json` — current task statuses, completed phases
- **Trajectory:** `tail -f .specs/<feature>/trajectory.jsonl` — real-time log of every REPL turn, sub-agent dispatch, and check result
