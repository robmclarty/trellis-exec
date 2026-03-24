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
//# sourceMappingURL=git.d.ts.map