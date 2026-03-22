import type { EnrichmentFlag } from "../types/compile.js";
import type { Task } from "../types/tasks.js";
/**
 * Builds a targeted prompt for Haiku to resolve ambiguous fields flagged by the
 * deterministic parser. Includes each flag with its surrounding task context so
 * the model can make informed decisions without seeing the entire plan.
 */
export declare function buildEnrichmentPrompt(flags: EnrichmentFlag[], tasks: Task[]): string;
/**
 * Decomposes a technical plan into implementable phases and tasks using the
 * spec for requirements and acceptance criteria, the plan for architecture and
 * design decisions, and (optionally) project guidelines for coding conventions
 * and file structure.
 *
 * This is the primary compilation path for plans that are not already formatted
 * as phase/task lists.
 */
export declare function buildDecomposePrompt(planContent: string, specContent: string, specRef: string, planRef: string, projectRoot: string, guidelinesContent?: string, guidelinesRef?: string): string;
//# sourceMappingURL=prompts.d.ts.map