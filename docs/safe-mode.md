# Safe Mode

trellis-exec runs coding agents unsupervised. By default, it applies **safe mode** -- a set of permission controls, git checkpoints, and budget enforcement that prevent agents from taking destructive actions, burning unlimited tokens, or leaving the project in an unrecoverable state.

The threat model is **operational safety for trusted code**, not sandbox isolation for untrusted code. The goal is to prevent agent misjudgment during unsupervised overnight runs: deleting wrong files, pushing to main, running destructive scripts, or burning tokens in a retry loop.

---

## Execution Modes

Three execution modes control how much freedom agents have:

| Mode | Activation | Permission strategy | Use case |
|------|-----------|---------------------|----------|
| **Safe (default)** | No flag needed | `--permission-mode dontAsk` + granular allow/deny | Unsupervised runs on internal codebases |
| **Container** | `--container` | `--dangerously-skip-permissions --bare` inside Docker | Full tool access with OS-level isolation |
| **Unsafe** | `--unsafe` | `--dangerously-skip-permissions` (legacy behavior) | Trusted environments where speed matters |

Role-constrained agents (judge, reporter) are **read-only in all modes**. This is role enforcement, not safety -- the judge should never write files because it breaks the pipeline's separation of responsibilities.

---

## Layer 1: Permission Controls

### How it works

In safe mode, agents are launched with Claude CLI's native permission system:

- **`--permission-mode dontAsk`** -- denies anything not explicitly allowed. No TTY prompts, no wasted turns.
- **`--tools`** -- controls which tools Claude sees in its context. Omitted tools are invisible; Claude never attempts them.
- **`--allowedTools`** -- auto-approves specific tool patterns without prompting.
- **`--disallowedTools`** -- hard-denies specific patterns, even if they'd otherwise be allowed.

### Worker agents (safe mode)

Worker agents (orchestrator, implement, scaffold, test-writer, fix, browser-tester, browser-fixer) see a curated tool set:

**Visible tools:** Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent, Bash

**Auto-approved patterns:**

- All non-Bash tools (Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent)
- Build/test commands: `npm test`, `npm run build`, `npx tsc`, `npx vitest run`, `npx jest`
- Git read + commit: `git status`, `git diff`, `git log`, `git add`, `git commit`
- File management: `ls`, `mkdir`, `cp`, `mv`, `cat`, `head`, `tail`
- Runtime: `node`

**Hard-denied patterns:**

- Network: `curl`, `wget`, `ssh`, `scp`
- Destructive git: `git push`, `git remote`
- Package publishing: `npm publish`, `npx -y`
- Destructive filesystem: `rm -rf /`, `rm -rf ~`, `sudo`, `chmod`, `chown`

### Read-only agents (all modes)

The judge and reporter agents see only: Read, Glob, Grep, WebFetch, WebSearch. They cannot write files, run Bash commands, or modify the project in any way. This applies in safe, unsafe, and container modes.

### Unsafe mode

Agents receive `--dangerously-skip-permissions` -- the legacy behavior where Claude has unrestricted tool access. Use this when you trust the environment and want maximum speed.

### Container mode

Worker agents inside the Docker container receive `--dangerously-skip-permissions --bare` (full tool access, minimal startup). The container itself is the security boundary: `--network none`, CPU/memory limits, bind-mounted workspace. The `--bare` flag skips hooks, LSP, plugin sync, and CLAUDE.md auto-discovery for faster startup inside the container.

---

## Layer 2: Git Checkpoints

Before each phase begins, trellis-exec automatically:

1. Commits any uncommitted changes with `trellis: checkpoint before phase <phaseId>`
2. Tags the commit: `trellis/checkpoint/<phaseId>/<timestamp>`

This happens in **all modes** (safe, container, unsafe). Checkpoints are always useful.

### Recovery

If a phase fails after exhausting retries, the failure message includes a recovery command:

```text
Phase "phase-3" failed after 2 retries. Last known-good state:
  git reset --hard trellis/checkpoint/phase-3/1711756800
```

trellis-exec never auto-rollbacks. The user decides whether to reset, inspect, or continue.

### Cleanup

After a successful run, checkpoint tags can be cleaned up:

```bash
git tag -l 'trellis/checkpoint/*' | xargs git tag -d
```

---

## Layer 3: Budget Enforcement

Two levels of budget control prevent runaway token consumption:

### Per-phase budget (native)

Claude CLI's `--max-budget-usd` flag caps spending for each `claude -p` invocation. Set via:

```bash
trellis-exec run tasks.json --max-phase-budget 5.00
```

When the per-phase budget is exceeded, the Claude CLI subprocess halts. The phase runner treats this as a phase failure and follows normal retry/halt logic.

### Per-run budget (cumulative)

A cumulative tracker across all phases monitors total cost and token consumption:

```bash
trellis-exec run tasks.json --max-run-budget 25.00
trellis-exec run tasks.json --max-run-tokens 5000000
```

When the run-level budget is exceeded, the runner halts immediately with a clear message:

```text
Cost budget exceeded: $25.12 spent, limit $25.00
Halting run.
```

### Default timeout

In safe mode, phases default to a 30-minute timeout when neither `--timeout` nor `--long-run` is specified. In unsafe and container modes, existing timeout behavior is preserved (30 min orchestrator default, 2 hours with `--long-run`).

### Summary report

The summary report includes budget usage when budget limits are configured:

```text
Run Budget: $4.23 / $10.00 (42.3%)
```

---

## Layer 4: Docker Container Mode

Container mode runs the entire trellis-exec pipeline inside a single Docker container, providing OS-level isolation as the security boundary.

### How it works

```bash
trellis-exec run tasks.json --container
```

This:

1. Checks Docker availability
2. Selects image variant: `slim` (~200MB) by default, `browser` (~1.5GB) if browser testing is enabled
3. Launches `docker run` with the project mounted at `/workspace`
4. The inner trellis-exec process runs with `--container-inner`, which enables `containerMode` and gives worker agents full tool access
5. Role-constrained agents (judge, reporter) remain read-only inside the container

### Container configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--container-network <mode>` | `none` | Docker network mode (`none` = no network) |
| `--container-cpus <n>` | `4` | CPU limit |
| `--container-memory <size>` | `8g` | Memory limit |
| `--container-image <image>` | auto-built | Use a custom Docker image |

### Bind mounts

| Host path | Container path | Mode |
|-----------|---------------|------|
| Project root | `/workspace` | read-write |
| tasks.json | `/inputs/tasks.json` | read-only |
| spec.md | `/inputs/spec.md` | read-only |
| plan.md | `/inputs/plan.md` | read-only |
| guidelines.md | `/inputs/guidelines.md` | read-only (if exists) |

Git checkpoints work identically inside the container since the same `.git` directory is mounted.

---

## CLI Reference

### Flags

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--unsafe` | `TRELLIS_EXEC_UNSAFE` | `false` | Legacy: full permissions for all worker agents |
| `--container` | `TRELLIS_EXEC_CONTAINER` | `false` | Run inside Docker with OS-level isolation |
| `--max-phase-budget <usd>` | `TRELLIS_EXEC_MAX_PHASE_BUDGET` | *(none)* | Per-phase USD cap |
| `--max-run-budget <usd>` | `TRELLIS_EXEC_MAX_RUN_BUDGET` | *(none)* | Cumulative USD cap across the run |
| `--max-run-tokens <n>` | `TRELLIS_EXEC_MAX_RUN_TOKENS` | *(none)* | Cumulative token cap across the run |
| `--container-network <mode>` | -- | `none` | Docker network mode |
| `--container-cpus <n>` | -- | `4` | CPU limit for container |
| `--container-memory <size>` | -- | `8g` | Memory limit for container |
| `--container-image <image>` | -- | auto-built | Custom Docker image |

### Subcommand

```bash
trellis-exec init-safety [project-root]
```

Generates reference configuration files for using the same permission restrictions in interactive Claude Code sessions. This does **not** affect trellis-exec itself -- it creates `.claude/settings.safe-mode-reference.json` and `.claude/hooks/repo-jail.sh` for manual adoption.

---

## Migration from Previous Versions

This is a **breaking change**: the default behavior changes from `--dangerously-skip-permissions` (unrestricted) to safe mode (restricted). Users who depend on unrestricted access must add `--unsafe`.

If the first phase fails because a tool was denied, a hint is logged:

```text
Hint: tool denied by safe mode. If this command is safe for your
project, add it to the allow list or use --unsafe for unrestricted access.
```

### Quick migration

```bash
# Before (implicit unrestricted):
trellis-exec run tasks.json

# After (explicit unrestricted):
trellis-exec run tasks.json --unsafe

# Or use the new default (safe mode):
trellis-exec run tasks.json
```
