import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TasksJsonSchema } from "../types/tasks.js";
import type { TasksJson } from "../types/tasks.js";
import type { AgentLauncher } from "../orchestrator/agentLauncher.js";
import { parsePlan } from "./planParser.js";
import { enrichPlan } from "./planEnricher.js";
import { buildFullParseFallbackPrompt } from "./prompts.js";

export type CompileConfig = {
  planPath: string;
  specPath: string;
  outputPath: string;
  agentLauncher: AgentLauncher;
};

/**
 * Strips markdown code fences from a JSON response if present.
 */
function stripCodeFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
}

/**
 * Full plan compilation pipeline:
 * 1. Read plan.md from disk.
 * 2. Run deterministic parser (Stage 1).
 * 3. If successful, run enricher (Stage 2) to fill gaps.
 * 4. If parser failed, fall back to full LLM parse.
 * 5. Validate final output against Zod schema.
 * 6. Write to outputPath.
 */
export async function compilePlan(config: CompileConfig): Promise<TasksJson> {
  const planContent = readFileSync(config.planPath, "utf-8");
  const specRef = config.specPath;
  const planRef = config.planPath;

  const parseResult = parsePlan(planContent, specRef, planRef);

  let tasksJson: TasksJson;

  if (parseResult.success && parseResult.tasksJson) {
    const enricher = (prompt: string) => config.agentLauncher.llmQuery(prompt);
    tasksJson = await enrichPlan(parseResult, enricher);
  } else {
    const fallbackPrompt = buildFullParseFallbackPrompt(planContent, specRef);
    const raw = await config.agentLauncher.llmQuery(fallbackPrompt);
    const parsed = JSON.parse(stripCodeFences(raw));
    const validation = TasksJsonSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(
        `Fallback LLM parse produced invalid TasksJson: ${validation.error.message}`,
      );
    }
    tasksJson = validation.data;
  }

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
