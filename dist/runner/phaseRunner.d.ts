import type { TasksJson } from "../types/tasks.js";
import type { SharedState } from "../types/state.js";
export type PhaseRunnerConfig = {
    tasksJsonPath: string;
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
export declare function dryRunReport(tasksJson: TasksJson): string;
export declare function promptForContinuation(): Promise<"continue" | "retry" | "skip" | "quit">;
export declare function runPhases(config: PhaseRunnerConfig): Promise<PhaseRunnerResult>;
export declare function runSinglePhase(config: PhaseRunnerConfig, phaseId: string): Promise<PhaseRunnerResult>;
//# sourceMappingURL=phaseRunner.d.ts.map