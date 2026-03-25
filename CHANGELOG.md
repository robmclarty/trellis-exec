# Changelog

## 0.5.10

- Polish orchestrator spinner: add trailing ellipsis to label and smooth ping-pong with 1-frame dwell at bounce endpoints
- Fix spinner animation to bounce back and forth instead of jumping to start
- Normalize orchestrator spinner label to action word "Orchestrating…"

## 0.5.9

- Fix spinner leak: stop spinner in executePhase catch block so process exits after orchestrator timeout
- Add cross-phase learnings: surface `decisionsLog` entries from prior phases in orchestrator context
- Cap accumulated learnings at 20 entries with phase ID prefix for provenance
- Update phase-orchestrator agent to reference learnings and write forward-looking decisionsLog entries

## 0.5.8

- Add test coverage for streamParser, agentLauncher, and spinner (3 new test files)
- Expand phaseRunner tests with range-based judging and startSha tracking coverage
- Expand prompts tests with buildEnrichmentPrompt coverage
- Export `formatElapsed` from spinner for testability
- Fix markdown lint errors and migrate agnix config to tools array

## 0.5.7

- Add per-task git commits via orchestrator prompt (conventional commit format with scope and bullet summary)
- Add per-phase git commit in runner after judge passes, summarizing all completed tasks
- Track `startSha`/`endSha` per phase in PhaseReport for commit range tracking
- Fix judge silently auto-passing by using range-based diffs (`startSha..HEAD`) instead of working tree vs HEAD
- Add git helpers: `getCurrentSha`, `ensureInitialCommit`, `commitAll`, `getChangedFilesRange`, `getDiffContentRange`
- Add `getPhaseCommitRange` convenience function to state manager

## 0.5.6

- Use absolute path for phase report file in completion protocol so subagents resolve the correct location

## 0.5.5

- Stream orchestrator output in real-time using `claude --output-format stream-json` instead of buffered `--print`
- Add pause/resume to spinner so real-time output and elapsed-time indicator coexist cleanly
- Add NDJSON stream parser (`src/ui/streamParser.ts`) for extracting assistant text and result events

## 0.5.4

- Stream orchestrator stdout/stderr in real-time with `--verbose` flag
- Show actual recommendation (retry/halt/advance) in interactive prompt instead of misleading "continue" label
- Run judge even when phase fails if files were changed, preventing silent skip of judge/fix loop
- Default to "retry" instead of "halt" for transient failures like missing report files
- Store current phase report in `state.json` (`phaseReport` field) and clean up temp file after reading
- Auto-detect new test files after each phase and set check command from `package.json` or test runner configs
- Refactor `execClaude` to use options object instead of positional params

## 0.5.3

- Use Opus instead of Haiku for plan decomposition to handle ambiguous, architectural inputs
- Add stage-based progress messages during compile (parsing, decomposing, enriching, validating)
- Show elapsed time in spinner during long-running LLM calls
- Increase default compile timeout to 10 minutes with `--timeout` CLI flag for user override
- Add `onStderr` callback to `execClaude()` for real-time subprocess progress streaming
- Add simplified orchestration design document and native tools architecture doc

## 0.5.2

- Remove unused imports in phaseRunner test to fix lint warnings

## 0.5.1

- Fix executable bit on dist/cli.js lost during tsc rebuild, causing npx entrypoint to fail with "Permission denied"

## 0.5.0

- Replace REPL-mediated orchestrator with single `claude --print` invocation per phase using native tools (Read, Write, Edit, Bash, Glob, Grep)
- Orchestrator signals completion by writing `.trellis-phase-report.json` to disk instead of calling a REPL helper
- Remove worktree isolation (`--isolation` flag) — phases run directly in project root
- Remove `turnLimit` and `maxConsecutiveErrors` CLI options (no longer applicable without REPL turn loop)
- Add previous-attempt context to phase prompt for retries (last report, judge issues, corrective tasks)
- Extract git-diff helpers into standalone `src/git.ts` module
- Replace `AgentLauncher` dependency in `compilePlan` with simple `query` callback
- Delete replManager, replHelpers, worktreeManager and all associated tests (~8,700 lines removed)

## 0.4.10

- Add input validation to dispatchSubAgent() — returns descriptive error instead of crashing on wrong argument format
- Add writeFile(path, content) REPL helper for simple file creation without spawning a sub-agent
- Add task completion gate on writePhaseReport() — rejects reports missing any task from tasksCompleted or tasksFailed
- Add stuck-loop detection — intervenes after 4 identical REPL outputs with alternative approach guidance
- Update orchestrator prompts with writeFile docs, dispatchSubAgent worked example, and stricter completion rules
- Fix safePath ancestor resolution for symlinked tmpdir paths

## 0.4.9

- Fix REPL async IIFE wrapper silently dropping sub-agent return values, causing orchestrator to skip tasks and prematurely complete phases
- Wrap dispatchSubAgent and runCheck in sandbox with auto-reporting via capturedConsole so results always appear in REPL output
- Fix statement-form IIFE to return the last `var` declaration's value

## 0.4.8

- Add adaptive REPL timeout: 30s for sync expressions, 5min for long-running helpers (dispatchSubAgent, runCheck, llmQuery) so sub-agents aren't killed prematurely
- Strengthen post-timeout feedback to prevent orchestrator from hallucinating that timed-out work was completed
- Pre-load spec and guidelines content into orchestrator phase context to eliminate warm-up turns

## 0.4.7

- Accept structured judge output objects (`{task, severity, description}`) as the primary format, with plain strings as fallback
- Normalize `detail` → `description` field before validation to handle LLM field name variance
- Fix "continue" action incorrectly mapping to "halt" when the judge recommends retry
- Show retry counter (`retries used: 1/2`) in the interactive phase prompt
- Log a message when max retries are exceeded instead of exiting silently
- Remove habbit-tracker example files

## 0.4.6

- Add bouncing-bar spinner animation on stderr during LLM wait states (orchestrator launch, REPL turns, judge dispatch, plan compilation)

## 0.4.5

- Add `normalizeReport()` to validate and map orchestrator phase reports to the canonical schema, fixing Zod validation errors from LLM-style field names
- Detect and skip comment-only code blocks in the REPL turn loop; log raw orchestrator responses in verbose mode for debugging
- Increase verbose output limits from 200 to 500/1000 chars for code/results
- Add default file-existence check when no `--check` command is provided, verifying all phase `targetPaths` exist
- Include untracked files in `getChangedFiles()` and `getDiffContent()` so the judge reviews new files created by sub-agents
- Improve timeout error messages to prevent orchestrator from writing false "complete" reports after sub-agent timeouts
- Enforce all-tasks iteration in orchestrator prompts — `writePhaseReport()` must not be called until every task is attempted

## 0.4.4

- Document judge → fix correction loop in phase-runner.md
- Update README architecture diagram to show judge/fix as post-orchestration Phase Runner step
- Fix judge model reference (Sonnet → Opus) and remove stale env vars from README

## 0.4.3

- Fix markdown lint errors in docs (trailing punctuation, blank lines, code fence labels)

## 0.4.2

- Add comprehensive test coverage for critical execution paths (191 → 273 unit tests)
- New test files for replHelpers, extractCode, and compilePlan covering previously untested modules
- Add mergeWorktree tests for clean merges, conflicts, and missing branches
- Add CLI handler subprocess tests for handleStatus, handleCompile, and handleRun
- Add buildJudgePrompt edge case and runPhases halt action tests
- Export `stripCodeFences` from compilePlan for direct unit testing

## 0.4.1

- Fix interactive prompt to accept full words "retry"/"skip"/"quit" (not just single chars)
- Fix REPL variable scoping — `var` declarations now persist across eval turns for synchronous code
- Fix `searchFiles` to auto-detect glob patterns in first param instead of treating them as regex
- Make spec and guidelines file references explicit in phase context with `readFile()` examples

## 0.4.0

- Move judge invocation from orchestrator to phase runner — judge now runs as a system-controlled gate between phases using git diff for accurate changed-file detection
- Add lightweight fix agent (`agents/fix.md`) for targeted corrections from judge feedback
- Upgrade judge model from sonnet to opus for better reasoning on tricky issues
- Add bounded judge-fix correction loop (max 2 attempts) before surfacing issues
- Add `getChangedFiles()` and `getDiffContent()` git diff helpers to worktree manager
- Add progress logging during phase runner startup

## 0.3.12

- Fix cross-phase task dependency validation — tasks can now reference IDs from prior phases without being rejected as non-existent

## 0.3.11

- Store specRef, planRef, and guidelinesRef as relative paths in tasks.json, making it portable across machines

## 0.3.10

- Add `projectRoot` as required field in tasks.json, enabling tasks.json to live outside the project directory
- Introduce `RunContext` type that normalizes CLI flags + tasks.json refs into a single resolved config before execution
- Add `--spec`, `--plan`, `--guidelines` CLI override flags for the run command
- Refactor phaseRunner to accept pre-resolved `RunContext` instead of resolving paths internally
- Fix markdown lint errors in docs and README

## 0.3.9

- Format-agnostic plan compiler: accepts any well-structured technical plan, not just phase/task formatted plans
- New `buildDecomposePrompt` decomposes plans via LLM using full spec + plan + guidelines as context
- Add `--guidelines` CLI flag for the compile command
- Add optional `guidelinesRef` field to TasksJson schema
- Copy guidelines file to project root during execution, mirroring spec pattern
- Include guidelines reference in `buildPhaseContext` orchestrator context

## 0.3.8

- Replace spec-section-injection with spec file copy into project root for simpler, more reliable spec access
- Remove `readSpecSections` REPL helper and `parseSpecSections` — orchestrator now reads spec directly via `readFile()`
- Update phase-orchestrator and skill docs to reference `readFile('spec.md')` instead of `readSpecSections()`

## 0.3.7

- Fix readSpecSections to accept both array and varargs calling conventions
- Update phase-orchestrator prompt to direct agent to use pre-loaded spec sections
- Add test coverage for parseSpecSections, buildPhaseContext spec embedding, and varargs readSpecSections

## 0.3.6

- Pre-load spec sections into phase context prompt for --project-root compatibility
- Add graceful error handling to readSpecSections when spec file is missing

## 0.3.5

- Add `--project-root` CLI flag to decouple project root from tasks.json location

## 0.3.4

- Fix invalid git branch names when specRef is an absolute file path in worktree creation

## 0.3.3

- Add habit-tracker example specs (plan, spec, tasks, guidelines, pitch)

## 0.3.2

- Auto-fallback to LLM parsing when deterministic plan parser cannot identify phase boundaries

## 0.3.1

- Fix CLI entrypoint detection for `npx` and `npm link` by resolving symlinks with `realpathSync`
- Fix vitest config `resolve` option incorrectly nested inside `test` (ts2769)

## 0.3.0

- Rewrite orchestrator to use sequential `--print --continue` calls instead of persistent process
- Fix `--agent-file` → `--agent` CLI flag for sub-agents and orchestrator
- Add `--dangerously-skip-permissions` for headless sub-agent execution
- Disable orchestrator file tools via `--disallowedTools` to enforce REPL-only interaction
- Add `extractCode()` to parse JS from Claude responses, filtering natural language
- Add corrective nudge when orchestrator outputs natural language instead of JS
- Add REPL helper function docs to phase context
- Fix `dryRun` passthrough in `executePhase` (was hardcoded to `false`)
- Gate e2e CLI test behind `TRELLIS_E2E_CLAUDE` env var
- Split vitest config into unit and e2e with dedicated scripts
- Add `docs/cli-integration-architecture-changes.md` documenting the new architecture
- Update sub-agent prompt and agent files to use Write/Edit tools instead of text output

## 0.2.14

- Fix command injection in worktreeManager by replacing execSync with execFileSync
- Fix getState() ENOENT crash on first phase turn (returns empty initial state)
- Fix in-place mutation of phase tasks during retry (spread copies + unique IDs)
- Fix listener leak in agentLauncher orchestrator handle
- Add regex validation in searchFiles to prevent ReDoS and SyntaxError
- Add `--enrich` flag to compile CLI for opt-in LLM enrichment
- Fix cleanupWorktree running from inside the directory being deleted
- Track and clear sandbox timers on session destroy to prevent leaks
- Add 14 new security and edge-case tests
- Add docs/security.md documenting attack surface and mitigations
- Redesign README banner and add architecture diagram drafts

## 0.2.13

- Add Claude CLI pre-flight check with clear install message on failure
- Remove dead TRELLIS_EXEC_COMPACTION_THRESHOLD env var from help text
- Add tests for llmQuery default model and interactive mode promptForContinuation
- Document sub-agent permission enforcement model (Claude CLI --agent-file)
- Clean up stale TODO reference in skills doc

## 0.2.12

- Add e2e integration tests verifying §10 success criteria (compile, dry run, state round-trip, parallel scheduling, phase retry, handoff, REPL truncation, architectural validation)
- Add test fixtures: minimal Node.js test project, sample spec, and sample plan
- Add Group 2 claude CLI tests that skip gracefully when CLI is unavailable
- Add e2e integration tests documentation

## 0.2.11

- Package for dual npm CLI and Claude Code plugin distribution
- Add README with installation, CLI reference, architecture, configuration, and custom agents docs
- Update package.json with files, keywords, author, and prepublishOnly script
- Update plugin.json description and keywords
- Fix Zod 4 `z.record()` arity in agent linter

## 0.2.10

- Add eight orchestrator skills: compile, dispatch-agent, explore-codebase, manage-phase, quick-query, run, status, and verify-work
- Add skill architecture documentation explaining the rationale for skill-based orchestrator design
- Add agnix linter configuration
- Fix agent tools frontmatter to use YAML array syntax

## 0.2.9

- Fix agent frontmatter to use `tools` instead of `allowed-tools` per official Claude Code sub-agent docs
- Add Zod-based agent frontmatter linter with strict schema validation to catch unknown fields

## 0.2.8

- Add agent markdown files: phase-orchestrator, implement, test-writer, scaffold, and judge
- Update agent frontmatter to `allowed-tools` syntax matching current Claude Code format
- Add agnix and markdownlint-cli2 dev dependencies with `lint:code`, `lint:md`, and `lint:agents` scripts
- Add `.markdownlint-cli2.jsonc` config and fix all markdown lint errors across docs and agents
- Fix skill `allowed-tools` to space-delimited format per Agent Skills spec

## 0.2.7

- Add plan enricher (Stage 2) with targeted Haiku calls for ambiguous fields flagged by the deterministic parser
- Add prompt templates for enrichment and full-plan fallback parsing
- Add `compilePlan` pipeline wiring Stages 1–3: deterministic parse → targeted enrichment → fallback
- Add plan compiler architecture documentation

## 0.2.6

- Add CLI entry point (`src/cli.ts`) with `run`, `compile`, and `status` subcommands
- Argument parsing via Node built-in `util.parseArgs()` with environment variable fallbacks
- CLI flags override environment variables; environment variables override defaults
- Add `bin` field and `build` script to `package.json`
- Include compiled `dist/` output for direct installation
- Add CLI reference documentation (`docs/cli.md`)

## 0.2.5

- Add phase runner — the deterministic outer loop that composes all sub-modules into the full execution pipeline
- Implements §6 Phase Runner Logic: phase iteration, orchestrator ↔ REPL turn loop, advance/retry/skip/halt action handling, worktree commits at phase boundaries, and resume from saved state
- Add phase runner documentation

## 0.2.4

- Add agent launcher module for managing claude CLI subprocesses (sub-agent dispatch, LLM queries, orchestrator sessions)
- Support real, dryRun, and mock operating modes for testability
- Add agent launcher documentation

## 0.2.3

- Add git worktree manager for isolating execution runs on separate branches (create, commit, merge, cleanup)
- Add check runner for executing user-defined verification commands as a deterministic gate after each task
- Add documentation for worktree manager and check runner modules

## 0.2.2

- Add REPL manager (replManager.ts) with vm-based sandboxed eval, expression-first async execution, output truncation, scaffold restoration, and consecutive error tracking
- Add REPL helper factory (replHelpers.ts) with filesystem helpers (readFile, listDir, searchFiles, readSpecSections, getState) and stubs for agent/LLM helpers
- Add REPL architecture documentation
- Add JSDoc comments to orchestrator, planParser, and scheduler functions

## 0.2.1

- Add deterministic plan parser (Stage 1 of plan compiler) that extracts phases, tasks, spec references, file paths, dependencies, sub-agent types, and acceptance criteria from plan.md without LLM calls
- Flag ambiguous fields for Stage 2 enrichment
- Move test fixtures to test/fixtures

## 0.2.0

- Add task scheduler with dependency resolution and parallel execution grouping
- Implement targetPaths overlap detection for implicit dependency serialization
- Add dependency validation (missing refs, self-refs, circular dependencies)
- Document scheduler grouping vs spec §10 #8 ordering rationale
- Fix invalid --verbose flag in typecheck script

## 0.1.6

- Add oxlint linter with lint and lint:fix npm scripts
- Fix no-empty-file lint violation in test setup

## 0.1.5

- Migrate test suite from node:test to vitest with expect-style assertions
- Add vitest.config.ts scoped to *.test.ts files only
- Add test/ directory for shared test concerns
- Add typecheck script with verbose tsc output
- Add tsconfig.test.json for typechecking test files separately from build

## 0.1.4

- Add state persistence layer (stateManager) with atomic writes and Zod validation
- Add crash-safe trajectory logger with JSONL append
- Enable @types/node in tsconfig and add tsx for test execution
- Add test suites for stateManager and trajectoryLogger (19 tests)
- Add .npmrc with save-exact config

## 0.1.3

- Add core data model types and Zod schemas for tasks, state, and agents
- Add zod as a dependency
- Switch package type to ESM

## 0.1.2

- Add Trellis RLM Executor spec v3 documentation
- Add gitkeep files for agents, hooks, and skills directories

## 0.1.1

- Add project scaffolding (package.json, tsconfig, .gitignore)
- Add plugin manifest and version bump skill
- Add Claude Code settings
