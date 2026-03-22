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
 * Decomposes a technical plan into implementable phases and tasks using the
 * spec for requirements and acceptance criteria, the plan for architecture and
 * design decisions, and (optionally) project guidelines for coding conventions
 * and file structure.
 *
 * This is the primary compilation path for plans that are not already formatted
 * as phase/task lists.
 */
export function buildDecomposePrompt(planContent, specContent, specRef, planRef, projectRoot, guidelinesContent, guidelinesRef) {
    const guidelinesSection = guidelinesContent
        ? `
## Guidelines

The following project guidelines define coding conventions, architecture patterns, and file structure. Tasks should follow these conventions, and targetPaths should reflect the directory layout described here.

<guidelines>
${guidelinesContent}
</guidelines>
`
        : "";
    const guidelinesRefField = guidelinesRef
        ? `\n  "guidelinesRef": "${guidelinesRef}",`
        : "";
    return `You are decomposing a software project into implementable phases and tasks.

You are given three documents:
1. **Spec** — defines what to build: functional requirements, data model, business rules, failure modes, and success criteria.
2. **Plan** — the technical design: architecture, technology decisions, data access patterns, interface implementation details, and testing strategy.${guidelinesContent ? "\n3. **Guidelines** — coding conventions, architecture patterns, directory structure, and naming rules." : ""}

Your job is to read all documents and produce a structured JSON task breakdown that a team of sub-agents can execute sequentially to build the project.

## Spec

<spec>
${specContent}
</spec>

## Plan

<plan>
${planContent}
</plan>
${guidelinesSection}
## Output Schema

Produce a JSON object matching this exact schema:

{
  "projectRoot": "${projectRoot}",
  "specRef": "${specRef}",
  "planRef": "${planRef}",${guidelinesRefField}
  "createdAt": "<ISO 8601 timestamp>",
  "phases": [
    {
      "id": "phase-<N>",
      "name": "<phase name>",
      "description": "<brief phase description>",
      "tasks": [
        {
          "id": "phase-<N>-task-<M>",
          "title": "<concise task title>",
          "description": "<detailed implementation instructions>",
          "dependsOn": ["<task IDs this task depends on>"],
          "specSections": ["§N"],
          "targetPaths": ["<file paths this task creates or modifies>"],
          "acceptanceCriteria": ["<verifiable criteria>"],
          "subAgentType": "implement" | "test-writer" | "scaffold" | "judge",
          "status": "pending"
        }
      ]
    }
  ]
}

## Decomposition Rules

### Phases
- Organize into logical build stages, NOT by mirroring the plan's section headings.
- A typical ordering: project scaffolding → data layer (adapters, repositories) → business logic (behaviors) → UI (views, routing) → integration tests → polish.
- Each phase should be completable independently once its dependencies are done.

### Tasks
- Each task must be **concrete and implementable**: specify exactly which files to create or modify.
- Task descriptions should include enough detail for an agent to implement without re-reading the full plan — reference specific data shapes, function signatures, and patterns from the plan.
- Keep tasks focused: one concern per task. A task that creates a module and tests it should be split into two tasks.

### Fields
- **id**: "phase-N-task-M" (e.g., "phase-1-task-1").
- **dependsOn**: task IDs this task requires to be completed first. Can reference tasks in earlier phases or the same phase.
- **specSections**: spec section references (§N) relevant to this task. Derive from the spec's section numbering (§1 Context, §2 Functional Overview, §4 Data Model, §6 Business Rules, §8 Success Criteria, etc.).
- **targetPaths**: actual file paths this task creates or modifies.${guidelinesContent ? " Derive from the guidelines' directory structure." : ""}
- **acceptanceCriteria**: verifiable conditions. Derive from the spec's success criteria (§8) where applicable. Each criterion should be testable — "file exists", "function returns X given Y", "test passes".
- **subAgentType**: "scaffold" for project setup, config, and boilerplate. "test-writer" for creating test files. "judge" for review/validation tasks. "implement" for everything else.
- **status**: always "pending".

### Sizing
- Aim for 3–8 tasks per phase, 3–6 phases total.
- If a phase has more than 8 tasks, split it into sub-phases.
- If a task touches more than 4–5 files, consider splitting it.

## Response Format

Respond with ONLY the JSON object. No preamble, no explanation, no markdown fences.`;
}
//# sourceMappingURL=prompts.js.map