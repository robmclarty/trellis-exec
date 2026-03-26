import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getChangedFilesRange } from "../git.js";
const TODO_PATTERN = /\b(TODO|FIXME|HACK)\b/;
/**
 * Lightweight deterministic verification after orchestrator reports "complete."
 * Catches lazy-completion patterns before the expensive judge invocation.
 */
export function verifyCompletion(projectRoot, phase, report, startSha) {
    const failures = [];
    // 1. Target path existence: completed tasks must have their targetPaths on disk
    let totalTargetPaths = 0;
    let missingTargetPaths = 0;
    for (const task of phase.tasks) {
        if (!report.tasksCompleted.includes(task.id))
            continue;
        for (const targetPath of task.targetPaths) {
            totalTargetPaths++;
            const absPath = resolve(projectRoot, targetPath);
            if (!existsSync(absPath)) {
                missingTargetPaths++;
                failures.push(`[${task.id}] target path missing: ${targetPath}`);
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
        const changedFiles = getChangedFilesRange(projectRoot, startSha);
        for (const file of changedFiles) {
            if (file.status !== "A")
                continue;
            try {
                const content = readFileSync(resolve(projectRoot, file.path), "utf-8");
                const lines = content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const match = line.match(TODO_PATTERN);
                    if (match) {
                        failures.push(`[${file.path}:${i + 1}] contains ${match[0]}`);
                    }
                }
            }
            catch {
                // File unreadable (binary, deleted race) — skip
            }
        }
    }
    return { passed: failures.length === 0, failures };
}
//# sourceMappingURL=completionVerifier.js.map