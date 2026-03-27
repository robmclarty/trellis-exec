import type { TasksJson } from "../types/tasks.js";
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
export declare function stripCodeFences(raw: string): string;
/**
 * Full plan compilation pipeline:
 * 1. Read plan.md from disk.
 * 2. Run deterministic parser (Stage 1).
 * 3. If successful, run enricher (Stage 2) to fill gaps.
 * 4. If parser failed, decompose via LLM using spec + plan + guidelines.
 * 5. Validate final output against Zod schema.
 * 6. Write to outputPath.
 */
export declare function compilePlan(config: CompileConfig): Promise<TasksJson>;
/**
 * Injects a CLAUDE.md scaffolding task into the first phase.
 * CLAUDE.md is auto-loaded by Claude Code at session start and survives
 * context compaction, giving all agents (orchestrator, judge, fix) persistent
 * project orientation derived from the spec and guidelines.
 */
export declare function injectClaudeMdTask(tasksJson: TasksJson): TasksJson;
//# sourceMappingURL=compilePlan.d.ts.map