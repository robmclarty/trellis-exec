# Native Tools Architecture (v0.5)

This document explains the orchestration architecture introduced in v0.5, which replaced the REPL-mediated orchestrator with direct use of Claude's native tools.

## Why the change

The v0.4 architecture interposed a JavaScript REPL (node:vm sandbox) between the orchestrator LLM and the filesystem. Claude's native tools (Read, Write, Edit, Bash, Glob, Grep) were disabled via `--disallowedTools`, and reimplemented as REPL helper functions (`readFile()`, `writeFile()`, `listDir()`, etc.). The orchestrator communicated exclusively through JavaScript code evaluated in this sandbox.

This design was the source of most bugs and complexity:

- **Code extraction fragility.** The orchestrator's responses had to be valid JavaScript. A `extractCode()` function used heuristics to separate code from natural language, with frequent false positives and negatives.
- **Multi-turn session management.** An `OrchestratorHandle` managed sequential `claude --continue` calls, tracking turn state across multiple subprocess invocations.
- **Stuck-loop detection.** A `detectStuck()` function compared fingerprints of the last N outputs to detect when the orchestrator was repeating itself, then injected corrective nudges.
- **Sandbox edge cases.** The node:vm sandbox required `var` (not `const`/`let`) for cross-turn persistence, automatic scaffold restoration after each eval to prevent helper overwriting, differentiated timeouts for long-running helpers, and self-reporting wrappers so async results were visible to the orchestrator.
- **Worktree isolation.** Git worktrees provided filesystem isolation per run, adding creation/commit/merge/cleanup lifecycle management to every code path.

Each of these was a layer of indirection between what the LLM wanted to do and what actually happened. Native Claude tools do all of this better, with none of the indirection.

## How it works now

### One subprocess per phase

Each phase is a single `claude --agent agents/phase-orchestrator.md --print --dangerously-skip-permissions` invocation. The phase context (tasks, state, spec, guidelines) is piped via stdin. The orchestrator runs to completion using Claude's native tools, then exits.

```text
phaseRunner.ts
  └─ launcher.runPhaseOrchestrator(context, agentFile, model)
       └─ spawns: claude --agent phase-orchestrator.md --print --dangerously-skip-permissions
            └─ orchestrator uses Read, Write, Edit, Bash, Glob, Grep natively
            └─ writes .trellis-phase-report.json when done
       └─ runner reads report file after subprocess exits
```

No `--disallowedTools`. No `--append-system-prompt` with REPL instructions. No `--continue` for multi-turn sessions. The orchestrator has full access to Claude's tool suite.

### File-based report contract

Instead of calling a `writePhaseReport()` REPL helper that signals completion to the runner process, the orchestrator writes `.trellis-phase-report.json` to the project root using the Write tool. The runner reads this file after the subprocess exits:

```json
{
  "phaseId": "phase-1",
  "status": "complete",
  "recommendedAction": "advance",
  "tasksCompleted": ["task-1-1", "task-1-2"],
  "tasksFailed": [],
  "summary": "Set up project structure",
  "handoff": "Created package.json and tsconfig.json",
  "correctiveTasks": [],
  "decisionsLog": ["Used ESM over CJS"],
  "orchestratorAnalysis": "All tasks completed, checks pass"
}
```

The runner validates that every task ID appears in either `tasksCompleted` or `tasksFailed`. Missing tasks cause the phase to be marked as partial with a retry recommendation.

If the subprocess crashes or doesn't write a report file, `buildPartialReport()` synthesizes a failure report so the retry/halt logic still works.

### Sub-agent dispatch

The orchestrator dispatches sub-agents for complex multi-file tasks by running them via Bash:

```bash
echo "<instructions>" | claude --agent agents/implement.md --print --dangerously-skip-permissions
```

For simple single-file changes, the orchestrator uses Write/Edit directly without spawning a sub-agent. This is the same tradeoff the REPL version made (`writeFile()` vs `dispatchSubAgent()`), but without the indirection layer.

### Retry context

When a phase is retried (after judge rejection), `buildPhaseContext()` appends a "Previous Attempt" section that includes:

- How many prior attempts have occurred
- The last report's status, summary, completed/failed tasks, and orchestrator analysis
- Judge issues (must-fix) and suggestions (non-blocking) from the last attempt
- Corrective tasks that were appended to the phase
- A retry strategy: read existing files first, focus on judge issues, don't redo passed work

This gives the orchestrator full context about what went wrong and what to focus on, without needing access to the previous session's REPL history.

## What was removed

### Files deleted

| File | What it did |
|------|-------------|
| `src/orchestrator/replManager.ts` | node:vm sandbox, code evaluation, timeout handling, consecutive error tracking, scaffold restoration |
| `src/orchestrator/replHelpers.ts` | 9 REPL helper functions (readFile, writeFile, listDir, searchFiles, getState, writePhaseReport, dispatchSubAgent, runCheck, llmQuery) |
| `src/isolation/worktreeManager.ts` | Git worktree creation, commit, merge, cleanup |
| `src/orchestrator/__tests__/*` | Tests for REPL manager, helpers, and old agentLauncher API |
| `src/isolation/__tests__/*` | Tests for worktree operations |
| `src/runner/__tests__/extractCode.test.ts` | Tests for JS extraction heuristics |

### Functions deleted from phaseRunner.ts

| Function | What it did |
|----------|-------------|
| `replTurnLoop()` | Multi-turn orchestrator-to-REPL interaction loop |
| `extractCode()` | Heuristic JS extraction from LLM responses |
| `isCommentOnly()` | Detected comment-only responses |
| `detectStuck()` | Compared output fingerprints to detect loops |
| `deriveProjectRoot()` | Selected between worktree and base project root |
| `copySpecToProjectRoot()` | Copied spec into worktree for sandbox access |
| `copyGuidelinesToProjectRoot()` | Copied guidelines into worktree |
| `cleanupCopiedFile()` | Removed copied files on cleanup |

### Types removed from agentLauncher.ts

| Type/Function | What it did |
|---------------|-------------|
| `OrchestratorHandle` | Multi-turn session interface (send/isAlive/kill) |
| `OrchestratorLaunchConfig` | Config for multi-turn orchestrator sessions |
| `REPL_SYSTEM_PROMPT` | System prompt forcing JS-only responses |
| `buildOrchestratorArgs()` | CLI args with --disallowedTools and --append-system-prompt |
| `buildOrchestratorContinueArgs()` | CLI args for --continue turns |
| `createSequentialHandle()` | Multi-turn session via sequential subprocess spawns |
| `createDryRunHandle()` | Mock handle for dry-run mode |
| `launchOrchestrator()` | Factory method returning OrchestratorHandle |
| `llmQuery()` | Quick LLM query via `claude --print` |

### CLI flags removed

| Flag | Why |
|------|-----|
| `--isolation <mode>` | Worktree isolation removed entirely |
| `turnLimit` (env var) | No REPL turn loop to limit |
| `maxConsecutiveErrors` (env var) | No REPL error tracking |

## What was added

| Addition | Purpose |
|----------|---------|
| `src/git.ts` | Extracted `getChangedFiles()` and `getDiffContent()` from worktreeManager (pure git-diff wrappers with no worktree dependency) |
| `runPhaseOrchestrator()` in agentLauncher | Single fire-and-forget `claude --print` call with 30-minute timeout (configurable via `--timeout`, or 2 hours with `--long-run`) |
| `ExecClaudeResult` export | Return type from `execClaude()`, now public for use by compilePlan |
| `query` callback in compilePlan | Replaced `AgentLauncher` interface dependency with a simple `(prompt: string) => Promise<string>` callback |
| "Previous Attempt" section in buildPhaseContext | Retry context with last report, judge issues, corrective tasks |
| "Completion Protocol" section in buildPhaseContext | Instructions for writing `.trellis-phase-report.json` |
| `phase_exec` trajectory event type | Replaced `repl_exec` for logging phase orchestrator execution |

## What stayed the same

These components were intentionally preserved without modification:

- **Phase sequencing and retry logic** in `runPhases()` and `runSinglePhase()` -- the deterministic loop that advances, retries, or halts phases
- **State management** (`stateManager.ts`) -- load/save/update of `state.json`
- **Scheduler** (`scheduler.ts`) -- dependency validation and execution order resolution
- **Judge loop** (`judgePhase()`, `buildJudgePrompt()`, `parseJudgeResult()`, `buildFixPrompt()`) -- dispatches judge and fix sub-agents after each phase
- **Report normalization** (`normalizeReport()`) -- handles LLM output variance in field names and formats
- **Plan compilation** (`src/compile/*`) -- deterministic parser and LLM enrichment pipeline
- **All type definitions** (`src/types/*`) -- except renaming `repl_exec` to `phase_exec` in TrajectoryEvent
- **Sub-agent files** (`agents/implement.md`, `judge.md`, `fix.md`, `scaffold.md`, `test-writer.md`)

## Net impact

The refactor removed approximately 8,700 lines and added approximately 1,200 lines across 86 files. The core execution flow (plan -> phases -> tasks -> judge -> retry) is unchanged. The only architectural change is how the orchestrator interacts with the project: native tools and a file-based report instead of a REPL sandbox and helper functions.
