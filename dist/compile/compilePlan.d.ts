import type { TasksJson } from "../types/tasks.js";
import type { AgentLauncher } from "../orchestrator/agentLauncher.js";
export type CompileConfig = {
    planPath: string;
    specPath: string;
    outputPath: string;
    agentLauncher: AgentLauncher;
};
/**
 * Full plan compilation pipeline:
 * 1. Read plan.md from disk.
 * 2. Run deterministic parser (Stage 1).
 * 3. If successful, run enricher (Stage 2) to fill gaps.
 * 4. If parser failed, fall back to full LLM parse.
 * 5. Validate final output against Zod schema.
 * 6. Write to outputPath.
 */
export declare function compilePlan(config: CompileConfig): Promise<TasksJson>;
//# sourceMappingURL=compilePlan.d.ts.map