import type { EnrichmentFlag } from "../types/compile.js";
import type { Task } from "../types/tasks.js";
/**
 * Builds a targeted prompt for Haiku to resolve ambiguous fields flagged by the
 * deterministic parser. Includes each flag with its surrounding task context so
 * the model can make informed decisions without seeing the entire plan.
 */
export declare function buildEnrichmentPrompt(flags: EnrichmentFlag[], tasks: Task[]): string;
/**
 * Fallback prompt for when the deterministic parser fails entirely (no phase
 * boundaries found). Sends the full plan to Haiku and asks for a complete
 * TasksJson structure.
 */
export declare function buildFullParseFallbackPrompt(planContent: string, specRef: string): string;
//# sourceMappingURL=prompts.d.ts.map