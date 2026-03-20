import type { SharedState, PhaseReport } from "../types/state.js";
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
//# sourceMappingURL=stateManager.d.ts.map