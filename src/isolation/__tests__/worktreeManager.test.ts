import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import {
  createWorktree,
  commitPhase,
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
      expect(second.error).toBeDefined();

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
  });
});
