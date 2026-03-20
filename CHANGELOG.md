# Changelog

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
