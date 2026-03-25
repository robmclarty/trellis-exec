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
export declare function collectLearnings(state: SharedState): string[];
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
/**
 * Selects the judge model based on diff size and task count.
 * Small diffs with few tasks use Sonnet; larger work uses Opus.
 * An explicit override (from --judge-model) takes precedence.
 */
export declare function selectJudgeModel(diffLineCount: number, taskCount: number, override?: string): string;
export declare function buildJudgePrompt(config: {
    changedFiles: ChangedFile[];
    diffContent: string;
    phase: Phase;
    orchestratorReport: PhaseReport;
}): string;
/**
 * Builds a targeted re-judge prompt after a fix has been applied.
 * Instead of the full phase diff, includes only the fix diff and the
 * previous issues so the judge can evaluate whether they were resolved.
 */
export declare function buildRejudgePrompt(config: {
    fixDiff: string;
    fixChangedFiles: ChangedFile[];
    previousIssues: JudgeIssue[];
    phase: Phase;
}): string;
export declare function parseJudgeResult(output: string): JudgeAssessment;
/** Format a JudgeIssue (string or object) to a display string. */
export declare function formatIssue(issue: JudgeIssue): string;
export declare function buildFixPrompt(issues: JudgeIssue[], phase: Phase): string;
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