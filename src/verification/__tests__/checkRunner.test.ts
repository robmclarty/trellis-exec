import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createCheckRunner } from "../checkRunner.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "trellis-check-test-"));
}

describe("checkRunner", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns passed: true for a passing command", async () => {
    const runner = createCheckRunner({ command: "echo ok", cwd: tmpDir });
    const result = await runner.run();

    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("ok");
  });

  it("returns passed: false for a failing command", async () => {
    const runner = createCheckRunner({ command: "exit 1", cwd: tmpDir });
    const result = await runner.run();

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("captures stdout and stderr in output", async () => {
    const runner = createCheckRunner({
      command: 'echo stdout-msg && echo stderr-msg >&2',
      cwd: tmpDir,
    });
    const result = await runner.run();

    expect(result.passed).toBe(true);
    expect(result.output).toContain("stdout-msg");
    expect(result.output).toContain("stderr-msg");
  });

  it("returns passed: false with timeout message on timeout", async () => {
    const runner = createCheckRunner({
      command: "sleep 10",
      cwd: tmpDir,
      timeout: 100,
    });
    const result = await runner.run();

    expect(result.passed).toBe(false);
    expect(result.output).toContain("timed out");
  });
});
