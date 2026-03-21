/**
 * Builds a targeted prompt for Haiku to resolve ambiguous fields flagged by the
 * deterministic parser. Includes each flag with its surrounding task context so
 * the model can make informed decisions without seeing the entire plan.
 */
export function buildEnrichmentPrompt(flags, tasks) {
    const taskIndex = new Map(tasks.map((t) => [t.id, t]));
    const allTaskIds = tasks.map((t) => t.id);
    const flagDescriptions = flags.map((flag) => {
        const task = taskIndex.get(flag.taskId);
        const taskContext = task
            ? `Title: ${task.title}\nDescription: ${task.description}`
            : `(task not found)`;
        return [
            `- Task ID: ${flag.taskId}`,
            `  Field: ${flag.field}`,
            `  Reason: ${flag.reason}`,
            `  Context: ${flag.context}`,
            `  Task details:`,
            `    ${taskContext}`,
        ].join("\n");
    });
    return `You are resolving ambiguous fields in a structured task plan. The deterministic parser could not resolve the following fields and needs your help.

Available task IDs in this plan: ${JSON.stringify(allTaskIds)}

Fields to resolve:

${flagDescriptions.join("\n\n")}

For each flag, provide the resolved value. The expected types per field name are:
- "dependsOn": an array of task ID strings from the available task IDs listed above. Only include IDs that this task genuinely depends on.
- "subAgentType": one of "implement", "test-writer", "scaffold", "judge"
- "acceptanceCriteria": an array of short, verifiable criterion strings

Respond with ONLY a JSON object in this exact shape, no preamble, no markdown fences:

{"resolved":[{"taskId":"<id>","field":"<field>","value":<resolved_value>}]}`;
}
/**
 * Fallback prompt for when the deterministic parser fails entirely (no phase
 * boundaries found). Sends the full plan to Haiku and asks for a complete
 * TasksJson structure.
 */
export function buildFullParseFallbackPrompt(planContent, specRef) {
    return `You are converting a software implementation plan into a structured JSON task breakdown.

The plan markdown is provided below. Parse it into phases and tasks following this exact JSON schema:

{
  "specRef": "${specRef}",
  "planRef": "${specRef.replace(/spec\.md$/, "plan.md")}",
  "createdAt": "<ISO 8601 timestamp>",
  "phases": [
    {
      "id": "phase-<N>",
      "name": "<phase name>",
      "description": "<brief phase description>",
      "tasks": [
        {
          "id": "phase-<N>-task-<M>",
          "title": "<task title>",
          "description": "<detailed task description>",
          "dependsOn": ["<task IDs this task depends on within the same phase>"],
          "specSections": ["§N", ...],
          "targetPaths": ["<file paths this task creates or modifies>"],
          "acceptanceCriteria": ["<verifiable criteria>"],
          "subAgentType": "implement" | "test-writer" | "scaffold" | "judge",
          "status": "pending"
        }
      ]
    }
  ]
}

Rules:
- Phase IDs are "phase-1", "phase-2", etc.
- Task IDs are "phase-N-task-M" (e.g., "phase-1-task-1").
- dependsOn only references task IDs within the same phase.
- specSections are §N references found in the task text.
- targetPaths are file paths mentioned in backticks.
- subAgentType: use "scaffold" for setup/config tasks, "test-writer" for test tasks, "implement" for everything else.
- All tasks start with status "pending".
- Set createdAt to the current time in ISO 8601 format.

Plan markdown:

${planContent}

Respond with ONLY the JSON object. No preamble, no markdown fences.`;
}
//# sourceMappingURL=prompts.js.map