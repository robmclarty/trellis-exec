import { execFileSync } from "node:child_process";
/**
 * Returns the absolute path of the git repository root for the given directory,
 * or null if the directory is not inside a git repository.
 */
export function getGitRoot(cwd) {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
    }
    catch {
        return null;
    }
}
/**
 * Returns the list of files changed relative to HEAD (or since `fromSha` if provided).
 *
 * Also includes untracked files (status "?").
 *
 * @param cwd - Working directory (project root)
 * @param fromSha - Optional base SHA; when provided uses `fromSha..HEAD` range
 * @returns Array of changed files with their git status letter
 */
export function getChangedFiles(cwd, fromSha) {
    try {
        if (fromSha) {
            // Range query: must use git diff + ls-files (two spawns)
            const output = execFileSync("git", ["diff", "--name-status", `${fromSha}..HEAD`], { cwd, encoding: "utf-8", stdio: "pipe" });
            const files = output
                .trim()
                .split("\n")
                .filter((line) => line.length > 0)
                .map((line) => {
                const [status, ...rest] = line.split("\t");
                return { path: rest.join("\t"), status: status };
            });
            const untrackedOutput = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd, encoding: "utf-8", stdio: "pipe" });
            const untrackedFiles = untrackedOutput
                .trim()
                .split("\n")
                .filter((line) => line.length > 0)
                .map((filePath) => ({ path: filePath, status: "?" }));
            return [...files, ...untrackedFiles];
        }
        // No ref range: use single git status --porcelain (one spawn instead of two)
        const output = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8", stdio: "pipe" });
        return output
            .trim()
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => {
            // Porcelain format: XY filename (or XY old -> new for renames)
            const indexStatus = line[0];
            const workTreeStatus = line[1];
            const filePath = line.slice(3);
            // Map porcelain status codes to our ChangedFile status
            if (indexStatus === "?" && workTreeStatus === "?") {
                return { path: filePath, status: "?" };
            }
            if (indexStatus === "A" || workTreeStatus === "A") {
                return { path: filePath, status: "A" };
            }
            if (indexStatus === "D" || workTreeStatus === "D") {
                return { path: filePath, status: "D" };
            }
            if (indexStatus === "R" || workTreeStatus === "R") {
                // Rename: format is "R  old -> new"
                const parts = filePath.split(" -> ");
                return { path: parts[1] ?? filePath, status: "R" };
            }
            return { path: filePath, status: "M" };
        });
    }
    catch {
        if (fromSha)
            return getChangedFiles(cwd);
        return [];
    }
}
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
export function getDiffContent(cwd, fromSha) {
    try {
        // Stage untracked files as intent-to-add so they appear in the diff
        execFileSync("git", ["add", "--intent-to-add", "--all"], { cwd, encoding: "utf-8", stdio: "pipe" });
        if (fromSha) {
            // Committed changes since the base SHA
            const committedDiff = execFileSync("git", ["diff", `${fromSha}..HEAD`], { cwd, encoding: "utf-8", stdio: "pipe", maxBuffer: 10 * 1024 * 1024 });
            // Uncommitted changes (working tree vs HEAD)
            const uncommittedDiff = execFileSync("git", ["diff", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe", maxBuffer: 10 * 1024 * 1024 });
            if (committedDiff && uncommittedDiff) {
                return committedDiff + "\n" + uncommittedDiff;
            }
            return committedDiff || uncommittedDiff;
        }
        return execFileSync("git", ["diff", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe", maxBuffer: 10 * 1024 * 1024 });
    }
    catch {
        // When a range query fails, fall back to plain HEAD diff
        if (fromSha)
            return getDiffContent(cwd);
        return "";
    }
}
/**
 * Returns the current HEAD SHA, or null if the repo has no commits.
 */
export function getCurrentSha(cwd) {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
    }
    catch {
        return null;
    }
}
/**
 * Ensures the repo has at least one commit. If HEAD doesn't exist,
 * creates an empty initial commit. Returns the HEAD SHA.
 */
export function ensureInitialCommit(cwd) {
    const sha = getCurrentSha(cwd);
    if (sha)
        return sha;
    execFileSync("git", ["commit", "--allow-empty", "-m", "chore: initial commit (trellis)"], { cwd, encoding: "utf-8", stdio: "pipe" });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}
/**
 * Stages all changes and commits with the given message.
 * Returns the new commit SHA, or null if there was nothing to commit.
 */
export function commitAll(cwd, message) {
    try {
        execFileSync("git", ["add", "-A"], { cwd, encoding: "utf-8", stdio: "pipe" });
        execFileSync("git", ["commit", "-m", message], { cwd, encoding: "utf-8", stdio: "pipe" });
        return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=git.js.map