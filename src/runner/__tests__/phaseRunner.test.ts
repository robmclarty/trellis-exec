import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TasksJson } from "../../types/tasks.js";
import type { PhaseReport, SharedState } from "../../types/state.js";
import type { Phase } from "../../types/tasks.js";
import type { ExecClaudeResult } from "../../orchestrator/agentLauncher.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports of the module under test
// ---------------------------------------------------------------------------

vi.mock("../../orchestrator/agentLauncher.js", () => ({
  createAgentLauncher: vi.fn(),
  buildSubAgentPrompt: vi.fn(() => ""),
  buildSubAgentArgs: vi.fn(() => []),
  execClaude: vi.fn(),
}));

vi.mock("../../git.js", () => ({
  getChangedFiles: vi.fn(() => []),
  getDiffContent: vi.fn(() => ""),
  getCurrentSha: vi.fn(() => "abc123"),
  ensureInitialCommit: vi.fn(() => "abc123"),
  commitAll: vi.fn(() => null),
  getGitRoot: vi.fn(() => null),
}));

// Import module under test and mocked modules AFTER vi.mock declarations
import {
  runPhases,
  dryRunReport,
  buildPhaseContext,
  buildJudgePrompt,
  parseJudgeResult,
  buildFixPrompt,
  buildReporterPrompt,
  normalizeReport,
  createDefaultCheck,
  extractScopes,
  makePhaseCommit,
  collectLearnings,
  hasNewTestFiles,
} from "../phaseRunner.js";
import type { RunContext } from "../../cli.js";
import { createAgentLauncher } from "../../orchestrator/agentLauncher.js";
import { getChangedFiles, getDiffContent, commitAll, ensureInitialCommit, getCurrentSha } from "../../git.js";

const mockedGetChangedFiles = vi.mocked(getChangedFiles);
const mockedGetDiffContent = vi.mocked(getDiffContent);
const mockedCommitAll = vi.mocked(commitAll);
const mockedEnsureInitialCommit = vi.mocked(ensureInitialCommit);
const mockedGetCurrentSha = vi.mocked(getCurrentSha);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
          {
            id: "task-1-2",
            title: "Add config",
            description: "Add configuration files",
            dependsOn: ["task-1-1"],
            specSections: ["§1"],
            targetPaths: ["tsconfig.json"],
            acceptanceCriteria: ["tsc --noEmit exits 0"],
            subAgentType: "scaffold",
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
            title: "Build feature A",
            description: "Implement feature A",
            dependsOn: [],
            specSections: ["§2"],
            targetPaths: ["src/a.ts"],
            acceptanceCriteria: ["tests pass"],
            subAgentType: "implement",
            status: "pending",
          },
          {
            id: "task-2-2",
            title: "Build feature B",
            description: "Implement feature B",
            dependsOn: [],
            specSections: ["§3"],
            targetPaths: ["src/b.ts"],
            acceptanceCriteria: ["tests pass"],
            subAgentType: "implement",
            status: "pending",
          },
        ],
      },
    ],
  };
}

function makePhaseReport(
  phaseId: string,
  overrides?: Partial<PhaseReport>,
): PhaseReport {
  return {
    phaseId,
    status: "complete",
    summary: "Phase completed successfully",
    tasksCompleted: [],
    tasksFailed: [],
    orchestratorAnalysis: "All good",
    recommendedAction: "advance",
    correctiveTasks: [],
    decisionsLog: [],
    handoff: `# ${phaseId} handoff\nDone.`,
    ...overrides,
  };
}

function makeDefaultConfig(tmpDir: string): RunContext {
  return {
    projectRoot: tmpDir,
    specPath: join(tmpDir, "spec.md"),
    planPath: join(tmpDir, "plan.md"),
    statePath: join(tmpDir, "state.json"),
    trajectoryPath: join(tmpDir, "trajectory.jsonl"),
    tasksJsonPath: join(tmpDir, "tasks.json"),
    concurrency: 3,
    maxRetries: 2,
    headless: true,
    verbose: false,
    dryRun: false,
    pluginRoot: join(tmpDir, "plugin"),
    judgeMode: "always",
    saveE2eTests: false,
    browserTestRetries: 3,
  };
}

function setupTmpDir(tasksJson: TasksJson): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "phaserunner-test-"));
  writeFileSync(
    join(tmpDir, "tasks.json"),
    JSON.stringify(tasksJson),
  );
  // Create plugin dirs that the runner references
  mkdirSync(join(tmpDir, "plugin", "agents"), { recursive: true });
  writeFileSync(
    join(tmpDir, "plugin", "agents", "phase-orchestrator.md"),
    "---\nname: phase-orchestrator\n---\n",
  );
  // Create a spec file
  writeFileSync(join(tmpDir, "spec.md"), "# Spec\n## §1 Intro\nContent.");
  return tmpDir;
}

// ---------------------------------------------------------------------------
// Helpers to wire up mocks for a runPhases call
// ---------------------------------------------------------------------------

/**
 * Sets up mocks so that each phase completes successfully.
 * The mock orchestrator writes a report file to disk and exits 0.
 */
function setupMocksForSuccess(
  tmpDir: string,
  phaseReports: Map<string, PhaseReport>,
): void {
  const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;

  let launchCount = 0;
  const phaseIds = [...phaseReports.keys()];

  mockCreateAgentLauncher.mockImplementation(() => ({
    dispatchSubAgent: async () => ({
      success: true,
      output: '{"passed": true, "issues": [], "suggestions": []}',
      filesModified: [],
    }),
    runPhaseOrchestrator: async (): Promise<ExecClaudeResult> => {
      const phaseId = phaseIds[launchCount] ?? phaseIds[phaseIds.length - 1]!;
      launchCount++;
      const report = phaseReports.get(phaseId)!;

      // Write the report file to disk (simulates orchestrator behavior)
      writeFileSync(
        join(tmpDir, ".trellis-phase-report.json"),
        JSON.stringify(report),
      );

      return { stdout: "done", stderr: "", exitCode: 0 };
    },
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tmpDir: string;

describe("phaseRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("runPhases — happy path", () => {
    it("runs both phases successfully", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);

      const reports = new Map<string, PhaseReport>([
        [
          "phase-1",
          makePhaseReport("phase-1", {
            tasksCompleted: ["task-1-1", "task-1-2"],
          }),
        ],
        [
          "phase-2",
          makePhaseReport("phase-2", {
            tasksCompleted: ["task-2-1", "task-2-2"],
          }),
        ],
      ]);
      setupMocksForSuccess(tmpDir, reports);

      const result = await runPhases(config, tasksJson);

      expect(result.success).toBe(true);
      expect(result.phasesCompleted).toContain("phase-1");
      expect(result.phasesCompleted).toContain("phase-2");
      expect(result.phasesFailed).toHaveLength(0);
      expect(result.finalState.completedPhases).toContain("phase-1");
      expect(result.finalState.completedPhases).toContain("phase-2");
    });
  });

  describe("runPhases — missing report file", () => {
    it("returns failed when orchestrator does not write report", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = { ...makeDefaultConfig(tmpDir), maxRetries: 0 };

      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;
      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
          success: true,
          output: '{"passed": true, "issues": [], "suggestions": []}',
          filesModified: [],
        }),
        runPhaseOrchestrator: async (): Promise<ExecClaudeResult> => {
          // Don't write a report file
          return { stdout: "crashed", stderr: "error", exitCode: 1 };
        },
      }));

      const result = await runPhases(config, tasksJson);

      expect(result.success).toBe(false);
      expect(result.phasesFailed).toContain("phase-1");
    });
  });

  describe("runPhases — missing tasks in report", () => {
    it("marks phase as partial when report is missing tasks", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = { ...makeDefaultConfig(tmpDir), maxRetries: 0, judgeMode: "never" as const };

      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;
      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
          success: true,
          output: '{"passed": true, "issues": [], "suggestions": []}',
          filesModified: [],
        }),
        runPhaseOrchestrator: async (): Promise<ExecClaudeResult> => {
          // Report only accounts for 1 of 2 tasks
          const report = makePhaseReport("phase-1", {
            tasksCompleted: ["task-1-1"],
            tasksFailed: [],
          });
          writeFileSync(
            join(tmpDir, ".trellis-phase-report.json"),
            JSON.stringify(report),
          );
          return { stdout: "done", stderr: "", exitCode: 0 };
        },
      }));

      const result = await runPhases(config, tasksJson);

      // With maxRetries=0, it should halt after first phase fails
      expect(result.success).toBe(false);
      expect(result.phasesFailed).toContain("phase-1");
    });
  });

  describe("dryRunReport", () => {
    it("generates a report with phase and task info", () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);

      const report = dryRunReport(tasksJson, config);

      expect(report).toContain("phase-1");
      expect(report).toContain("phase-2");
      expect(report).toContain("task-1-1");
      expect(report).toContain("Init project");
    });
  });

  describe("normalizeReport", () => {
    it("fills defaults for missing fields", () => {
      const report = normalizeReport({}, "test-phase");

      expect(report.phaseId).toBe("test-phase");
      expect(report.status).toBe("partial");
      expect(report.recommendedAction).toBe("halt");
      expect(report.tasksCompleted).toEqual([]);
      expect(report.tasksFailed).toEqual([]);
    });

    it("maps taskOutcomes to tasksCompleted/tasksFailed", () => {
      const report = normalizeReport(
        {
          taskOutcomes: [
            { taskId: "task-1", status: "complete" },
            { taskId: "task-2", status: "failed" },
            { taskId: "task-3", status: "completed" },
          ],
        },
        "p1",
      );

      expect(report.tasksCompleted).toEqual(["task-1", "task-3"]);
      expect(report.tasksFailed).toEqual(["task-2"]);
    });

    it("maps handoffBriefing to handoff", () => {
      const report = normalizeReport(
        { handoffBriefing: "Next phase should..." },
        "p1",
      );

      expect(report.handoff).toBe("Next phase should...");
    });

    it("preserves valid status and action", () => {
      const report = normalizeReport(
        {
          status: "complete",
          recommendedAction: "advance",
          tasksCompleted: ["a", "b"],
        },
        "p1",
      );

      expect(report.status).toBe("complete");
      expect(report.recommendedAction).toBe("advance");
      expect(report.tasksCompleted).toEqual(["a", "b"]);
    });
  });

  describe("buildPhaseContext", () => {
    it("includes task details and completion protocol", () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);
      const state: SharedState = {
        currentPhase: "",
        completedPhases: [],
        phaseReports: [],
        phaseRetries: {},
        phaseReport: null,
      };

      const context = buildPhaseContext(
        tasksJson.phases[0]!,
        state,
        "",
        config,
      );

      expect(context).toContain("task-1-1");
      expect(context).toContain("task-1-2");
      expect(context).toContain("Completion Protocol");
      expect(context).toContain(".trellis-phase-report.json");
      // Should NOT contain REPL protocol
      expect(context).not.toContain("REPL Protocol");
      expect(context).not.toContain("readFile(");
      expect(context).not.toContain("writeFile(");
    });

    it("includes previous attempt context on retries", () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);
      const state: SharedState = {
        currentPhase: "phase-1",
        completedPhases: [],
        phaseReports: [
          makePhaseReport("phase-1", {
            status: "partial",
            summary: "Build failed",
            tasksCompleted: ["task-1-1"],
            tasksFailed: ["task-1-2"],
          }),
        ],
        phaseRetries: { "phase-1": 1 },
        phaseReport: null,
      };

      const context = buildPhaseContext(
        tasksJson.phases[0]!,
        state,
        "",
        config,
      );

      expect(context).toContain("Previous Attempt");
      expect(context).toContain("retry attempt 1");
      expect(context).toContain("Build failed");
    });
  });

  describe("buildJudgePrompt", () => {
    it("includes changed files and acceptance criteria", () => {
      const phase: Phase = makeTasksJson().phases[0]!;
      const report = makePhaseReport("phase-1", {
        tasksCompleted: ["task-1-1", "task-1-2"],
      });

      const prompt = buildJudgePrompt({
        changedFiles: [
          { path: "package.json", status: "A" },
          { path: "tsconfig.json", status: "A" },
        ],
        diffContent: "diff --git a/package.json...",
        phase,
        orchestratorReport: report,
      });

      expect(prompt).toContain("package.json");
      expect(prompt).toContain("tsconfig.json");
      expect(prompt).toContain("npm install exits 0");
      expect(prompt).toContain("tsc --noEmit exits 0");
    });
  });

  describe("parseJudgeResult", () => {
    it("parses valid JSON from markdown fences", () => {
      const output = '```json\n{"passed": true, "issues": [], "suggestions": []}\n```';
      const result = parseJudgeResult(output);

      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it("parses JSON without fences", () => {
      const result = parseJudgeResult(
        '{"passed": false, "issues": [{"task": "t1", "severity": "must-fix", "description": "missing"}], "suggestions": []}',
      );

      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
    });

    it("returns failure for unparseable output", () => {
      const result = parseJudgeResult("This is not JSON at all.");

      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
    });

    it("returns failure for empty string (e.g. CLI process failed with no output)", () => {
      const result = parseJudgeResult("");

      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatch(/unparseable/i);
    });
  });

  describe("buildFixPrompt", () => {
    it("includes issue descriptions", () => {
      const phase: Phase = makeTasksJson().phases[0]!;
      const prompt = buildFixPrompt(
        [{ task: "task-1-1", severity: "must-fix", description: "Missing export" }],
        phase,
      );

      expect(prompt).toContain("Missing export");
      expect(prompt).toContain("task-1-1");
    });
  });

  describe("createDefaultCheck", () => {
    it("passes when all target paths exist", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);

      // Create the target files
      writeFileSync(join(tmpDir, "package.json"), "{}");
      writeFileSync(join(tmpDir, "tsconfig.json"), "{}");

      const check = createDefaultCheck(tmpDir, tasksJson.phases[0]!);
      const result = await check.run();

      expect(result.passed).toBe(true);
    });

    it("fails when target paths are missing", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);

      const check = createDefaultCheck(tmpDir, tasksJson.phases[0]!);
      const result = await check.run();

      expect(result.passed).toBe(false);
      expect(result.output).toContain("package.json");
    });
  });

  describe("extractScopes", () => {
    it("extracts meaningful directory names from targetPaths", () => {
      const tasks = makeTasksJson();
      const phase = {
        ...tasks.phases[1]!,
        tasks: [
          { ...tasks.phases[1]!.tasks[0]!, targetPaths: ["src/auth/login.tsx", "src/auth/schema.ts"] },
          { ...tasks.phases[1]!.tasks[1]!, targetPaths: ["src/db/migrations/001.sql"] },
        ],
      };
      const report = makePhaseReport("phase-2", {
        tasksCompleted: ["task-2-1", "task-2-2"],
      });

      const scopes = extractScopes(phase, report);
      expect(scopes).toContain("auth");
      expect(scopes).toContain("db");
      expect(scopes).not.toContain("src");
    });

    it("skips generic top-level dirs like src, lib, app", () => {
      const tasks = makeTasksJson();
      const phase = {
        ...tasks.phases[0]!,
        tasks: [
          { ...tasks.phases[0]!.tasks[0]!, targetPaths: ["src/components/Button.tsx"] },
        ],
      };
      const report = makePhaseReport("phase-1", {
        tasksCompleted: ["task-1-1"],
      });

      const scopes = extractScopes(phase, report);
      expect(scopes).toContain("components");
      expect(scopes).not.toContain("src");
    });

    it("deduplicates scopes", () => {
      const tasks = makeTasksJson();
      const phase = {
        ...tasks.phases[1]!,
        tasks: [
          { ...tasks.phases[1]!.tasks[0]!, targetPaths: ["src/auth/login.tsx"] },
          { ...tasks.phases[1]!.tasks[1]!, targetPaths: ["src/auth/register.tsx"] },
        ],
      };
      const report = makePhaseReport("phase-2", {
        tasksCompleted: ["task-2-1", "task-2-2"],
      });

      const scopes = extractScopes(phase, report);
      expect(scopes).toEqual(["auth"]);
    });

    it("returns empty array when no targetPaths have meaningful dirs", () => {
      const tasks = makeTasksJson();
      const phase = {
        ...tasks.phases[0]!,
        tasks: [
          { ...tasks.phases[0]!.tasks[0]!, targetPaths: ["package.json"] },
        ],
      };
      const report = makePhaseReport("phase-1", {
        tasksCompleted: ["task-1-1"],
      });

      const scopes = extractScopes(phase, report);
      expect(scopes).toEqual([]);
    });

    it("only considers completed tasks", () => {
      const tasks = makeTasksJson();
      const phase = {
        ...tasks.phases[1]!,
        tasks: [
          { ...tasks.phases[1]!.tasks[0]!, targetPaths: ["src/auth/login.tsx"] },
          { ...tasks.phases[1]!.tasks[1]!, targetPaths: ["src/db/schema.ts"] },
        ],
      };
      const report = makePhaseReport("phase-2", {
        tasksCompleted: ["task-2-1"],
        tasksFailed: ["task-2-2"],
      });

      const scopes = extractScopes(phase, report);
      expect(scopes).toContain("auth");
      expect(scopes).not.toContain("db");
    });
  });

  describe("makePhaseCommit", () => {
    it("returns null when there are no uncommitted changes", () => {
      // getChangedFiles mock already returns [] by default
      const tasks = makeTasksJson();
      const phase = tasks.phases[0]!;
      const report = makePhaseReport("phase-1", {
        tasksCompleted: ["task-1-1", "task-1-2"],
      });

      const result = makePhaseCommit("/tmp/project", phase, report);
      expect(result).toBeNull();
      expect(mockedCommitAll).not.toHaveBeenCalled();
    });

    it("commits with conventional format when changes exist", () => {
      mockedGetChangedFiles.mockReturnValueOnce([
        { path: "leftover.txt", status: "?" },
      ]);
      mockedCommitAll.mockReturnValueOnce("def456");

      const tasks = makeTasksJson();
      const phase = tasks.phases[0]!;
      const report = makePhaseReport("phase-1", {
        tasksCompleted: ["task-1-1", "task-1-2"],
        summary: "Set up project scaffolding",
      });

      const result = makePhaseCommit("/tmp/project", phase, report);
      expect(result).toBe("def456");
      expect(mockedCommitAll).toHaveBeenCalledWith(
        "/tmp/project",
        expect.stringContaining("[trellis phase-1]"),
      );
      expect(mockedCommitAll).toHaveBeenCalledWith(
        "/tmp/project",
        expect.stringContaining("Set up project scaffolding"),
      );
    });

    it("includes task titles in commit body", () => {
      mockedGetChangedFiles.mockReturnValueOnce([
        { path: "file.txt", status: "M" },
      ]);
      mockedCommitAll.mockReturnValueOnce("sha123");

      const tasks = makeTasksJson();
      const phase = tasks.phases[0]!;
      const report = makePhaseReport("phase-1", {
        tasksCompleted: ["task-1-1", "task-1-2"],
        summary: "Done",
      });

      makePhaseCommit("/tmp/project", phase, report);

      const commitMsg = mockedCommitAll.mock.calls[0]![1];
      expect(commitMsg).toContain("- Init project");
      expect(commitMsg).toContain("- Add config");
    });
  });

  describe("buildPhaseContext — git commit protocol", () => {
    it("includes git commit protocol section in phase context", () => {
      const tasks = makeTasksJson();
      const state = {
        currentPhase: "phase-1",
        completedPhases: [],
        phaseReports: [],
        phaseRetries: {},
        phaseReport: null,
      };
      tmpDir = setupTmpDir(tasks);
      const ctx = makeDefaultConfig(tmpDir);

      const context = buildPhaseContext(tasks.phases[0]!, state, "", ctx);
      expect(context).toContain("## Git Commit Protocol");
      expect(context).toContain("conventional commit format");
      expect(context).toContain(".trellis-phase-report.json");
    });
  });

  describe("collectLearnings", () => {
    it("returns empty array when no phase reports exist", () => {
      const state: SharedState = {
        currentPhase: "",
        completedPhases: [],
        phaseReports: [],
        phaseRetries: {},
        phaseReport: null,
      };

      const learnings = collectLearnings(state);
      expect(learnings.architectural).toEqual([]);
      expect(learnings.tactical).toEqual([]);
      expect(learnings.constraint).toEqual([]);
    });

    it("collects from multiple phases with phase ID prefix", () => {
      const state: SharedState = {
        currentPhase: "phase-3",
        completedPhases: ["phase-1", "phase-2"],
        phaseReports: [
          makePhaseReport("phase-1", {
            decisionsLog: [{ text: "Used .jsx for all JSX files", tier: "tactical" }],
          }),
          makePhaseReport("phase-2", {
            decisionsLog: [{ text: "localStorage adapter uses JSON.stringify", tier: "tactical" }],
          }),
        ],
        phaseRetries: {},
        phaseReport: null,
      };

      const learnings = collectLearnings(state);
      expect(learnings.tactical).toEqual([
        "[phase-1] Used .jsx for all JSX files",
        "[phase-2] localStorage adapter uses JSON.stringify",
      ]);
    });

    it("never evicts architectural learnings", () => {
      const reports = Array.from({ length: 25 }, (_, i) =>
        makePhaseReport(`phase-${i}`, {
          decisionsLog: [{ text: `Decision from phase ${i}`, tier: "tactical" as const }],
        }),
      );
      // Add an early architectural decision
      reports[0]!.decisionsLog.push({ text: "Use PostgreSQL", tier: "architectural" });

      const state: SharedState = {
        currentPhase: "phase-25",
        completedPhases: reports.map((r) => r.phaseId),
        phaseReports: reports,
        phaseRetries: {},
        phaseReport: null,
      };

      const learnings = collectLearnings(state);
      // Architectural is always preserved
      expect(learnings.architectural).toContain("[phase-0] Use PostgreSQL");
      // Tactical is capped
      expect(learnings.tactical.length).toBeLessThanOrEqual(20);
      // Most recent tactical entries kept
      expect(learnings.tactical[learnings.tactical.length - 1]).toBe(
        "[phase-24] Decision from phase 24",
      );
    });

    it("skips phases with empty decisionsLog", () => {
      const state: SharedState = {
        currentPhase: "phase-3",
        completedPhases: ["phase-1", "phase-2"],
        phaseReports: [
          makePhaseReport("phase-1", { decisionsLog: [] }),
          makePhaseReport("phase-2", {
            decisionsLog: [{ text: "Important finding", tier: "tactical" }],
          }),
        ],
        phaseRetries: {},
        phaseReport: null,
      };

      const learnings = collectLearnings(state);
      expect(learnings.tactical).toEqual(["[phase-2] Important finding"]);
    });

    it("partitions architectural, tactical, and constraint entries correctly", () => {
      const state: SharedState = {
        currentPhase: "phase-2",
        completedPhases: ["phase-1"],
        phaseReports: [
          makePhaseReport("phase-1", {
            decisionsLog: [
              { text: "Use ESM modules", tier: "architectural" },
              { text: "Renamed file to avoid warning", tier: "tactical" },
              { text: "Vite dev server requires .jsx extensions", tier: "constraint" },
            ],
          }),
        ],
        phaseRetries: {},
        phaseReport: null,
      };

      const learnings = collectLearnings(state);
      expect(learnings.architectural).toEqual(["[phase-1] Use ESM modules"]);
      expect(learnings.tactical).toEqual(["[phase-1] Renamed file to avoid warning"]);
      expect(learnings.constraint).toEqual(["[phase-1] Vite dev server requires .jsx extensions"]);
    });

    it("never evicts constraint learnings", () => {
      const reports = Array.from({ length: 25 }, (_, i) =>
        makePhaseReport(`phase-${i}`, {
          decisionsLog: [{ text: `Decision from phase ${i}`, tier: "tactical" as const }],
        }),
      );
      // Add an early constraint
      reports[0]!.decisionsLog.push({ text: "esbuild requires .jsx", tier: "constraint" });

      const state: SharedState = {
        currentPhase: "phase-25",
        completedPhases: reports.map((r) => r.phaseId),
        phaseReports: reports,
        phaseRetries: {},
        phaseReport: null,
      };

      const learnings = collectLearnings(state);
      expect(learnings.constraint).toContain("[phase-0] esbuild requires .jsx");
      // Constraint entries reduce tactical budget
      expect(learnings.tactical.length).toBeLessThanOrEqual(19);
    });
  });

  describe("buildPhaseContext — spec amendments section", () => {
    it("includes amendments section when prior phases have decisionsLog entries", () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);
      const state: SharedState = {
        currentPhase: "phase-2",
        completedPhases: ["phase-1"],
        phaseReports: [
          makePhaseReport("phase-1", {
            decisionsLog: [{ text: "Vite requires .jsx extension for JSX files", tier: "tactical" }],
          }),
        ],
        phaseRetries: {},
        phaseReport: null,
      };

      const context = buildPhaseContext(
        tasksJson.phases[1]!,
        state,
        "Phase 1 done.",
        config,
      );

      expect(context).toContain("## Spec Amendments from Prior Phases");
      expect(context).toContain("[phase-1] Vite requires .jsx extension for JSX files");
      expect(context).toContain("amendments take precedence");
    });

    it("omits amendments section when all decisionsLog arrays are empty", () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);
      const state: SharedState = {
        currentPhase: "phase-2",
        completedPhases: ["phase-1"],
        phaseReports: [
          makePhaseReport("phase-1", { decisionsLog: [] }),
        ],
        phaseRetries: {},
        phaseReport: null,
      };

      const context = buildPhaseContext(
        tasksJson.phases[1]!,
        state,
        "Phase 1 done.",
        config,
      );

      expect(context).not.toContain("Spec Amendments from Prior Phases");
    });

    it("positions amendments after spec content", () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);
      const state: SharedState = {
        currentPhase: "phase-2",
        completedPhases: ["phase-1"],
        phaseReports: [
          makePhaseReport("phase-1", {
            decisionsLog: [{ text: "Use .jsx extensions", tier: "architectural" }],
          }),
        ],
        phaseRetries: {},
        phaseReport: null,
      };

      const context = buildPhaseContext(
        tasksJson.phases[1]!,
        state,
        "Phase 1 done.",
        config,
      );

      const specIndex = context.indexOf("## Spec Content");
      const amendmentsIndex = context.indexOf("## Spec Amendments from Prior Phases");
      expect(specIndex).toBeGreaterThan(-1);
      expect(amendmentsIndex).toBeGreaterThan(specIndex);
    });

    it("renders constraint tier with binding label", () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);
      const state: SharedState = {
        currentPhase: "phase-2",
        completedPhases: ["phase-1"],
        phaseReports: [
          makePhaseReport("phase-1", {
            decisionsLog: [{ text: "esbuild requires .jsx", tier: "constraint" }],
          }),
        ],
        phaseRetries: {},
        phaseReport: null,
      };

      const context = buildPhaseContext(
        tasksJson.phases[1]!,
        state,
        "Phase 1 done.",
        config,
      );

      expect(context).toContain("### Discovered Constraints (binding");
      expect(context).toContain("[phase-1] esbuild requires .jsx");
    });

    it("handoff section includes authoritative framing", () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);
      const state: SharedState = {
        currentPhase: "phase-2",
        completedPhases: ["phase-1"],
        phaseReports: [],
        phaseRetries: {},
        phaseReport: null,
      };

      const context = buildPhaseContext(
        tasksJson.phases[1]!,
        state,
        "Phase 1 done.",
        config,
      );

      expect(context).toContain("## Prior Phase Handoff (authoritative");
    });
  });

  describe("runPhases — range-based judging", () => {
    it("uses getChangedFiles with startSha during judge phase", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);

      // ensureInitialCommit returns the baseline SHA
      mockedEnsureInitialCommit.mockReturnValue("baseline-sha-000");
      // Range-based functions return some files so judge runs
      mockedGetChangedFiles.mockReturnValue([
        { path: "package.json", status: "A" },
      ]);
      mockedGetDiffContent.mockReturnValue("diff --git a/package.json");
      mockedGetCurrentSha.mockReturnValue("final-sha-999");
      mockedCommitAll.mockReturnValue("commit-sha-111");

      const reports = new Map<string, PhaseReport>([
        [
          "phase-1",
          makePhaseReport("phase-1", {
            tasksCompleted: ["task-1-1", "task-1-2"],
          }),
        ],
        [
          "phase-2",
          makePhaseReport("phase-2", {
            tasksCompleted: ["task-2-1", "task-2-2"],
          }),
        ],
      ]);
      setupMocksForSuccess(tmpDir, reports);

      await runPhases(config, tasksJson);

      // Verify range-based git functions were called with the baseline SHA
      expect(mockedGetChangedFiles).toHaveBeenCalledWith(
        tmpDir,
        "baseline-sha-000",
      );
      expect(mockedGetDiffContent).toHaveBeenCalledWith(
        tmpDir,
        "baseline-sha-000",
      );
    });

    it("tracks startSha and endSha in phase reports", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);

      mockedEnsureInitialCommit.mockReturnValue("start-sha-aaa");
      mockedGetChangedFiles.mockReturnValue([
        { path: "file.ts", status: "A" },
      ]);
      mockedGetDiffContent.mockReturnValue("some diff");
      mockedGetCurrentSha.mockReturnValue("end-sha-bbb");
      mockedCommitAll.mockReturnValue("commit-sha-ccc");

      const reports = new Map<string, PhaseReport>([
        [
          "phase-1",
          makePhaseReport("phase-1", {
            tasksCompleted: ["task-1-1", "task-1-2"],
          }),
        ],
        [
          "phase-2",
          makePhaseReport("phase-2", {
            tasksCompleted: ["task-2-1", "task-2-2"],
          }),
        ],
      ]);
      setupMocksForSuccess(tmpDir, reports);

      const result = await runPhases(config, tasksJson);

      // Phase reports should include SHA tracking
      const phaseReport = result.finalState.phaseReports.find(
        (r) => r.phaseId === "phase-1",
      );
      expect(phaseReport?.startSha).toBe("start-sha-aaa");
    });
  });

  describe("hasNewTestFiles", () => {
    it("uses getChangedFiles with fromSha when startSha is provided", () => {
      mockedGetChangedFiles.mockReturnValueOnce([
        { path: "test/foo.test.ts", status: "A" },
      ]);

      const result = hasNewTestFiles("/tmp/project", "abc123");

      expect(result).toBe(true);
      expect(mockedGetChangedFiles).toHaveBeenCalledWith("/tmp/project", "abc123");
    });

    it("falls back to getChangedFiles without startSha", () => {
      mockedGetChangedFiles.mockReturnValueOnce([
        { path: "test/foo.test.ts", status: "A" },
      ]);

      const result = hasNewTestFiles("/tmp/project");

      expect(result).toBe(true);
      expect(mockedGetChangedFiles).toHaveBeenCalledWith("/tmp/project", undefined);
    });

    it("detects modified test files with startSha", () => {
      mockedGetChangedFiles.mockReturnValueOnce([
        { path: "src/__tests__/app.test.js", status: "M" },
      ]);

      const result = hasNewTestFiles("/tmp/project", "abc123");

      expect(result).toBe(true);
    });

    it("returns false when no test files in changes", () => {
      mockedGetChangedFiles.mockReturnValueOnce([
        { path: "src/index.ts", status: "A" },
      ]);

      const result = hasNewTestFiles("/tmp/project", "abc123");

      expect(result).toBe(false);
    });
  });

  describe("runPhases — judge upgrade on timeout", () => {
    it("advances when judge passes a timed-out phase with committed work", async () => {
      const tasksJson = makeTasksJson();
      // Only use phase-1 to keep it simple
      tasksJson.phases = [tasksJson.phases[0]!];
      tmpDir = setupTmpDir(tasksJson);
      const config = { ...makeDefaultConfig(tmpDir), maxRetries: 1 };

      mockedEnsureInitialCommit.mockReturnValue("baseline-sha");
      // Phase has committed changes (so judge will run)
      mockedGetChangedFiles.mockReturnValue([
        { path: "package.json", status: "A" },
      ]);
      mockedGetDiffContent.mockReturnValue("diff content");
      mockedGetCurrentSha.mockReturnValue("end-sha");
      mockedCommitAll.mockReturnValue("commit-sha");

      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;

      let orchestratorCalls = 0;
      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
          success: true,
          // Judge passes
          output: '{"passed": true, "issues": [], "suggestions": []}',
          filesModified: [],
        }),
        runPhaseOrchestrator: async (): Promise<ExecClaudeResult> => {
          orchestratorCalls++;
          if (orchestratorCalls === 1) {
            // First call: simulate timeout (no report file written)
            throw new Error("claude subprocess timed out after 600000ms");
          }
          // Should not reach here if judge upgrade works
          const report = makePhaseReport("phase-1", {
            tasksCompleted: ["task-1-1", "task-1-2"],
          });
          writeFileSync(
            join(tmpDir, ".trellis-phase-report.json"),
            JSON.stringify(report),
          );
          return { stdout: "done", stderr: "", exitCode: 0 };
        },
      }));

      const result = await runPhases(config, tasksJson);

      // Should succeed without needing a retry
      expect(result.success).toBe(true);
      expect(result.phasesCompleted).toContain("phase-1");
      // Orchestrator should only be called once (no retry needed)
      expect(orchestratorCalls).toBe(1);
    });
  });

  describe("runPhases — tasks.json status sync", () => {
    it("writes updated task statuses to tasks.json after phase advance", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);

      // Create target files so completion verifier passes
      writeFileSync(join(tmpDir, "package.json"), "{}");
      writeFileSync(join(tmpDir, "tsconfig.json"), "{}");
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "a.ts"), "");
      writeFileSync(join(tmpDir, "src", "b.ts"), "");

      const reports = new Map<string, PhaseReport>([
        [
          "phase-1",
          makePhaseReport("phase-1", {
            tasksCompleted: ["task-1-1", "task-1-2"],
          }),
        ],
        [
          "phase-2",
          makePhaseReport("phase-2", {
            tasksCompleted: ["task-2-1", "task-2-2"],
          }),
        ],
      ]);
      setupMocksForSuccess(tmpDir, reports);

      await runPhases(config, tasksJson);

      // Read tasks.json from disk and verify statuses were updated
      const written = JSON.parse(readFileSync(join(tmpDir, "tasks.json"), "utf-8"));
      const phase1Task = written.phases[0].tasks.find((t: { id: string }) => t.id === "task-1-1");
      const phase2Task = written.phases[1].tasks.find((t: { id: string }) => t.id === "task-2-1");
      expect(phase1Task.status).toBe("complete");
      expect(phase2Task.status).toBe("complete");
    });
  });

  describe("buildReporterPrompt", () => {
    it("includes task IDs, target paths, acceptance criteria, and diff", () => {
      const phase = makeTasksJson().phases[0]!;
      const changedFiles = [
        { path: "package.json", status: "A" },
        { path: "tsconfig.json", status: "A" },
      ];
      const diff = "diff --git a/package.json b/package.json\n+content";

      const prompt = buildReporterPrompt(phase, changedFiles, diff);

      expect(prompt).toContain("task-1-1");
      expect(prompt).toContain("task-1-2");
      expect(prompt).toContain("package.json");
      expect(prompt).toContain("tsconfig.json");
      expect(prompt).toContain("npm install exits 0");
      expect(prompt).toContain("tsc --noEmit exits 0");
      expect(prompt).toContain("diff --git");
      expect(prompt).toContain("timed out");
    });
  });

  describe("runPhases — reporter fallback on timeout", () => {
    it("dispatches reporter when orchestrator times out with committed changes", async () => {
      const tasksJson = makeTasksJson();
      tasksJson.phases = [tasksJson.phases[0]!];
      tmpDir = setupTmpDir(tasksJson);
      const config = { ...makeDefaultConfig(tmpDir), maxRetries: 1 };

      mockedEnsureInitialCommit.mockReturnValue("baseline-sha");
      mockedGetChangedFiles.mockReturnValue([
        { path: "package.json", status: "A" },
      ]);
      mockedGetDiffContent.mockReturnValue("diff content");
      mockedGetCurrentSha.mockReturnValue("end-sha");
      mockedCommitAll.mockReturnValue("commit-sha");

      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;

      let reporterDispatched = false;
      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async (subConfig: { type: string }) => {
          if (subConfig.type === "reporter") {
            reporterDispatched = true;
            // Reporter writes the report file
            const report = makePhaseReport("phase-1", {
              tasksCompleted: ["task-1-1", "task-1-2"],
              orchestratorAnalysis: "Report generated by reporter fallback",
            });
            writeFileSync(
              join(tmpDir, ".trellis-phase-report.json"),
              JSON.stringify(report),
            );
            return { success: true, output: "report written", filesModified: [] };
          }
          // Judge passes
          return {
            success: true,
            output: '{"passed": true, "issues": [], "suggestions": []}',
            filesModified: [],
          };
        },
        runPhaseOrchestrator: async (): Promise<ExecClaudeResult> => {
          throw new Error("claude subprocess timed out after 900000ms");
        },
      }));

      const result = await runPhases(config, tasksJson);

      expect(reporterDispatched).toBe(true);
      expect(result.success).toBe(true);
      expect(result.phasesCompleted).toContain("phase-1");
    });

    it("falls through to partial report when reporter also fails", async () => {
      const tasksJson = makeTasksJson();
      tasksJson.phases = [tasksJson.phases[0]!];
      tmpDir = setupTmpDir(tasksJson);
      // Disable judge so dispatchSubAgent is only called for the reporter
      const config = { ...makeDefaultConfig(tmpDir), maxRetries: 0, judgeMode: "never" as const };

      mockedEnsureInitialCommit.mockReturnValue("baseline-sha");
      mockedGetChangedFiles.mockReturnValue([
        { path: "package.json", status: "A" },
      ]);
      mockedGetDiffContent.mockReturnValue("diff content");

      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;

      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => {
          throw new Error("reporter failed");
        },
        runPhaseOrchestrator: async (): Promise<ExecClaudeResult> => {
          throw new Error("claude subprocess timed out after 900000ms");
        },
      }));

      const result = await runPhases(config, tasksJson);

      // Should fail gracefully (reporter failed, maxRetries=0)
      expect(result.success).toBe(false);
    });

    it("skips reporter when timeout has no committed changes", async () => {
      const tasksJson = makeTasksJson();
      tasksJson.phases = [tasksJson.phases[0]!];
      tmpDir = setupTmpDir(tasksJson);
      const config = { ...makeDefaultConfig(tmpDir), maxRetries: 0 };

      mockedEnsureInitialCommit.mockReturnValue("baseline-sha");
      // No changes committed
      mockedGetChangedFiles.mockReturnValue([]);

      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;

      let reporterDispatched = false;
      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => {
          reporterDispatched = true;
          return { success: true, output: "", filesModified: [] };
        },
        runPhaseOrchestrator: async (): Promise<ExecClaudeResult> => {
          throw new Error("claude subprocess timed out after 900000ms");
        },
      }));

      await runPhases(config, tasksJson);

      expect(reporterDispatched).toBe(false);
    });
  });

  describe("runPhases — configurable timeout", () => {
    it("passes timeout option to orchestrator when ctx.timeout is set", async () => {
      const tasksJson = makeTasksJson();
      tmpDir = setupTmpDir(tasksJson);
      const config = { ...makeDefaultConfig(tmpDir), timeout: 1_200_000 };

      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;

      let capturedOptions: Record<string, unknown> | undefined;
      const reports = new Map<string, PhaseReport>([
        ["phase-1", makePhaseReport("phase-1", { tasksCompleted: ["task-1-1", "task-1-2"] })],
        ["phase-2", makePhaseReport("phase-2", { tasksCompleted: ["task-2-1", "task-2-2"] })],
      ]);

      let launchCount = 0;
      const phaseIds = [...reports.keys()];
      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
          success: true,
          output: '{"passed": true, "issues": [], "suggestions": []}',
          filesModified: [],
        }),
        runPhaseOrchestrator: async (
          _prompt: string,
          _agentFile: string,
          _model?: string,
          options?: Record<string, unknown>,
        ): Promise<ExecClaudeResult> => {
          capturedOptions = options;
          const phaseId = phaseIds[launchCount] ?? phaseIds[phaseIds.length - 1]!;
          launchCount++;
          const report = reports.get(phaseId)!;
          writeFileSync(
            join(tmpDir, ".trellis-phase-report.json"),
            JSON.stringify(report),
          );
          return { stdout: "done", stderr: "", exitCode: 0 };
        },
      }));

      await runPhases(config, tasksJson);

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.timeout).toBe(1_200_000);
    });
  });
});
