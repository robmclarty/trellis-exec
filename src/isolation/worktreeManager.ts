import { execFileSync } from "node:child_process";
import path, { resolve } from "node:path";

export type WorktreeConfig = {
  projectRoot: string;
  branchName?: string;
  specName?: string;
};

export type WorktreeResult = {
  success: boolean;
  worktreePath: string;
  branchName: string;
  error?: string;
};

export type MergeConfig = {
  projectRoot: string;
  worktreePath: string;
  branchName: string;
};

export type MergeResult = {
  success: boolean;
  error?: string;
};

/**
 * Generates a compact ISO timestamp suitable for branch names.
 * @returns Timestamp string like "20260319T1423"
 */
function compactTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${y}${mo}${d}T${h}${mi}`;
}

/**
 * Converts a branch name into a filesystem-safe directory name.
 * @param branchName - The git branch name
 * @returns A slug safe for use as a directory name
 */
function branchToSlug(branchName: string): string {
  return branchName.replace(/\//g, "-");
}

/**
 * Creates a git worktree branched off the current HEAD.
 *
 * Verifies the project root is a git repository, generates a deterministic
 * branch name, and creates the worktree. Never force-deletes branches or
 * stashes changes.
 *
 * @param config - Worktree configuration
 * @param config.projectRoot - Absolute path to the git repository
 * @param config.branchName - Optional explicit branch name
 * @param config.specName - Used in the default branch name if provided
 * @returns Result with the worktree path and branch name, or an error
 */
export function createWorktree(config: WorktreeConfig): WorktreeResult {
  const { projectRoot } = config;
  const branch =
    config.branchName ??
    `trellis-exec/${config.specName ?? "run"}/${compactTimestamp()}`;
  const slug = branchToSlug(branch);
  const worktreePath = path.join(projectRoot, ".trellis-worktrees", slug);

  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    return { success: false, worktreePath: "", branchName: branch, error: "Not a git repository" };
  }

  try {
    execFileSync("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, worktreePath: "", branchName: branch, error: message };
  }

  return { success: true, worktreePath, branchName: branch };
}

/**
 * Stages all changes and commits them in a worktree.
 *
 * @param worktreePath - Absolute path to the worktree directory
 * @param phaseId - Phase identifier used in the default commit message
 * @param message - Optional custom commit message
 * @returns True if a commit was created, false if there was nothing to commit
 */
export function commitPhase(
  worktreePath: string,
  phaseId: string,
  message?: string,
): boolean {
  const commitMessage = message ?? `trellis-exec: complete ${phaseId}`;

  try {
    execFileSync("git", ["add", "-A"], { cwd: worktreePath, encoding: "utf-8", stdio: "pipe" });
  } catch {
    return false;
  }

  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd: worktreePath,
      encoding: "utf-8",
      stdio: "pipe",
    });
    // Exit 0 means no staged changes
    return false;
  } catch {
    // Exit non-zero means there are staged changes — proceed to commit
  }

  try {
    execFileSync("git", ["commit", "-m", commitMessage], {
      cwd: worktreePath,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Merges the worktree branch back into the current branch of the project root.
 *
 * @param config - Merge configuration
 * @param config.projectRoot - Absolute path to the original repository
 * @param config.worktreePath - Absolute path to the worktree (unused but kept for context)
 * @param config.branchName - The branch to merge
 * @returns Result indicating success or failure with an error message
 */
export function mergeWorktree(config: MergeConfig): MergeResult {
  const { projectRoot, branchName } = config;

  try {
    execFileSync("git", ["merge", branchName, "--no-edit"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Removes a git worktree. Silently ignores errors if the worktree
 * has already been removed.
 *
 * @param worktreePath - Absolute path to the worktree to remove
 */
export function cleanupWorktree(worktreePath: string): void {
  // Derive project root: worktreePath is always <projectRoot>/.trellis-worktrees/<slug>
  const projectRoot = resolve(worktreePath, "..", "..");
  try {
    execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    // Silently ignore — worktree may already be gone
  }
}
