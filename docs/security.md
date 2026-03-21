# Security: Attack Surface and Mitigations

trellis-exec orchestrates LLM-generated code execution inside a REPL sandbox, dispatches sub-agent subprocesses, and manages git worktrees on behalf of the user. This document describes the system's attack surface, known risks, and the protections in place.

---

## Architecture Overview

```
User input (plan.md, spec.md)
  → Deterministic compiler (parsePlan)
  → Optional LLM enrichment (compilePlan --enrich)
  → Phase runner loop
    → Orchestrator subprocess (claude CLI, interactive)
    → VM sandbox (REPL) executes orchestrator-generated code
      → Filesystem helpers (read, list, search — scoped to project root)
      → Sub-agent dispatch (claude CLI, --print mode)
      → Check runner (user-defined shell command)
  → Git worktree isolation (optional)
```

The key trust boundary is between the orchestrator LLM's generated JavaScript and the host system. The VM sandbox is the primary enforcement point.

---

## 1. Shell Command Injection

**Risk:** Git operations (worktree creation, commits, merges, cleanup) previously interpolated user-supplied strings into `execSync` template literals. A crafted branch name or commit message containing shell metacharacters (`;`, `$()`, backticks, `"`) could escape the command and execute arbitrary code on the host.

**Attack vector:** The `specName` field flows from user-supplied `specRef` in tasks.json into branch names. Commit messages are derived from phase IDs. Both paths were exploitable.

**Mitigation:** All `execSync` calls in `worktreeManager.ts` have been replaced with `execFileSync` using argument arrays. `execFileSync` bypasses the shell entirely — arguments are passed directly to the git binary via `execve`, so metacharacters are treated as literal strings.

**Test coverage:** `worktreeManager.test.ts` includes tests with shell metacharacters (`"; rm -rf / ; echo "`), command substitution attempts (`$(whoami)`), and verifies that commit messages with injection payloads are stored literally.

---

## 2. VM Sandbox Escape via Timers

**Risk:** The REPL sandbox exposed the host's real `setTimeout` and `clearTimeout` directly. LLM-generated code could schedule callbacks that outlive `session.destroy()`, retaining references to the VM context object. This creates a memory leak and allows code execution after the session is supposedly torn down.

**Attack vector:** An orchestrator could schedule a long-delay timer (`setTimeout(malicious, 999999)`) that fires after the phase completes and the session is destroyed, potentially accessing stale context.

**Mitigation:** The sandbox now provides wrapped timer functions that track all active timer IDs in a `Set<NodeJS.Timeout>`. When `destroy()` is called, all outstanding timers are cleared before marking the session as destroyed. The wrapped `setTimeout` automatically removes IDs from the tracking set when callbacks fire normally.

**Test coverage:** `replManager.test.ts` verifies that `destroy()` does not throw with outstanding timers, that `setTimeout` works normally for short-lived operations, and that `clearTimeout` successfully cancels tracked timers.

---

## 3. Regular Expression Denial of Service (ReDoS)

**Risk:** The `searchFiles` REPL helper accepted LLM-generated regex patterns and passed them directly to `new RegExp()`. Two risks:
1. **SyntaxError** from malformed patterns (e.g., unclosed `[`) would throw and increment the consecutive error counter.
2. **Catastrophic backtracking** from pathological patterns (e.g., `(a+)+$`) would block the Node.js event loop synchronously, bypassing the VM's async timeout mechanism.

**Attack vector:** The orchestrator LLM generates the search pattern. A confused or adversarial prompt could produce a ReDoS pattern that hangs the process indefinitely.

**Mitigation:** `searchFiles` now:
- Rejects patterns longer than 200 characters (returns empty array).
- Wraps `new RegExp()` in a try/catch, returning an empty array on `SyntaxError`.

Note: This does not fully prevent ReDoS from short pathological patterns. A more robust defense would use a regex complexity analyzer or run the search in a worker thread with a timeout. The current mitigation handles the most common cases.

**Test coverage:** `replManager.test.ts` tests both invalid regex patterns and excessively long patterns, verifying empty array returns instead of exceptions.

---

## 4. State File Race Conditions

**Risk:** `getState()` in the REPL sandbox called `readFileSync` on `state.json`, which doesn't exist on the first turn of phase-1 (before any state has been written). The resulting `ENOENT` error was surfaced as a REPL execution failure.

**Attack vector:** Not a direct security risk, but a reliability issue — the consecutive error counter could reach the threshold and halt the phase prematurely, causing data loss or requiring manual intervention.

**Mitigation:** `getState()` now catches `ENOENT` errors specifically and returns a valid empty `SharedState` object matching the Zod schema. Other filesystem errors (permission denied, etc.) are still thrown.

**Test coverage:** `replManager.test.ts` verifies that `getState()` returns a valid empty state when the state file does not exist.

---

## 5. In-Place Mutation During Phase Retry

**Risk:** When a phase retry included corrective tasks, the code pushed new tasks directly onto the phase's `tasks` array with `phase.tasks.push()`. This mutated the original `tasksJson` object in-place, causing:
- **Task duplication:** On subsequent retries, previously appended corrective tasks were still present.
- **ID collisions:** Corrective task IDs were generated with a zero-based counter that reset on each retry, producing duplicate IDs (e.g., `phase-1-corrective-0` on both retry 1 and retry 2).

**Attack vector:** Not directly exploitable, but causes incorrect behavior — duplicate tasks get executed multiple times, and colliding IDs corrupt state tracking.

**Mitigation:** The retry logic now creates a new phase object with a spread copy of the tasks array (`{ ...phase, tasks: [...phase.tasks, ...newTasks] }`). Corrective task IDs include a retry-count offset (`retryCount * 100`) to ensure uniqueness across retries.

**Test coverage:** `phaseRunner.test.ts` includes a test that exercises multiple retries with corrective tasks and verifies that the original `tasksJson.phases[0].tasks.length` remains unchanged (not mutated).

---

## 6. Listener and Timer Leaks in Orchestrator Handle

**Risk:** The `createProcessHandle` function attached a `resetIdle` listener to `child.stdout` on each `send()` call, but only removed the `onData` listener when the idle timer fired. The `resetIdle` listener persisted, accumulating unbounded listeners across `send()` calls. This is a resource leak that could also cause data from one response cycle to bleed into the next.

**Mitigation:** The idle timeout callback now removes both `onData` and `resetIdle` listeners from `child.stdout`, ensuring clean teardown after each send/response cycle.

**Test coverage:** `agentLauncher.test.ts` verifies that multiple sequential `send()` calls work cleanly without errors (via the dry-run handle).

---

## 7. Filesystem Traversal

**Risk:** REPL helpers (`readFile`, `listDir`, `searchFiles`) accept paths from LLM-generated code. Without bounds checking, the orchestrator could read arbitrary files outside the project (e.g., `../../etc/passwd`).

**Mitigation:** All path-accepting helpers route through `safePath()`, which:
1. Resolves the path relative to `projectRoot`.
2. Resolves symlinks via `realpathSync`.
3. Rejects any resolved path that doesn't start with the project root prefix.

This prevents both `../` traversal and symlink-based escapes.

---

## 8. Sub-Agent Permission Scoping

**Risk:** Sub-agents are spawned as `claude` CLI subprocesses. Without scoping, they could modify any file on disk.

**Mitigation:** Sub-agents are launched with `--agent-file` flags that define their permission model. The `outputPaths` constraint is communicated in the prompt (soft enforcement). Hard enforcement depends on the Claude CLI's agent-file permission model. This is a defense-in-depth layer, not a hard sandbox.

---

## 9. Check Command Execution

**Risk:** The user-configured `--check` command is executed via shell to run lint/test suites. This is intentionally a shell command (the user defines it), but it runs with the full permissions of the trellis-exec process.

**Mitigation:** The check command is user-configured, not LLM-generated. It's executed via `execSync` in a subprocess with a timeout. The user is responsible for ensuring their check command is safe. trellis-exec does not sanitize or validate the check command itself — it trusts user configuration.

---

## 10. Git Worktree Isolation

**Risk:** Without isolation, phase execution modifies files directly in the user's working directory. A failed or misbehaving phase could leave the project in a broken state.

**Mitigation:** When `--isolation worktree` is set (the default), trellis-exec creates a git worktree branched off HEAD. All phase execution happens in the worktree. On success, the worktree branch is merged back. On failure, the worktree is cleaned up without affecting the main working directory. The `cleanupWorktree` function derives `projectRoot` from the worktree path (two directories up from `.trellis-worktrees/<slug>`) and runs the removal command from the project root, avoiding the issue of executing commands from within a directory being deleted.

---

## Trust Model Summary

| Component | Trust Level | Boundary |
|-----------|------------|----------|
| User input (plan.md, spec.md, tasks.json) | Trusted | User-authored |
| User config (--check command, --model) | Trusted | User-configured |
| Deterministic compiler (parsePlan) | Trusted | No LLM involvement |
| LLM enrichment (compilePlan) | Semi-trusted | Output validated by Zod schema |
| Orchestrator LLM output | Untrusted | Executed in VM sandbox |
| Sub-agent LLM output | Untrusted | Scoped by agent-file permissions |
| Filesystem access | Scoped | `safePath()` enforces project boundary |
| Git operations | Scoped | `execFileSync` prevents injection; worktree isolates changes |
| Check command | User-trusted | Executed as-is; user defines it |

---

## Reporting Security Issues

If you discover a security vulnerability in trellis-exec, please report it responsibly. Do not open a public issue — instead, contact the maintainers directly.
