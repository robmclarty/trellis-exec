import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { SharedStateSchema } from "../types/state.js";
import type { SharedState, PhaseReport, JudgeCorrection, DecisionEntry } from "../types/state.js";
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse state file ${statePath}: ${message}`);
  }
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
 * Applies a phase report's task outcomes to a TasksJson structure.
 * Marks completed tasks as "complete" and failed tasks as "failed".
 * Silently skips task IDs not found in the phase (e.g., corrective tasks
 * dynamically added during retries).
 */
export function applyReportToTasks(
  tasksJson: TasksJson,
  phaseId: string,
  report: PhaseReport,
): TasksJson {
  let updated = tasksJson;
  for (const taskId of report.tasksCompleted) {
    try {
      updated = updateTaskStatus(updated, phaseId, taskId, "complete");
    } catch { /* corrective/dynamic task IDs may not exist in original tasks.json */ }
  }
  for (const taskId of report.tasksFailed) {
    try {
      updated = updateTaskStatus(updated, phaseId, taskId, "failed");
    } catch { /* skip */ }
  }
  return updated;
}

/**
 * Applies judge-provided corrections to tasks.json.
 * Currently supports targetPath renames — replacing stale spec paths
 * with the actual paths the orchestrator created on disk.
 *
 * Returns the updated TasksJson and auto-generated constraint-tier
 * decision entries so corrections propagate to future phases.
 */
export function applyCorrections(
  tasksJson: TasksJson,
  corrections: JudgeCorrection[],
): { tasksJson: TasksJson; decisions: DecisionEntry[] } {
  if (corrections.length === 0) {
    return { tasksJson, decisions: [] };
  }

  const decisions: DecisionEntry[] = [];
  let updated = tasksJson;

  for (const correction of corrections) {
    if (correction.type === "targetPath") {
      updated = {
        ...updated,
        phases: updated.phases.map((phase) => ({
          ...phase,
          tasks: phase.tasks.map((task) => {
            if (task.id !== correction.taskId) return task;
            return {
              ...task,
              targetPaths: task.targetPaths.map((tp) =>
                tp === correction.old ? correction.new : tp,
              ),
            };
          }),
        })),
      };
      decisions.push({
        text: `[${correction.taskId}] targetPath renamed: ${correction.old} → ${correction.new} (${correction.reason})`,
        tier: "constraint",
      });
    }
  }

  return { tasksJson: updated, decisions };
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
