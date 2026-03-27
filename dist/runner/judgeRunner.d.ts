import type { Phase } from "../types/tasks.js";
import type { TasksJson } from "../types/tasks.js";
import type { SharedState, PhaseReport, JudgeAssessment } from "../types/state.js";
import type { TrajectoryLogger } from "../logging/trajectoryLogger.js";
import type { RunContext } from "../types/runner.js";
export type JudgePhaseResult = {
    assessment: JudgeAssessment;
    correctionAttempts: number;
};
/**
 * Selects the judge model based on diff size and task count.
 * Small diffs with few tasks use Sonnet; larger work uses Opus.
 * An explicit override (from --judge-model) takes precedence.
 */
export declare function selectJudgeModel(diffLineCount: number, taskCount: number, override?: string): string;
export declare function judgePhase(config: {
    phase: Phase;
    report: PhaseReport;
    state: SharedState;
    projectRoot: string;
    ctx: RunContext;
    logger: TrajectoryLogger;
    maxCorrections?: number;
    startSha?: string;
}): Promise<JudgePhaseResult>;
/**
 * Applies judge assessment to report and tasks.json:
 * - Applies corrections (targetPath renames) and writes tasks.json to disk
 * - Upgrades report to "complete" if judge passed but orchestrator failed
 * - Downgrades report to "retry" if judge found issues but orchestrator said advance
 *
 * Returns the updated report and tasks.json.
 */
export declare function applyJudgeOutcome(config: {
    judgeResult: JudgePhaseResult;
    report: PhaseReport;
    tasksJson: TasksJson;
    phaseId: string;
    phaseExecStatus: "complete" | "partial" | "failed";
    tasksJsonPath: string;
    verbose?: boolean;
}): {
    report: PhaseReport;
    tasksJson: TasksJson;
};
//# sourceMappingURL=judgeRunner.d.ts.map