# Phase Runner

`src/runner/phaseRunner.ts`

The deterministic outer loop that composes every other module in the executor into a single pipeline. It reads a `tasks.json` file, walks through each phase in order, launches an orchestrator for each one, mediates the orchestrator ↔ REPL conversation, and decides what to do when a phase finishes — advance, retry, skip, or halt. Everything that touches shared state, trajectory logging, worktree isolation, and inter-phase handoff flows through this module.

## Why a dedicated runner

Each sub-module (state manager, scheduler, trajectory logger, worktree manager, check runner, agent launcher, REPL manager, REPL helpers) solves one problem. None of them know about the others. The phase runner is the composition layer that wires them together and enforces the execution protocol described in §6 of the spec.

Without it, the caller would need to manually sequence module calls, handle retry counters, manage orchestrator lifecycles, and coordinate worktree commits at phase boundaries. The runner encapsulates all of that into a single `runPhases()` call.

## How it works

The runner follows a strict sequence. Each step maps to a specific sub-module:

```text
Load tasks.json            →  Zod validation (TasksJsonSchema)
Validate dependencies      →  scheduler.validateDependencies()
Load / init state          →  stateManager.loadState() / initState()
Create trajectory logger   →  trajectoryLogger.createTrajectoryLogger()
Create worktree (optional) →  worktreeManager.createWorktree()

For each incomplete phase:
  Build phase context      →  buildPhaseContext() (internal)
  Create agent launcher    →  agentLauncher.createAgentLauncher()
  Create REPL helpers      →  replHelpers.createReplHelpers() + overrides
  Create REPL session      →  replManager.createReplSession()
  Launch orchestrator      →  launcher.launchOrchestrator()
  Run REPL turn loop       →  replTurnLoop() (internal)
  Judge phase              →  judgePhase() (judge → fix correction loop)
  Decide action            →  report.recommendedAction + judge assessment + user input
  Update state             →  stateManager.updateStateAfterPhase()
  Commit to worktree       →  worktreeManager.commitPhase()

Merge worktree (on success) → worktreeManager.mergeWorktree()
Cleanup                      → worktreeManager.cleanupWorktree(), logger.close()
```

### The REPL turn loop

This is the core inner loop. It mediates between the orchestrator (a `claude` subprocess) and the REPL session (a `node:vm` sandbox):

1. Send the previous REPL output (or "Begin phase execution." on turn 1) to the orchestrator.
2. Receive code back from the orchestrator.
3. Eval the code in the REPL sandbox.
4. Restore scaffold — re-inject original REPL helper references so the orchestrator's code can't accidentally overwrite them.
5. Log the turn to `trajectory.jsonl`.
6. Check for phase completion (the orchestrator signals this by calling `writePhaseReport()` inside its REPL code).
7. Check for consecutive errors — halt if the threshold is reached.
8. Feed the REPL output back to the orchestrator.
9. Repeat until complete, turn limit, consecutive error threshold, or orchestrator death.

### Phase completion detection

The orchestrator signals it's done by calling `writePhaseReport(report)` in the REPL. This works through a closure: the runner creates the REPL helpers with an overridden `writePhaseReport` that captures the report into a local variable. The turn loop checks this variable after each orchestrator response and after each REPL eval. When it's set, the loop exits with reason "complete".

### Judge flow

After the orchestrator completes a phase (status is not `"failed"`), the runner dispatches a **judge agent** to independently verify the work against the spec and task acceptance criteria. The judge runs inside a correction loop managed by `judgePhase()`.

#### What the judge receives

The runner builds a judge prompt containing:

- **Changed files** — list with git status indicators (A/M/D)
- **Full unified diff** — all changes made during the phase
- **Task definitions** — IDs, titles, descriptions, target paths, and acceptance criteria
- **Spec sections** — referenced via each task's `specSections` field
- **Orchestrator's self-report** — the phase report with status and completion claims

#### What the judge evaluates

The judge (dispatched as a `"judge"` sub-agent on the `opus` model) assesses four dimensions:

1. **Spec compliance** — do the changes implement what the spec requires?
2. **Correctness** — are there obvious bugs or unhandled cases?
3. **Completeness** — are all tasks fully addressed, or are TODOs left behind?
4. **Consistency** — do the changes fit existing codebase patterns?

It returns a `JudgeAssessment`:

```typescript
{
  passed: boolean;
  issues: string[];     // problems that must be fixed
  suggestions: string[]; // optional improvements
}
```

#### The judge → fix correction loop

When the judge finds issues and correction attempts remain (default max: 2), the runner automatically dispatches a **fix agent** to address them:

```text
judgePhase(phase, report)
  ├── Get changed files from git diff
  ├── Skip if no files changed
  └── Loop (up to maxCorrections):
       ├── Dispatch judge sub-agent with diff + criteria
       ├── Parse JudgeAssessment from response
       ├── Log "judge_invoke" trajectory event
       ├── If passed → break, return assessment
       ├── If not passed and attempts remain:
       │    ├── Dispatch fix sub-agent with issues list
       │    ├── Run check command (if configured)
       │    └── Refresh changed files for next pass
       └── If max corrections exceeded → return final assessment
```

The fix agent (dispatched as a `"fix"` sub-agent on the `sonnet` model) receives only the specific issues identified by the judge and is constrained to fixing those issues — no refactoring.

#### How the assessment affects action decisions

The judge assessment is stored on the phase report as `judgeAssessment` and influences the action decision:

**Interactive mode:** If the judge found issues and the orchestrator recommended `"advance"`, the runner overrides the recommendation to `"retry"` and populates `correctiveTasks` with the judge's issues. The user is then prompted with this adjusted recommendation.

**Headless mode:** If the judge found issues and the orchestrator recommended `"advance"`, the runner downgrades the status to `"partial"` and changes the recommendation to `"retry"`.

### Action logic after a phase

Once a phase finishes and the judge assessment is applied, the runner decides what to do next. In headless mode, it follows the (possibly judge-adjusted) `recommendedAction`. In interactive mode (the default), it also prompts the user:

| Report recommends | Judge passed | User chooses | Result |
|-------------------|-------------|-------------|--------|
| `advance` | yes | Enter | Commit changes, advance to next phase |
| `advance` | no | (overridden to `retry`) | Retry with judge issues as corrective tasks |
| `advance` | — | `r` | Retry current phase |
| `advance` | — | `s` | Skip, mark complete, advance |
| `advance` | — | `q` | Save state, exit |
| `retry` | — | (headless) | Retry if under `maxRetries`, else halt |
| `halt` | — | (any) | Save state, exit |

On retry, the runner appends the report's `correctiveTasks` (which may include judge-identified issues) as new task objects to the phase and re-enters it without advancing the phase index. The retry counter is stored in `state.phaseRetries` and persists across saves.

State is only updated after the action decision. This prevents a retry-bound phase from being prematurely marked as completed.

### Resume

The runner supports resuming from a saved `state.json`. On startup, it loads existing state and skips any phase already in `completedPhases`. Combined with `--phase <id>` (via `runSinglePhase`), this gives the developer full control over re-entry points after a failure.

## Module wiring

The runner connects sub-modules through dependency injection rather than direct coupling:

```text
phaseRunner.runPhases()
  ├── stateManager      — load, init, save, update
  ├── scheduler         — validate dependencies, resolve execution order
  ├── trajectoryLogger  — append events per REPL turn
  ├── worktreeManager   — create, commit, merge, cleanup
  └── executePhase()
       ├── agentLauncher.createAgentLauncher()
       │    ├── .dispatchSubAgent()  →  wired into replHelpers + judgePhase
       │    ├── .llmQuery()          →  wired into replHelpers
       │    └── .launchOrchestrator() → orchestratorHandle
       ├── checkRunner.createCheckRunner()
       │    └── .run()  →  wired into replHelpers.runCheck
       ├── replHelpers.createReplHelpers()
       │    └── writePhaseReport, runCheck, llmQuery overridden
       ├── replManager.createReplSession(helpers)
       ├── replTurnLoop(orchestratorHandle, replSession, logger)
       └── judgePhase(phase, report, launcher, logger)
            ├── dispatchSubAgent("judge")  →  assess changes against criteria
            └── dispatchSubAgent("fix")    →  correct issues (if judge fails)
```

The REPL helpers bridge is the key integration point. The phase runner creates the helpers with `createReplHelpers()`, then overrides three methods using object spread:

- **`writePhaseReport`** — replaced with a closure that captures the report for the turn loop to detect.
- **`runCheck`** — replaced with a real `CheckRunner` (when a check command is configured) instead of the stub.
- **`llmQuery`** — replaced with the agent launcher's `llmQuery`, which spawns a real `claude --print` subprocess.

This avoids modifying `replHelpers.ts` while giving the runner full control over how these operations execute.

## Exported API

### `runPhases(config: PhaseRunnerConfig): Promise<PhaseRunnerResult>`

The main entry point. Runs all incomplete phases from `tasks.json`.

```typescript
const result = await runPhases({
  tasksJsonPath: ".specs/auth/tasks.json",
  isolation: "worktree",
  concurrency: 3,
  maxRetries: 2,
  headless: false,
  verbose: false,
  dryRun: false,
  turnLimit: 100,
  maxConsecutiveErrors: 5,
  pluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? ".",
});
// result.success          → true if all phases completed
// result.phasesCompleted  → ["phase-1", "phase-2"]
// result.phasesFailed     → []
// result.finalState       → full SharedState object
```

### `runSinglePhase(config, phaseId): Promise<PhaseRunnerResult>`

Runs one phase by ID. Same setup as `runPhases` but targets a single phase. Used for the `--phase <id>` CLI flag.

```typescript
const result = await runSinglePhase(config, "phase-2");
```

### `promptForContinuation(): Promise<"continue" | "retry" | "skip" | "quit">`

Reads a single line from stdin. Maps Enter → `"continue"`, `r` → `"retry"`, `s` → `"skip"`, `q` → `"quit"`. Used between phases in interactive mode.

### `dryRunReport(tasksJson: TasksJson): string`

Produces a human-readable execution plan without making any LLM calls. Uses the scheduler to resolve execution groups and detect target path overlaps.

```text
Spec: ./spec.md
Plan: ./plan.md
Phases: 2

## phase-1: scaffolding
Set up project

  Group 0 [sequential]:
    - task-1-1: Init project (implement)
      targets: package.json
  Group 1 [sequential]:
    - task-1-2: Add config (scaffold)
      targets: tsconfig.json

## phase-2: implementation
Build features

  Group 0 [parallel]:
    - task-2-1: Build feature A (implement)
      targets: src/a.ts
    - task-2-2: Build feature B (implement)
      targets: src/b.ts
```

## Safety and cleanup

The runner uses `try/finally` at two levels:

1. **`runPhases` level** — ensures `cleanupWorktree()` and `logger.close()` always execute, even on unhandled errors.
2. **`executePhase` level** — ensures `repl.destroy()` and `orchestrator.kill()` always execute, even if the turn loop throws.

State is saved to disk after every phase boundary, so a crash between phases loses no progress. The trajectory log is flushed synchronously after each turn (via `fsyncSync`), so the external record is always complete regardless of crashes.

## Configuration

| Field | Default | Purpose |
|-------|---------|---------|
| `tasksJsonPath` | (required) | Path to `tasks.json` |
| `statePath` | `<tasksJsonDir>/state.json` | Persisted execution state |
| `trajectoryPath` | `<tasksJsonDir>/trajectory.jsonl` | Append-only event log |
| `checkCommand` | none | Shell command run after each task (e.g., `npm run lint && npm test`) |
| `isolation` | `"worktree"` | `"worktree"` for git isolation, `"none"` to work in place |
| `concurrency` | `3` | Max parallel sub-agents within a phase |
| `model` | none | Override the orchestrator's default model |
| `maxRetries` | `2` | Max phase retries before halting |
| `headless` | `false` | Skip interactive prompts between phases |
| `verbose` | `false` | Print REPL turn details to stdout |
| `dryRun` | `false` | Print execution plan, make no changes |
| `turnLimit` | `100` | Max REPL turns per phase before forced halt |
| `maxConsecutiveErrors` | `5` | Consecutive REPL errors before halting |
| `pluginRoot` | (required) | Directory containing `agents/` and `skills/` |
