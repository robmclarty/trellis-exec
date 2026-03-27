# Phase Runner

`src/runner/phaseRunner.ts`

The deterministic outer loop that composes every other module in the executor into a single pipeline. It reads a `tasks.json` file, walks through each phase in order, launches an orchestrator for each one, and decides what to do when a phase finishes — advance, retry, skip, or halt. Everything that touches shared state, trajectory logging, and inter-phase handoff flows through this module.

## Why a dedicated runner

Each sub-module (state manager, scheduler, trajectory logger, check runner, agent launcher) solves one problem. None of them know about the others. The phase runner is the composition layer that wires them together and enforces the execution protocol.

Without it, the caller would need to manually sequence module calls, handle retry counters, manage orchestrator lifecycles, and coordinate git commits at phase boundaries. The runner encapsulates all of that into a single `runPhases()` call.

## How it works

The runner follows a strict sequence:

```text
Load tasks.json            →  Zod validation (TasksJsonSchema)
Validate dependencies      →  scheduler.validateDependencies()
Load / init state          →  stateManager.loadState() / initState()
Create trajectory logger   →  trajectoryLogger.createTrajectoryLogger()

For each incomplete phase:
  Ensure initial git commit →  git.ensureInitialCommit() (captures startSha)
  Build phase context       →  buildPhaseContext() (internal)
  Create agent launcher     →  agentLauncher.createAgentLauncher()
  Launch orchestrator       →  launcher.runPhaseOrchestrator() (single subprocess)
  Read report file          →  .trellis-phase-report.json
  Normalize report          →  normalizeReport() (handles LLM output variations)
  Browser smoke check       →  runBrowserSmokeForPhase() (if requiresBrowserTest)
  Judge phase               →  judgePhase() (judge → fix correction loop)
  Completion verification   →  verifyCompletion() (target paths + TODO scan)
  Auto-detect test suite    →  hasNewTestFiles() + detectTestCommand()
  Decide action             →  report.recommendedAction + judge assessment + user input
  Phase-level git commit    →  makePhaseCommit() (conventional commit format)
  Update state              →  stateManager.updateStateAfterPhase()

After all phases:
  Browser acceptance tests  →  runBrowserAcceptance() (if any phase had requiresBrowserTest)

Cleanup                     →  logger.close()
```

### Orchestrator execution

The orchestrator is spawned as a single `claude --agent --print` subprocess that runs to completion. It receives the full phase context via stdin and uses native Claude tools (Read, Write, Edit, Bash, Glob, Grep) to execute tasks. The orchestrator signals completion by writing a `.trellis-phase-report.json` file to the project root.

The phase context includes:

- Phase name, description, and all tasks with acceptance criteria
- Prior phase handoff briefing
- Shared state summary (completed phases, learnings)
- Pre-loaded spec and guidelines content
- Check command (if configured)
- Git commit protocol instructions
- Completion protocol with report JSON schema
- Previous attempt context (on retries — judge issues, corrective tasks)

### Phase completion detection

The orchestrator writes a `.trellis-phase-report.json` file to the project root when done. The phase runner reads and parses this file after the subprocess exits. The report is validated — all task IDs must appear in either `tasksCompleted` or `tasksFailed`. Missing tasks cause the report to be marked as `"partial"` with a recommendation to retry.

### Git commit protocol

The orchestrator creates **per-task commits** using conventional commit format during execution:

```text
<type>(<scope>): <summary>

- <change 1>
- <change 2>
```

After the phase advances, the runner creates a **phase-level commit** for any remaining uncommitted changes:

```text
feat(auth,api): [trellis phase-2] Implemented user authentication

- Created LoginForm component
- Added JWT token validation
```

Scopes are extracted from completed tasks' `targetPaths`, skipping generic top-level directories (src, lib, app).

### Judge flow

After the orchestrator completes a phase, the runner dispatches a **judge agent** to independently verify the work against the spec and task acceptance criteria. The judge runs inside a correction loop managed by `judgePhase()`.

#### Judge model selection

The judge uses **adaptive model selection** based on diff size:

- Small diffs (<150 lines) with few tasks (<3) → Sonnet
- Larger diffs or more tasks → Opus
- Explicit `--judge-model` override takes precedence

#### What the judge receives

The runner builds a judge prompt containing:

- **Changed files** — list with git status indicators (A/M/D), sourced from `startSha..HEAD` range
- **Full unified diff** — all changes made during the phase (committed + uncommitted)
- **Task definitions** — IDs, titles, descriptions, target paths, and acceptance criteria
- **Orchestrator's self-report** — the phase report with status and completion claims (marked as "context only — not authoritative")

#### Judge assessment format

The judge returns a `JudgeAssessment`:

```typescript
{
  passed: boolean;
  issues: JudgeIssue[];      // problems that must be fixed
  suggestions: JudgeIssue[];  // optional improvements
}
```

Where `JudgeIssue` is either a plain string or a structured object:

```typescript
{ task?: string; severity?: string; description: string }
```

#### Judge mode

Judge invocation is controlled by the `--judge` flag:

| Mode | Behavior |
|------|----------|
| `always` (default) | Judge runs after every phase |
| `on-failure` | Judge runs only when the phase status is not `"complete"` |
| `never` | Judge is skipped entirely |

The judge also runs on `"failed"` phases if they produced changes (so the fix loop can attempt recovery).

#### The judge → fix correction loop

When the judge finds issues and correction attempts remain (default max: 2), the runner automatically dispatches a **fix agent** to address them:

```text
judgePhase(phase, report)
  ├── Get changed files from git diff (startSha..HEAD)
  ├── Skip if no files changed
  └── Loop (up to maxCorrections):
       ├── Build judge/re-judge prompt
       ├── Select model (adaptive or override)
       ├── Dispatch judge sub-agent
       ├── Parse JudgeAssessment from response
       ├── Log "judge_invoke" trajectory event
       ├── If passed → break, return assessment
       ├── If not passed and attempts remain:
       │    ├── Capture pre-fix SHA for targeted diff
       │    ├── Dispatch fix sub-agent with issues list
       │    ├── Run check command (if configured)
       │    ├── Capture fix-only diff for targeted re-judging
       │    └── Refresh changed files for next pass
       └── If max corrections exceeded → return final assessment
```

After the first judge pass, subsequent passes use a **targeted re-judge prompt** that includes only the fix diff and previous issues (rather than the full phase diff), making re-evaluation faster and more focused.

#### How the assessment affects action decisions

The judge assessment is stored on the phase report as `judgeAssessment` and influences the action decision:

In `runPhases()`: If the judge found issues and the orchestrator recommended `"advance"`, the runner changes the recommendation to `"retry"` and populates `correctiveTasks` with the judge's issues.

In `runSinglePhase()`: Same behavior, but also downgrades the status to `"partial"`.

### Test auto-detection

If no `--check` command is provided, the runner automatically detects test suites when new test files appear:

- Checks `package.json` for a `test` script → `npm test`
- Checks for common config files (`vitest.config.ts`, `jest.config.js`, etc.) → appropriate `npx` command

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

On retry, the runner appends the report's `correctiveTasks` as new task objects to the phase and re-enters it without advancing the phase index. Corrective task IDs include a retry-count offset (`retryCount * 100`) to ensure uniqueness across retries. The retry counter is stored in `state.phaseRetries` and persists across saves.

State is only updated after the action decision. This prevents a retry-bound phase from being prematurely marked as completed.

### Resume

The runner supports resuming from a saved `state.json`. On startup, it loads existing state and skips any phase already in `completedPhases`. Combined with `--phase <id>` (via `runSinglePhase`), this gives the developer full control over re-entry points after a failure.

## Module wiring

The runner connects sub-modules through dependency injection rather than direct coupling:

```text
phaseRunner.runPhases()
  ├── stateManager      — load, init, save, update
  ├── scheduler         — validate dependencies, resolve execution order
  ├── trajectoryLogger  — append events per phase
  ├── git               — ensureInitialCommit, commitAll, getChangedFiles/Range, getDiff/Range
  └── executePhase()
       ├── agentLauncher.createAgentLauncher()
       │    ├── .dispatchSubAgent()         → judge + fix sub-agents
       │    └── .runPhaseOrchestrator()     → single fire-and-forget subprocess
       ├── browserSmoke.runBrowserSmoke()   → per-phase Playwright smoke check
       ├── browserAcceptance.runBrowserAcceptance() → end-of-build acceptance loop
       ├── completionVerifier.verifyCompletion() → target path + TODO scan
       ├── checkRunner.createCheckRunner()  → check command after fixes
       └── judgePhase()
            ├── dispatchSubAgent("judge")   → assess changes against criteria
            └── dispatchSubAgent("fix")     → correct issues (if judge fails)
```

## Exported API

### `runPhases(ctx: RunContext, tasksJson: TasksJson): Promise<PhaseRunnerResult>`

The main entry point. Runs all incomplete phases from `tasks.json`.

```typescript
const result = await runPhases(ctx, tasksJson);
// result.success          → true if all phases completed
// result.phasesCompleted  → ["phase-1", "phase-2"]
// result.phasesFailed     → []
// result.finalState       → full SharedState object
```

### `runSinglePhase(ctx, tasksJson, phaseId): Promise<PhaseRunnerResult>`

Runs one phase by ID. Same setup as `runPhases` but targets a single phase. Used for the `--phase <id>` CLI flag.

### `promptForContinuation(options?): Promise<"continue" | "retry" | "skip" | "quit">`

Reads a single line from stdin. Maps Enter → `"continue"`, `r` → `"retry"`, `s` → `"skip"`, `q` → `"quit"`. Displays retry counts, recommendations, and reasons when provided.

### `dryRunReport(tasksJson: TasksJson, ctx: RunContext): string`

Produces a human-readable execution plan without making any LLM calls. Uses the scheduler to resolve execution groups and detect target path overlaps.

### Other exported functions

- `buildPhaseContext(phase, state, handoff, ctx)` — constructs the orchestrator prompt
- `buildJudgePrompt(config)` — creates judge evaluation prompt
- `buildRejudgePrompt(config)` — creates targeted re-judge prompt after fix
- `buildFixPrompt(issues, phase)` — creates fix agent prompt
- `normalizeReport(raw, phaseId)` — normalizes orchestrator output to PhaseReport schema
- `selectJudgeModel(diffLineCount, taskCount, override?)` — adaptive model selection
- `parseJudgeResult(output)` — extracts JudgeAssessment from judge output
- `formatIssue(issue)` — formats JudgeIssue for display
- `makePhaseCommit(projectRoot, phase, report)` — creates conventional commit
- `extractScopes(phase, report)` — extracts scope names for commit messages
- `collectLearnings(state)` — gathers decision log entries from prior phases
- `hasNewTestFiles(projectRoot)` — checks for newly added test files
- `detectTestCommand(projectRoot)` — auto-detects test runner from project config
- `createDefaultCheck(projectRoot, phase)` — file-existence check when no command is configured

## Safety and cleanup

The runner uses `try/finally` to ensure `logger.close()` always executes, even on unhandled errors.

State is saved to disk after every phase boundary, so a crash between phases loses no progress. The trajectory log is flushed synchronously after each event (via `fsyncSync`), so the external record is always complete regardless of crashes.

## Configuration

Configuration is provided via `RunContext` (defined in `cli.ts`):

| Field | Default | Purpose |
|-------|---------|---------|
| `projectRoot` | *(from tasks.json)* | Absolute path to project root |
| `specPath` | *(from tasks.json)* | Path to spec file |
| `planPath` | *(from tasks.json)* | Path to plan file |
| `guidelinesPath` | *(optional)* | Path to guidelines file |
| `statePath` | `<tasksJsonDir>/state.json` | Persisted execution state |
| `trajectoryPath` | `<tasksJsonDir>/trajectory.jsonl` | Append-only event log |
| `checkCommand` | none | Shell command run after each task (e.g., `npm run lint && npm test`) |
| `concurrency` | `3` | Max parallel sub-agents within a phase |
| `model` | none | Override the orchestrator's default model |
| `maxRetries` | `2` | Max phase retries before halting |
| `headless` | `false` | Skip interactive prompts between phases |
| `verbose` | `false` | Print stream-json output from orchestrator |
| `dryRun` | `false` | Print execution plan, make no changes |
| `pluginRoot` | (required) | Directory containing `agents/` and `skills/` |
| `judgeMode` | `"always"` | When to run the judge: `always`, `on-failure`, `never` |
| `judgeModel` | *(adaptive)* | Override judge model selection |
| `timeout` | none | Explicit timeout override for orchestrator subprocess |
| `devServerCommand` | none | Dev server start command for browser testing (auto-detected if absent) |
| `saveE2eTests` | `false` | Save generated browser acceptance tests to project |
| `browserTestRetries` | `3` | Max retries for end-of-build browser acceptance loop |
