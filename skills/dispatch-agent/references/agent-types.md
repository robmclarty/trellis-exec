# Agent Types

Detailed reference for all sub-agent types available to the phase orchestrator.

## implement

**File:** `agents/implement.md`
**Model:** Sonnet
**Purpose:** Create or modify source files per task instructions.
**Permissions:** Write to specified `outputPaths` only.

Use for any task that requires creating new source files or modifying existing ones. This is the workhorse agent — most tasks go through `implement`.

**When to use:**

- Creating new modules, functions, or types
- Modifying existing source code to add features or fix bugs
- Refactoring code structure

**Context to provide:**

- The target file (if modifying an existing file)
- Type definitions used by the target
- Related modules that import from or are imported by the target
- Clear instructions with acceptance criteria

**Example dispatch:**

```js
const result = await dispatchSubAgent({
  type: "implement",
  taskId: "phase1-task2",
  instructions: `Create src/runner/stateManager.ts with:
- readState(path): reads and parses state.json, returns SharedState
- writeState(path, state): writes SharedState to state.json
- updateTaskStatus(state, taskId, status): returns new state with updated task
Use the SharedState type from src/types/state.ts`,
  filePaths: ["src/types/state.ts"],
  outputPaths: ["src/runner/stateManager.ts"],
})
```

## test-writer

**File:** `agents/test-writer.md`
**Model:** Sonnet
**Purpose:** Create test files for source modules.
**Permissions:** Write to `*.test.ts` and `*.spec.ts` files only.

Use when the task specifically calls for creating or updating tests. The test-writer is scoped to test files only — it cannot modify source code.

**When to use:**

- Creating test files for newly implemented modules
- Adding test cases to existing test files
- Writing regression tests for bugs

**Context to provide:**

- The source file being tested (so the agent knows the API)
- Type definitions for parameters and return values
- Existing test files (so the agent matches test conventions)
- Spec sections describing expected behavior

**Example dispatch:**

```js
const result = await dispatchSubAgent({
  type: "test-writer",
  taskId: "phase1-task5",
  instructions: `Write tests for src/compile/planParser.ts. Cover:
- Parsing a well-formatted plan with 2 phases and 4 tasks
- Extracting spec section references (§N format)
- Extracting file paths from backtick-quoted paths
- Handling a plan with no phase headings (should return empty phases)`,
  filePaths: [
    "src/compile/planParser.ts",
    "src/types/tasks.ts",
  ],
  outputPaths: ["src/compile/planParser.test.ts"],
})
```

## scaffold

**File:** `agents/scaffold.md`
**Model:** Haiku (cheapest/fastest)
**Purpose:** Generate boilerplate files — configs, directory structures, template files.
**Permissions:** Write to specified paths.

Use for mechanical, template-driven work that doesn't require deep reasoning. The scaffold agent uses Haiku because boilerplate generation doesn't need Sonnet-level intelligence.

**When to use:**

- Creating config files (tsconfig, package.json, eslint configs)
- Setting up directory structures with placeholder files
- Generating repetitive boilerplate (type stubs, barrel exports)

**When NOT to use:**

- Anything requiring complex logic or reasoning — use `implement` instead
- Code that needs to interact with existing complex modules

**Example dispatch:**

```js
const result = await dispatchSubAgent({
  type: "scaffold",
  taskId: "phase1-task1",
  instructions: `Create the initial directory structure:
- src/types/tasks.ts: export empty interfaces for Phase and Task
- src/types/state.ts: export empty interfaces for SharedState and PhaseReport
- src/types/agents.ts: export empty interfaces for SubAgentConfig and SubAgentResult`,
  filePaths: [],
  outputPaths: [
    "src/types/tasks.ts",
    "src/types/state.ts",
    "src/types/agents.ts",
  ],
})
```

## judge

**File:** `agents/judge.md`
**Model:** Sonnet
**Purpose:** Evaluate phase changes for spec compliance and code quality.
**Permissions:** Read-only. Cannot create tasks or modify files.

The judge is invoked once per phase, as the orchestrator's final act before writing the phase report. It provides an independent assessment of the work done.

**When to use:**

- At the end of every phase (this is required, not optional)
- When you need an independent evaluation of code quality

**What it receives:**

- Modified files list with contents
- Relevant spec sections
- Task descriptions (what each task was supposed to accomplish)

**What it returns:**

```json
{
  "passed": true,
  "issues": ["Spec violation: ...", "Bug: ..."],
  "suggestions": ["Style: ...", "Enhancement: ..."]
}
```

**Example dispatch:**

```js
const modifiedFiles = ["src/runner/phaseRunner.ts", "src/runner/stateManager.ts"]
const result = await dispatchSubAgent({
  type: "judge",
  taskId: "phase1-judge",
  instructions: `Evaluate the following files modified during Phase 1.
Tasks completed:
- task1: Created type definitions
- task2: Implemented state manager
- task3: Implemented phase runner loop

Check against spec §5 and §6 for compliance.`,
  filePaths: modifiedFiles,
  outputPaths: [],  // judge is read-only
})
```

**After the judge responds**, parse its assessment and synthesize it with your own execution context before writing the phase report. See the `manage-phase` skill for details.
