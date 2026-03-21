---
name: verify-work
description: Use when verifying task output — documents runCheck() and the three verification tiers with retry logic and failure analysis
---

# Verify Work

After every sub-agent dispatch, verify that the work is correct. Three tiers of verification exist, applied at different scopes.

## Tier 1: Check (per task, required)

Run the user-defined check command. This is the hard gate — if check fails, the task is not complete.

```js
const result = await runCheck()
// => {passed: boolean, stdout: string, stderr: string, exitCode: number}
```

**Always run `runCheck()` after every `dispatchSubAgent()` call.** This is not optional.

The check command is configured per project (e.g., `npm run lint && npm run build && npm test`). You don't need to know what it runs — just call `runCheck()` and interpret the result.

**Interpreting results:**

```js
const result = await runCheck()

if (result.passed) {
  // Task passed check — move to optional verify step or next task
} else {
  // Analyze the failure before retrying
  const analysis = await llmQuery(
    `Check command failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}\n\nWhat went wrong?`
  )
  // Retry with adjusted instructions based on analysis
}
```

## Tier 2: Verify (per task, optional)

A dynamic verification step you generate based on what the sub-agent just did. This runs inside the REPL session — it's your own code, not a function call.

**Examples of verify steps:**

```js
// Verify a file exports the expected function
const content = readFile("src/runner/stateManager.ts")
const hasExport = content.includes("export function readState")

// Verify a test file exists and covers the right module
const tests = searchFiles("describe.*stateManager", "**/*.test.ts")

// Verify a new route is registered
const routes = searchFiles("router.use.*auth", "src/**/*.ts")

// Use llmQuery for spec compliance check
const specSection = readSpecSections(["§5"])
const fileContent = readFile("src/verification/checkRunner.ts")
const verdict = await llmQuery(
  `Does this implementation match the spec?\n\nSpec:\n${specSection}\n\nImplementation:\n${fileContent}`
)
```

**When to verify:** Use your judgment. Good candidates:

- Tasks that create new modules (verify exports exist)
- Tasks that modify APIs (verify callers still work)
- Tasks with specific spec requirements (verify compliance)

**When to skip:** Trivial tasks, scaffolding, or when check already covers everything.

## Tier 3: Judge (per phase, required)

Invoked once at the end of the phase via `dispatchSubAgent({ type: "judge", ... })`. This is covered in the `manage-phase` skill. You don't call `runCheck()` for the judge — it's a read-only assessment.

## Retry Logic

When check or verify fails, retry up to 3 times per task:

```js
let retries = 0
const MAX_RETRIES = 3

while (retries < MAX_RETRIES) {
  const result = await dispatchSubAgent({
    type: "implement",
    taskId: taskId,
    instructions: retries === 0
      ? originalInstructions
      : `${originalInstructions}\n\nPrevious attempt failed:\n${failureContext}`,
    filePaths: filePaths,
    outputPaths: outputPaths,
  })

  const check = await runCheck()
  if (check.passed) break

  // Analyze before retrying
  const analysis = await llmQuery(
    `Check failed after sub-agent dispatch.\nError: ${check.stderr}\nWhat needs to change?`
  )
  failureContext = `Error: ${check.stderr}\nAnalysis: ${analysis}`
  retries++
}

if (retries >= MAX_RETRIES) {
  // Mark task as failed and move on
}
```

**Critical: analyze before retrying.** Don't just re-run the same instructions. Use `llmQuery()` to understand what went wrong and adjust the instructions accordingly.

See `references/failure-analysis.md` for common failure patterns and diagnostic strategies.

## Failure Analysis Flow

1. **Read the error output.** Check `result.stderr` and `result.stdout`.
2. **Classify the failure.** Is it a type error, missing import, test failure, or lint violation?
3. **Diagnose with `llmQuery()`.** Ask it to explain the error and suggest a fix.
4. **Adjust instructions.** Include the error context and the suggested fix in the retry instructions.
5. **Retry or fail.** If the diagnosis suggests a fundamental misunderstanding, consider re-reading the spec before retrying.
