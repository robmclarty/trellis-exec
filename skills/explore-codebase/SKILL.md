---
name: explore-codebase
description: Use when exploring the codebase — documents readFile, listDir, and searchFiles REPL helpers
---

# Explore Codebase

Use these REPL helpers to understand the project before dispatching sub-agents. Exploration is step 2 of every task — after checking dependencies, before analysis.

## Functions

### readFile(path)

Read a file from the project. Returns the file content as a string.

```js
const content = readFile("src/runner/phaseRunner.ts")
```

**When to use:** When you know the exact file you need. Use after `listDir()` or `searchFiles()` has identified the target.

**Truncation:** Output is capped at 8192 characters. If the file is larger, you get a `[TRUNCATED — showing first 8192 chars of N total]` marker. Work around this by searching for the specific section you need:

```js
// Instead of reading a large file whole:
const lines = readFile("src/types/tasks.ts").split("\n")
const typeBlock = lines.filter(l => l.includes("Phase") || l.includes("Task")).join("\n")
```

### listDir(path)

List directory contents. Returns an array of `{name, type, size}` objects.

```js
const entries = listDir("src/runner")
// => [{name: "phaseRunner.ts", type: "file", size: 4521},
//     {name: "stateManager.ts", type: "file", size: 2103},
//     {name: "scheduler.ts", type: "file", size: 3200}]
```

**When to use:** To understand project structure before diving into specific files. Always start broad exploration here.

### searchFiles(pattern, glob?)

Search files by content (grep-like). Returns matching lines with file paths and line numbers.

```js
const matches = searchFiles("export function run", "src/**/*.ts")
// => [{path: "src/runner/phaseRunner.ts", line: 42, content: "export function runPhase(...)"}]
```

**When to use:** To find where something is defined, used, or referenced. The optional `glob` parameter narrows the search to specific file patterns.

**Tip:** Use specific patterns. `searchFiles("runCheck")` is better than `searchFiles("run")`.

## Exploration Pattern

Follow this sequence for every task:

1. **Broad scan** — `listDir()` on the directories mentioned in `targetPaths`
2. **Targeted search** — `searchFiles()` for key identifiers (function names, type names, imports)
3. **Focused read** — `readFile()` on the specific files you need to understand
4. **Spec context** — The spec file is available in the project root. Use `readFile('spec.md')` to read spec sections referenced in the task.

See `references/exploration-patterns.md` for worked examples.

## Working with Large Output

All REPL output is truncated at 8192 characters. Strategies:

- **Filter in code:** Use `.filter()`, `.slice()`, `.map()` to extract what you need before printing
- **Search instead of read:** Use `searchFiles()` to find the specific lines rather than reading entire files
- **Read in sections:** Split large files by line and read ranges: `lines.slice(40, 80).join("\n")`
- **Never print entire directories:** Use `listDir()` and filter by name or type
