import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Phase } from "../types/tasks.js";
import type { PhaseReport } from "../types/state.js";
import { getChangedFiles } from "../git.js";

export type CompletionVerification = {
  passed: boolean;
  failures: string[];
};

const TODO_PATTERN = /\b(TODO|FIXME|HACK)\b/;

/**
 * Lightweight deterministic verification after judge corrections are applied.
 * Catches lazy-completion patterns (missing files, leftover TODOs).
 *
 * Target path mismatches (e.g., .css vs .module.css, .js vs .jsx) are handled
 * upstream by the judge's corrections mechanism, which updates tasks.json
 * before this function runs. No extension-variant guessing needed here.
 */
export function verifyCompletion(
  projectRoot: string,
  phase: Phase,
  report: PhaseReport,
  startSha?: string,
): CompletionVerification {
  const failures: string[] = [];

  // 1. Target path existence: completed tasks must have their targetPaths on disk
  let totalTargetPaths = 0;
  let missingTargetPaths = 0;
  for (const task of phase.tasks) {
    if (!report.tasksCompleted.includes(task.id)) continue;
    for (const targetPath of task.targetPaths) {
      totalTargetPaths++;
      if (!existsSync(resolve(projectRoot, targetPath))) {
        missingTargetPaths++;
        failures.push(
          `[${task.id}] target path missing: ${targetPath}`,
        );
      }
    }
  }

  // If ALL target paths are missing, this is almost certainly a projectRoot
  // misconfiguration rather than individual files not being created.
  // Replace per-file failures with a single diagnostic to prevent corrective
  // task snowball on retries.
  if (totalTargetPaths > 0 && missingTargetPaths === totalTargetPaths) {
    return {
      passed: false,
      failures: [
        `All ${totalTargetPaths} target paths missing — projectRoot may be misconfigured (resolved to: ${resolve(projectRoot)})`,
      ],
    };
  }

  // 2. TODO/FIXME/HACK scan on newly added files
  if (startSha) {
    const changedFiles = getChangedFiles(projectRoot, startSha);
    for (const file of changedFiles) {
      if (file.status !== "A") continue;
      try {
        const content = readFileSync(resolve(projectRoot, file.path), "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const match = line.match(TODO_PATTERN);
          if (match) {
            failures.push(
              `[${file.path}:${i + 1}] contains ${match[0]}`,
            );
          }
        }
      } catch {
        // File unreadable (binary, deleted race) — skip
      }
    }
  }

  return { passed: failures.length === 0, failures };
}
