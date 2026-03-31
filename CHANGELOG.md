# Changelog

## 0.8.5

- Add `trellis-exec login` command for interactive OAuth inside Docker with credential persistence in a named volume
- Forward host plugins and settings into containers, run as non-root `claude` user
- Fix container auth failure caused by `--bare` flag skipping OAuth credential loading in newer Claude Code versions

## 0.8.4

- Fix container mode default network: change from `none` to `bridge` so the Claude CLI can reach the Anthropic API

## 0.8.3

- Fix duplicate binary name in Docker inner command that caused "Unknown command: trellis-exec" when using `--container`
- Auto-build Docker image when missing instead of failing with a cryptic pull error
- Add `docker:slim` and `docker:browser` npm scripts for easier image builds

## 0.8.2

- Reject plans with phase headings but no task items, falling back to LLM decomposition instead of silently producing empty phases

## 0.8.1

- Implement Docker container mode (Layer 4): `--container` launches `docker run` with the project mounted, re-invoking trellis-exec inside the container with full tool access and OS-level isolation
- Add container launcher module with pure `buildDockerArgs` and `buildInnerCliArgs` functions
- Add multi-stage Dockerfile (`slim` ~200MB, `browser` ~1.5GB with Playwright)
- Add container e2e tests with graceful skip when Docker is unavailable
- Add `docs/container-mode.md` with full documentation on mounts, networking, resource limits, and troubleshooting

## 0.8.0

- **BREAKING:** Safe mode is now the default. Agents run with granular permission controls instead of `--dangerously-skip-permissions`. Use `--unsafe` for legacy unrestricted access.
- Add permission controls: `buildPermissionArgs()` with safe, unsafe, and container modes. Judge and reporter agents are read-only in all modes.
- Add git checkpoints: automatic commit + tag before each phase for recovery on failure
- Add budget enforcement: per-phase cap via `--max-phase-budget` and cumulative run-level caps via `--max-run-budget` and `--max-run-tokens`
- Add container mode plumbing (`--container` flag and related options) for Docker-based isolation
- Add `init-safety` subcommand to generate reference safety config for interactive Claude Code sessions
- Strip `tools:` from all agent frontmatter; tool permissions are now controlled entirely by the execution mode via CLI flags
- Add default 30-minute phase timeout in safe mode when no explicit timeout is set
- Display budget usage in summary report when limits are configured

## 0.7.21

- Fix browser acceptance tester output parsing when CLI returns content block arrays instead of plain strings
- Add verbose logging of raw browser-tester output for debugging parse failures
- Strengthen browser-tester agent output format instructions to improve JSON compliance
- Track sub-agent token usage (judge, fix) in phase summary reports for accurate cost reporting
- Fix outdated model defaults and add --timeout documentation
- Fix ASCII diagram alignment in README

## 0.7.20

- Change default orchestrator model from sonnet to opus
- Add default values to CLI reference flags in README

## 0.7.19

- Make test auto-detection language-agnostic: support Python (pytest), Go, Rust, Ruby (rspec), Java (Maven/Gradle), Elixir, and Makefile projects
- Extend web app detection for Django, Rails, and Phoenix frameworks (two-signal heuristic to avoid false positives on API-only projects)
- Replace JS-specific prompt examples with language-neutral alternatives across prompts, agents, and skills

## 0.7.18

- Fix `runSinglePhase` missing orchestrator correction pre-application (--phase runs now apply corrections correctly)
- Split `phaseRunner.ts` into focused modules: `judgeRunner.ts`, `browserRunner.ts`, `testDetector.ts`
- Move `RunContext` type from `cli.ts` to `src/types/runner.ts` (fixes inverted dependency)
- Remove backward-compatibility re-exports from `phaseRunner.ts`
- Fix `tryParseAssessment` mutating input object in-place (spread into new object)
- Cache spec/guidelines content in `RunContext` to avoid repeated disk reads during prompt building
- Wrap `realpathSync` in try/catch to handle broken symlinks gracefully
- Add `KNOWN_AGENT_TYPES` enum for `subAgentType` validation
- Log SHA fallback in `getChangedFiles` instead of silently falling back
- Validate fallback `JudgeAssessment` through Zod schema
- Fix immutability violations in phaseRunner corrective task injection and planEnricher `mergeResolvedField`
- Enable `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` in tsconfig
- Replace greedy regex in `parseJudgeResult` with iterative JSON.parse scan
- Add truncation notice to reporter prompt when diff exceeds 50k chars
- Invert context authority: learnings (Current Understanding) positioned before spec with anti-hack instructions
- Add orchestrator self-correction via corrections field in PhaseReport

## 0.7.17

- Fix markdown lint errors for blank lines around lists in README and docs

## 0.7.16

- Update README with browser testing architecture, auto-detection, verification pipeline, new CLI flags, and new agents
- Sync all docs with current implementation: fix orchestrator timeouts, remove stale REPL/worktree references, add browser and verification coverage to phase-runner and harness-comparison docs

## 0.7.15

- Fix browser acceptance empty-results loop: break on unparseable tester output instead of dispatching fixer on nothing
- Reinforce JSON output requirement in browser-tester prompt and agent definition
- Fix judge attempt numbering off-by-one (`passed on attempt 0` → `passed on attempt 1`)
- Add `judgeFixCycles` to PhaseReport; combine with `phaseRetries` in summary report Retries column
- Rewrite summary table with minimal box-drawing (`│ ─ ┼` delimiters)
- Show explicit message for empty browser acceptance results instead of `0/0 criteria passed`
- Add constraint generalization instruction to orchestrator prompt for better cross-phase learning
- Strengthen plain-text output instruction in phase-orchestrator agent to reduce markdown leakage

## 0.7.14

- Remove dead `phaseReport` field from SharedState schema; make `exitCode` required in CheckResultSchema
- Extract shared judge/rejudge prompt helpers and `applyJudgeOutcome()` to reduce duplication
- Inline single-use `buildSubAgentPrompt`/`buildSubAgentArgs` into `dispatchSubAgent()`
- Consolidate `getChangedFiles()` to use single `git status --porcelain` call (halves git spawns for no-ref path)
- Batch `applyReportToTasks` with Map lookup instead of per-task O(n) scans
- Add `prompts.test.ts` covering `buildRejudgePrompt`, `formatIssue`, `normalizeReport`, `parseJudgeResult`, `collectLearnings`
- Add tests for `reviewPhaseContract`, `detectTestCommand`, `selectJudgeModel`
- Add edge case tests for devServer, completionVerifier, and stateManager (350 total tests, up from 309)

## 0.7.13

- Add judge corrections mechanism: judge can return `corrections` (e.g., targetPath renames) that update tasks.json before the completion verifier runs, eliminating false-positive failures for `.module.css`/`.css` and `.jsx`/`.js` mismatches
- Reorder phase runner flow: completion verifier now runs after judge (not before) so corrections are applied first
- Remove `EXTENSION_VARIANTS` hack from completionVerifier — path reconciliation is now handled by the judge
- Auto-inject CLAUDE.md scaffolding task into phase-1 during compilation, giving all agents persistent project orientation that survives context compaction
- Add browser smoke and dev server integration tests with Playwright fixtures
- Add foundational CLAUDE.md for the trellis-exec project itself

## 0.7.12

- Consolidate `getChangedFiles`/`getChangedFilesRange` and `getDiffContent`/`getDiffContentRange` into single functions with optional `fromSha` parameter, eliminating duplication and simplifying callers
- Extract 13 prompt-building and normalization functions from `phaseRunner.ts` into new `src/runner/prompts.ts`, reducing phaseRunner from 2,202 to 1,510 lines

## 0.7.11

- Add subAgentType-aware execution guidance to phase orchestrator (scaffold/implement/test-writer strategies)
- Add Task Type Summary section to phase context for orchestrator awareness
- Clarify classifySubAgentType() role as orchestrator hint, not automatic dispatch trigger

## 0.7.10

- Add project-level web app detection (`detectWebApp`) that checks for frontend framework deps, build-tool configs, and HTML entry points
- Fix `requiresBrowserTest` heuristic to propagate across phases for web app projects: sticky propagation once any phase has UI output, and last-phase guarantee so end-of-build acceptance tests always run

## 0.7.9

- Fix token/cost extraction to read from nested `usage.input_tokens` (actual CLI format) instead of non-existent top-level `num_input_tokens`, with fallback for legacy format
- Add extension-variant tolerance to completion verifier so `.js` target paths resolve when `.jsx` exists on disk, preventing infinite retry loops
- Skip corrective tasks in contract review to suppress false warnings about missing acceptance criteria and target paths

## 0.7.8

- Fix sub-agent CLI calls (judge, fix, etc.) failing silently due to missing `--verbose` flag required by Claude CLI for `stream-json` with piped stdin
- Skip fix-judge retry loop when judge sub-agent process itself fails, avoiding wasted corrective task cycles on infrastructure errors
- Add tests for sub-agent CLI failure handling and stream-json `--verbose` invariant

## 0.7.7

- Add two-tier browser testing with Playwright (optional peer dependency)
- Tier 1: per-phase deterministic smoke check (console errors, blank page detection, interactive element click test) runs before the judge on UI phases
- Tier 2: end-of-build LLM-driven acceptance tests generated from spec criteria, with browser-fixer retry loop (default 3 retries)
- Add `requiresBrowserTest` flag to Phase schema, set by compiler prompt and deterministic heuristic
- Add `--dev-server`, `--save-e2e-tests`, `--browser-test-retries` CLI flags
- Add language-agnostic dev server autodiscovery (Node, Python, Rails, Go, Docker Compose)
- Add `browser-tester` (Opus) and `browser-fixer` (Sonnet) agent definitions
- Feed browser smoke results to judge prompt as additional evidence
- Include browser acceptance results in end-of-run summary report

## 0.7.6

- Upgrade phase learnings to authoritative "Spec Amendments" that take precedence over spec assumptions
- Add `constraint` decision tier for runtime/toolchain facts discovered during implementation (never evicted)
- Reorder phase context so amendments appear after spec/guidelines, giving discovered constraints last-word authority
- Add structured handoff template (Architecture State / Deviations from Spec / Watch List) to orchestrator prompt
- Add consistent output style instructions to phase-orchestrator for `[task-id]` progress format

## 0.7.5

- Add end-of-run summary report showing per-phase time, task completion, judge results, retries, token usage, and cost
- Switch CLI subprocess output from `--print` to `--output-format stream-json` to capture token usage from Claude CLI result events
- Extract and accumulate token usage (input/output tokens, cost) per phase

## 0.7.4

- Randomize orchestrator spinner message from 10 fun labels instead of always showing "Orchestrating…"
- Reframe README tagline as phased execution harness

## 0.7.3

- Start judge attempt count at 1 instead of 0 for user-friendly output
- Use descriptive log message when orchestrator starts, keep spinner as "Orchestrating…"
- Adjust spinner frames so bounce endpoints show 1 bar instead of 0

## 0.7.2

- Fix false projectRoot/git-root mismatch warning on case-insensitive filesystems (macOS) by using `realpathSync` for path canonicalization
- Add success log for completion verifier so users can confirm it ran

## 0.7.1

- Fix projectRoot resolution: auto-detect git root instead of defaulting to tasks.json directory, preventing infinite retry loops when tasks.json lives in a subdirectory like `.specs/feature/`
- Add "all paths missing" diagnostic in completion verifier to fail fast with a clear error instead of snowballing corrective tasks
- Add early projectRoot sanity warning when resolved path is inside `.specs/` or differs from the git root

## 0.7.0

- Relax sub-agent tool restrictions: implement agent gains Glob/Grep, scaffold agent gains Edit
- Increase default orchestrator timeout to 30 minutes, add `--long-run` flag for 2-hour timeout
- Add long-running phase protocol with intermediate commit reminders for reporter fallback safety
- Add lightweight completion verification pass (target path existence, TODO/FIXME scan) before judge
- Replace flat 20-entry decisionsLog cap with tiered learnings: architectural decisions never evicted
- Add pre-phase contract review that flags missing or vague acceptance criteria before execution
- Add long-running harness comparison doc analyzing Trellis against Anthropic research

## 0.6.2

- Fix caller mutation: deep-clone tasksJson in runPhases and shallow-copy ctx to prevent side effects
- Add stdin error handler in execClaude to surface backpressure/early close as a proper rejection
- Fail fast on unreadable spec/guidelines files instead of silently injecting error text into prompts
- Add guidelinesRef to LLM decompose fallback path in compilePlan
- Wrap loadState JSON.parse in try/catch with file path in error message
- Increase default orchestrator timeout to 15m, add --timeout CLI flag and reporter fallback sub-agent
- Allow judge to upgrade timed-out phases when committed work passes review
- Sync task statuses back to tasks.json after each phase completes
- Fix check command auto-detection to use range-based diff for committed test files

## 0.6.1

- Validate and rewrite all docs to match current native-tools architecture
- Archive 7 obsolete docs (REPL, worktree, old spec) to docs/_archive/
- Update README with all current CLI flags, compile options, env vars, and adaptive judge model

## 0.6.0

- Add adaptive judge model selection: Sonnet for small diffs (<150 lines, <3 tasks), Opus for larger work
- Add `--judge` flag (`always|on-failure|never`) to control when the judge runs
- Add `--judge-model` flag to explicitly override the judge model
- Use targeted re-judge prompt after fix (fix-only diff instead of full phase diff)
- Switch orchestrator sub-agent dispatch from CLI subprocess to native Agent tool
- Remove unused `modifiedFiles` and `schemaChanges` state fields
- Consolidate duplicate `stripCodeFences` utility

## 0.5.11

- Fix spinner bounce to show zero bars at both endpoints for symmetric animation

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
