---
name: dispatch-agent
description: Use when dispatching sub-agents — documents dispatchSubAgent() API, agent types, context bundling, and dispatch vs llmQuery
---

# Dispatch Agent

Use `dispatchSubAgent()` to launch specialized sub-agents for code-producing work. This is the primary mechanism for creating and modifying files.

**Key distinction:** Use `dispatchSubAgent()` for file creation and modification. Use `llmQuery()` for analysis, interpretation, and decision-making. See the `quick-query` skill for the full rationale.

## API

```js
const result = await dispatchSubAgent({
  type: "implement",          // agent name (maps to agents/{type}.md)
  taskId: "phase1-task3",     // for tracking
  instructions: "...",        // natural-language instructions
  filePaths: ["src/foo.ts"],  // files to include in context
  outputPaths: ["src/bar.ts"],// files the agent may create/modify
  model: "sonnet",            // optional model override
})
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | yes | Agent name, resolves to `agents/{type}.md` |
| `taskId` | string | yes | Task ID for tracking and trajectory logging |
| `instructions` | string | yes | Clear, specific instructions for the sub-agent |
| `filePaths` | string[] | yes | Files to include in the sub-agent's context bundle |
| `outputPaths` | string[] | yes | Files the sub-agent is allowed to create or modify |
| `model` | string | no | Model override (default comes from agent frontmatter) |

**Returns:** `Promise<SubAgentResult>` with the sub-agent's output (file contents, status, any errors).

**This is async.** Always use `await`:

```js
const result = await dispatchSubAgent({
  type: "implement",
  taskId: "phase1-task2",
  instructions: `Create a runCheck function in src/verification/checkRunner.ts that:
- Accepts a shell command string
- Executes it via child_process.execSync
- Returns {passed: boolean, stdout: string, stderr: string}
- Throws on non-zero exit with the full stderr`,
  filePaths: [
    "src/types/state.ts",    // CheckResult type definition
    "src/runner/phaseRunner.ts" // to see how runCheck is called
  ],
  outputPaths: ["src/verification/checkRunner.ts"],
})
```

## Agent Types

Four sub-agent types are available. See `references/agent-types.md` for detailed descriptions.

| Type | Model | Purpose | Creates/modifies files? |
|------|-------|---------|------------------------|
| `implement` | Sonnet | Create or modify source files | Yes — specified `outputPaths` |
| `test-writer` | Sonnet | Create test files | Yes — `*.test.ts`, `*.spec.ts` |
| `scaffold` | Haiku | Generate boilerplate, configs | Yes — specified paths |
| `judge` | Sonnet | Evaluate changes for spec compliance | No — read-only |

## When to Dispatch vs Handle Inline

**Dispatch a sub-agent when:**

- The task requires creating or modifying files
- The work involves writing substantial code (more than a few lines)
- You need a specialist (test writing, scaffolding, judging)

**Use `llmQuery()` instead when:**

- Analyzing check failure output
- Deciding implementation strategy
- Summarizing spec sections
- Evaluating whether output meets criteria
- Reading and interpreting file structure
- Any interpretive or analytical work

**Example — wrong approach (wasteful):**

```js
// Don't dispatch a sub-agent just to analyze a failure
const result = await dispatchSubAgent({
  type: "implement",
  instructions: "Read the error output and tell me what's wrong",
  // ...
})
```

**Example — right approach (efficient):**

```js
// Use llmQuery for analysis
const analysis = await llmQuery(
  `The check command failed with this output:\n${checkResult.stderr}\n\nWhat went wrong and how should I fix it?`
)
```

## Context Bundling

The quality of a sub-agent's output depends directly on the quality of context you provide. See `references/context-bundling.md` for detailed strategies.

**Include:**

- Target files the agent will read or modify
- Type definitions used by those files
- Relevant spec sections (via `readFile('spec.md')`)
- Clear, specific instructions with acceptance criteria

**Exclude:**

- Unrelated files (even if they're in the same directory)
- Entire directory trees
- Large files that are only tangentially relevant
- Redundant context (don't send two files that say the same thing)

**Example — assembling context:**

```js
// Read the files you want to include
const types = readFile("src/types/tasks.ts")
const existing = readFile("src/runner/scheduler.ts")
const spec = readFile("spec.md")

// Dispatch with focused context
const result = await dispatchSubAgent({
  type: "implement",
  taskId: "phase1-task4",
  instructions: `Add parallel scheduling support to the scheduler module.

Requirements from spec §6:
- Independent tasks run in parallel (up to concurrency limit)
- Tasks with overlapping targetPaths are treated as implicitly dependent
- Never schedule overlapping tasks concurrently

The existing scheduler has sequential execution. Add a scheduleParallel()
function that groups independent tasks and runs them concurrently.`,
  filePaths: [
    "src/types/tasks.ts",
    "src/runner/scheduler.ts",
  ],
  outputPaths: ["src/runner/scheduler.ts"],
})
```

## Handling Sub-Agent Failures

If `dispatchSubAgent()` returns an error or the output is unparseable:

1. Log the raw output
2. Analyze the failure with `llmQuery()`
3. Retry with adjusted instructions (add clarity about expected format)
4. After 3 retries, mark the task as failed

```js
const result = await dispatchSubAgent({ /* ... */ })

if (result.error) {
  const analysis = await llmQuery(
    `Sub-agent returned an error: ${result.error}\nRaw output: ${result.output}\nWhat went wrong?`
  )
  // Retry with adjusted instructions based on analysis
}
```
