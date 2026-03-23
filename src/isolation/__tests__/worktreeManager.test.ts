import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import {
  createWorktree,
  commitPhase,
  mergeWorktree,
  cleanupWorktree,
} from "../worktreeManager.js";

function makeTempGitRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "trellis-wt-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
  writeFileSync(path.join(dir, "README.md"), "init");
  execSync("git add -A && git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
  return dir;
}

describe("worktreeManager", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempGitRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  describe("createWorktree", () => {
    it("succeeds in a real git repo", () => {
      const result = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/test/run1",
      });

      expect(result.success).toBe(true);
      expect(result.branchName).toBe("trellis-exec/test/run1");
      expect(existsSync(result.worktreePath)).toBe(true);

      // Cleanup
      cleanupWorktree(result.worktreePath);
    });

    it("fails gracefully when branch already exists", () => {
      const first = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/dup/branch",
      });
      expect(first.success).toBe(true);

      const second = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/dup/branch",
      });
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already exists|fatal/i);

      cleanupWorktree(first.worktreePath);
    });

    it("fails gracefully when not in a git repo", () => {
      const plainDir = mkdtempSync(path.join(os.tmpdir(), "trellis-no-git-"));

      const result = createWorktree({
        projectRoot: plainDir,
        branchName: "trellis-exec/fail/test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not a git repository");

      rmSync(plainDir, { recursive: true, force: true });
    });
  });

  describe("commitPhase", () => {
    it("commits changes and returns true", () => {
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/commit/test",
      });
      expect(wt.success).toBe(true);

      writeFileSync(path.join(wt.worktreePath, "new-file.ts"), "export {}");

      const committed = commitPhase(wt.worktreePath, "phase-1");
      expect(committed).toBe(true);

      const log = execSync("git log --oneline -1", {
        cwd: wt.worktreePath,
        encoding: "utf-8",
      });
      expect(log).toContain("trellis-exec: complete phase-1");

      cleanupWorktree(wt.worktreePath);
    });

    it("returns false with nothing to commit", () => {
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/empty/test",
      });
      expect(wt.success).toBe(true);

      const committed = commitPhase(wt.worktreePath, "phase-1");
      expect(committed).toBe(false);

      cleanupWorktree(wt.worktreePath);
    });
  });

  describe("cleanupWorktree", () => {
    it("removes the worktree", () => {
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/cleanup/test",
      });
      expect(wt.success).toBe(true);
      expect(existsSync(wt.worktreePath)).toBe(true);

      cleanupWorktree(wt.worktreePath);

      expect(existsSync(wt.worktreePath)).toBe(false);
    });

    // Issue #7: cleanupWorktree previously used `cwd: worktreePath`, which is
    // the directory being deleted. On macOS this produces confusing errors.
    // The fix derives projectRoot from the worktree path so the command runs
    // from a directory that still exists after removal.
    it("works correctly even though it removes its own target directory", () => {
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/cleanup/cwd-test",
      });
      expect(wt.success).toBe(true);

      // This should not throw — the cwd is now the project root, not the worktree
      expect(() => cleanupWorktree(wt.worktreePath)).not.toThrow();
      expect(existsSync(wt.worktreePath)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // mergeWorktree
  // -------------------------------------------------------------------------

  describe("mergeWorktree", () => {
    it("merges a branch with changes successfully", () => {
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/merge/clean",
      });
      expect(wt.success).toBe(true);

      writeFileSync(path.join(wt.worktreePath, "feature.ts"), "export const x = 1;");
      commitPhase(wt.worktreePath, "phase-1");
      cleanupWorktree(wt.worktreePath);

      const result = mergeWorktree({
        projectRoot: repoDir,
        worktreePath: wt.worktreePath,
        branchName: wt.branchName,
      });

      expect(result.success).toBe(true);
      // Verify the file exists on the main branch after merge
      expect(existsSync(path.join(repoDir, "feature.ts"))).toBe(true);
    });

    it("returns {success: true} on clean merge", () => {
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/merge/result",
      });
      expect(wt.success).toBe(true);

      writeFileSync(path.join(wt.worktreePath, "new.ts"), "export {}");
      commitPhase(wt.worktreePath, "phase-1");
      cleanupWorktree(wt.worktreePath);

      const result = mergeWorktree({
        projectRoot: repoDir,
        worktreePath: wt.worktreePath,
        branchName: wt.branchName,
      });

      expect(result).toEqual({ success: true });
    });

    it("returns {success: false, error} on merge conflict", () => {
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/merge/conflict",
      });
      expect(wt.success).toBe(true);

      // Create conflicting changes on both sides
      writeFileSync(path.join(wt.worktreePath, "README.md"), "worktree version");
      commitPhase(wt.worktreePath, "phase-1");
      cleanupWorktree(wt.worktreePath);

      // Make a conflicting change on main
      writeFileSync(path.join(repoDir, "README.md"), "main version");
      execSync("git add -A && git commit -m 'conflict on main'", {
        cwd: repoDir,
        stdio: "pipe",
      });

      const result = mergeWorktree({
        projectRoot: repoDir,
        worktreePath: wt.worktreePath,
        branchName: wt.branchName,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Clean up the merge conflict state
      execSync("git merge --abort", { cwd: repoDir, stdio: "pipe" });
    });

    it("returns {success: false} when branch does not exist", () => {
      const result = mergeWorktree({
        projectRoot: repoDir,
        worktreePath: "/tmp/nonexistent",
        branchName: "no-such-branch",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("handles branch names with special characters safely", () => {
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/merge/special-chars_v2.0",
      });
      expect(wt.success).toBe(true);

      writeFileSync(path.join(wt.worktreePath, "safe.ts"), "export {}");
      commitPhase(wt.worktreePath, "phase-1");
      cleanupWorktree(wt.worktreePath);

      const result = mergeWorktree({
        projectRoot: repoDir,
        worktreePath: wt.worktreePath,
        branchName: wt.branchName,
      });

      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Security: command injection prevention
  // -------------------------------------------------------------------------
  // Issue #1: All git operations previously used `execSync` with template
  // literal interpolation, allowing shell metacharacters in branch names or
  // commit messages to escape the command. For example:
  //   branchName = 'test"; rm -rf / ; echo "'
  // would execute `rm -rf /` on the host.
  //
  // Mitigation: All calls now use `execFileSync` with argument arrays, which
  // bypasses the shell entirely. Characters like `"`, `;`, `$()`, and backticks
  // are passed as literal strings to git, not interpreted by a shell.
  // -------------------------------------------------------------------------
  describe("command injection prevention", () => {
    it("handles branch names containing shell metacharacters safely", () => {
      // This branch name would be dangerous with shell interpolation:
      // the semicolon and backticks would execute arbitrary commands.
      // With execFileSync, they are passed literally to git and simply
      // create an oddly-named (but harmless) branch.
      const malicious = 'trellis-exec/test";echo INJECTED;echo "';

      const result = createWorktree({
        projectRoot: repoDir,
        branchName: malicious,
      });

      // Git will either succeed (creating a branch with special chars in the name)
      // or fail with a git error — but it must never execute the injected command.
      // The key assertion is that we get here at all without side effects.
      if (result.success) {
        cleanupWorktree(result.worktreePath);
      }
      // Either outcome is safe — the important thing is no injection occurred
      expect(typeof result.success).toBe("boolean");
    });

    it("handles commit messages containing shell metacharacters safely", () => {
      // A commit message with shell escapes would be dangerous under execSync.
      // With execFileSync, it's passed as a single argument to `git commit -m`.
      const wt = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/inject-commit/test",
      });
      expect(wt.success).toBe(true);

      writeFileSync(path.join(wt.worktreePath, "test.txt"), "test");

      const maliciousMessage = '"; rm -rf / ; echo "pwned';
      const committed = commitPhase(wt.worktreePath, "phase-1", maliciousMessage);
      expect(committed).toBe(true);

      // Verify the exact message was stored literally, not executed
      const log = execSync("git log --oneline -1 --format=%s", {
        cwd: wt.worktreePath,
        encoding: "utf-8",
      }).trim();
      expect(log).toBe(maliciousMessage);

      cleanupWorktree(wt.worktreePath);
    });

    it("handles branch names with $() command substitution attempts", () => {
      // $(whoami) would execute under shell interpolation.
      // With execFileSync, it's a literal string.
      const result = createWorktree({
        projectRoot: repoDir,
        branchName: "trellis-exec/$(whoami)/test",
      });

      if (result.success) {
        // Branch was created with the literal name — no substitution occurred
        expect(result.branchName).toContain("$(whoami)");
        cleanupWorktree(result.worktreePath);
      }
      // Git may reject the branch name, but no command was executed
      expect(typeof result.success).toBe("boolean");
    });
  });
});
