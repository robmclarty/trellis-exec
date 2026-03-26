import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { enrichPlan } from "../planEnricher.js";
import { parsePlan } from "../planParser.js";
import { TasksJsonSchema } from "../../types/tasks.js";
import type { ParseResult } from "../../types/compile.js";
import type { TasksJson } from "../../types/tasks.js";

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "../../../test/fixtures/sample-plan.md",
);

function makeTasksJson(overrides?: Partial<TasksJson>): TasksJson {
  return {
    projectRoot: ".",
    specRef: "spec.md",
    planRef: "plan.md",
    createdAt: "2026-03-17T00:00:00Z",
    phases: [
      {
        id: "phase-1",
        name: "Setup",
        description: "",
        requiresBrowserTest: false,
        tasks: [
          {
            id: "phase-1-task-1",
            title: "Create config",
            description: "Set up config files",
            dependsOn: [],
            specSections: [],
            targetPaths: ["src/config.ts"],
            acceptanceCriteria: ["Config loads"],
            subAgentType: "scaffold",
            status: "pending",
          },
          {
            id: "phase-1-task-2",
            title: "Build auth module",
            description: "Implement authentication",
            dependsOn: [],
            specSections: ["§4"],
            targetPaths: ["src/auth.ts"],
            acceptanceCriteria: [],
            subAgentType: "implement",
            status: "pending",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("enrichPlan", () => {
  it("returns tasksJson unchanged when no enrichment is needed", async () => {
    const tasksJson = makeTasksJson();
    const parseResult: ParseResult = {
      success: true,
      tasksJson,
      enrichmentNeeded: [],
      errors: [],
    };

    const enricher = vi.fn();
    const result = await enrichPlan(parseResult, enricher);

    expect(enricher).not.toHaveBeenCalled();
    expect(result).toEqual(tasksJson);
  });

  it("resolves flagged fields via the enricher", async () => {
    const tasksJson = makeTasksJson();
    const parseResult: ParseResult = {
      success: true,
      tasksJson,
      enrichmentNeeded: [
        {
          taskId: "phase-1-task-2",
          field: "subAgentType",
          context: "Build auth module",
          reason: "Multiple sub-agent type keywords matched",
        },
        {
          taskId: "phase-1-task-2",
          field: "dependsOn",
          context: "Build auth module",
          reason: "Natural-language dependency reference",
        },
      ],
      errors: [],
    };

    const enricher = vi.fn().mockResolvedValue(
      JSON.stringify({
        resolved: [
          {
            taskId: "phase-1-task-2",
            field: "subAgentType",
            value: "implement",
          },
          {
            taskId: "phase-1-task-2",
            field: "dependsOn",
            value: ["phase-1-task-1"],
          },
        ],
      }),
    );

    const result = await enrichPlan(parseResult, enricher);

    expect(enricher).toHaveBeenCalledOnce();
    const task2 = result.phases[0]!.tasks[1]!;
    expect(task2.subAgentType).toBe("implement");
    expect(task2.dependsOn).toEqual(["phase-1-task-1"]);
  });

  it("falls back to defaults when enricher returns invalid JSON", async () => {
    const tasksJson = makeTasksJson();
    const parseResult: ParseResult = {
      success: true,
      tasksJson,
      enrichmentNeeded: [
        {
          taskId: "phase-1-task-2",
          field: "subAgentType",
          context: "Build auth module",
          reason: "Ambiguous",
        },
      ],
      errors: [],
    };

    const enricher = vi.fn().mockResolvedValue("this is not json at all!!!");
    const result = await enrichPlan(parseResult, enricher);

    const task2 = result.phases[0]!.tasks[1]!;
    expect(task2.subAgentType).toBe("implement");
  });

  it("falls back to defaults when enricher throws", async () => {
    const tasksJson = makeTasksJson();
    const parseResult: ParseResult = {
      success: true,
      tasksJson,
      enrichmentNeeded: [
        {
          taskId: "phase-1-task-2",
          field: "dependsOn",
          context: "Build auth module",
          reason: "Ambiguous dependency",
        },
      ],
      errors: [],
    };

    const enricher = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const result = await enrichPlan(parseResult, enricher);

    const task2 = result.phases[0]!.tasks[1]!;
    expect(task2.dependsOn).toEqual([]);
  });

  it("does not mutate the original parseResult", async () => {
    const tasksJson = makeTasksJson();
    const parseResult: ParseResult = {
      success: true,
      tasksJson,
      enrichmentNeeded: [
        {
          taskId: "phase-1-task-2",
          field: "subAgentType",
          context: "Build auth module",
          reason: "Ambiguous",
        },
      ],
      errors: [],
    };

    const enricher = vi.fn().mockResolvedValue(
      JSON.stringify({
        resolved: [
          { taskId: "phase-1-task-2", field: "subAgentType", value: "scaffold" },
        ],
      }),
    );

    const result = await enrichPlan(parseResult, enricher);

    expect(result.phases[0]!.tasks[1]!.subAgentType).toBe("scaffold");
    expect(parseResult.tasksJson!.phases[0]!.tasks[1]!.subAgentType).toBe("implement");
  });

  it("full pipeline: parsePlan → enrichPlan produces valid TasksJson", async () => {
    const content = readFileSync(FIXTURE_PATH, "utf-8");
    const parseResult = parsePlan(content, "spec.md", "plan.md", ".");

    expect(parseResult.success).toBe(true);

    const enricher = vi.fn().mockResolvedValue(
      JSON.stringify({ resolved: [] }),
    );

    const result = await enrichPlan(parseResult, enricher);
    const validation = TasksJsonSchema.safeParse(result);

    expect(validation.success).toBe(true);
    expect(result.phases.length).toBeGreaterThan(0);
  });
});
