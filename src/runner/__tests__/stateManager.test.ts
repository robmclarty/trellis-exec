import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TasksJson } from "../../types/tasks.js";
import type { PhaseReport } from "../../types/state.js";
import {
  initState,
  loadState,
  saveState,
  updateStateAfterPhase,
  updateTaskStatus,
} from "../stateManager.js";

function makeTasksJson(): TasksJson {
  return {
    specRef: "./spec.md",
    planRef: "./plan.md",
    createdAt: "2026-03-17T00:00:00Z",
    phases: [
      {
        id: "phase-1",
        name: "scaffolding",
        description: "Set up project",
        tasks: [
          {
            id: "task-1-1",
            title: "Init project",
            description: "Initialize the project",
            dependsOn: [],
            specSections: ["§1"],
            targetPaths: ["package.json"],
            acceptanceCriteria: ["npm install exits 0"],
            subAgentType: "implement",
            status: "pending",
          },
        ],
      },
      {
        id: "phase-2",
        name: "implementation",
        description: "Build features",
        tasks: [
          {
            id: "task-2-1",
            title: "Build feature",
            description: "Implement the feature",
            dependsOn: [],
            specSections: ["§2"],
            targetPaths: ["src/index.ts"],
            acceptanceCriteria: ["tsc --noEmit exits 0"],
            subAgentType: "implement",
            status: "pending",
          },
        ],
      },
    ],
  };
}

function makePhaseReport(phaseId: string): PhaseReport {
  return {
    phaseId,
    status: "complete",
    summary: "Phase completed successfully",
    tasksCompleted: ["task-1-1"],
    tasksFailed: [],
    orchestratorAnalysis: "All good",
    recommendedAction: "advance",
    correctiveTasks: [],
    decisionsLog: [],
    handoff: "# Handoff\nDone.",
  };
}

let tmpDir: string;

describe("stateManager", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "state-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("initState", () => {
    it("creates valid initial state from a minimal TasksJson", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);

      assert.equal(state.currentPhase, "phase-1");
      assert.deepEqual(state.completedPhases, []);
      assert.deepEqual(state.modifiedFiles, []);
      assert.deepEqual(state.schemaChanges, []);
      assert.deepEqual(state.phaseReports, []);
      assert.deepEqual(state.phaseRetries, {});
    });

    it("throws if TasksJson has no phases", () => {
      const tasks: TasksJson = {
        specRef: "./spec.md",
        planRef: "./plan.md",
        createdAt: "2026-03-17T00:00:00Z",
        phases: [],
      };

      assert.throws(() => initState(tasks), /at least one phase/);
    });
  });

  describe("saveState + loadState", () => {
    it("round-trips correctly", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const statePath = join(tmpDir, "state.json");

      saveState(statePath, state);
      const loaded = loadState(statePath);

      assert.deepEqual(loaded, state);
    });

    it("atomic write leaves no .tmp file behind", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const statePath = join(tmpDir, "state.json");

      saveState(statePath, state);

      assert.equal(existsSync(`${statePath}.tmp`), false);
      assert.equal(existsSync(statePath), true);
    });

    it("saveState writes valid JSON", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const statePath = join(tmpDir, "state.json");

      saveState(statePath, state);

      const raw = readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      assert.equal(parsed.currentPhase, "phase-1");
    });
  });

  describe("loadState", () => {
    it("returns null for missing file", () => {
      const result = loadState(join(tmpDir, "nonexistent.json"));
      assert.equal(result, null);
    });

    it("throws for malformed JSON", () => {
      const statePath = join(tmpDir, "bad.json");
      writeFileSync(statePath, "not json at all", "utf-8");

      assert.throws(() => loadState(statePath));
    });

    it("throws for invalid schema", () => {
      const statePath = join(tmpDir, "invalid.json");
      writeFileSync(
        statePath,
        JSON.stringify({ currentPhase: 123 }),
        "utf-8",
      );

      assert.throws(() => loadState(statePath));
    });
  });

  describe("updateStateAfterPhase", () => {
    it("advances currentPhase correctly", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const report = makePhaseReport("phase-1");

      const updated = updateStateAfterPhase(state, report, tasks.phases);

      assert.equal(updated.currentPhase, "phase-2");
      assert.deepEqual(updated.completedPhases, ["phase-1"]);
      assert.equal(updated.phaseReports.length, 1);
      assert.equal(updated.phaseReports[0]?.phaseId, "phase-1");
    });

    it("sets currentPhase to empty string when last phase completes", () => {
      const tasks = makeTasksJson();
      let state = initState(tasks);
      state = updateStateAfterPhase(
        state,
        makePhaseReport("phase-1"),
        tasks.phases,
      );

      state = { ...state, currentPhase: "phase-2" };
      state = updateStateAfterPhase(
        state,
        makePhaseReport("phase-2"),
        tasks.phases,
      );

      assert.equal(state.currentPhase, "");
      assert.deepEqual(state.completedPhases, ["phase-1", "phase-2"]);
    });

    it("does not mutate the original state", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const report = makePhaseReport("phase-1");

      const updated = updateStateAfterPhase(state, report, tasks.phases);

      assert.equal(state.currentPhase, "phase-1");
      assert.deepEqual(state.completedPhases, []);
      assert.notEqual(state, updated);
    });
  });

  describe("updateTaskStatus", () => {
    it("updates the correct task status", () => {
      const tasks = makeTasksJson();
      const updated = updateTaskStatus(tasks, "phase-1", "task-1-1", "complete");

      const phase = updated.phases.find((p) => p.id === "phase-1");
      const task = phase?.tasks.find((t) => t.id === "task-1-1");
      assert.equal(task?.status, "complete");
    });

    it("does not mutate the original TasksJson", () => {
      const tasks = makeTasksJson();
      updateTaskStatus(tasks, "phase-1", "task-1-1", "complete");

      const task = tasks.phases[0]?.tasks[0];
      assert.equal(task?.status, "pending");
    });

    it("throws for unknown phase", () => {
      const tasks = makeTasksJson();
      assert.throws(
        () => updateTaskStatus(tasks, "phase-99", "task-1-1", "complete"),
        /Phase not found/,
      );
    });

    it("throws for unknown task", () => {
      const tasks = makeTasksJson();
      assert.throws(
        () => updateTaskStatus(tasks, "phase-1", "task-99", "complete"),
        /Task not found/,
      );
    });
  });
});
