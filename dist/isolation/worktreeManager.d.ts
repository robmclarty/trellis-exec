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
export declare function createWorktree(config: WorktreeConfig): WorktreeResult;
/**
 * Stages all changes and commits them in a worktree.
 *
 * @param worktreePath - Absolute path to the worktree directory
 * @param phaseId - Phase identifier used in the default commit message
 * @param message - Optional custom commit message
 * @returns True if a commit was created, false if there was nothing to commit
 */
export declare function commitPhase(worktreePath: string, phaseId: string, message?: string): boolean;
/**
 * Merges the worktree branch back into the current branch of the project root.
 *
 * @param config - Merge configuration
 * @param config.projectRoot - Absolute path to the original repository
 * @param config.worktreePath - Absolute path to the worktree (unused but kept for context)
 * @param config.branchName - The branch to merge
 * @returns Result indicating success or failure with an error message
 */
export declare function mergeWorktree(config: MergeConfig): MergeResult;
/**
 * Removes a git worktree. Silently ignores errors if the worktree
 * has already been removed.
 *
 * @param worktreePath - Absolute path to the worktree to remove
 */
export declare function cleanupWorktree(worktreePath: string): void;
//# sourceMappingURL=worktreeManager.d.ts.map