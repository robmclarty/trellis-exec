import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTrajectoryLogger } from "../trajectoryLogger.js";
import type { TrajectoryEvent } from "../../types/agents.js";

let tmpDir: string;

function makeEvent(): Omit<TrajectoryEvent, "timestamp"> {
  return {
    phaseId: "phase-1",
    turnNumber: 1,
    type: "repl_exec",
    input: "readFile('src/index.ts')",
    output: "file contents",
    duration: 45,
  };
}

describe("trajectoryLogger", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "traj-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("append writes one JSON line per call", () => {
    const logPath = join(tmpDir, "trajectory.jsonl");
    const logger = createTrajectoryLogger(logPath);

    logger.append(makeEvent());
    logger.close();

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.phaseId).toBe("phase-1");
    expect(parsed.type).toBe("repl_exec");
  });

  it("append includes timestamp automatically", () => {
    const logPath = join(tmpDir, "trajectory.jsonl");
    const logger = createTrajectoryLogger(logPath);

    const before = new Date().toISOString();
    logger.append(makeEvent());
    const after = new Date().toISOString();
    logger.close();

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const parsed = JSON.parse(lines[0]!);

    expect(parsed.timestamp).toBeTruthy();
    expect(parsed.timestamp >= before).toBe(true);
    expect(parsed.timestamp <= after).toBe(true);
  });

  it("multiple appends produce valid JSONL", () => {
    const logPath = join(tmpDir, "trajectory.jsonl");
    const logger = createTrajectoryLogger(logPath);

    logger.append(makeEvent());
    logger.append({ ...makeEvent(), turnNumber: 2, type: "check_run" });
    logger.append({ ...makeEvent(), turnNumber: 3, type: "judge_invoke" });
    logger.close();

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);

    // Each line should be valid JSON
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries[0]?.turnNumber).toBe(1);
    expect(entries[1]?.turnNumber).toBe(2);
    expect(entries[2]?.turnNumber).toBe(3);
    expect(entries[1]?.type).toBe("check_run");
    expect(entries[2]?.type).toBe("judge_invoke");
  });

  it("close prevents further writes", () => {
    const logPath = join(tmpDir, "trajectory.jsonl");
    const logger = createTrajectoryLogger(logPath);

    logger.append(makeEvent());
    logger.close();

    expect(() => logger.append(makeEvent())).toThrow(/closed/);
  });
});
