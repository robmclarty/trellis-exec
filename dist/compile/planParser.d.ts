import type { ParseResult } from "../types/compile.js";
/**
 * Deterministic Stage 1 parser that converts plan.md markdown into a TasksJson structure.
 * Extracts phases, tasks, spec references, file paths, dependencies, sub-agent types,
 * and acceptance criteria without any LLM calls. Fields that cannot be resolved
 * deterministically are flagged in enrichmentNeeded for Stage 2 (Haiku enrichment).
 * Returns success: false if no phase boundaries can be identified.
 */
export declare function parsePlan(planContent: string, specRef: string, planRef: string): ParseResult;
//# sourceMappingURL=planParser.d.ts.map