import type { TasksJson, Phase } from "../types/tasks.js";
import type { SharedState, PhaseReport, CheckResult } from "../types/state.js";
import type { RunContext } from "../cli.js";
import type { UsageStats } from "../ui/streamParser.js";
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
};
/**
 * Lightweight pre-phase contract review. Checks acceptance criteria for
 * common issues without invoking an LLM. Returns warnings (advisory only).
 */
export declare function reviewPhaseContract(phase: Phase): string[];
export declare function dryRunReport(tasksJson: TasksJson, ctx: RunContext): string;
/**
 * Returns true if any newly added files look like test files.
 */
export declare function hasNewTestFiles(projectRoot: string, startSha?: string): boolean;
/**
 * Attempts to detect a test command from the project.
 * Returns null if no test runner can be identified.
 */
export declare function detectTestCommand(projectRoot: string): string | null;
export declare function promptForContinuation(options?: {
    phaseId?: string;
    retryCount?: number;
    maxRetries?: number;
    recommendedAction?: "advance" | "retry" | "halt";
    reason?: string;
}): Promise<"continue" | "retry" | "skip" | "quit">;
/**
 * Selects the judge model based on diff size and task count.
 * Small diffs with few tasks use Sonnet; larger work uses Opus.
 * An explicit override (from --judge-model) takes precedence.
 */
export declare function selectJudgeModel(diffLineCount: number, taskCount: number, override?: string): string;
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
export { REPORT_FILENAME, collectLearnings, buildPhaseContext, normalizeReport, formatIssue, parseJudgeResult, buildJudgePrompt, buildRejudgePrompt, buildFixPrompt, buildReporterPrompt, } from "./prompts.js";
//# sourceMappingURL=phaseRunner.d.ts.map