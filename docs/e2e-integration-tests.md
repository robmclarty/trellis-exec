# End-to-End Integration Tests

## Why these tests exist

The unit tests for each module (plan compiler, phase runner, scheduler, REPL
manager, etc.) verify that individual components behave correctly in isolation.
What they cannot verify is whether those components work together as a system —
whether a plan compiled from markdown actually produces state that the phase
runner can consume, whether that state survives a process restart and resumes
correctly, or whether the scheduler's execution groups actually feed into the
runner's phase loop the way the spec intends.

The e2e tests exist to close that gap. They exercise the full pipeline —
compile, schedule, run, persist, resume — against a real (trivial) test project,
verifying the automated success criteria from §10 of the spec.

## Test fixtures

All fixtures live under `test/fixtures/e2e/`:

```text
test/fixtures/e2e/
├── test-project/           # Minimal Node.js project
│   ├── package.json        # "test" script uses Node's built-in test runner
│   ├── tsconfig.json
│   └── src/
│       └── index.ts        # One existing source file
├── sample-spec.md          # Spec: add a greet(name) function
└── sample-plan.md          # Plan: Phase 1 creates greet.ts, Phase 2 creates tests
```

The test project is intentionally minimal — just enough to have a working
`npm test` and a file for the plan to build on. The spec and plan describe a
trivial feature (a greeting function with two behaviors) split across two phases
so that handoff, state persistence, and resume can all be tested.

## Test structure

The tests in `src/__tests__/e2e.test.ts` are split into two groups.

### Group 1: No LLM required

These tests use the same mock patterns as the unit tests in
`src/runner/__tests__/phaseRunner.test.ts` — mock agent launcher, mock REPL
session, mock helpers — so they run fast and deterministically in any CI
environment.

| Test | What it verifies | §10 criteria |
|------|-----------------|--------------|
| **Compile** | `parsePlan` + `enrichPlan` produces valid `TasksJson` from `sample-plan.md`. Checks phase count, targetPaths, specSections, subAgentType classification. | #1 |
| **Dry run** | `dryRunReport` output contains phases, tasks, agent types, spec/plan refs, and grouping labels. | #7 |
| **State round-trip** | Run phase 1 with mocks → verify `state.json` on disk (completedPhases, handoff in phaseReport) → pre-populate state for resume → run again → phase 2 completes without re-running phase 1. | #3 |
| **Parallel scheduling** | 4 tasks where A→B and C, D are independent: scheduler puts A+C+D in group 0 (parallelizable), B in group 1. Also: two tasks targeting the same file are serialized via implicit dependency. | #8, #9 |
| **Phase retry** | Phase 1 returns `recommendedAction: "retry"` with corrective tasks → runner re-enters phase → second attempt returns `advance` → `phaseRetries` counter is 1. | #10 |
| **Handoff consumption** | Phase 1 report includes a handoff string → it persists in `state.json` → available to phase 2 context. | #4 |
| **REPL truncation** | Real (not mocked) `createReplSession` evaluates code producing >8192 chars → `result.truncated` is true, output contains `[TRUNCATED` marker. | #5 |
| **Architectural validation** | `phaseRunner.ts` contains zero direct LLM/claude/anthropic imports — all LLM interaction is behind the `AgentLauncher` interface. Trajectory log exists after a run with valid JSONL lines. | Architectural criteria, #15 |

### Group 2: Requires claude CLI

These tests are wrapped in `describe.skipIf(!hasClaude())` and will only run
when the `claude` CLI binary is on `$PATH`. They exercise the real end-to-end
flow:

1. Copy the test project to a temp directory and `git init`.
2. Compile `sample-plan.md` into `tasks.json` (deterministic parse, no LLM
   needed for this step since the plan is well-structured).
3. Run `trellis-exec run tasks.json --headless --isolation none` via the
   compiled CLI entry point.
4. Verify that `src/greet.ts` and `src/greet.test.ts` exist in the project.
5. Verify that `npm test` passes.
6. Verify that `trajectory.jsonl` contains valid JSONL events.

This test has a 10-minute timeout since it involves real LLM calls.

## How the mocks work

The e2e tests reuse the mock wiring pattern from the phaseRunner unit tests.
Four modules are mocked via `vi.mock()`:

- **agentLauncher** — `createAgentLauncher` returns an object with mock
  `launchOrchestrator`, `dispatchSubAgent`, and `llmQuery`. The mock
  orchestrator returns pre-scripted code strings that the mock REPL session
  evaluates.
- **replManager** — `createReplSession` returns a mock session where `eval`
  intercepts `writePhaseReport(...)` calls and delegates to the helpers, causing
  the phase runner to detect phase completion.
- **replHelpers** — `createReplHelpers` returns stubs for all helper functions.
- **worktreeManager** — all worktree operations return success without touching
  git.

The REPL truncation test is the exception: it uses `vi.importActual` to get the
real `createReplSession` implementation so it can verify the actual truncation
behavior in the `node:vm` sandbox.

## Running the tests

```bash
# All tests (Group 1 always runs, Group 2 skips if no claude CLI)
npm run test

# Just the e2e file
npx vitest run src/__tests__/e2e.test.ts

# With verbose output
npx vitest run src/__tests__/e2e.test.ts --reporter=verbose
```

## Adding new e2e tests

When adding a new §10 criterion or verifying a new cross-module behavior:

1. If it can be tested with mocks, add it to Group 1. Use `setupMocksForSuccess`
   or write custom mock wiring following the existing patterns.
2. If it requires real LLM interaction, add it to the Group 2 `describe` block
   with `skipIf(!hasClaude())`.
3. If it needs a new fixture (a different plan structure, a project with
   specific files), add it under `test/fixtures/e2e/`.
