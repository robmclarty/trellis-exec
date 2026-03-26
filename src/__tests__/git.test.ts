import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  getGitRoot,
  getCurrentSha,
  ensureInitialCommit,
  commitAll,
  getChangedFiles,
  getChangedFilesRange,
  getDiffContent,
  getDiffContentRange,
} from "../git.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

function initRepo(cwd: string): void {
  git(cwd, "init");
  git(cwd, "config", "user.email", "test@test.com");
  git(cwd, "config", "user.name", "Test");
}

let tmpDir: string;

describe("git utilities", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "git-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getGitRoot", () => {
    it("returns the repository root for a git repo", () => {
      initRepo(tmpDir);
      const root = getGitRoot(tmpDir);
      // git returns the realpath (resolves symlinks like /tmp -> /private/tmp on macOS)
      expect(root).toBe(realpathSync(tmpDir));
    });

    it("returns the repo root from a subdirectory", () => {
      initRepo(tmpDir);
      const sub = join(tmpDir, "a", "b");
      execFileSync("mkdir", ["-p", sub]);
      const root = getGitRoot(sub);
      expect(root).toBe(realpathSync(tmpDir));
    });

    it("returns null for a non-git directory", () => {
      const nonGit = mkdtempSync(join(tmpdir(), "no-git-"));
      try {
        expect(getGitRoot(nonGit)).toBeNull();
      } finally {
        rmSync(nonGit, { recursive: true, force: true });
      }
    });
  });

  describe("getCurrentSha", () => {
    it("returns null for a repo with no commits", () => {
      initRepo(tmpDir);
      expect(getCurrentSha(tmpDir)).toBeNull();
    });

    it("returns the HEAD SHA after a commit", () => {
      initRepo(tmpDir);
      writeFileSync(join(tmpDir, "file.txt"), "hello");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "init");

      const sha = getCurrentSha(tmpDir);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("ensureInitialCommit", () => {
    it("creates an initial commit if none exists", () => {
      initRepo(tmpDir);
      const sha = ensureInitialCommit(tmpDir);

      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      // Verify commit exists
      const log = git(tmpDir, "log", "--oneline");
      expect(log).toContain("initial commit (trellis)");
    });

    it("returns existing HEAD if commits already exist", () => {
      initRepo(tmpDir);
      writeFileSync(join(tmpDir, "file.txt"), "hello");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "existing");

      const existingSha = git(tmpDir, "rev-parse", "HEAD");
      const sha = ensureInitialCommit(tmpDir);
      expect(sha).toBe(existingSha);
    });
  });

  describe("commitAll", () => {
    it("stages and commits all changes, returns new SHA", () => {
      initRepo(tmpDir);
      git(tmpDir, "commit", "--allow-empty", "-m", "init");

      writeFileSync(join(tmpDir, "new.txt"), "content");
      const sha = commitAll(tmpDir, "feat: add new file");

      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      const log = git(tmpDir, "log", "--oneline");
      expect(log).toContain("feat: add new file");
    });

    it("returns null when there is nothing to commit", () => {
      initRepo(tmpDir);
      git(tmpDir, "commit", "--allow-empty", "-m", "init");

      const sha = commitAll(tmpDir, "feat: empty");
      expect(sha).toBeNull();
    });

    it("handles multiline commit messages", () => {
      initRepo(tmpDir);
      git(tmpDir, "commit", "--allow-empty", "-m", "init");

      writeFileSync(join(tmpDir, "file.txt"), "data");
      const message = "feat(auth): add login\n\n- Created form\n- Added validation";
      const sha = commitAll(tmpDir, message);

      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      const log = git(tmpDir, "log", "-1", "--format=%B");
      expect(log).toContain("feat(auth): add login");
      expect(log).toContain("- Created form");
    });
  });

  describe("getChangedFilesRange", () => {
    it("returns files changed between two commits plus untracked", () => {
      initRepo(tmpDir);
      writeFileSync(join(tmpDir, "base.txt"), "base");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "init");
      const baseSha = git(tmpDir, "rev-parse", "HEAD");

      // Create committed changes
      writeFileSync(join(tmpDir, "committed.txt"), "committed");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "add committed file");

      // Create untracked file
      writeFileSync(join(tmpDir, "untracked.txt"), "untracked");

      const files = getChangedFilesRange(tmpDir, baseSha);
      const paths = files.map((f) => f.path);

      expect(paths).toContain("committed.txt");
      expect(paths).toContain("untracked.txt");
      expect(paths).not.toContain("base.txt");
    });

    it("returns empty when nothing changed since base", () => {
      initRepo(tmpDir);
      writeFileSync(join(tmpDir, "file.txt"), "data");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "init");
      const sha = git(tmpDir, "rev-parse", "HEAD");

      const files = getChangedFilesRange(tmpDir, sha);
      expect(files).toEqual([]);
    });
  });

  describe("getDiffContentRange", () => {
    it("includes both committed and uncommitted diffs", () => {
      initRepo(tmpDir);
      writeFileSync(join(tmpDir, "file.txt"), "original");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "init");
      const baseSha = git(tmpDir, "rev-parse", "HEAD");

      // Committed change
      writeFileSync(join(tmpDir, "file.txt"), "modified");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "modify");

      // Uncommitted change
      writeFileSync(join(tmpDir, "new.txt"), "new content");

      const diff = getDiffContentRange(tmpDir, baseSha);
      expect(diff).toContain("modified");
      expect(diff).toContain("new content");
    });

    it("returns committed diff even when working tree is clean", () => {
      initRepo(tmpDir);
      writeFileSync(join(tmpDir, "file.txt"), "original");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "init");
      const baseSha = git(tmpDir, "rev-parse", "HEAD");

      writeFileSync(join(tmpDir, "file.txt"), "changed");
      git(tmpDir, "add", "-A");
      git(tmpDir, "commit", "-m", "change");

      const diff = getDiffContentRange(tmpDir, baseSha);
      expect(diff).toContain("changed");
    });
  });

  describe("getChangedFiles (existing)", () => {
    it("returns untracked files", () => {
      initRepo(tmpDir);
      git(tmpDir, "commit", "--allow-empty", "-m", "init");
      writeFileSync(join(tmpDir, "new.txt"), "content");

      const files = getChangedFiles(tmpDir);
      expect(files).toEqual([{ path: "new.txt", status: "?" }]);
    });
  });

  describe("getDiffContent (existing)", () => {
    it("includes untracked files via intent-to-add", () => {
      initRepo(tmpDir);
      git(tmpDir, "commit", "--allow-empty", "-m", "init");
      writeFileSync(join(tmpDir, "new.txt"), "hello");

      const diff = getDiffContent(tmpDir);
      expect(diff).toContain("hello");
    });
  });
});
