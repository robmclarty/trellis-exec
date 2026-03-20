import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(lines.length, 1);

    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.phaseId, "phase-1");
    assert.equal(parsed.type, "repl_exec");
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

    assert.ok(parsed.timestamp);
    assert.ok(parsed.timestamp >= before);
    assert.ok(parsed.timestamp <= after);
  });

  it("multiple appends produce valid JSONL", () => {
    const logPath = join(tmpDir, "trajectory.jsonl");
    const logger = createTrajectoryLogger(logPath);

    logger.append(makeEvent());
    logger.append({ ...makeEvent(), turnNumber: 2, type: "check_run" });
    logger.append({ ...makeEvent(), turnNumber: 3, type: "judge_invoke" });
    logger.close();

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    assert.equal(lines.length, 3);

    // Each line should be valid JSON
    const entries = lines.map((line) => JSON.parse(line));
    assert.equal(entries[0]?.turnNumber, 1);
    assert.equal(entries[1]?.turnNumber, 2);
    assert.equal(entries[2]?.turnNumber, 3);
    assert.equal(entries[1]?.type, "check_run");
    assert.equal(entries[2]?.type, "judge_invoke");
  });

  it("close prevents further writes", () => {
    const logPath = join(tmpDir, "trajectory.jsonl");
    const logger = createTrajectoryLogger(logPath);

    logger.append(makeEvent());
    logger.close();

    assert.throws(() => logger.append(makeEvent()), /closed/);
  });
});
