import type { SharedState, PhaseReport, JudgeCorrection, DecisionEntry } from "../types/state.js";
import type { TasksJson, Phase, TaskStatus } from "../types/tasks.js";
/**
 * Creates initial shared state from a tasks.json file.
 * Sets currentPhase to the first phase; everything else empty.
 */
export declare function initState(tasksJson: TasksJson): SharedState;
/**
 * Reads and validates state.json from disk.
 * Returns null if the file doesn't exist.
 * Throws on invalid data.
 */
export declare function loadState(statePath: string): SharedState | null;
/**
 * Writes state.json atomically (write to temp, then rename)
 * to prevent corruption on crash.
 */
export declare function saveState(statePath: string, state: SharedState): void;
/**
 * Applies a phase report to the state after phase completion.
 * Immutable — returns a new state object.
 *
 * - Moves currentPhase to completedPhases
 * - Appends the report to phaseReports
 * - Advances currentPhase to the next phase (or "" if last)
 */
export declare function updateStateAfterPhase(state: SharedState, report: PhaseReport, phases: Phase[]): SharedState;
/**
 * Updates a single task's status within a TasksJson structure.
 * Immutable — returns a new TasksJson object.
 * Throws if the phase or task is not found.
 */
export declare function updateTaskStatus(tasksJson: TasksJson, phaseId: string, taskId: string, status: TaskStatus): TasksJson;
/**
 * Applies a phase report's task outcomes to a TasksJson structure.
 * Marks completed tasks as "complete" and failed tasks as "failed".
 * Silently skips task IDs not found in the phase (e.g., corrective tasks
 * dynamically added during retries).
 *
 * Uses a single pass through the phase's tasks instead of O(n) per update.
 */
export declare function applyReportToTasks(tasksJson: TasksJson, phaseId: string, report: PhaseReport): TasksJson;
/**
 * Applies judge-provided corrections to tasks.json.
 * Currently supports targetPath renames — replacing stale spec paths
 * with the actual paths the orchestrator created on disk.
 *
 * Returns the updated TasksJson and auto-generated constraint-tier
 * decision entries so corrections propagate to future phases.
 */
export declare function applyCorrections(tasksJson: TasksJson, corrections: JudgeCorrection[]): {
    tasksJson: TasksJson;
    decisions: DecisionEntry[];
};
/**
 * Returns the commit range (startSha..endSha) for a completed phase,
 * or null if the phase has no recorded SHAs.
 */
export declare function getPhaseCommitRange(state: SharedState, phaseId: string): {
    startSha: string;
    endSha: string;
} | null;
//# sourceMappingURL=stateManager.d.ts.map