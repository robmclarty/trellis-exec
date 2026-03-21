# Failure Analysis

Patterns for diagnosing and recovering from check and verify failures.

## Common Failure Categories

### Type Errors

**Symptoms:** `TS2345`, `TS2322`, `TS2339` — type mismatch, missing property, unknown property.

**Diagnosis:**

```js
const analysis = await llmQuery(
  `TypeScript error:\n${check.stderr}\n\nThe sub-agent was implementing ${taskDescription}.\nWhat type mismatch occurred and how should the code be fixed?`
)
```

**Typical cause:** The sub-agent used an outdated type definition or missed a required field. Often fixed by including the correct type file in `filePaths`.

**Retry strategy:** Include the type definition file and quote the specific interface in the instructions.

### Missing Imports

**Symptoms:** `Cannot find module`, `is not exported from`, `TS2307`.

**Diagnosis:** Check whether the imported module exists and exports the expected symbol.

```js
const exists = searchFiles("export.*functionName", "src/**/*.ts")
```

**Typical cause:** The sub-agent assumed an export exists that hasn't been created yet, or used the wrong import path.

**Retry strategy:** Include the actual module in `filePaths` so the agent sees what's exported. If the export doesn't exist yet, note this in instructions.

### Test Failures

**Symptoms:** `FAIL`, `AssertionError`, `Expected X but received Y`.

**Diagnosis:**

```js
const analysis = await llmQuery(
  `Test failure:\n${check.stdout}\n\nWhat assertion failed and why? Is the test wrong or the implementation?`
)
```

**Typical cause:** Either the implementation doesn't match the test's expectations, or the test was written against an outdated spec.

**Retry strategy:** Include both the test file and the source file in context. Clarify in instructions which is the source of truth.

### Lint Violations

**Symptoms:** Eslint errors, formatting errors, naming convention violations.

**Diagnosis:** Usually self-explanatory from the error output. Parse the rule name and file/line.

**Typical cause:** The sub-agent didn't follow the project's lint rules.

**Retry strategy:** Include a similar file that passes lint as a style reference. Mention the specific lint rule in instructions.

## When to Retry vs Mark Failed

**Retry when:**

- The error is specific and actionable (a type mismatch, a missing import)
- The analysis suggests a clear fix
- The sub-agent was close but missed a detail
- You can provide better context or clearer instructions

**Mark failed when:**

- Three retries are exhausted
- The error suggests a fundamental misunderstanding of the task
- The task depends on something that doesn't exist yet (dependency issue)
- The error is in code the sub-agent didn't write (environmental issue)

## Diagnostic Prompts for llmQuery

Effective prompts for analyzing failures:

**General failure:**

```text
Check command failed after implementing [task description].
stdout: [stdout]
stderr: [stderr]

1. What specific error occurred?
2. Is this a problem in the generated code or a pre-existing issue?
3. What change would fix this?
```

**Repeated failure (retry 2+):**

```text
This is retry [N] for task [taskId]. Previous attempts failed with:
[previous errors]

The latest attempt failed with:
[current error]

Are we stuck in a loop? What fundamentally different approach should we try?
```

**Ambiguous failure:**

```text
The check command exited non-zero but the error output is unclear:
[output]

Based on the task (implementing [description]), what might have gone wrong?
List the most likely causes in order of probability.
```
