# Exploration Patterns

Concrete examples of how to explore the codebase before dispatching sub-agents.

## Example 1: Understanding a Module Before Modifying It

Task: "Add a `skipPhase()` function to `src/runner/phaseRunner.ts`"

```js
// 1. See what's in the runner directory
listDir("src/runner")
// => [{name: "phaseRunner.ts", ...}, {name: "stateManager.ts", ...}, {name: "scheduler.ts", ...}]

// 2. Read the target file to understand existing structure
const content = readFile("src/runner/phaseRunner.ts")

// 3. Find what the module exports (to know the public API)
searchFiles("export function", "src/runner/phaseRunner.ts")

// 4. Find who imports from this module (to understand callers)
searchFiles("from.*phaseRunner", "src/**/*.ts")

// 5. Check the relevant types
searchFiles("PhaseReport|PhaseStatus", "src/types/*.ts")
```

**Why this order:** You need to understand the module's shape, its public API, and its callers before deciding where to add the new function and what signature it should have.

## Example 2: Finding All Usages of a Type Before Refactoring

Task: "Rename `SubAgentConfig` to `AgentDispatchConfig`"

```js
// 1. Find where the type is defined
searchFiles("interface SubAgentConfig|type SubAgentConfig", "src/**/*.ts")
// => [{path: "src/types/agents.ts", line: 12, ...}]

// 2. Find every file that imports or uses it
searchFiles("SubAgentConfig", "src/**/*.ts")
// => Shows all imports, parameter types, variable annotations

// 3. Read the type definition to understand the full shape
const content = readFile("src/types/agents.ts")

// 4. Check test files too
searchFiles("SubAgentConfig", "**/*.test.ts")
```

**Why this order:** Start with the definition to understand the type, then find all usages to know the blast radius of the rename.

## Example 3: Locating Test Files for a Source File

Task: "Add tests for `src/compile/planParser.ts`"

```js
// 1. Check if a test file already exists
searchFiles("planParser", "**/*.test.ts")

// 2. Look at existing test file patterns
listDir("src/compile")
// or
searchFiles("describe\\(", "**/*.test.ts")

// 3. Read the source file to understand what needs testing
const content = readFile("src/compile/planParser.ts")

// 4. Find what it exports (these are the functions to test)
searchFiles("export function|export const", "src/compile/planParser.ts")

// 5. Read the spec for expected behavior
readFile("spec.md")
```

**Why this order:** First check if tests already exist (avoid duplicating). Then understand the test conventions. Then read the source to know what to test.

## General Rules

- **Start broad, go narrow.** `listDir()` → `searchFiles()` → `readFile()`.
- **Never read files blindly.** Use `listDir()` or `searchFiles()` to identify targets first.
- **Filter large output programmatically.** Don't print 500 lines and hope to parse them visually.
- **Load spec sections on demand.** Only read the sections relevant to the current task.
- **Check for existing patterns.** Before creating something new, search for similar implementations in the codebase.
