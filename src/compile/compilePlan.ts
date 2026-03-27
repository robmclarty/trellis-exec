import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { TasksJsonSchema } from "../types/tasks.js";
import type { TasksJson, Task } from "../types/tasks.js";
import { parsePlan } from "./planParser.js";
import { enrichPlan } from "./planEnricher.js";
import { buildDecomposePrompt } from "./prompts.js";

export type CompileConfig = {
  planPath: string;
  specPath: string;
  guidelinesPath?: string;
  projectRoot: string;
  outputPath: string;
  /** Used for lightweight enrichment calls (e.g. Haiku). */
  query: (prompt: string) => Promise<string>;
  /** Used for full plan decomposition (e.g. Opus). Falls back to `query` if not provided. */
  decomposeQuery?: (prompt: string) => Promise<string>;
};

/**
 * Strips markdown code fences from a JSON response if present.
 */
export function stripCodeFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
}

/**
 * Full plan compilation pipeline:
 * 1. Read plan.md from disk.
 * 2. Run deterministic parser (Stage 1).
 * 3. If successful, run enricher (Stage 2) to fill gaps.
 * 4. If parser failed, decompose via LLM using spec + plan + guidelines.
 * 5. Validate final output against Zod schema.
 * 6. Write to outputPath.
 */
export async function compilePlan(config: CompileConfig): Promise<TasksJson> {
  const planContent = readFileSync(config.planPath, "utf-8");

  // Store refs as paths relative to the output directory so tasks.json is portable
  const outputDir = dirname(resolve(config.outputPath));
  const specRef = relative(outputDir, resolve(config.specPath)) || ".";
  const planRef = relative(outputDir, resolve(config.planPath)) || ".";
  const guidelinesRef = config.guidelinesPath
    ? relative(outputDir, resolve(config.guidelinesPath)) || "."
    : undefined;

  const parseResult = parsePlan(planContent, specRef, planRef, config.projectRoot);

  let tasksJson: TasksJson;

  if (parseResult.success && parseResult.tasksJson) {
    const enricher = config.query;
    tasksJson = await enrichPlan(parseResult, enricher);
    if (guidelinesRef) {
      tasksJson = { ...tasksJson, guidelinesRef };
    }
  } else {
    const specContent = readFileSync(config.specPath, "utf-8");
    const guidelinesContent = config.guidelinesPath
      ? readFileSync(config.guidelinesPath, "utf-8")
      : undefined;
    const decomposePrompt = buildDecomposePrompt(
      planContent,
      specContent,
      specRef,
      planRef,
      config.projectRoot,
      guidelinesContent,
      guidelinesRef,
    );
    const decompose = config.decomposeQuery ?? config.query;
    const raw = await decompose(decomposePrompt);
    const parsed = JSON.parse(stripCodeFences(raw));
    const validation = TasksJsonSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(
        `LLM decomposition produced invalid TasksJson: ${validation.error.message}`,
      );
    }
    tasksJson = validation.data;
    if (guidelinesRef) {
      tasksJson = { ...tasksJson, guidelinesRef };
    }
  }

  tasksJson = injectClaudeMdTask(tasksJson);

  const finalValidation = TasksJsonSchema.safeParse(tasksJson);
  if (!finalValidation.success) {
    throw new Error(
      `Final TasksJson validation failed: ${finalValidation.error.message}`,
    );
  }

  mkdirSync(dirname(config.outputPath), { recursive: true });
  writeFileSync(config.outputPath, JSON.stringify(tasksJson, null, 2), "utf-8");

  return tasksJson;
}

/**
 * Injects a CLAUDE.md scaffolding task into the first phase.
 * CLAUDE.md is auto-loaded by Claude Code at session start and survives
 * context compaction, giving all agents (orchestrator, judge, fix) persistent
 * project orientation derived from the spec and guidelines.
 */
export function injectClaudeMdTask(tasksJson: TasksJson): TasksJson {
  if (!Array.isArray(tasksJson.phases) || tasksJson.phases.length === 0) return tasksJson;

  const firstPhase = tasksJson.phases[0]!;

  // Don't inject if a CLAUDE.md task already exists
  const hasClaudeMd = firstPhase.tasks.some((t) =>
    t.targetPaths.some((p) => p.endsWith("CLAUDE.md")),
  );
  if (hasClaudeMd) return tasksJson;

  const claudeMdTask: Task = {
    id: `${firstPhase.id}-task-claude-md`,
    title: "Generate CLAUDE.md project orientation",
    description:
      "Create a CLAUDE.md file in the project root. This file is auto-loaded by Claude Code " +
      "at session start and survives context compaction, providing persistent orientation for " +
      "all agents (orchestrator, judge, fix). Derive content from the spec and guidelines. " +
      "Include: project purpose (1-2 sentences), dev commands (build, test, lint), directory " +
      "layout with one-line descriptions, code conventions (language, module system, naming, " +
      "export style), testing patterns (framework, file location), and git commit format. " +
      "Keep it under 80 lines — concise enough to scan, detailed enough to orient.",
    dependsOn: [],
    specSections: [],
    targetPaths: ["CLAUDE.md"],
    acceptanceCriteria: [
      "CLAUDE.md exists in project root",
      "Contains project purpose, dev commands, directory layout, and code conventions",
      "Under 80 lines",
    ],
    subAgentType: "scaffold",
    status: "pending",
  };

  const updatedPhases = tasksJson.phases.map((phase, i) =>
    i === 0
      ? { ...phase, tasks: [...phase.tasks, claudeMdTask] }
      : phase,
  );

  return { ...tasksJson, phases: updatedPhases };
}
