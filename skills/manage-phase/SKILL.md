---
name: manage-phase
description: Use when completing a phase — documents writePhaseReport(), getState(), judge synthesis, handoff briefings, and context compaction
---

# Manage Phase

Use these functions to manage phase lifecycle: tracking state, synthesizing the judge assessment, writing the phase report, and handling context compaction.

## Functions

### getState()

Read the current shared state. Returns the `SharedState` object with completed tasks, modified files, decisions log, and phase reports from prior phases.

```js
const state = getState()
// => {
//   completedTasks: ["phase1-task1", "phase1-task2"],
//   modifiedFiles: {"src/types/tasks.ts": "Created type definitions"},
//   phases: { "phase1": { status: "in_progress", ... } },
//   decisionsLog: [...]
// }
```

**When to use:**

- After context compaction, to verify your summary against ground truth
- Before starting a task, to check what prior phases accomplished
- When deciding whether a dependency is satisfied

### writePhaseReport(report)

Write the phase report. Called once, at the end of the phase, after the judge assessment.

```js
writePhaseReport({
  status: "complete",              // "complete" or "partial"
  recommendedAction: "advance",    // "advance", "retry", or "halt"
  tasks: {
    passed: ["phase1-task1", "phase1-task2", "phase1-task3"],
    failed: [],
    skipped: [],
  },
  judgeAssessment: {
    passed: true,
    issues: [],
    suggestions: ["Style: consider extracting shared validation logic"],
  },
  synthesis: "All tasks completed and check passed. The judge flagged a style suggestion about shared validation — this is a valid improvement but not blocking. Recommend advancing to phase 2.",
  handoff: {
    summary: "Phase 1 created the type system and core state manager. All types are in src/types/. The state manager reads/writes state.json.",
    watchFor: "The SharedState interface may need a `retryCount` field added in phase 2 when implementing the retry logic.",
    unresolvedIssues: [],
  },
})
```

**This is the last thing you do in a phase.** After calling `writePhaseReport()`, your work is done. The phase runner takes over.

## Phase Report Format

See `references/report-format.md` for the complete structure with examples.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"complete"` or `"partial"` | Whether all tasks were processed |
| `recommendedAction` | `"advance"`, `"retry"`, or `"halt"` | What the phase runner should do next |
| `tasks.passed` | string[] | Task IDs that passed check |
| `tasks.failed` | string[] | Task IDs that failed after all retries |
| `tasks.skipped` | string[] | Task IDs skipped due to failed dependencies |
| `judgeAssessment` | object | Raw judge output: `{passed, issues, suggestions}` |
| `synthesis` | string | Your interpretation combining judge findings with execution context |
| `handoff` | object | Briefing for the next phase |

### Recommended Action Guide

- **`"advance"`** — All tasks passed (or failures are non-blocking), judge passed. Move to next phase.
- **`"retry"`** — Some tasks failed but are fixable. Include `correctiveTasks` describing what to fix. The phase runner will append these tasks and re-enter the phase.
- **`"halt"`** — Fundamental issues that can't be fixed within this phase. Requires human intervention.

### When to Retry

Include `correctiveTasks` when recommending retry:

```js
writePhaseReport({
  status: "complete",
  recommendedAction: "retry",
  correctiveTasks: [
    {
      description: "Fix type mismatch in stateManager.writeState — the retryCount field is missing from SharedState",
      targetPaths: ["src/types/state.ts", "src/runner/stateManager.ts"],
      type: "implement",
    },
  ],
  // ... other fields
})
```

## Judge Synthesis

After invoking the judge (via `dispatchSubAgent({ type: 'judge', ... })`), you must synthesize its assessment — don't just pass it through. The phase runner needs a single coherent analysis.

**Steps:**

1. Parse the judge's `{passed, issues, suggestions}` response
2. For each issue, add your context: why it exists, whether it's an intentional tradeoff, whether it was a known limitation
3. For suggestions, note which are actionable now vs deferred
4. Write a `synthesis` paragraph that combines both perspectives

**Example synthesis:**

```text
The judge flagged two issues:
1. "Missing error handling in dispatchSubAgent timeout case" — This is valid.
   The spec (§9) defines this as a failure mode. I attempted to handle it in
   task 4 but the sub-agent omitted the timeout logic. Adding a corrective task.
2. "readFile doesn't validate path exists" — Intentional. The spec says the
   REPL helpers throw on errors; the orchestrator catches at the task level.
   Not a bug, by design.

The judge also suggested extracting shared validation logic — deferring to phase 3
where the validation module is scheduled.

Recommending retry to address issue 1 only.
```

## Handoff Briefing

The handoff object is consumed by the next phase's orchestrator. Write it so a fresh orchestrator can pick up without reading the entire phase history.

### Structure

```js
handoff: {
  summary: "One paragraph: what this phase accomplished.",
  watchFor: "Specific things the next phase should be aware of.",
  unresolvedIssues: ["List of known issues carried forward."],
}
```

**Good summary:** "Phase 2 implemented the plan compiler (planParser.ts + planEnricher.ts). The deterministic parser handles standard plan formats. The enricher calls Haiku for dependency inference. Both modules export from src/compile/."

**Bad summary:** "Did the plan compiler stuff." (Too vague for a fresh orchestrator.)

## Context Compaction

When your message history is getting long and you sense context pressure, self-summarize before continuing work.

### When to Compact

- Your conversation is approaching ~80% of context capacity
- You've completed several tasks and the early conversation history is no longer actively needed
- You're starting to feel repetitive or losing track of earlier details

### How to Compact

Write a compaction summary covering:

1. **Completed tasks** — IDs and outcomes
2. **Remaining tasks** — IDs and current status
3. **Modified files** — path and one-line description
4. **Check failures** — what failed and how it was resolved
5. **Current state** — what you were in the middle of doing
6. **Key decisions** — important choices made so far

After writing your summary, verify against ground truth:

```js
const state = getState()
// Compare your summary against state.completedTasks, state.modifiedFiles, etc.
```

The `history` REPL variable holds pre-compaction context if you need to recall specific details later.
