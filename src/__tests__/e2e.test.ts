import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  cpSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { TasksJsonSchema } from "../types/tasks.js";
import type { TasksJson, Task } from "../types/tasks.js";
import type { PhaseReport, SharedState } from "../types/state.js";
import type { OrchestratorHandle } from "../orchestrator/agentLauncher.js";
import type { ReplSession, ReplEvalResult } from "../orchestrator/replManager.js";
import type { ReplHelpers } from "../orchestrator/replHelpers.js";

// ---------------------------------------------------------------------------
// Constants — fixture paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../../test/fixtures/e2e",
);
const SAMPLE_PLAN_PATH = join(FIXTURES_DIR, "sample-plan.md");
const SAMPLE_SPEC_PATH = join(FIXTURES_DIR, "sample-spec.md");
const TEST_PROJECT_DIR = join(FIXTURES_DIR, "test-project");

// ---------------------------------------------------------------------------
// Mocks — declared before module-under-test imports
// ---------------------------------------------------------------------------

vi.mock("../orchestrator/agentLauncher.js", () => ({
  createAgentLauncher: vi.fn(),
  buildSubAgentPrompt: vi.fn(() => ""),
  buildSubAgentArgs: vi.fn(() => []),
  buildLlmQueryArgs: vi.fn(() => []),
  buildOrchestratorArgs: vi.fn(() => []),
}));

vi.mock("../orchestrator/replManager.js", () => ({
  createReplSession: vi.fn(),
}));

vi.mock("../orchestrator/replHelpers.js", () => ({
  createReplHelpers: vi.fn(),
}));

vi.mock("../isolation/worktreeManager.js", () => ({
  createWorktree: vi.fn(() => ({
    success: true,
    worktreePath: "/tmp/wt",
    branchName: "trellis-exec/test/123",
  })),
  commitPhase: vi.fn(() => true),
  mergeWorktree: vi.fn(() => ({ success: true })),
  cleanupWorktree: vi.fn(),
}));

// Import modules under test AFTER vi.mock declarations
import { parsePlan } from "../compile/planParser.js";
import { enrichPlan } from "../compile/planEnricher.js";
import { runPhases, dryRunReport } from "../runner/phaseRunner.js";
import type { PhaseRunnerConfig } from "../runner/phaseRunner.js";
import {
  resolveExecutionOrder,
  detectTargetPathOverlaps,
} from "../runner/scheduler.js";
import { createAgentLauncher } from "../orchestrator/agentLauncher.js";
import { createReplSession } from "../orchestrator/replManager.js";
import { createReplHelpers } from "../orchestrator/replHelpers.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function createMockOrchestrator(responses: string[]): OrchestratorHandle {
  let callIndex = 0;
  let alive = true;

  return {
    async send(_input: string): Promise<string> {
      const response = responses[callIndex] ?? 'console.log("noop")';
      callIndex++;
      return response;
    },
    isAlive(): boolean {
      return alive;
    },
    kill(): void {
      alive = false;
    },
  };
}

function createMockHelpers(): ReplHelpers {
  return {
    readFile: () => "",
    listDir: () => [],
    searchFiles: () => [],
    getState: () => ({
      currentPhase: "",
      completedPhases: [],
      modifiedFiles: [],
      schemaChanges: [],
      phaseReports: [],
      phaseRetries: {},
    }),
    writePhaseReport: () => {},
    dispatchSubAgent: async () => ({
      success: true,
      output: "",
      filesModified: [],
    }),
    runCheck: async () => ({ passed: true, output: "", exitCode: 0 }),
    llmQuery: async () => "mock response",
  };
}

function makeDefaultConfig(tmpDir: string): PhaseRunnerConfig {
  return {
    tasksJsonPath: join(tmpDir, "tasks.json"),
    statePath: join(tmpDir, "state.json"),
    trajectoryPath: join(tmpDir, "trajectory.jsonl"),
    isolation: "none",
    concurrency: 3,
    maxRetries: 2,
    headless: true,
    verbose: false,
    dryRun: false,
    turnLimit: 100,
    maxConsecutiveErrors: 5,
    pluginRoot: join(tmpDir, "plugin"),
  };
}

function setupTmpDir(tasksJson: TasksJson): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "e2e-test-"));
  writeFileSync(join(tmpDir, "tasks.json"), JSON.stringify(tasksJson));
  mkdirSync(join(tmpDir, "plugin", "agents"), { recursive: true });
  mkdirSync(join(tmpDir, "plugin", "skills"), { recursive: true });
  writeFileSync(
    join(tmpDir, "plugin", "agents", "phase-orchestrator.md"),
    "---\nname: phase-orchestrator\n---\n",
  );
  // Copy spec into project root matching the specRef in tasks.json
  cpSync(SAMPLE_SPEC_PATH, join(tmpDir, "sample-spec.md"));
  return tmpDir;
}

/**
 * Compiles the sample-plan.md fixture via deterministic parse + mock enrichment.
 * Returns a validated TasksJson.
 */
async function compileSamplePlan(): Promise<TasksJson> {
  const planContent = readFileSync(SAMPLE_PLAN_PATH, "utf-8");
  const parseResult = parsePlan(planContent, "./sample-spec.md", "./sample-plan.md");
  expect(parseResult.success).toBe(true);
  expect(parseResult.tasksJson).not.toBeNull();

  // Mock enricher that returns no resolved fields (deterministic parse sufficient)
  const mockEnricher = async () => JSON.stringify({ resolved: [] });
  return await enrichPlan(parseResult, mockEnricher);
}

/**
 * Sets up mocks so that each phase completes successfully via writePhaseReport.
 */
function setupMocksForSuccess(
  phaseReports: Map<string, PhaseReport>,
): void {
  const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;
  const mockCreateReplSession = createReplSession as ReturnType<typeof vi.fn>;
  const mockCreateReplHelpers = createReplHelpers as ReturnType<typeof vi.fn>;

  mockCreateReplHelpers.mockImplementation(() => createMockHelpers());

  let launchCount = 0;
  const phaseIds = [...phaseReports.keys()];

  mockCreateAgentLauncher.mockImplementation(() => ({
    dispatchSubAgent: async () => ({
      success: true,
      output: "",
      filesModified: [],
    }),
    llmQuery: async () => "mock",
    launchOrchestrator: async () => {
      const phaseId = phaseIds[launchCount] ?? phaseIds[phaseIds.length - 1]!;
      launchCount++;
      const report = phaseReports.get(phaseId)!;

      return createMockOrchestrator([
        'console.log("working...")',
        `writePhaseReport(${JSON.stringify(report)})`,
      ]);
    },
  }));

  mockCreateReplSession.mockImplementation(
    (sessionConfig: { helpers: ReplHelpers }) => {
      let consecutiveErrors = 0;

      return {
        async eval(code: string): Promise<ReplEvalResult> {
          if (code.includes("writePhaseReport(")) {
            try {
              const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
              if (jsonMatch?.[1]) {
                const report = JSON.parse(jsonMatch[1]);
                sessionConfig.helpers.writePhaseReport(report);
              }
            } catch {
              // parse failure — ignore
            }
            consecutiveErrors = 0;
            return {
              success: true,
              output: "Phase report written.",
              truncated: false,
              duration: 1,
            };
          }
          consecutiveErrors = 0;
          return {
            success: true,
            output: `ok: ${code.slice(0, 30)}`,
            truncated: false,
            duration: 1,
          };
        },
        restoreScaffold() {},
        getConsecutiveErrors() {
          return consecutiveErrors;
        },
        resetConsecutiveErrors() {
          consecutiveErrors = 0;
        },
        destroy() {},
      } satisfies ReplSession;
    },
  );
}

function hasClaude(): boolean {
  if (!process.env["TRELLIS_E2E_CLAUDE"]) return false;
  try {
    execSync("claude --version", { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Group 1 — No LLM required
// ---------------------------------------------------------------------------

let tmpDir: string;

describe("e2e integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Test 1: Compile — parsePlan + enrichPlan produces valid tasks.json
  // -----------------------------------------------------------------------

  describe("compile: parsePlan + enrichPlan", () => {
    it("produces valid tasks.json from sample-plan.md matching §3 schema", async () => {
      const tasksJson = await compileSamplePlan();

      // Validate against Zod schema
      const validation = TasksJsonSchema.safeParse(tasksJson);
      expect(validation.success).toBe(true);

      // Structure checks
      expect(tasksJson.phases).toHaveLength(2);
      expect(tasksJson.specRef).toBe("./sample-spec.md");
      expect(tasksJson.planRef).toBe("./sample-plan.md");

      // Phase 1: one task targeting src/greet.ts
      const phase1 = tasksJson.phases[0]!;
      expect(phase1.id).toBe("phase-1");
      expect(phase1.tasks).toHaveLength(1);
      const task1 = phase1.tasks[0]!;
      expect(task1.targetPaths).toContain("src/greet.ts");
      expect(task1.specSections).toContain("§2");
      expect(task1.status).toBe("pending");

      // Phase 2: one task targeting src/greet.test.ts
      const phase2 = tasksJson.phases[1]!;
      expect(phase2.id).toBe("phase-2");
      expect(phase2.tasks).toHaveLength(1);
      const task2 = phase2.tasks[0]!;
      expect(task2.targetPaths).toContain("src/greet.test.ts");
      expect(task2.specSections).toContain("§3");
      // test-writer classification for test tasks
      expect(task2.subAgentType).toBe("test-writer");
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: Dry run — dryRunReport prints execution groups
  // -----------------------------------------------------------------------

  describe("dry run: dryRunReport", () => {
    it("prints execution plan with phases, tasks, and grouping", async () => {
      const tasksJson = await compileSamplePlan();
      const report = dryRunReport(tasksJson);

      // Contains phase and task info
      expect(report).toContain("phase-1");
      expect(report).toContain("phase-2");
      expect(report).toContain("src/greet.ts");
      expect(report).toContain("src/greet.test.ts");
      // Contains spec and plan refs
      expect(report).toContain("Spec: ./sample-spec.md");
      expect(report).toContain("Plan: ./sample-plan.md");
      // Contains agent types
      expect(report).toContain("implement");
      expect(report).toContain("test-writer");
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: State round-trip — phase 1 with mocks, then resume at phase 2
  // -----------------------------------------------------------------------

  describe("state round-trip: run, persist, resume", () => {
    it("saves state after phase 1, resumes and completes phase 2", async () => {
      const tasksJson = await compileSamplePlan();
      tmpDir = setupTmpDir(tasksJson);

      // --- Run phase 1 only ---
      // Set up mocks that only advance phase-1, then halt on phase-2
      const phase1Report = makePhaseReport("phase-1", {
        tasksCompleted: [tasksJson.phases[0]!.tasks[0]!.id],
        handoff: "# Phase 1 → Phase 2 Handoff\n\ngreet.ts created.",
      });

      // For phase 1: advance. For phase 2: halt (by returning halt action).
      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;
      const mockCreateReplSession = createReplSession as ReturnType<typeof vi.fn>;
      const mockCreateReplHelpers = createReplHelpers as ReturnType<typeof vi.fn>;

      mockCreateReplHelpers.mockImplementation(() => createMockHelpers());

      let launchCount = 0;
      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
          success: true,
          output: "",
          filesModified: [],
        }),
        llmQuery: async () => "mock",
        launchOrchestrator: async () => {
          launchCount++;
          if (launchCount === 1) {
            // Phase 1: succeed
            return createMockOrchestrator([
              'console.log("phase 1")',
              `writePhaseReport(${JSON.stringify(phase1Report)})`,
            ]);
          }
          // Phase 2: halt (return halt report)
          const haltReport = makePhaseReport("phase-2", {
            status: "failed",
            recommendedAction: "halt",
            tasksCompleted: [],
            tasksFailed: [tasksJson.phases[1]!.tasks[0]!.id],
          });
          return createMockOrchestrator([
            'console.log("phase 2 fail")',
            `writePhaseReport(${JSON.stringify(haltReport)})`,
          ]);
        },
      }));

      mockCreateReplSession.mockImplementation(
        (sessionConfig: { helpers: ReplHelpers }) => {
          let consecutiveErrors = 0;
          return {
            async eval(code: string): Promise<ReplEvalResult> {
              if (code.includes("writePhaseReport(")) {
                try {
                  const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
                  if (jsonMatch?.[1]) {
                    sessionConfig.helpers.writePhaseReport(JSON.parse(jsonMatch[1]));
                  }
                } catch {}
                return { success: true, output: "ok", truncated: false, duration: 1 };
              }
              consecutiveErrors = 0;
              return { success: true, output: "ok", truncated: false, duration: 1 };
            },
            restoreScaffold() {},
            getConsecutiveErrors() { return consecutiveErrors; },
            resetConsecutiveErrors() { consecutiveErrors = 0; },
            destroy() {},
          } satisfies ReplSession;
        },
      );

      const config = makeDefaultConfig(tmpDir);
      const result1 = await runPhases(config);

      // Phase 1 completed, phase 2 halted
      expect(result1.phasesCompleted).toContain("phase-1");
      expect(result1.phasesFailed).toContain("phase-2");

      // --- Verify state.json ---
      const stateRaw = readFileSync(join(tmpDir, "state.json"), "utf-8");
      const state: SharedState = JSON.parse(stateRaw);
      expect(state.completedPhases).toContain("phase-1");
      expect(state.phaseReports.length).toBeGreaterThanOrEqual(1);
      // Handoff should be present
      const phase1ReportFromState = state.phaseReports.find(
        (r) => r.phaseId === "phase-1",
      );
      expect(phase1ReportFromState?.handoff).toContain("greet.ts created");

      // --- Resume: pre-populate state so phase-1 is done, run again ---
      vi.clearAllMocks();

      const resumeState: SharedState = {
        currentPhase: "phase-2",
        completedPhases: ["phase-1"],
        modifiedFiles: [],
        schemaChanges: [],
        phaseReports: [phase1Report],
        phaseRetries: {},
      };
      writeFileSync(join(tmpDir, "state.json"), JSON.stringify(resumeState));

      const phase2Report = makePhaseReport("phase-2", {
        tasksCompleted: [tasksJson.phases[1]!.tasks[0]!.id],
        handoff: "# Phase 2 handoff\nTests created.",
      });

      const reports = new Map<string, PhaseReport>([
        ["phase-2", phase2Report],
      ]);
      setupMocksForSuccess(reports);

      const result2 = await runPhases(config);

      expect(result2.success).toBe(true);
      expect(result2.phasesCompleted).toContain("phase-1");
      expect(result2.phasesCompleted).toContain("phase-2");
      expect(result2.finalState.completedPhases).toContain("phase-1");
      expect(result2.finalState.completedPhases).toContain("phase-2");

      // Only one orchestrator launch for phase-2
      const mockLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;
      expect(mockLauncher).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: Parallel scheduling verification
  // -----------------------------------------------------------------------

  describe("parallel scheduling", () => {
    function makeTask(overrides: Partial<Task> & { id: string }): Task {
      return {
        title: overrides.id,
        description: "",
        dependsOn: [],
        specSections: [],
        targetPaths: [],
        acceptanceCriteria: [],
        subAgentType: "implement",
        status: "pending",
        ...overrides,
      };
    }

    it("schedules A+C+D in parallel, then B (§10 criteria #8)", () => {
      const tasks = [
        makeTask({ id: "A", targetPaths: ["a.ts"] }),
        makeTask({ id: "B", dependsOn: ["A"], targetPaths: ["b.ts"] }),
        makeTask({ id: "C", targetPaths: ["c.ts"] }),
        makeTask({ id: "D", targetPaths: ["d.ts"] }),
      ];

      const groups = resolveExecutionOrder(tasks);

      expect(groups).toHaveLength(2);
      expect(groups[0]!.taskIds).toEqual(
        expect.arrayContaining(["A", "C", "D"]),
      );
      expect(groups[0]!.taskIds).toHaveLength(3);
      expect(groups[0]!.parallelizable).toBe(true);
      expect(groups[1]!.taskIds).toEqual(["B"]);
    });

    it("serializes tasks with overlapping targetPaths (§10 criteria #9)", () => {
      const tasks = [
        makeTask({ id: "X", targetPaths: ["src/foo.ts"] }),
        makeTask({ id: "Y", targetPaths: ["src/foo.ts"] }),
      ];

      const groups = resolveExecutionOrder(tasks);
      expect(groups).toHaveLength(2);
      expect(groups[0]!.taskIds).toEqual(["X"]);
      expect(groups[1]!.taskIds).toEqual(["Y"]);

      // Also verify detectTargetPathOverlaps
      const overlaps = detectTargetPathOverlaps(tasks);
      expect(overlaps).toEqual([["X", "Y"]]);
    });
  });

  // -----------------------------------------------------------------------
  // Test 5: Phase retry with corrective tasks (§10 criteria #10)
  // -----------------------------------------------------------------------

  describe("phase retry with corrective tasks", () => {
    it("retries with corrective tasks, then advances", async () => {
      const tasksJson = await compileSamplePlan();
      tmpDir = setupTmpDir(tasksJson);
      const config = makeDefaultConfig(tmpDir);

      const retryReport = makePhaseReport("phase-1", {
        status: "complete",
        recommendedAction: "retry",
        correctiveTasks: ["Fix the export statement"],
        tasksCompleted: [],
        tasksFailed: [tasksJson.phases[0]!.tasks[0]!.id],
      });

      const successReport = makePhaseReport("phase-1", {
        status: "complete",
        recommendedAction: "advance",
        tasksCompleted: [tasksJson.phases[0]!.tasks[0]!.id],
      });

      const phase2Report = makePhaseReport("phase-2", {
        tasksCompleted: [tasksJson.phases[1]!.tasks[0]!.id],
      });

      const mockCreateAgentLauncher = createAgentLauncher as ReturnType<typeof vi.fn>;
      const mockCreateReplSession = createReplSession as ReturnType<typeof vi.fn>;
      const mockCreateReplHelpers = createReplHelpers as ReturnType<typeof vi.fn>;

      mockCreateReplHelpers.mockImplementation(() => createMockHelpers());

      let launchCount = 0;
      mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
          success: true,
          output: "",
          filesModified: [],
        }),
        llmQuery: async () => "mock",
        launchOrchestrator: async () => {
          const idx = launchCount;
          launchCount++;

          let report: PhaseReport;
          if (idx === 0) {
            report = retryReport;
          } else if (idx === 1) {
            report = successReport;
          } else {
            report = phase2Report;
          }

          return createMockOrchestrator([
            'console.log("work")',
            `writePhaseReport(${JSON.stringify(report)})`,
          ]);
        },
      }));

      mockCreateReplSession.mockImplementation(
        (sessionConfig: { helpers: ReplHelpers }) => {
          let consecutiveErrors = 0;
          return {
            async eval(code: string): Promise<ReplEvalResult> {
              if (code.includes("writePhaseReport(")) {
                try {
                  const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
                  if (jsonMatch?.[1]) {
                    sessionConfig.helpers.writePhaseReport(JSON.parse(jsonMatch[1]));
                  }
                } catch {}
                return { success: true, output: "ok", truncated: false, duration: 1 };
              }
              consecutiveErrors = 0;
              return { success: true, output: "ok", truncated: false, duration: 1 };
            },
            restoreScaffold() {},
            getConsecutiveErrors() { return consecutiveErrors; },
            resetConsecutiveErrors() { consecutiveErrors = 0; },
            destroy() {},
          } satisfies ReplSession;
        },
      );

      const result = await runPhases(config);

      expect(result.success).toBe(true);
      expect(result.phasesCompleted).toContain("phase-1");
      expect(result.phasesCompleted).toContain("phase-2");
      // Verify retry happened
      expect(result.finalState.phaseRetries["phase-1"]).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Test 6: Handoff consumption (§10 criteria #4)
  // -----------------------------------------------------------------------

  describe("handoff from phase 1 consumed by phase 2", () => {
    it("handoff string persists in state and is available to phase 2", async () => {
      const tasksJson = await compileSamplePlan();
      tmpDir = setupTmpDir(tasksJson);

      const handoffText =
        "# Phase 1 → Phase 2 Handoff\n\n## What was built\n- greet.ts with greet() function";

      const reports = new Map<string, PhaseReport>([
        [
          "phase-1",
          makePhaseReport("phase-1", {
            tasksCompleted: [tasksJson.phases[0]!.tasks[0]!.id],
            handoff: handoffText,
          }),
        ],
        [
          "phase-2",
          makePhaseReport("phase-2", {
            tasksCompleted: [tasksJson.phases[1]!.tasks[0]!.id],
          }),
        ],
      ]);
      setupMocksForSuccess(reports);

      const config = makeDefaultConfig(tmpDir);
      const result = await runPhases(config);

      expect(result.success).toBe(true);

      // Verify handoff is in state.json
      const stateRaw = readFileSync(join(tmpDir, "state.json"), "utf-8");
      const state: SharedState = JSON.parse(stateRaw);
      const phase1Report = state.phaseReports.find(
        (r) => r.phaseId === "phase-1",
      );
      expect(phase1Report?.handoff).toBe(handoffText);
    });
  });

  // -----------------------------------------------------------------------
  // Test 7: REPL output truncation (§10 criteria #5)
  // -----------------------------------------------------------------------

  describe("REPL output truncation", () => {
    it("truncates output exceeding 8192 chars with marker", async () => {
      // Use the REAL createReplSession (not mocked) for this test.
      // We need to import it dynamically to bypass the vi.mock.
      const { createReplSession: realCreateReplSession } = await vi.importActual<
        typeof import("../orchestrator/replManager.js")
      >("../orchestrator/replManager.js");

      const helpers = createMockHelpers();
      const session = realCreateReplSession({
        projectRoot: tmpdir(),
        outputLimit: 8192,
        timeout: 10_000,
        helpers,
      });

      try {
        // Generate output larger than 8192 chars
        const result = await session.eval(
          'console.log("x".repeat(10000))',
        );

        expect(result.success).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.output).toContain("[TRUNCATED");
        expect(result.output).toContain("10000 total");
      } finally {
        session.destroy();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Test 8: Architectural validation
  // -----------------------------------------------------------------------

  describe("architectural validation", () => {
    it("phaseRunner.ts has zero direct LLM imports", () => {
      const phaseRunnerSource = readFileSync(
        resolve(import.meta.dirname ?? ".", "../runner/phaseRunner.ts"),
        "utf-8",
      );

      // Collect all import lines
      const importLines = phaseRunnerSource
        .split("\n")
        .filter((line) => line.trimStart().startsWith("import"));

      // No import should reference 'claude' as a module (direct LLM dependency)
      for (const line of importLines) {
        // Allow type imports from agentLauncher (interface only)
        if (line.includes("agentLauncher")) {
          // Should import via the factory function or types, not direct claude SDK
          expect(line).not.toMatch(/from\s+["']claude/);
        }
        // No direct anthropic/claude SDK imports
        expect(line).not.toMatch(/from\s+["']@anthropic/);
        expect(line).not.toMatch(/from\s+["']anthropic/);
      }
    });

    it("trajectory.jsonl is written after a phase run", async () => {
      const tasksJson = await compileSamplePlan();
      tmpDir = setupTmpDir(tasksJson);

      const reports = new Map<string, PhaseReport>([
        [
          "phase-1",
          makePhaseReport("phase-1", {
            tasksCompleted: [tasksJson.phases[0]!.tasks[0]!.id],
          }),
        ],
        [
          "phase-2",
          makePhaseReport("phase-2", {
            tasksCompleted: [tasksJson.phases[1]!.tasks[0]!.id],
          }),
        ],
      ]);
      setupMocksForSuccess(reports);

      const config = makeDefaultConfig(tmpDir);
      await runPhases(config);

      // Trajectory log should exist and contain valid JSONL
      const trajectoryPath = join(tmpDir, "trajectory.jsonl");
      expect(existsSync(trajectoryPath)).toBe(true);

      const lines = readFileSync(trajectoryPath, "utf-8")
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);

      expect(lines.length).toBeGreaterThan(0);

      // Each line should be valid JSON with required fields
      for (const line of lines) {
        const event = JSON.parse(line);
        expect(event).toHaveProperty("phaseId");
        expect(event).toHaveProperty("timestamp");
        expect(event).toHaveProperty("type");
        expect(event).toHaveProperty("duration");
        expect(typeof event.duration).toBe("number");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Group 2 — Requires claude CLI
  // -----------------------------------------------------------------------

  describe.skipIf(!hasClaude())("full end-to-end with claude CLI", () => {
    it(
      "compiles plan and runs against test project",
      { timeout: 600_000 },
      async () => {
        // Copy test-project to temp dir
        tmpDir = mkdtempSync(join(tmpdir(), "e2e-full-"));
        const projectDir = join(tmpDir, "test-project");
        cpSync(TEST_PROJECT_DIR, projectDir, { recursive: true });

        // Copy spec and plan
        cpSync(SAMPLE_SPEC_PATH, join(projectDir, "sample-spec.md"));
        cpSync(SAMPLE_PLAN_PATH, join(projectDir, "sample-plan.md"));

        // Initialize git repo
        execSync("git init && git add . && git commit -m 'init'", {
          cwd: projectDir,
          stdio: "pipe",
        });

        // Compile plan → tasks.json using real parsePlan + mock enricher
        const planContent = readFileSync(
          join(projectDir, "sample-plan.md"),
          "utf-8",
        );
        const parseResult = parsePlan(
          planContent,
          "./sample-spec.md",
          "./sample-plan.md",
        );
        expect(parseResult.success).toBe(true);
        const mockEnricher = async () => JSON.stringify({ resolved: [] });
        const compiledTasks = await enrichPlan(parseResult, mockEnricher);
        const tasksJsonPath = join(projectDir, "tasks.json");
        writeFileSync(tasksJsonPath, JSON.stringify(compiledTasks, null, 2));

        // Run trellis-exec via CLI
        const cliPath = resolve(
          import.meta.dirname ?? ".",
          "../../dist/cli.js",
        );

        // Build first if needed
        try {
          execSync("npm run build", {
            cwd: resolve(import.meta.dirname ?? ".", "../.."),
            stdio: "pipe",
          });
        } catch {
          // build may already be done
        }

        execSync(
          `node ${cliPath} run ${tasksJsonPath} --headless --isolation none`,
          {
            cwd: projectDir,
            timeout: 300_000,
            stdio: "pipe",
            encoding: "utf-8",
          },
        );

        // Verify outputs exist
        expect(existsSync(join(projectDir, "src/greet.ts"))).toBe(true);
        expect(existsSync(join(projectDir, "src/greet.test.ts"))).toBe(true);

        // Verify tests pass in the project
        const testResult = execSync("npm test", {
          cwd: projectDir,
          stdio: "pipe",
          encoding: "utf-8",
        });
        expect(testResult).toBeDefined();

        // Verify trajectory.jsonl exists
        const trajectoryPath = join(projectDir, "trajectory.jsonl");
        expect(existsSync(trajectoryPath)).toBe(true);

        const trajectoryLines = readFileSync(trajectoryPath, "utf-8")
          .trim()
          .split("\n")
          .filter((l) => l.length > 0);

        for (const line of trajectoryLines) {
          const event = JSON.parse(line);
          expect(event).toHaveProperty("phaseId");
          expect(event).toHaveProperty("timestamp");
        }
      },
    );
  });
});
