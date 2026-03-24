import { execFileSync } from "node:child_process";

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
export function getChangedFiles(cwd: string): ChangedFile[] {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-status", "HEAD"],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    );
    const files = output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        return { path: rest.join("\t"), status: status as ChangedFile["status"] };
      });

    // Include untracked files (new files not yet git-added)
    const untrackedOutput = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    );
    const untrackedFiles = untrackedOutput
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((filePath) => ({ path: filePath, status: "?" as ChangedFile["status"] }));

    return [...files, ...untrackedFiles];
  } catch {
    return [];
  }
}

/**
 * Returns the full unified diff relative to HEAD.
 *
 * @param cwd - Working directory (project root)
 * @returns The unified diff string, or empty string on failure
 */
export function getDiffContent(cwd: string): string {
  try {
    // Stage untracked files as intent-to-add so they appear in the diff
    execFileSync(
      "git",
      ["add", "--intent-to-add", "--all"],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    );
    return execFileSync(
      "git",
      ["diff", "HEAD"],
      { cwd, encoding: "utf-8", stdio: "pipe", maxBuffer: 10 * 1024 * 1024 },
    );
  } catch {
    return "";
  }
}

/**
 * Returns the current HEAD SHA, or null if the repo has no commits.
 */
export function getCurrentSha(cwd: string): string | null {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Ensures the repo has at least one commit. If HEAD doesn't exist,
 * creates an empty initial commit. Returns the HEAD SHA.
 */
export function ensureInitialCommit(cwd: string): string {
  const sha = getCurrentSha(cwd);
  if (sha) return sha;

  execFileSync(
    "git",
    ["commit", "--allow-empty", "-m", "chore: initial commit (trellis)"],
    { cwd, encoding: "utf-8", stdio: "pipe" },
  );
  return execFileSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd, encoding: "utf-8", stdio: "pipe" },
  ).trim();
}

/**
 * Stages all changes and commits with the given message.
 * Returns the new commit SHA, or null if there was nothing to commit.
 */
export function commitAll(cwd: string, message: string): string | null {
  try {
    execFileSync(
      "git",
      ["add", "-A"],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    );
    execFileSync(
      "git",
      ["commit", "-m", message],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    );
    return execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Returns files changed between a base SHA and HEAD, plus untracked files.
 * Used by the judge to see all changes in a phase (including per-task commits).
 */
export function getChangedFilesRange(cwd: string, fromSha: string): ChangedFile[] {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-status", `${fromSha}..HEAD`],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    );
    const files = output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        return { path: rest.join("\t"), status: status as ChangedFile["status"] };
      });

    // Include untracked files (new files not yet git-added)
    const untrackedOutput = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    );
    const untrackedFiles = untrackedOutput
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((filePath) => ({ path: filePath, status: "?" as ChangedFile["status"] }));

    return [...files, ...untrackedFiles];
  } catch {
    return getChangedFiles(cwd);
  }
}

/**
 * Returns the unified diff covering all changes since fromSha,
 * including both committed changes (fromSha..HEAD) and any
 * uncommitted changes in the working tree.
 */
export function getDiffContentRange(cwd: string, fromSha: string): string {
  try {
    // Committed changes since the phase started
    const committedDiff = execFileSync(
      "git",
      ["diff", `${fromSha}..HEAD`],
      { cwd, encoding: "utf-8", stdio: "pipe", maxBuffer: 10 * 1024 * 1024 },
    );

    // Uncommitted changes (working tree vs HEAD)
    execFileSync(
      "git",
      ["add", "--intent-to-add", "--all"],
      { cwd, encoding: "utf-8", stdio: "pipe" },
    );
    const uncommittedDiff = execFileSync(
      "git",
      ["diff", "HEAD"],
      { cwd, encoding: "utf-8", stdio: "pipe", maxBuffer: 10 * 1024 * 1024 },
    );

    if (committedDiff && uncommittedDiff) {
      return committedDiff + "\n" + uncommittedDiff;
    }
    return committedDiff || uncommittedDiff;
  } catch {
    return getDiffContent(cwd);
  }
}
