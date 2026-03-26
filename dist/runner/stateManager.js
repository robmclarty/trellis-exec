import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { SharedStateSchema } from "../types/state.js";
/**
 * Creates initial shared state from a tasks.json file.
 * Sets currentPhase to the first phase; everything else empty.
 */
export function initState(tasksJson) {
    const firstPhase = tasksJson.phases[0];
    if (!firstPhase) {
        throw new Error("TasksJson must contain at least one phase");
    }
    return {
        currentPhase: firstPhase.id,
        completedPhases: [],
        phaseReports: [],
        phaseRetries: {},
        phaseReport: null,
    };
}
/**
 * Reads and validates state.json from disk.
 * Returns null if the file doesn't exist.
 * Throws on invalid data.
 */
export function loadState(statePath) {
    let raw;
    try {
        raw = readFileSync(statePath, "utf-8");
    }
    catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") {
            return null;
        }
        throw err;
    }
    const parsed = JSON.parse(raw);
    return SharedStateSchema.parse(parsed);
}
/**
 * Writes state.json atomically (write to temp, then rename)
 * to prevent corruption on crash.
 */
export function saveState(statePath, state) {
    const tmpPath = `${statePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmpPath, statePath);
}
/**
 * Applies a phase report to the state after phase completion.
 * Immutable — returns a new state object.
 *
 * - Moves currentPhase to completedPhases
 * - Appends the report to phaseReports
 * - Advances currentPhase to the next phase (or "" if last)
 */
export function updateStateAfterPhase(state, report, phases) {
    const currentIndex = phases.findIndex((p) => p.id === state.currentPhase);
    const nextPhase = currentIndex >= 0 ? phases[currentIndex + 1] : undefined;
    return {
        ...state,
        completedPhases: [...state.completedPhases, state.currentPhase],
        phaseReports: [...state.phaseReports, report],
        currentPhase: nextPhase?.id ?? "",
        phaseReport: null,
    };
}
/**
 * Updates a single task's status within a TasksJson structure.
 * Immutable — returns a new TasksJson object.
 * Throws if the phase or task is not found.
 */
export function updateTaskStatus(tasksJson, phaseId, taskId, status) {
    const phaseIndex = tasksJson.phases.findIndex((p) => p.id === phaseId);
    if (phaseIndex < 0) {
        throw new Error(`Phase not found: ${phaseId}`);
    }
    const phase = tasksJson.phases[phaseIndex];
    const taskIndex = phase.tasks.findIndex((t) => t.id === taskId);
    if (taskIndex < 0) {
        throw new Error(`Task not found: ${taskId} in phase ${phaseId}`);
    }
    const updatedTasks = phase.tasks.map((t, i) => i === taskIndex ? { ...t, status } : t);
    const updatedPhases = tasksJson.phases.map((p, i) => i === phaseIndex ? { ...p, tasks: updatedTasks } : p);
    return { ...tasksJson, phases: updatedPhases };
}
/**
 * Applies a phase report's task outcomes to a TasksJson structure.
 * Marks completed tasks as "complete" and failed tasks as "failed".
 * Silently skips task IDs not found in the phase (e.g., corrective tasks
 * dynamically added during retries).
 */
export function applyReportToTasks(tasksJson, phaseId, report) {
    let updated = tasksJson;
    for (const taskId of report.tasksCompleted) {
        try {
            updated = updateTaskStatus(updated, phaseId, taskId, "complete");
        }
        catch { /* corrective/dynamic task IDs may not exist in original tasks.json */ }
    }
    for (const taskId of report.tasksFailed) {
        try {
            updated = updateTaskStatus(updated, phaseId, taskId, "failed");
        }
        catch { /* skip */ }
    }
    return updated;
}
/**
 * Returns the commit range (startSha..endSha) for a completed phase,
 * or null if the phase has no recorded SHAs.
 */
export function getPhaseCommitRange(state, phaseId) {
    const report = state.phaseReports.find((r) => r.phaseId === phaseId);
    if (!report?.startSha || !report?.endSha)
        return null;
    return { startSha: report.startSha, endSha: report.endSha };
}
//# sourceMappingURL=stateManager.js.map