import type { TasksJson, Phase } from "../types/tasks.js";
import type { SharedState, PhaseReport, CheckResult } from "../types/state.js";
import type { RunContext } from "../types/runner.js";
import type { UsageStats } from "../ui/streamParser.js";
import type { BudgetConfig, BudgetState } from "../safety/budgetTracker.js";
import type { BrowserAcceptanceReport } from "../types/state.js";
export type PhaseRunnerResult = {
    success: boolean;
    phasesCompleted: string[];
    phasesFailed: string[];
    finalState: SharedState;
    phaseDurations: Record<string, number>;
    totalDuration: number;
    browserAcceptanceReport?: BrowserAcceptanceReport;
    phaseTokens: Record<string, UsageStats>;
    budgetState?: BudgetState;
    budgetConfig?: BudgetConfig;
};
/**
 * Lightweight pre-phase contract review. Checks acceptance criteria for
 * common issues without invoking an LLM. Returns warnings (advisory only).
 */
export declare function reviewPhaseContract(phase: Phase): string[];
export declare function dryRunReport(tasksJson: TasksJson, ctx: RunContext): string;
export declare function promptForContinuation(options?: {
    phaseId?: string;
    retryCount?: number;
    maxRetries?: number;
    recommendedAction?: "advance" | "retry" | "halt";
    reason?: string;
}): Promise<"continue" | "retry" | "skip" | "quit">;
export declare function createDefaultCheck(projectRoot: string, phase: Phase): {
    run: () => Promise<CheckResult>;
};
/**
 * Extracts scope names from completed tasks' targetPaths.
 * E.g., ["src/auth/login.tsx", "src/db/schema.ts"] → ["auth", "db"]
 */
export declare function extractScopes(phase: Phase, report: PhaseReport): string[];
/**
 * Commits any remaining uncommitted changes as a phase-level summary commit.
 * Returns the new SHA, or null if nothing to commit.
 */
export declare function makePhaseCommit(projectRoot: string, phase: Phase, report: PhaseReport): string | null;
export declare function runPhases(ctx: RunContext, tasksJson: TasksJson): Promise<PhaseRunnerResult>;
export declare function runSinglePhase(ctx: RunContext, tasksJson: TasksJson, phaseId: string): Promise<PhaseRunnerResult>;
//# sourceMappingURL=phaseRunner.d.ts.map