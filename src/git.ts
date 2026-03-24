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
