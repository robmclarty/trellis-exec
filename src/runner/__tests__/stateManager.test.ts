import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TasksJson, Task } from "../../types/tasks.js";
import type { PhaseReport } from "../../types/state.js";
import {
  initState,
  loadState,
  saveState,
  updateStateAfterPhase,
  updateTaskStatus,
  applyReportToTasks,
  applyCorrections,
  getPhaseCommitRange,
} from "../stateManager.js";

function makeTasksJson(): TasksJson {
  return {
    projectRoot: ".",
    specRef: "./spec.md",
    planRef: "./plan.md",
    createdAt: "2026-03-17T00:00:00Z",
    phases: [
      {
        id: "phase-1",
        name: "scaffolding",
        description: "Set up project",
        requiresBrowserTest: false,
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
        requiresBrowserTest: false,
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

      expect(state.currentPhase).toBe("phase-1");
      expect(state.completedPhases).toEqual([]);
      expect(state.phaseReports).toEqual([]);
      expect(state.phaseRetries).toEqual({});
    });

    it("throws if TasksJson has no phases", () => {
      const tasks: TasksJson = {
        projectRoot: ".",
        specRef: "./spec.md",
        planRef: "./plan.md",
        createdAt: "2026-03-17T00:00:00Z",
        phases: [],
      };

      expect(() => initState(tasks)).toThrow(/at least one phase/);
    });
  });

  describe("saveState + loadState", () => {
    it("round-trips correctly", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const statePath = join(tmpDir, "state.json");

      saveState(statePath, state);
      const loaded = loadState(statePath);

      expect(loaded).toEqual(state);
    });

    it("atomic write leaves no .tmp file behind", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const statePath = join(tmpDir, "state.json");

      saveState(statePath, state);

      expect(existsSync(`${statePath}.tmp`)).toBe(false);
      expect(existsSync(statePath)).toBe(true);
    });

    it("saveState writes valid JSON", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const statePath = join(tmpDir, "state.json");

      saveState(statePath, state);

      const raw = readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.currentPhase).toBe("phase-1");
    });
  });

  describe("loadState", () => {
    it("returns null for missing file", () => {
      const result = loadState(join(tmpDir, "nonexistent.json"));
      expect(result).toBeNull();
    });

    it("throws for malformed JSON", () => {
      const statePath = join(tmpDir, "bad.json");
      writeFileSync(statePath, "not json at all", "utf-8");

      expect(() => loadState(statePath)).toThrow();
    });

    it("throws for invalid schema", () => {
      const statePath = join(tmpDir, "invalid.json");
      writeFileSync(
        statePath,
        JSON.stringify({ currentPhase: 123 }),
        "utf-8",
      );

      expect(() => loadState(statePath)).toThrow();
    });
  });

  describe("updateStateAfterPhase", () => {
    it("advances currentPhase correctly", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const report = makePhaseReport("phase-1");

      const updated = updateStateAfterPhase(state, report, tasks.phases);

      expect(updated.currentPhase).toBe("phase-2");
      expect(updated.completedPhases).toEqual(["phase-1"]);
      expect(updated.phaseReports.length).toBe(1);
      expect(updated.phaseReports[0]?.phaseId).toBe("phase-1");
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

      expect(state.currentPhase).toBe("");
      expect(state.completedPhases).toEqual(["phase-1", "phase-2"]);
    });

    it("does not mutate the original state", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const report = makePhaseReport("phase-1");

      const updated = updateStateAfterPhase(state, report, tasks.phases);

      expect(state.currentPhase).toBe("phase-1");
      expect(state.completedPhases).toEqual([]);
      expect(state).not.toBe(updated);
    });
  });

  describe("updateTaskStatus", () => {
    it("updates the correct task status", () => {
      const tasks = makeTasksJson();
      const updated = updateTaskStatus(tasks, "phase-1", "task-1-1", "complete");

      const phase = updated.phases.find((p) => p.id === "phase-1");
      const task = phase?.tasks.find((t) => t.id === "task-1-1");
      expect(task?.status).toBe("complete");
    });

    it("does not mutate the original TasksJson", () => {
      const tasks = makeTasksJson();
      updateTaskStatus(tasks, "phase-1", "task-1-1", "complete");

      const task = tasks.phases[0]?.tasks[0];
      expect(task?.status).toBe("pending");
    });

    it("throws for unknown phase", () => {
      const tasks = makeTasksJson();
      expect(
        () => updateTaskStatus(tasks, "phase-99", "task-1-1", "complete"),
      ).toThrow(/Phase not found/);
    });

    it("throws for unknown task", () => {
      const tasks = makeTasksJson();
      expect(
        () => updateTaskStatus(tasks, "phase-1", "task-99", "complete"),
      ).toThrow(/Task not found/);
    });
  });

  describe("getPhaseCommitRange", () => {
    it("returns commit range when both SHAs are present", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const report: PhaseReport = {
        ...makePhaseReport("phase-1"),
        startSha: "aaa111",
        endSha: "bbb222",
      };
      const stateWithReport = {
        ...state,
        phaseReports: [report],
      };

      const range = getPhaseCommitRange(stateWithReport, "phase-1");
      expect(range).toEqual({ startSha: "aaa111", endSha: "bbb222" });
    });

    it("returns null when phase has no SHAs", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const report = makePhaseReport("phase-1");
      const stateWithReport = {
        ...state,
        phaseReports: [report],
      };

      const range = getPhaseCommitRange(stateWithReport, "phase-1");
      expect(range).toBeNull();
    });

    it("returns null when phase is not found", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);

      const range = getPhaseCommitRange(state, "nonexistent");
      expect(range).toBeNull();
    });

    it("returns null when only startSha is present", () => {
      const tasks = makeTasksJson();
      const state = initState(tasks);
      const report: PhaseReport = {
        ...makePhaseReport("phase-1"),
        startSha: "aaa111",
      };
      const stateWithReport = {
        ...state,
        phaseReports: [report],
      };

      const range = getPhaseCommitRange(stateWithReport, "phase-1");
      expect(range).toBeNull();
    });
  });

  describe("applyReportToTasks", () => {
    it("marks completed tasks as complete", () => {
      const tasks = makeTasksJson();
      const report: PhaseReport = {
        ...makePhaseReport("phase-1"),
        tasksCompleted: ["task-1-1"],
        tasksFailed: [],
      };

      const updated = applyReportToTasks(tasks, "phase-1", report);
      const task = updated.phases[0]?.tasks.find((t: Task) => t.id === "task-1-1");
      expect(task?.status).toBe("complete");
    });

    it("marks failed tasks as failed", () => {
      const tasks = makeTasksJson();
      const report: PhaseReport = {
        ...makePhaseReport("phase-1"),
        tasksCompleted: [],
        tasksFailed: ["task-1-1"],
      };

      const updated = applyReportToTasks(tasks, "phase-1", report);
      const task = updated.phases[0]?.tasks.find((t: Task) => t.id === "task-1-1");
      expect(task?.status).toBe("failed");
    });

    it("silently skips unknown task IDs", () => {
      const tasks = makeTasksJson();
      const report: PhaseReport = {
        ...makePhaseReport("phase-1"),
        tasksCompleted: ["task-1-1", "corrective-task-99"],
        tasksFailed: [],
      };

      const updated = applyReportToTasks(tasks, "phase-1", report);
      const task = updated.phases[0]?.tasks.find((t: Task) => t.id === "task-1-1");
      expect(task?.status).toBe("complete");
      // No error thrown for unknown task
    });

    it("does not mutate the original TasksJson", () => {
      const tasks = makeTasksJson();
      const report: PhaseReport = {
        ...makePhaseReport("phase-1"),
        tasksCompleted: ["task-1-1"],
        tasksFailed: [],
      };

      applyReportToTasks(tasks, "phase-1", report);
      const task = tasks.phases[0]?.tasks.find((t: Task) => t.id === "task-1-1");
      expect(task?.status).toBe("pending");
    });
  });

  describe("applyCorrections", () => {
    it("replaces a targetPath in the correct task", () => {
      const tasks = makeTasksJson();
      const { tasksJson: updated } = applyCorrections(tasks, [
        {
          type: "targetPath",
          taskId: "task-1-1",
          old: "package.json",
          new: "package.jsonc",
          reason: "JSONC convention used",
        },
      ]);

      const task = updated.phases[0]?.tasks.find((t: Task) => t.id === "task-1-1");
      expect(task?.targetPaths).toEqual(["package.jsonc"]);
    });

    it("generates a constraint-tier decision entry", () => {
      const tasks = makeTasksJson();
      const { decisions } = applyCorrections(tasks, [
        {
          type: "targetPath",
          taskId: "task-1-1",
          old: "package.json",
          new: "package.jsonc",
          reason: "JSONC convention used",
        },
      ]);

      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.tier).toBe("constraint");
      expect(decisions[0]?.text).toContain("package.json");
      expect(decisions[0]?.text).toContain("package.jsonc");
      expect(decisions[0]?.text).toContain("task-1-1");
    });

    it("is a no-op for a non-existent taskId", () => {
      const tasks = makeTasksJson();
      const { tasksJson: updated, decisions } = applyCorrections(tasks, [
        {
          type: "targetPath",
          taskId: "nonexistent-task",
          old: "foo.js",
          new: "foo.jsx",
          reason: "JSX required",
        },
      ]);

      // targetPaths unchanged across all tasks
      expect(updated.phases[0]?.tasks[0]?.targetPaths).toEqual(["package.json"]);
      expect(updated.phases[1]?.tasks[0]?.targetPaths).toEqual(["src/index.ts"]);
      // Decision still generated (records the intent even if task not found)
      expect(decisions).toHaveLength(1);
    });

    it("handles multiple corrections on the same task", () => {
      const tasks: TasksJson = {
        ...makeTasksJson(),
        phases: [
          {
            id: "phase-1",
            name: "scaffolding",
            description: "Set up project",
            requiresBrowserTest: false,
            tasks: [
              {
                id: "task-1-1",
                title: "Create components",
                description: "Create components",
                dependsOn: [],
                specSections: [],
                targetPaths: ["src/Nav.css", "src/Modal.css"],
                acceptanceCriteria: [],
                subAgentType: "implement",
                status: "pending",
              },
            ],
          },
        ],
      };

      const { tasksJson: updated, decisions } = applyCorrections(tasks, [
        { type: "targetPath", taskId: "task-1-1", old: "src/Nav.css", new: "src/Nav.module.css", reason: "CSS Modules" },
        { type: "targetPath", taskId: "task-1-1", old: "src/Modal.css", new: "src/Modal.module.css", reason: "CSS Modules" },
      ]);

      const task = updated.phases[0]?.tasks[0];
      expect(task?.targetPaths).toEqual(["src/Nav.module.css", "src/Modal.module.css"]);
      expect(decisions).toHaveLength(2);
    });

    it("returns unchanged input for empty corrections", () => {
      const tasks = makeTasksJson();
      const { tasksJson: updated, decisions } = applyCorrections(tasks, []);

      expect(updated).toBe(tasks); // same reference — early return
      expect(decisions).toEqual([]);
    });

    it("does not mutate the original TasksJson", () => {
      const tasks = makeTasksJson();
      applyCorrections(tasks, [
        {
          type: "targetPath",
          taskId: "task-1-1",
          old: "package.json",
          new: "package.jsonc",
          reason: "test",
        },
      ]);

      expect(tasks.phases[0]?.tasks[0]?.targetPaths).toEqual(["package.json"]);
    });
  });

  describe("loadState edge cases", () => {
    it("throws with descriptive error for truncated JSON", () => {
      const statePath = join(tmpDir, "truncated.json");
      writeFileSync(statePath, '{"currentPhase": "phase-1", "completedPha', "utf-8");

      expect(() => loadState(statePath)).toThrow(/Failed to parse state file/);
    });

    it("throws for valid JSON that does not match SharedState schema", () => {
      const statePath = join(tmpDir, "wrong-schema.json");
      writeFileSync(
        statePath,
        JSON.stringify({
          currentPhase: "phase-1",
          // missing completedPhases, phaseReports, phaseRetries
        }),
        "utf-8",
      );

      expect(() => loadState(statePath)).toThrow();
    });
  });

  describe("applyReportToTasks edge cases", () => {
    it("silently skips corrective task IDs not present in the phase", () => {
      const tasks = makeTasksJson();
      const report: PhaseReport = {
        ...makePhaseReport("phase-1"),
        tasksCompleted: ["corrective-new-task"],
        tasksFailed: [],
      };

      // Should not throw; real tasks remain unchanged
      const updated = applyReportToTasks(tasks, "phase-1", report);
      const task = updated.phases[0]?.tasks.find((t: Task) => t.id === "task-1-1");
      expect(task?.status).toBe("pending");
    });

    it("failed wins when a task appears in both completed and failed lists", () => {
      const tasks = makeTasksJson();
      const report: PhaseReport = {
        ...makePhaseReport("phase-1"),
        tasksCompleted: ["task-1-1"],
        tasksFailed: ["task-1-1"],
      };

      const updated = applyReportToTasks(tasks, "phase-1", report);
      const task = updated.phases[0]?.tasks.find((t: Task) => t.id === "task-1-1");
      // tasksFailed is processed after tasksCompleted in the statusMap,
      // so "failed" overwrites "complete"
      expect(task?.status).toBe("failed");
    });
  });
});
