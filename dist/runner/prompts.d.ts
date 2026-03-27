import type { Phase } from "../types/tasks.js";
import type { SharedState, PhaseReport, JudgeAssessment, JudgeIssue } from "../types/state.js";
import type { RunContext } from "../types/runner.js";
import type { ChangedFile } from "../git.js";
export declare const REPORT_FILENAME = ".trellis-phase-report.json";
export declare function collectLearnings(state: SharedState): {
    architectural: string[];
    tactical: string[];
    constraint: string[];
};
/**
 * Builds the reference sections shared by both the orchestrator and the fix
 * agent: learnings (as "Current Understanding"), implementation authority
 * guidance, guidelines, and the original spec. Learnings appear FIRST so
 * they have prime positioning; the spec is demoted to reference material.
 */
export declare function buildReferenceContext(state: SharedState, ctx: RunContext): string;
export declare function buildPhaseContext(phase: Phase, state: SharedState, handoff: string, ctx: RunContext): string;
/**
 * Normalizes a raw report object (as produced by the orchestrator LLM) into
 * a valid PhaseReport.  Maps common LLM-style field names to the canonical
 * schema fields and fills in defaults for anything missing.
 */
export declare function normalizeReport(raw: Record<string, unknown>, phaseId: string): PhaseReport;
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
export declare function buildFixPrompt(issues: JudgeIssue[], phase: Phase, state: SharedState, ctx: RunContext): string;
/**
 * Builds a prompt for the reporter fallback agent that generates a phase
 * report from git diff and task context when the orchestrator times out.
 */
export declare function buildReporterPrompt(phase: Phase, changedFiles: ChangedFile[], diffContent: string): string;
//# sourceMappingURL=prompts.d.ts.map