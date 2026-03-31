# Security: Attack Surface and Mitigations

trellis-exec orchestrates LLM-driven code execution via Claude CLI subprocesses, dispatches sub-agent subprocesses, and manages git commits on behalf of the user. This document describes the system's attack surface, known risks, and the protections in place.

---

## Architecture Overview

```text
User input (plan.md, spec.md)
  → Deterministic compiler (parsePlan)
  → Optional LLM enrichment (compilePlan --enrich)
  → Phase runner loop
    → Orchestrator subprocess (claude CLI, single fire-and-forget --print invocation)
      → Native Claude tools (Read, Write, Edit, Bash, Glob, Grep)
      → Per-task git commits
    → Judge sub-agent (claude CLI, --print mode)
    → Fix sub-agent (claude CLI, --print mode)
    → Check runner (user-defined shell command)
  → Phase-level git commits
```

The key trust boundary is between the LLM-generated actions (via Claude CLI subprocesses) and the host system. Claude CLI's native tool permissions and the `--agent` flag are the primary enforcement points.

---

## 1. Shell Command Injection in Git Operations

**Risk:** Git operations that interpolate user-supplied strings into shell commands could allow arbitrary code execution via crafted branch names, commit messages, or file paths.

**Mitigation:** All git operations in `git.ts` use `execFileSync` with argument arrays. `execFileSync` bypasses the shell entirely — arguments are passed directly to the git binary via `execve`, so metacharacters are treated as literal strings.

**Functions protected:** `getChangedFiles`, `getDiffContent`, `getCurrentSha`, `ensureInitialCommit`, `commitAll`, `getChangedFilesRange`, `getDiffContentRange`.

---

## 2. Sub-Agent Permission Scoping

**Risk:** Sub-agents are spawned as `claude` CLI subprocesses. Without scoping, they could modify any file on disk, run destructive commands, or make unwanted network requests.

**Mitigation (safe mode, default):** Sub-agents are launched with `--permission-mode dontAsk` and granular `--tools`, `--allowedTools`, and `--disallowedTools` flags. This restricts the tool set to a curated allow list (file operations, approved build/test commands, git read+commit) and hard-denies destructive patterns (git push, rm -rf, curl, sudo, npm publish). Role-constrained agents (judge, reporter) are further restricted to read-only tools in all modes.

**Mitigation (container mode):** Worker agents receive `--dangerously-skip-permissions --bare` because the Docker container provides OS-level isolation (`--network none`, CPU/memory limits, bind-mounted workspace).

**Legacy (unsafe mode):** Both the orchestrator and sub-agents use `--dangerously-skip-permissions`, meaning Claude CLI's built-in permission system is bypassed. File access scoping relies on prompt-based instructions (the `outputPaths` constraint communicated in the prompt) rather than hard enforcement. Use `--unsafe` to opt into this mode.

See [safe-mode.md](safe-mode.md) for full details on the three execution modes.

---

## 3. Check Command Execution

**Risk:** The user-configured `--check` command is executed via shell (`exec()`) to run lint/test suites. This runs with the full permissions of the trellis-exec process.

**Mitigation:** The check command is user-configured, not LLM-generated. It's executed via `exec` in a subprocess with a configurable timeout (default: 120 seconds, max buffer: 10MB). The user is responsible for ensuring their check command is safe. trellis-exec does not sanitize or validate the check command itself — it trusts user configuration.

---

## 4. In-Place Mutation During Phase Retry

**Risk:** When a phase retry includes corrective tasks, mutating the original `tasksJson` object in-place could cause task duplication and ID collisions on subsequent retries.

**Mitigation:** The retry logic creates a new phase object with a spread copy of the tasks array (`{ ...phase, tasks: [...phase.tasks, ...newTasks] }`). Corrective task IDs include a retry-count offset (`retryCount * 100`) to ensure uniqueness across retries.

---

## 5. Orchestrator Output Parsing

**Risk:** The orchestrator writes a `.trellis-phase-report.json` file that the phase runner parses. A malformed or adversarial report could cause incorrect state transitions.

**Mitigation:** The report is parsed through `normalizeReport()`, which validates field types and applies safe defaults for missing fields. Status values are validated against known enums (`"complete"`, `"partial"`, `"failed"`). Unknown status values default to `"partial"`, and unknown recommended actions default to `"halt"`. All task IDs are validated against the phase's task list — missing tasks cause the report to be marked as `"partial"` with a retry recommendation.

---

## 6. Judge Assessment Parsing

**Risk:** The judge returns JSON that is parsed and used to influence retry decisions. Malformed output could cause crashes or incorrect behavior.

**Mitigation:** `parseJudgeResult()` attempts multiple parsing strategies (JSON from code fences, raw JSON, object extraction from text). Issue arrays are normalized to handle both string and object formats, with `detail` → `description` field coercion. If all parsing fails, a safe default assessment is returned: `{ passed: false, issues: ["unparseable output"], suggestions: [] }`.

---

## 7. Process Timeouts

**Risk:** A hung Claude CLI subprocess could block the phase runner indefinitely.

**Mitigation:** All subprocesses have enforced timeouts via `setTimeout` + `SIGTERM`:

- Sub-agents: 5 minutes (300,000ms)
- Orchestrator: 30 minutes (1,800,000ms), configurable via `--timeout` or `--long-run` (2 hours)
- Compile/decompose: 10 minutes (600,000ms)

Timeout errors are caught and surfaced as `SubAgentResult.success = false` with a descriptive error message.

---

## 8. Budget Exhaustion

**Risk:** A runaway retry loop or verbose agent could burn unlimited tokens and dollars across a multi-phase run.

**Mitigation:** Two levels of budget enforcement:

- **Per-phase:** Claude CLI's native `--max-budget-usd` caps each subprocess invocation.
- **Per-run:** A cumulative tracker monitors total cost and token consumption across all phases. When exceeded, the runner halts immediately.

Budget limits are optional but recommended for unsupervised runs.

---

## 9. Git Checkpoint Recovery

**Risk:** A failed phase could leave the project in a broken state with no easy way to roll back.

**Mitigation:** Before each phase, trellis-exec commits any uncommitted changes and creates a git tag (`trellis/checkpoint/<phaseId>/<timestamp>`). On failure, the recovery tag and `git reset --hard` command are printed. trellis-exec never auto-rollbacks.

---

## Trust Model Summary

| Component | Trust Level | Boundary |
|-----------|------------|----------|
| User input (plan.md, spec.md, tasks.json) | Trusted | User-authored |
| User config (--check command, --model) | Trusted | User-configured |
| Deterministic compiler (parsePlan) | Trusted | No LLM involvement |
| LLM enrichment (compilePlan) | Semi-trusted | Output validated by Zod schema |
| Orchestrator LLM output | Untrusted | Safe mode: granular allow/deny. Unsafe: prompt constraints only |
| Sub-agent LLM output | Untrusted | Safe mode: role-based tool restrictions. Unsafe: prompt constraints only |
| Git operations | Safe | `execFileSync` prevents injection |
| Check command | User-trusted | Executed as-is; user defines it |
| Docker container | Isolated | Network=none, resource limits, bind-mounted workspace |

---

## Reporting Security Issues

If you discover a security vulnerability in trellis-exec, please report it responsibly. Do not open a public issue — instead, contact the maintainers directly.
