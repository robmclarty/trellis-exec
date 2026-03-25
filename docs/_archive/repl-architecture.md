# REPL Architecture

The phase orchestrator runs inside a sandboxed JavaScript REPL powered by `node:vm`. This document explains the structure, the techniques used, and why each choice was made.

## Two-module design

The REPL layer is split into two files with distinct responsibilities:

```text
src/orchestrator/
├── replHelpers.ts    ← what the orchestrator can do (filesystem, state, agents)
├── replManager.ts    ← how code gets executed (vm sandbox, eval, error tracking)
```

**replHelpers.ts** is a factory (`createReplHelpers`) that produces a plain object of functions. These are the orchestrator's capabilities — reading files, searching code, querying the spec, dispatching sub-agents. The factory closes over configuration (project root, spec path, state path, agent launcher) so the helpers are pre-bound to a specific execution context.

**replManager.ts** is a factory (`createReplSession`) that creates a `node:vm` context, injects the helpers into it, and returns eval/lifecycle methods. It owns the sandbox boundary, output capture, truncation, and error tracking.

This separation means helpers can be tested independently of the vm sandbox, and the sandbox logic doesn't need to know anything about filesystem operations or agent dispatch.

## The vm sandbox

### Why `node:vm` instead of `child_process` or `eval`

- **`eval`** runs in the host process with full access to `require`, `process`, `fs`, and everything else. LLM-generated code could do arbitrary damage.
- **`child_process`** (spawning a separate Node process per eval) would work for isolation but adds IPC overhead, makes state sharing between evals awkward (each invocation starts fresh), and complicates timeout handling.
- **`node:vm`** runs code in an isolated context within the same process. The context persists between evals (variables survive across calls), there's no IPC overhead, and `node:vm` provides built-in timeout enforcement for synchronous execution. It's not a full security sandbox (a determined attacker can escape it), but for LLM-generated code operating in a development tool, it provides the right level of isolation: accidental damage prevention, not adversarial containment.

### What's exposed in the sandbox

The context receives a curated set of globals:

- **Helper functions** — `readFile`, `listDir`, `searchFiles`, `readSpecSections`, `getState`, `writePhaseReport`, `dispatchSubAgent`, `runCheck`, `llmQuery`
- **Safe builtins** — `JSON`, `Math`, `Date`, `Array`, `Object`, `Map`, `Set`, `RegExp`, `Error`, `Promise`, `URL`, `TextEncoder`, `TextDecoder`, `setTimeout`, `clearTimeout`
- **Captured console** — `console.log/warn/error` write to an internal buffer instead of stdout

Notably absent: `process`, `require`, `import`, `fs`, `child_process`. The orchestrator interacts with the outside world exclusively through the injected helpers.

## Expression-first eval with async support

### The problem

The orchestrator writes JS code that the REPL evaluates. This code falls into two categories:

1. **Expressions** — `1 + 2`, `readFile("src/index.ts")`, `typeof readFile`
2. **Statements** — `throw new Error("fail")`, `const x = 5; console.log(x)`

A bare `vm.runInContext("1 + 2", ctx)` returns `3`. But some helpers (`dispatchSubAgent`, `runCheck`, `llmQuery`) return Promises, so the orchestrator needs `await` support. Wrapping code in an async IIFE — `(async () => { 1 + 2 })()` — makes `await` work but breaks expression returns (the IIFE returns `undefined` because there's no `return`).

### The solution: compile-probe with `Script`

```text
1. Try:   (async () => { return ( <code> ) })()
2. If that fails to parse, fall back to:
          (async () => { <code> })()
```

Step 1 uses `new Script(exprForm)` to compile-check the expression form **without executing it**. This is a parse-only operation — no side effects, no execution cost. If the code is a valid expression, it compiles and the expression form is used, so the return value flows through. If it's a statement (like `throw` or a declaration), the `Script` constructor throws a `SyntaxError` and we fall back to the statement form.

This is the same strategy Node's built-in REPL uses. The `Script` compile check costs ~microseconds and avoids the double-execution problem of a runtime probe.

### Async timeout via `Promise.race`

The `vm.runInContext` `timeout` option only applies to synchronous execution. An `await dispatchSubAgent(...)` call that hangs would block forever. The eval function handles this with:

```typescript
Promise.race([resultPromise, timeoutPromise])
```

The timeout promise rejects after the configured duration. Whichever settles first wins. If the result resolves first, the timeout is cleared to avoid leaking timers.

## Console capture

The sandbox receives a custom `console` object that appends to an internal string array instead of writing to stdout. On each eval:

1. The buffer is cleared.
2. Code runs — any `console.log/warn/error` calls append to the buffer.
3. The buffer contents are prepended to the return value in the output string.

This means the orchestrator sees both side-effect output (logs) and the expression result in a single `ReplEvalResult.output` string, which is what gets fed back into the LLM's context.

## Output truncation

Any output exceeding `outputLimit` (default 8192 chars) is sliced with a marker:

```text
[TRUNCATED — showing first 8192 chars of 34210 total]
```

This is critical for the RLM pattern. The orchestrator's output flows back into the LLM context window. Without truncation, a single `readFile` on a large file would consume the entire context budget. The truncation marker tells the LLM the output was cut so it can use programmatic filtering (`searchFiles`, line-range reads) instead.

## Scaffold restoration

After each eval, the caller invokes `restoreScaffold()`. This re-assigns every helper function reference on the vm context from the stored originals:

```typescript
for (const name of HELPER_NAMES) {
  context[name] = originals[name];
}
```

### Why this exists

The LLM generates code that runs in the same persistent context. If it writes `readFile = someTransform(readFile)` or `readFile = "oops"`, the helper is gone for all subsequent evals. Scaffold restoration makes the helpers immutable across turns without actually using `Object.freeze` or `Object.defineProperty` (which would make the context less flexible for legitimate variable assignments).

The originals are captured once at session creation and never mutated, so restoration is always to the known-good state.

## Consecutive error tracking

A closure variable tracks sequential eval failures:

- **Incremented** on every failed eval (syntax error, runtime error, timeout).
- **Reset to zero** on any successful eval.

The phase runner reads this via `getConsecutiveErrors()`. If it hits the threshold (default 5), the phase is halted — the orchestrator is stuck in an error loop and continuing would waste tokens. This is distinct from per-task retry logic; it catches structural problems like the LLM consistently generating invalid code or misunderstanding the REPL API.

## Helper implementation choices

### Path security via `safePath`

Every filesystem helper resolves paths relative to `projectRoot` and validates the result against `realpathSync(projectRoot)`. This prevents directory traversal — `readFile("../../etc/passwd")` throws instead of leaking host files. The check uses `realpathSync` to resolve symlinks, so a symlink pointing outside the project root is also caught.

### `searchFiles` with minimal glob support

The spec calls for a `glob` parameter on `searchFiles`. Rather than adding a dependency (`fast-glob`, `minimatch`), a 25-line `globToRegex` function handles the common cases: `*` (any non-slash chars), `**` (any chars including slashes), `?` (single non-slash char), and literal escaping. Results are capped at 100 matches to prevent unbounded output.

Using `readdirSync` with `{ recursive: true }` (available since Node 18.17, stable in Node 22) avoids writing a manual recursive walker.

### `readSpecSections` as a line-based parser

The spec file is parsed by scanning for `## §N` heading patterns and collecting lines between them into a map. This is intentionally simple — a regex split, not a full markdown AST parser. The spec format is controlled by Trellis (it generates the `## §N — Title` headings), so the parser only needs to handle that one pattern reliably. Missing sections return a `[Section §N not found]` marker instead of throwing, so the orchestrator gets actionable feedback.

### Stubs with delegation

The LLM-dependent helpers (`dispatchSubAgent`, `runCheck`, `llmQuery`, `writePhaseReport`) are stubs that log and return mock responses. But `dispatchSubAgent` accepts an optional `agentLauncher` callback through the config — if provided, it delegates to the real implementation. This means the same factory works for both testing (null launcher, mock responses) and production (real launcher) without conditional logic scattered through the code.

## Functional style

Both modules use the closure-factory pattern established elsewhere in the codebase (`createTrajectoryLogger`, `createReplSession`). State lives in closure variables (`consecutiveErrors`, `destroyed`, `consoleBuffer`), not in class instance fields. The returned objects are plain interfaces with no prototype chain. This matches the project's "no classes" constraint and keeps the code straightforward to test — create the object, call methods, assert results.
