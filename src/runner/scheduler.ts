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
export function validateDependencies(
  tasks: Task[],
  knownExternalIds: Set<string> = new Set(),
): ValidationResult {
  const errors: string[] = [];
  const taskIds = new Set(tasks.map((t) => t.id));

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (dep === task.id) {
        errors.push(`Task "${task.id}" depends on itself`);
      } else if (!taskIds.has(dep) && !knownExternalIds.has(dep)) {
        errors.push(
          `Task "${task.id}" depends on non-existent task "${dep}"`,
        );
      }
    }
  }

  // Detect cycles via DFS
  const cycleError = detectCycle(tasks);
  if (cycleError) {
    errors.push(cycleError);
  }

  return { valid: errors.length === 0, errors };
}

/** Detects circular dependencies via DFS (white/gray/black coloring). Returns an error message or null. */
function detectCycle(tasks: Task[]): string | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const taskIds = new Set(tasks.map((t) => t.id));

  for (const task of tasks) {
    color.set(task.id, WHITE);
  }

  // Build adjacency list (task -> tasks that depend on it)
  const adj = new Map<string, string[]>();
  for (const task of tasks) {
    if (!adj.has(task.id)) {
      adj.set(task.id, []);
    }
    for (const dep of task.dependsOn) {
      if (taskIds.has(dep)) {
        if (!adj.has(dep)) {
          adj.set(dep, []);
        }
        adj.get(dep)!.push(task.id);
      }
    }
  }

  function dfs(nodeId: string): string | null {
    color.set(nodeId, GRAY);
    for (const neighbor of adj.get(nodeId) ?? []) {
      if (color.get(neighbor) === GRAY) {
        return `Circular dependency detected involving task "${neighbor}"`;
      }
      if (color.get(neighbor) === WHITE) {
        const result = dfs(neighbor);
        if (result) return result;
      }
    }
    color.set(nodeId, BLACK);
    return null;
  }

  for (const task of tasks) {
    if (color.get(task.id) === WHITE) {
      const result = dfs(task.id);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Returns pairs of task IDs that have overlapping targetPaths.
 * A path overlaps if they are identical or one is a parent directory of the other.
 */
export function detectTargetPathOverlaps(
  tasks: Task[],
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i]!;
      const b = tasks[j]!;
      if (pathsOverlap(a.targetPaths, b.targetPaths)) {
        pairs.push([a.id, b.id]);
      }
    }
  }

  return pairs;
}

/** Strips a trailing slash from a path for consistent comparison. */
function normalizePath(p: string): string {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

/** Returns true if two paths are identical or one is a parent directory of the other. */
function twoPathsOverlap(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return (
    na === nb || nb.startsWith(na + "/") || na.startsWith(nb + "/")
  );
}

/** Returns true if any path in pathsA overlaps with any path in pathsB. */
function pathsOverlap(pathsA: string[], pathsB: string[]): boolean {
  for (const a of pathsA) {
    for (const b of pathsB) {
      if (twoPathsOverlap(a, b)) return true;
    }
  }
  return false;
}

/**
 * Takes a flat array of tasks (within one phase) and returns ordered
 * execution groups. Tasks within a group can run in parallel.
 * Groups must be executed sequentially.
 *
 * Uses Kahn's algorithm with both explicit (dependsOn) and implicit
 * (targetPaths overlap) dependencies.
 */
export function resolveExecutionOrder(
  tasks: Task[],
  knownExternalIds: Set<string> = new Set(),
): ExecutionGroup[] {
  if (tasks.length === 0) return [];

  const validation = validateDependencies(tasks, knownExternalIds);
  if (!validation.valid) {
    throw new Error(
      `Invalid dependencies: ${validation.errors.join("; ")}`,
    );
  }

  // Build combined dependency graph.
  // For implicit overlaps, the earlier task (by array position) goes first.
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  const prerequisites = new Map<string, Set<string>>();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, new Set());
    prerequisites.set(task.id, new Set());
  }

  // Helper to add a directed edge: from must complete before to
  function addEdge(from: string, to: string): void {
    if (prerequisites.get(to)!.has(from)) return; // already exists
    prerequisites.get(to)!.add(from);
    dependents.get(from)!.add(to);
    inDegree.set(to, inDegree.get(to)! + 1);
  }

  // Explicit dependencies (skip cross-phase deps — those are already complete)
  const localIds = new Set(tasks.map((t) => t.id));
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (localIds.has(dep)) {
        addEdge(dep, task.id);
      }
    }
  }

  // Implicit dependencies from targetPaths overlaps
  const overlapPairs = detectTargetPathOverlaps(tasks);
  for (const [earlier, later] of overlapPairs) {
    addEdge(earlier, later);
  }

  // Kahn's algorithm — level-by-level to produce execution groups
  const groups: ExecutionGroup[] = [];
  const remaining = new Map(inDegree);
  let groupIndex = 0;

  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const [id, deg] of remaining) {
      if (deg === 0) ready.push(id);
    }

    if (ready.length === 0) {
      // This shouldn't happen since we validated, but guard against it
      throw new Error("Circular dependency detected during scheduling");
    }

    groups.push({
      groupIndex,
      taskIds: ready,
      parallelizable: ready.length > 1,
    });

    for (const id of ready) {
      remaining.delete(id);
      for (const dep of dependents.get(id)!) {
        if (remaining.has(dep)) {
          remaining.set(dep, remaining.get(dep)! - 1);
        }
      }
    }

    groupIndex++;
  }

  return groups;
}
