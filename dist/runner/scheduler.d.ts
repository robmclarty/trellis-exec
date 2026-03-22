import type { Task } from "../types/tasks.js";
export type ExecutionGroup = {
    groupIndex: number;
    taskIds: string[];
    parallelizable: boolean;
};
export type ValidationResult = {
    valid: boolean;
    errors: string[];
};
/**
 * Checks for missing dependency references, self-references,
 * and circular dependencies.
 *
 * @param knownExternalIds - Task IDs from prior phases that are valid
 *   dependency targets but not part of the current task set (e.g. cross-phase deps).
 */
export declare function validateDependencies(tasks: Task[], knownExternalIds?: Set<string>): ValidationResult;
/**
 * Returns pairs of task IDs that have overlapping targetPaths.
 * A path overlaps if they are identical or one is a parent directory of the other.
 */
export declare function detectTargetPathOverlaps(tasks: Task[]): Array<[string, string]>;
/**
 * Takes a flat array of tasks (within one phase) and returns ordered
 * execution groups. Tasks within a group can run in parallel.
 * Groups must be executed sequentially.
 *
 * Uses Kahn's algorithm with both explicit (dependsOn) and implicit
 * (targetPaths overlap) dependencies.
 */
export declare function resolveExecutionOrder(tasks: Task[], knownExternalIds?: Set<string>): ExecutionGroup[];
//# sourceMappingURL=scheduler.d.ts.map