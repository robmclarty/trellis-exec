---
name: quick-query
description: Use when analyzing, interpreting, or deciding — documents llmQuery() for cheap fast LLM analysis vs dispatchSubAgent
---

# Quick Query

`llmQuery()` is your tool for thinking. Use it for any interpretive, analytical, or decision-making work. It's cheap, fast, and should be used liberally.

## The Core Distinction

| Need | Tool | Why |
|------|------|-----|
| **Analyze, interpret, decide** | `llmQuery()` | Fast, cheap, no file I/O overhead |
| **Create or modify files** | `dispatchSubAgent()` | Has file write permissions, structured output |

**Rule of thumb:** If the output is a decision or understanding (not a file), use `llmQuery()`. If the output is code that gets written to disk, use `dispatchSubAgent()`.

## API

```js
const answer = await llmQuery(prompt, options?)
```

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | yes | — | The question or analysis request |
| `options.model` | string | no | `"haiku"` | Model to use. Override for harder tasks. |

**Returns:** `Promise<string>` — the LLM's response text.

**This is async.** Always use `await`:

```js
const analysis = await llmQuery("What does this error mean?\n" + errorOutput)
```

## Model Selection

- **Default (Haiku):** Sufficient for most analysis. Use for: parsing errors, summarizing files, simple decisions, format interpretation.
- **Override to Sonnet:** For harder analytical work. Use for: complex spec interpretation, multi-file architectural analysis, nuanced judgment calls.

```js
// Default — Haiku (fast and cheap)
const simple = await llmQuery("Is this a type error or a runtime error?\n" + stderr)

// Override — Sonnet (for harder analysis)
const complex = await llmQuery(
  "Given these 3 spec sections and the current implementation, what's the best approach for adding retry logic?\n" + context,
  { model: "sonnet" }
)
```

## When to Use llmQuery

### Analyzing Check Failures

After `runCheck()` fails, diagnose the error before retrying:

```js
const check = await runCheck()
if (!check.passed) {
  const diagnosis = await llmQuery(
    `Check command failed.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}\n\nWhat specific error occurred and what change would fix it?`
  )
}
```

### Reading and Summarizing Spec Sections

When a task references spec sections, load and interpret them:

```js
const spec = readFile("spec.md")
const summary = await llmQuery(
  `Summarize the key requirements from this spec section that are relevant to implementing the phase runner loop:\n${spec}`
)
```

### Deciding Task Strategy

Before dispatching a sub-agent, decide the approach:

```js
const fileContent = readFile("src/runner/scheduler.ts")
const strategy = await llmQuery(
  `I need to add parallel task scheduling to this module. The current implementation is sequential. Should I:\nA) Refactor the existing runTasks function to support parallel\nB) Add a new scheduleParallel function alongside the existing one\n\nHere's the current code:\n${fileContent}`
)
```

### Evaluating Sub-Agent Output

After a sub-agent returns, evaluate quality before proceeding:

```js
const result = await dispatchSubAgent({ /* ... */ })
const evaluation = await llmQuery(
  `A sub-agent just created this file. Does it look correct?\n\nTask: ${taskDescription}\nOutput:\n${readFile(outputPath)}`
)
```

### Interpreting File Structure

When exploring unfamiliar parts of the codebase:

```js
const entries = listDir("src/orchestrator")
const understanding = await llmQuery(
  `This directory contains these files: ${JSON.stringify(entries)}\nBased on the names, what does each file likely do? Which ones would I need to read to understand how the REPL session works?`
)
```

## Anti-patterns

**Don't use `llmQuery()` to write code that gets saved to files:**

```js
// WRONG — use dispatchSubAgent instead
const code = await llmQuery("Write a TypeScript function that...")
writeFile("src/foo.ts", code)  // No! You don't have writeFile anyway
```

**Don't dispatch a sub-agent for pure analysis:**

```js
// WRONG — wasteful, slow, expensive
const result = await dispatchSubAgent({
  type: "implement",
  instructions: "Read this error and tell me what's wrong",
  // ...
})

// RIGHT — fast, cheap
const analysis = await llmQuery("Read this error and tell me what's wrong:\n" + error)
```

**Don't skip analysis before retrying:**

```js
// WRONG — blind retry
if (!check.passed) {
  await dispatchSubAgent({ /* same instructions */ })
}

// RIGHT — diagnose first, then retry with adjusted instructions
if (!check.passed) {
  const diagnosis = await llmQuery(`What went wrong?\n${check.stderr}`)
  await dispatchSubAgent({ instructions: `${original}\n\nFix: ${diagnosis}` })
}
```
