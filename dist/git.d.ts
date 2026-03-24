export type ChangedFile = {
    path: string;
    status: "A" | "M" | "D" | "R" | (string & {});
};
/**
 * Returns the list of files changed relative to HEAD.
 *
 * `git diff --name-status HEAD` captures what changed since the last commit.
 * Also includes untracked files (status "?").
 *
 * @param cwd - Working directory (project root)
 * @returns Array of changed files with their git status letter
 */
export declare function getChangedFiles(cwd: string): ChangedFile[];
/**
 * Returns the full unified diff relative to HEAD.
 *
 * @param cwd - Working directory (project root)
 * @returns The unified diff string, or empty string on failure
 */
export declare function getDiffContent(cwd: string): string;
/**
 * Returns the current HEAD SHA, or null if the repo has no commits.
 */
export declare function getCurrentSha(cwd: string): string | null;
/**
 * Ensures the repo has at least one commit. If HEAD doesn't exist,
 * creates an empty initial commit. Returns the HEAD SHA.
 */
export declare function ensureInitialCommit(cwd: string): string;
/**
 * Stages all changes and commits with the given message.
 * Returns the new commit SHA, or null if there was nothing to commit.
 */
export declare function commitAll(cwd: string, message: string): string | null;
/**
 * Returns files changed between a base SHA and HEAD, plus untracked files.
 * Used by the judge to see all changes in a phase (including per-task commits).
 */
export declare function getChangedFilesRange(cwd: string, fromSha: string): ChangedFile[];
/**
 * Returns the unified diff covering all changes since fromSha,
 * including both committed changes (fromSha..HEAD) and any
 * uncommitted changes in the working tree.
 */
export declare function getDiffContentRange(cwd: string, fromSha: string): string;
//# sourceMappingURL=git.d.ts.map