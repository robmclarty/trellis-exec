import type { TasksJson, Phase } from "../types/tasks.js";
import type { SharedState, PhaseReport, JudgeAssessment, JudgeIssue, CheckResult } from "../types/state.js";
import type { RunContext } from "../cli.js";
import type { ChangedFile } from "../git.js";
export type PhaseRunnerResult = {
    success: boolean;
    phasesCompleted: string[];
    phasesFailed: string[];
    finalState: SharedState;
};
export declare function buildPhaseContext(phase: Phase, state: SharedState, handoff: string, ctx: RunContext): string;
/**
 * Normalizes a raw report object (as produced by the orchestrator LLM) into
 * a valid PhaseReport.  Maps common LLM-style field names to the canonical
 * schema fields and fills in defaults for anything missing.
 */
export declare function normalizeReport(raw: Record<string, unknown>, phaseId: string): PhaseReport;
export declare function dryRunReport(tasksJson: TasksJson, ctx: RunContext): string;
/**
 * Returns true if any newly added files look like test files.
 */
export declare function hasNewTestFiles(projectRoot: string): boolean;
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
export declare function buildJudgePrompt(config: {
    changedFiles: ChangedFile[];
    diffContent: string;
    phase: Phase;
    orchestratorReport: PhaseReport;
}): string;
export declare function parseJudgeResult(output: string): JudgeAssessment;
/** Format a JudgeIssue (string or object) to a display string. */
export declare function formatIssue(issue: JudgeIssue): string;
export declare function buildFixPrompt(issues: JudgeIssue[], phase: Phase): string;
export declare function createDefaultCheck(projectRoot: string, phase: Phase): {
    run: () => Promise<CheckResult>;
};
export declare function runPhases(ctx: RunContext, tasksJson: TasksJson): Promise<PhaseRunnerResult>;
export declare function runSinglePhase(ctx: RunContext, tasksJson: TasksJson, phaseId: string): Promise<PhaseRunnerResult>;
//# sourceMappingURL=phaseRunner.d.ts.map