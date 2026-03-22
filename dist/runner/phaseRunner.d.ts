import type { TasksJson, Phase } from "../types/tasks.js";
import type { SharedState } from "../types/state.js";
export type PhaseRunnerConfig = {
    tasksJsonPath: string;
    projectRoot?: string;
    statePath?: string;
    trajectoryPath?: string;
    checkCommand?: string;
    isolation: "worktree" | "none";
    concurrency: number;
    model?: string;
    maxRetries: number;
    headless: boolean;
    verbose: boolean;
    dryRun: boolean;
    turnLimit: number;
    maxConsecutiveErrors: number;
    pluginRoot: string;
};
export type PhaseRunnerResult = {
    success: boolean;
    phasesCompleted: string[];
    phasesFailed: string[];
    finalState: SharedState;
};
/**
 * Read spec sections from a spec file by §N identifiers.
 * Returns a map of section key to content. Gracefully returns empty map on error.
 */
export declare function parseSpecSections(specPath: string): Map<string, string>;
export declare function buildPhaseContext(phase: Phase, state: SharedState, handoff: string, tasksJson: TasksJson, specPath: string, checkCommand?: string): string;
export declare function dryRunReport(tasksJson: TasksJson): string;
export declare function promptForContinuation(): Promise<"continue" | "retry" | "skip" | "quit">;
/**
 * Extracts executable JS code from an orchestrator response.
 *
 * The orchestrator may wrap code in markdown fences (```js ... ```) or
 * include explanatory text alongside code. This function extracts the
 * code blocks, falling back to the raw response if no fences are found.
 * If the response is clearly natural language (not JS), returns empty string.
 */
export declare function extractCode(response: string): string;
export declare function runPhases(config: PhaseRunnerConfig): Promise<PhaseRunnerResult>;
export declare function runSinglePhase(config: PhaseRunnerConfig, phaseId: string): Promise<PhaseRunnerResult>;
//# sourceMappingURL=phaseRunner.d.ts.map