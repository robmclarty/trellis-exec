# CLAUDE.md — trellis-exec

## Project

Phased execution harness for coding agents. Compiles a `plan.md` into structured `tasks.json`, then executes tasks phase-by-phase with sub-agent dispatch, a judge-fix verification loop, and iterative refinement. Each phase gets its own context window to eliminate context rot.

Published as both an npm CLI (`trellis-exec`) and a Claude Code plugin.

## Commands

```bash
npm run typecheck          # tsc --noEmit (main + test configs)
npm run lint               # oxlint + markdownlint + agnix (agent linter)
npm test                   # unit + e2e + browser tests
npm run test:unit          # vitest run
npm run test:e2e           # vitest run --config vitest.e2e.config.ts
npm run test:browser       # vitest run --config vitest.browser.config.ts
npm run build              # tsc (compile to dist/)
```

Always run `npm run typecheck && npm run lint` before committing. Run `npm test` to verify nothing is broken.

**Important:** `dist/` is checked into the repo — it is the actual script that gets distributed and run. After making source changes, run `npm run build` and commit the updated `dist/` directory.

## Architecture

```text
src/
  cli.ts                   # CLI entry point
  git.ts                   # Git utilities (diff, changed files, commit)
  compile/                 # Plan → tasks.json compilation
  runner/                  # Phase execution engine
    phaseRunner.ts         #   Main loop: orchestrate → judge → verify → advance/retry
    stateManager.ts        #   state.json read/write, task status sync
    prompts.ts             #   Prompt builders for orchestrator, judge, fix, reporter
    scheduler.ts           #   Dependency validation and execution ordering
  orchestrator/            # Sub-agent dispatch (agentLauncher.ts)
  verification/            # Post-phase checks
    completionVerifier.ts  #   Target path existence + TODO scan
    checkRunner.ts         #   User-provided check command runner
    browserSmoke.ts        #   Playwright smoke tests (optional)
    browserAcceptance.ts   #   End-of-build acceptance tests
    devServer.ts           #   Dev server lifecycle management
  types/                   # Zod schemas + TypeScript types
    state.ts               #   SharedState, PhaseReport, JudgeAssessment
    tasks.ts               #   TasksJson, Phase, Task
  ui/                      # Spinner, stream parsing, summary report
  logging/                 # Trajectory logging (JSONL)
agents/                    # Sub-agent definitions (.md with frontmatter)
skills/                    # Claude Code skill definitions
hooks/                     # Plugin hooks
```

### Execution flow

```text
orchestrator → browser smoke → judge (+ apply corrections) → completion verifier → advance/retry
```

The judge can return `corrections` (e.g., targetPath renames) that update tasks.json before the verifier runs. Corrections auto-generate constraint-tier decisions that propagate to future phases.

## Code conventions

- **TypeScript strict mode** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- **ESM only** — use `.js` extensions in import paths (e.g., `import { foo } from "./bar.js"`)
- **Named exports** — no default exports; use `export type` for type-only exports
- **Zod for runtime validation** — schemas live in `src/types/`, parsed at system boundaries
- **Immutable state updates** — `stateManager.ts` functions return new objects, never mutate
- **Functional style** — prefer factory functions and closures over classes
- **Semicolons always**
- **camelCase** for files and functions, **PascalCase** for types, **SCREAMING_SNAKE** for constants
- **Section separators** in longer files: `// ---\n// Section Name\n// ---`

## Testing

- **Framework**: vitest 4.1.0 (imports from `vitest`, not globals)
- **Location**: colocated `__tests__/` directories (e.g., `src/runner/__tests__/phaseRunner.test.ts`)
- **Mocks**: declare `vi.mock()` before imports of the module under test
- **Fixtures**: `test/fixtures/` for shared test data
- **Coverage**: v8 provider, excludes test files and types

## Git

- **Conventional commits**: `<type>(<scope>): <subject>` — lowercase, imperative tense
- Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`
- Scopes match source directories: `runner`, `judge`, `verification`, `compile`, `orchestrator`

## Key types

- **`TasksJson`** — the full task plan: phases → tasks with targetPaths, acceptanceCriteria, specSections
- **`SharedState`** — runtime state: currentPhase, completedPhases, phaseReports, phaseRetries
- **`PhaseReport`** — output of each phase: status, tasksCompleted/Failed, decisionsLog, handoff, judgeAssessment
- **`JudgeAssessment`** — judge output: passed, issues, suggestions, corrections
- **`DecisionEntry`** — `{ text, tier }` where tier is `architectural` | `tactical` | `constraint`; constraints are never evicted from the learnings window

## Dependencies

- **Runtime**: only `zod` (schema validation)
- **Peer**: `playwright` (optional, for browser testing)
- **Dev**: TypeScript, vitest, oxlint, markdownlint-cli2, agnix, tsx
