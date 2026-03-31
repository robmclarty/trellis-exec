/**
 * Returns the absolute path of the git repository root for the given directory,
 * or null if the directory is not inside a git repository.
 */
export declare function getGitRoot(cwd: string): string | null;
export type ChangedFile = {
    path: string;
    status: "A" | "M" | "D" | "R" | (string & {});
};
/**
 * Returns the list of files changed relative to HEAD (or since `fromSha` if provided).
 *
 * Also includes untracked files (status "?").
 *
 * @param cwd - Working directory (project root)
 * @param fromSha - Optional base SHA; when provided uses `fromSha..HEAD` range
 * @returns Array of changed files with their git status letter
 */
export declare function getChangedFiles(cwd: string, fromSha?: string): ChangedFile[];
/**
 * Returns the full unified diff relative to HEAD (or since `fromSha` if provided).
 *
 * When `fromSha` is supplied, returns committed changes (`fromSha..HEAD`) plus
 * any uncommitted working-tree changes concatenated together.
 *
 * @param cwd - Working directory (project root)
 * @param fromSha - Optional base SHA; when provided includes committed + uncommitted diffs
 * @returns The unified diff string, or empty string on failure
 */
export declare function getDiffContent(cwd: string, fromSha?: string): string;
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
 * Creates a lightweight git tag. Returns true on success, false on failure
 * (e.g. tag already exists or not a git repo).
 */
export declare function createTag(cwd: string, tagName: string): boolean;
//# sourceMappingURL=git.d.ts.map