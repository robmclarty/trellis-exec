import type { TasksJson, Phase } from "../types/tasks.js";
import type { SharedState } from "../types/state.js";
import type { RunContext } from "../cli.js";
export type PhaseRunnerResult = {
    success: boolean;
    phasesCompleted: string[];
    phasesFailed: string[];
    finalState: SharedState;
};
export declare function buildPhaseContext(phase: Phase, state: SharedState, handoff: string, ctx: RunContext): string;
export declare function dryRunReport(tasksJson: TasksJson, ctx: RunContext): string;
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
export declare function runPhases(ctx: RunContext, tasksJson: TasksJson): Promise<PhaseRunnerResult>;
export declare function runSinglePhase(ctx: RunContext, tasksJson: TasksJson, phaseId: string): Promise<PhaseRunnerResult>;
//# sourceMappingURL=phaseRunner.d.ts.map