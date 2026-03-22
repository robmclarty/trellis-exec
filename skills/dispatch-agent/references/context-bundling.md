# Context Bundling Strategies

How to assemble effective context bundles for sub-agents. The quality of a sub-agent's output is directly proportional to the quality of the context you provide.

## Principles

1. **Focused over comprehensive.** Send the 3–5 files the agent actually needs, not everything tangentially related.
2. **Types are critical.** Always include type definitions for the interfaces the agent will implement or consume.
3. **Instructions are the most important context.** Clear, specific instructions with acceptance criteria matter more than including extra files.
4. **Spec sections ground the work.** Use `readFile('spec.md')` to load the spec and include key requirements in the instructions.

## What to Include

### Always include

- **Target file** (if modifying an existing file) — the agent needs to see current state
- **Type definitions** — interfaces for parameters, return types, shared data structures
- **Instructions with acceptance criteria** — what to create, what it should do, how to verify

### Include when relevant

- **Importing modules** — files that will import from the agent's output (so it matches expected API)
- **Spec excerpts** — requirements that define the expected behavior
- **Related implementations** — similar modules to follow as a pattern (e.g., "follow the same style as stateManager.ts")

### Never include

- **Unrelated files** — don't send the whole `src/` directory
- **Large files in full** — if only a few functions are relevant, extract them with `readFile()` and `searchFiles()`, then include the relevant excerpts in the instructions
- **Redundant context** — two files that define the same thing
- **Test files** (unless the task is about tests) — they add noise for implementation tasks

## Sizing Guidelines

- **Ideal bundle:** 3–5 files, totaling under 2000 lines
- **Maximum practical bundle:** 8–10 files — beyond this, the agent loses focus
- **If you need more context:** Break the task into smaller sub-tasks with focused bundles each

## Example: Good Bundle

```js
// Task: implement checkRunner.ts

// 1. Read what the agent needs to know
const checkResultType = readFile("src/types/state.ts")
const phaseRunnerUsage = searchFiles("runCheck", "src/runner/phaseRunner.ts")

// 2. Dispatch with just the essentials
const result = await dispatchSubAgent({
  type: "implement",
  taskId: "phase1-task6",
  instructions: `Create src/verification/checkRunner.ts.

This module runs the user-defined check command after each task completes.

Function: runCheck(command: string): Promise<CheckResult>
- Execute the command via child_process.exec
- Capture stdout and stderr
- Return {passed, stdout, stderr, exitCode}
- passed is true when exitCode === 0

The CheckResult type is defined in src/types/state.ts.
The phase runner calls this after every sub-agent dispatch.`,
  filePaths: ["src/types/state.ts"],
  outputPaths: ["src/verification/checkRunner.ts"],
})
```

**Why this works:** One type file for the return type, clear instructions with the exact function signature, and a single output path. The agent has everything it needs and nothing it doesn't.

## Example: Over-bundled (Avoid)

```js
// Don't do this — too much irrelevant context
const result = await dispatchSubAgent({
  type: "implement",
  taskId: "phase1-task6",
  instructions: "Create the check runner module",
  filePaths: [
    "src/types/state.ts",
    "src/types/tasks.ts",      // not needed
    "src/types/agents.ts",     // not needed
    "src/runner/phaseRunner.ts",// only one line is relevant
    "src/runner/scheduler.ts", // not related
    "src/runner/stateManager.ts", // not related
    "src/cli.ts",              // definitely not related
  ],
  outputPaths: ["src/verification/checkRunner.ts"],
})
```

**Why this fails:** Vague instructions. Six extra files that dilute attention. The agent wastes tokens processing irrelevant code.

## Extracting Focused Context

When a relevant file is too large or only partially relevant, extract what matters:

```js
// Instead of sending the entire phaseRunner.ts
const content = readFile("src/runner/phaseRunner.ts")
const relevant = content.split("\n")
  .filter(l => l.includes("runCheck") || l.includes("CheckResult"))
  .join("\n")

// Include the extracted context in instructions instead of filePaths
const result = await dispatchSubAgent({
  type: "implement",
  taskId: "phase1-task6",
  instructions: `Create src/verification/checkRunner.ts.

Here's how it's called in the phase runner:
${relevant}

Implement the runCheck function to match this usage.`,
  filePaths: ["src/types/state.ts"],
  outputPaths: ["src/verification/checkRunner.ts"],
})
```
