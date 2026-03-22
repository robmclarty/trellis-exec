# Changelog

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
