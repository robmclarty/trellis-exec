# Phase Report Format

Complete structure and examples for phase reports written via `writePhaseReport()`.

## Full Structure

```json
{
  "status": "complete | partial",
  "recommendedAction": "advance | retry | halt",
  "tasks": {
    "passed": ["task-id-1", "task-id-2"],
    "failed": ["task-id-3"],
    "skipped": ["task-id-4"]
  },
  "judgeAssessment": {
    "passed": true,
    "issues": [],
    "suggestions": []
  },
  "synthesis": "Your interpretation combining judge + execution context.",
  "correctiveTasks": [],
  "handoff": {
    "summary": "What this phase accomplished.",
    "watchFor": "Things the next phase should know.",
    "unresolvedIssues": []
  }
}
```

## Example: Complete Phase (Advance)

```js
writePhaseReport({
  status: "complete",
  recommendedAction: "advance",
  tasks: {
    passed: ["phase1-task1", "phase1-task2", "phase1-task3", "phase1-task4"],
    failed: [],
    skipped: [],
  },
  judgeAssessment: {
    passed: true,
    issues: [],
    suggestions: [
      "Style: stateManager.ts could use a named return type instead of inline object",
    ],
  },
  synthesis: "All 4 tasks completed and passed check. The judge found no issues. One style suggestion noted (named return type in stateManager) — this is a minor readability improvement that doesn't affect correctness. Recommend advancing.",
  handoff: {
    summary: "Phase 1 established the foundation: type definitions (src/types/*.ts), state manager (src/runner/stateManager.ts), and the phase runner outer loop (src/runner/phaseRunner.ts). The phase runner reads tasks.json, iterates phases, and manages state.json.",
    watchFor: "The phaseRunner.ts currently has a placeholder for the orchestrator launch step (marked with a TODO). Phase 2 should implement the actual claude CLI subprocess launch.",
    unresolvedIssues: [],
  },
})
```

## Example: Partial Phase (Retry)

```js
writePhaseReport({
  status: "complete",
  recommendedAction: "retry",
  tasks: {
    passed: ["phase2-task1", "phase2-task2"],
    failed: ["phase2-task3"],
    skipped: ["phase2-task4"],
  },
  judgeAssessment: {
    passed: false,
    issues: [
      "Spec violation: replManager.ts does not implement scaffold restoration (§5 requirement)",
      "Bug: agentLauncher.ts passes --model flag without validating the model string",
    ],
    suggestions: [],
  },
  synthesis: "2 of 4 tasks passed. Task 3 (REPL manager) failed after 3 retries — the sub-agent consistently omitted the scaffold restoration logic despite explicit instructions. Task 4 was skipped because it depends on task 3. The judge correctly identified both the missing scaffold restoration and a model validation gap. Recommending retry with a focused corrective task that includes the exact scaffold restoration code pattern from the spec.",
  correctiveTasks: [
    {
      description: "Add scaffold restoration to replManager.ts: after each eval, reassign all helper function references (readFile, listDir, searchFiles, readSpecSections, dispatchSubAgent, runCheck, getState, writePhaseReport, llmQuery) to their original implementations. See spec §5 scaffold restoration rule.",
      targetPaths: ["src/orchestrator/replManager.ts"],
      type: "implement",
    },
    {
      description: "Add model string validation to agentLauncher.ts: validate against allowed model names before passing to --model flag.",
      targetPaths: ["src/orchestrator/agentLauncher.ts"],
      type: "implement",
    },
  ],
  handoff: {
    summary: "Phase 2 partially implemented the orchestrator layer. The agent launcher and REPL helpers are in place. The REPL manager needs scaffold restoration added.",
    watchFor: "The scaffold restoration is critical for reliability — without it, the orchestrator can accidentally overwrite helper functions.",
    unresolvedIssues: [
      "replManager.ts missing scaffold restoration",
      "agentLauncher.ts missing model validation",
    ],
  },
})
```

## Example: Partial Phase (Halt)

```js
writePhaseReport({
  status: "partial",
  recommendedAction: "halt",
  tasks: {
    passed: ["phase3-task1"],
    failed: ["phase3-task2", "phase3-task3"],
    skipped: ["phase3-task4", "phase3-task5"],
  },
  judgeAssessment: {
    passed: false,
    issues: [
      "Fundamental: the plan compiler assumes plan.md uses ## headings for phases, but the actual plan uses numbered lists. The parser cannot find any phases.",
    ],
    suggestions: [],
  },
  synthesis: "The plan compiler's parser is built on wrong assumptions about the plan format. This is a spec ambiguity — §5 doesn't prescribe the exact markdown format for plans. The parser needs to be redesigned to handle multiple formats, or the spec needs to be clarified. This cannot be fixed with a corrective task within this phase. Recommending halt for human review.",
  handoff: {
    summary: "Phase 3 attempted the plan compiler. Task 1 (type definitions) succeeded. Tasks 2–3 (parser and enricher) failed due to format assumptions. Human intervention needed to clarify plan.md format requirements.",
    watchFor: "Do not retry without resolving the plan format question first.",
    unresolvedIssues: [
      "Plan format ambiguity: ## headings vs numbered lists vs other formats",
    ],
  },
})
```

## Handoff Briefing Guidelines

The handoff is read by a fresh orchestrator with no prior context. Write it so the next orchestrator can start working immediately.

**Required elements:**

- **Summary:** What files were created/modified and what they do (with paths)
- **Watch for:** Specific technical details that affect the next phase's work
- **Unresolved issues:** Anything the next phase inherits

**Length:** 3–5 sentences for summary, 1–2 sentences for watchFor. Be specific — file paths, function names, and concrete details are more useful than vague descriptions.
