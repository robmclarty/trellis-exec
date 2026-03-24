import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { SharedStateSchema } from "../types/state.js";
import type { SharedState, PhaseReport } from "../types/state.js";
import type { TasksJson, Phase, TaskStatus } from "../types/tasks.js";

/**
 * Creates initial shared state from a tasks.json file.
 * Sets currentPhase to the first phase; everything else empty.
 */
export function initState(tasksJson: TasksJson): SharedState {
  const firstPhase = tasksJson.phases[0];
  if (!firstPhase) {
    throw new Error("TasksJson must contain at least one phase");
  }

  return {
    currentPhase: firstPhase.id,
    completedPhases: [],
    modifiedFiles: [],
    schemaChanges: [],
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
export function loadState(statePath: string): SharedState | null {
  let raw: string;
  try {
    raw = readFileSync(statePath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);
  return SharedStateSchema.parse(parsed);
}

/**
 * Writes state.json atomically (write to temp, then rename)
 * to prevent corruption on crash.
 */
export function saveState(statePath: string, state: SharedState): void {
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
export function updateStateAfterPhase(
  state: SharedState,
  report: PhaseReport,
  phases: Phase[],
): SharedState {
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
export function updateTaskStatus(
  tasksJson: TasksJson,
  phaseId: string,
  taskId: string,
  status: TaskStatus,
): TasksJson {
  const phaseIndex = tasksJson.phases.findIndex((p) => p.id === phaseId);
  if (phaseIndex < 0) {
    throw new Error(`Phase not found: ${phaseId}`);
  }

  const phase = tasksJson.phases[phaseIndex]!;
  const taskIndex = phase.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex < 0) {
    throw new Error(`Task not found: ${taskId} in phase ${phaseId}`);
  }

  const updatedTasks = phase.tasks.map((t, i) =>
    i === taskIndex ? { ...t, status } : t,
  );

  const updatedPhases = tasksJson.phases.map((p, i) =>
    i === phaseIndex ? { ...p, tasks: updatedTasks } : p,
  );

  return { ...tasksJson, phases: updatedPhases };
}

/**
 * Returns the commit range (startSha..endSha) for a completed phase,
 * or null if the phase has no recorded SHAs.
 */
export function getPhaseCommitRange(
  state: SharedState,
  phaseId: string,
): { startSha: string; endSha: string } | null {
  const report = state.phaseReports.find((r) => r.phaseId === phaseId);
  if (!report?.startSha || !report?.endSha) return null;
  return { startSha: report.startSha, endSha: report.endSha };
}
