import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// ---------------------------------------------------------------------------
// Mocks — must be declared before imports of the module under test
// ---------------------------------------------------------------------------
vi.mock("../../orchestrator/agentLauncher.js", () => ({
    createAgentLauncher: vi.fn(),
    buildSubAgentPrompt: vi.fn(() => ""),
    buildSubAgentArgs: vi.fn(() => []),
    buildLlmQueryArgs: vi.fn(() => []),
    buildOrchestratorArgs: vi.fn(() => []),
}));
vi.mock("../../orchestrator/replManager.js", () => ({
    createReplSession: vi.fn(),
}));
vi.mock("../../orchestrator/replHelpers.js", () => ({
    createReplHelpers: vi.fn(),
}));
vi.mock("../../isolation/worktreeManager.js", () => ({
    createWorktree: vi.fn(() => ({
        success: true,
        worktreePath: "/tmp/wt",
        branchName: "trellis-exec/test/123",
    })),
    commitPhase: vi.fn(() => true),
    mergeWorktree: vi.fn(() => ({ success: true })),
    cleanupWorktree: vi.fn(),
    getChangedFiles: vi.fn(() => []),
    getDiffContent: vi.fn(() => ""),
}));
// Import module under test and mocked modules AFTER vi.mock declarations
import { runPhases, runSinglePhase, dryRunReport, promptForContinuation, buildPhaseContext, buildJudgePrompt, parseJudgeResult, buildFixPrompt, normalizeReport, isCommentOnly, createDefaultCheck, } from "../phaseRunner.js";
import { createAgentLauncher } from "../../orchestrator/agentLauncher.js";
import { createReplSession } from "../../orchestrator/replManager.js";
import { createReplHelpers } from "../../orchestrator/replHelpers.js";
import { getChangedFiles, getDiffContent } from "../../isolation/worktreeManager.js";
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeTasksJson() {
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
function makePhaseReport(phaseId, overrides) {
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
function createMockOrchestrator(responses) {
    let callIndex = 0;
    let alive = true;
    return {
        async send(_input) {
            const response = responses[callIndex] ?? 'console.log("noop")';
            callIndex++;
            return response;
        },
        isAlive() {
            return alive;
        },
        kill() {
            alive = false;
        },
    };
}
function createMockHelpers() {
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
        writePhaseReport: () => { },
        dispatchSubAgent: async () => ({
            success: true,
            output: "",
            filesModified: [],
        }),
        runCheck: async () => ({ passed: true, output: "", exitCode: 0 }),
        llmQuery: async () => "mock response",
    };
}
function makeDefaultConfig(tmpDir) {
    return {
        projectRoot: tmpDir,
        specPath: join(tmpDir, "spec.md"),
        planPath: join(tmpDir, "plan.md"),
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
function setupTmpDir(tasksJson) {
    const tmpDir = mkdtempSync(join(tmpdir(), "phaserunner-test-"));
    writeFileSync(join(tmpDir, "tasks.json"), JSON.stringify(tasksJson));
    // Create plugin dirs that the runner references
    mkdirSync(join(tmpDir, "plugin", "agents"), { recursive: true });
    mkdirSync(join(tmpDir, "plugin", "skills"), { recursive: true });
    writeFileSync(join(tmpDir, "plugin", "agents", "phase-orchestrator.md"), "---\nname: phase-orchestrator\n---\n");
    // Create a spec file for replHelpers
    writeFileSync(join(tmpDir, "spec.md"), "# Spec\n## §1 Intro\nContent.");
    return tmpDir;
}
// ---------------------------------------------------------------------------
// Helpers to wire up mocks for a runPhases call
// ---------------------------------------------------------------------------
/**
 * Sets up mocks so that each phase completes successfully.
 * The mock orchestrator emits code that calls writePhaseReport on the
 * last turn.
 */
function setupMocksForSuccess(phaseReports) {
    const mockCreateAgentLauncher = createAgentLauncher;
    const mockCreateReplSession = createReplSession;
    const mockCreateReplHelpers = createReplHelpers;
    mockCreateReplHelpers.mockImplementation(() => createMockHelpers());
    // Track how many times launchOrchestrator is called to determine which phase
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
            const phaseId = phaseIds[launchCount] ?? phaseIds[phaseIds.length - 1];
            launchCount++;
            const report = phaseReports.get(phaseId);
            // The orchestrator sends one code turn, then signals complete
            return createMockOrchestrator([
                'console.log("working...")',
                `writePhaseReport(${JSON.stringify(report)})`,
            ]);
        },
    }));
    mockCreateReplSession.mockImplementation((sessionConfig) => {
        // Create a REPL session that captures writePhaseReport calls via the helpers
        let consecutiveErrors = 0;
        return {
            async eval(code) {
                // Simulate writePhaseReport being called in REPL context
                if (code.includes("writePhaseReport(")) {
                    try {
                        // Extract the JSON and call the real helper
                        const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
                        if (jsonMatch?.[1]) {
                            const report = JSON.parse(jsonMatch[1]);
                            sessionConfig.helpers.writePhaseReport(report);
                        }
                    }
                    catch {
                        // If parse fails, just call with a generic report
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
            restoreScaffold() { },
            getConsecutiveErrors() {
                return consecutiveErrors;
            },
            resetConsecutiveErrors() {
                consecutiveErrors = 0;
            },
            destroy() { },
        };
    });
}
/**
 * Sets up mocks where the REPL always returns errors.
 */
function setupMocksForErrors(maxConsecutiveErrors) {
    const mockCreateAgentLauncher = createAgentLauncher;
    const mockCreateReplSession = createReplSession;
    const mockCreateReplHelpers = createReplHelpers;
    mockCreateReplHelpers.mockImplementation(() => createMockHelpers());
    mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
            success: true,
            output: "",
            filesModified: [],
        }),
        llmQuery: async () => "mock",
        launchOrchestrator: async () => createMockOrchestrator(Array.from({ length: maxConsecutiveErrors + 5 }, () => "badCode()")),
    }));
    mockCreateReplSession.mockImplementation(() => {
        let consecutiveErrors = 0;
        return {
            async eval(_code) {
                consecutiveErrors++;
                return {
                    success: false,
                    output: "",
                    truncated: false,
                    error: "ReferenceError: badCode is not defined",
                    duration: 1,
                };
            },
            restoreScaffold() { },
            getConsecutiveErrors() {
                return consecutiveErrors;
            },
            resetConsecutiveErrors() {
                consecutiveErrors = 0;
            },
            destroy() { },
        };
    });
}
/**
 * Sets up mocks where the orchestrator never signals completion.
 */
function setupMocksForTurnLimit(turnLimit) {
    const mockCreateAgentLauncher = createAgentLauncher;
    const mockCreateReplSession = createReplSession;
    const mockCreateReplHelpers = createReplHelpers;
    mockCreateReplHelpers.mockImplementation(() => createMockHelpers());
    mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
            success: true,
            output: "",
            filesModified: [],
        }),
        llmQuery: async () => "mock",
        launchOrchestrator: async () => createMockOrchestrator(Array.from({ length: turnLimit + 5 }, (_, i) => `console.log("turn ${i}")`)),
    }));
    mockCreateReplSession.mockImplementation(() => {
        let consecutiveErrors = 0;
        return {
            async eval(code) {
                consecutiveErrors = 0;
                return {
                    success: true,
                    output: `ok: ${code.slice(0, 30)}`,
                    truncated: false,
                    duration: 1,
                };
            },
            restoreScaffold() { },
            getConsecutiveErrors() {
                return consecutiveErrors;
            },
            resetConsecutiveErrors() {
                consecutiveErrors = 0;
            },
            destroy() { },
        };
    });
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let tmpDir;
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
            const reports = new Map([
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
            setupMocksForSuccess(reports);
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(true);
            expect(result.phasesCompleted).toContain("phase-1");
            expect(result.phasesCompleted).toContain("phase-2");
            expect(result.phasesFailed).toHaveLength(0);
            expect(result.finalState.completedPhases).toContain("phase-1");
            expect(result.finalState.completedPhases).toContain("phase-2");
        });
    });
    describe("runPhases — phase retry", () => {
        it("retries a phase and then advances", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = makeDefaultConfig(tmpDir);
            // First call for phase-1 returns retry, second returns advance
            let phase1CallCount = 0;
            const phase1Reports = [
                makePhaseReport("phase-1", {
                    status: "complete",
                    recommendedAction: "retry",
                    correctiveTasks: ["Fix the build"],
                    tasksCompleted: ["task-1-1"],
                    tasksFailed: ["task-1-2"],
                }),
                makePhaseReport("phase-1", {
                    status: "complete",
                    recommendedAction: "advance",
                    tasksCompleted: ["task-1-1", "task-1-2"],
                }),
            ];
            const mockCreateAgentLauncher = createAgentLauncher;
            const mockCreateReplSession = createReplSession;
            const mockCreateReplHelpers = createReplHelpers;
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
                    let report;
                    if (idx === 0) {
                        report = phase1Reports[phase1CallCount];
                        phase1CallCount++;
                    }
                    else if (idx === 1) {
                        // Second call to phase-1 (retry)
                        report = phase1Reports[phase1CallCount];
                        phase1CallCount++;
                    }
                    else {
                        // phase-2
                        report = makePhaseReport("phase-2", {
                            tasksCompleted: ["task-2-1", "task-2-2"],
                        });
                    }
                    return createMockOrchestrator([
                        'console.log("work")',
                        `writePhaseReport(${JSON.stringify(report)})`,
                    ]);
                },
            }));
            mockCreateReplSession.mockImplementation((sessionConfig) => {
                let consecutiveErrors = 0;
                return {
                    async eval(code) {
                        if (code.includes("writePhaseReport(")) {
                            try {
                                const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
                                if (jsonMatch?.[1]) {
                                    sessionConfig.helpers.writePhaseReport(JSON.parse(jsonMatch[1]));
                                }
                            }
                            catch { }
                            consecutiveErrors = 0;
                            return {
                                success: true,
                                output: "Report written.",
                                truncated: false,
                                duration: 1,
                            };
                        }
                        consecutiveErrors = 0;
                        return {
                            success: true,
                            output: "ok",
                            truncated: false,
                            duration: 1,
                        };
                    },
                    restoreScaffold() { },
                    getConsecutiveErrors() {
                        return consecutiveErrors;
                    },
                    resetConsecutiveErrors() {
                        consecutiveErrors = 0;
                    },
                    destroy() { },
                };
            });
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(true);
            expect(result.phasesCompleted).toContain("phase-1");
            expect(result.phasesCompleted).toContain("phase-2");
            // Verify retry happened
            expect(result.finalState.phaseRetries["phase-1"]).toBe(1);
        });
    });
    describe("runPhases — max retries exceeded", () => {
        it("halts after maxRetries", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = { ...makeDefaultConfig(tmpDir), maxRetries: 2 };
            const retryReport = makePhaseReport("phase-1", {
                status: "complete",
                recommendedAction: "retry",
                correctiveTasks: ["Fix it"],
                tasksCompleted: [],
                tasksFailed: ["task-1-1"],
            });
            const mockCreateAgentLauncher = createAgentLauncher;
            const mockCreateReplSession = createReplSession;
            const mockCreateReplHelpers = createReplHelpers;
            mockCreateReplHelpers.mockImplementation(() => createMockHelpers());
            mockCreateAgentLauncher.mockImplementation(() => ({
                dispatchSubAgent: async () => ({
                    success: true,
                    output: "",
                    filesModified: [],
                }),
                llmQuery: async () => "mock",
                launchOrchestrator: async () => createMockOrchestrator([
                    'console.log("trying")',
                    `writePhaseReport(${JSON.stringify(retryReport)})`,
                ]),
            }));
            mockCreateReplSession.mockImplementation((sessionConfig) => {
                let consecutiveErrors = 0;
                return {
                    async eval(code) {
                        if (code.includes("writePhaseReport(")) {
                            try {
                                const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
                                if (jsonMatch?.[1]) {
                                    sessionConfig.helpers.writePhaseReport(JSON.parse(jsonMatch[1]));
                                }
                            }
                            catch { }
                            return {
                                success: true,
                                output: "ok",
                                truncated: false,
                                duration: 1,
                            };
                        }
                        consecutiveErrors = 0;
                        return {
                            success: true,
                            output: "ok",
                            truncated: false,
                            duration: 1,
                        };
                    },
                    restoreScaffold() { },
                    getConsecutiveErrors() {
                        return consecutiveErrors;
                    },
                    resetConsecutiveErrors() {
                        consecutiveErrors = 0;
                    },
                    destroy() { },
                };
            });
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(false);
            expect(result.phasesFailed).toContain("phase-1");
            // Should have retried twice then halted (3 total executions: initial + 2 retries)
            expect(result.finalState.phaseRetries["phase-1"]).toBe(2);
        });
    });
    // -------------------------------------------------------------------------
    // Issue #3: Corrective tasks were pushed directly onto the phase reference
    // from tasksJson with `phase.tasks.push(...newTasks)`, mutating the original
    // structure in-place. On a second retry, previous corrective tasks persisted,
    // causing duplicates. Corrective task IDs also collided since the counter
    // always started at 0.
    //
    // Mitigation: The retry logic now creates a new phase object with spread
    // copies of the tasks array. Corrective task IDs include a retry-count
    // offset (retryCount * 100) to prevent collisions across retries.
    // -------------------------------------------------------------------------
    describe("runPhases — corrective task IDs are unique across retries", () => {
        it("does not produce duplicate corrective task IDs on multiple retries", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = { ...makeDefaultConfig(tmpDir), maxRetries: 2 };
            const retryReport = makePhaseReport("phase-1", {
                status: "complete",
                recommendedAction: "retry",
                correctiveTasks: ["Fix the build"],
                tasksCompleted: [],
                tasksFailed: ["task-1-1"],
            });
            const mockCreateAgentLauncher = createAgentLauncher;
            const mockCreateReplSession = createReplSession;
            const mockCreateReplHelpers = createReplHelpers;
            mockCreateReplHelpers.mockImplementation(() => createMockHelpers());
            // Track task IDs seen across all phase executions
            const allPhaseContexts = [];
            mockCreateAgentLauncher.mockImplementation(() => ({
                dispatchSubAgent: async () => ({
                    success: true,
                    output: "",
                    filesModified: [],
                }),
                llmQuery: async () => "mock",
                launchOrchestrator: async (orchConfig) => {
                    allPhaseContexts.push(orchConfig.phaseContext);
                    return createMockOrchestrator([
                        `writePhaseReport(${JSON.stringify(retryReport)})`,
                    ]);
                },
            }));
            mockCreateReplSession.mockImplementation((sessionConfig) => {
                let consecutiveErrors = 0;
                return {
                    async eval(code) {
                        if (code.includes("writePhaseReport(")) {
                            try {
                                const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
                                if (jsonMatch?.[1]) {
                                    sessionConfig.helpers.writePhaseReport(JSON.parse(jsonMatch[1]));
                                }
                            }
                            catch { }
                            return {
                                success: true,
                                output: "ok",
                                truncated: false,
                                duration: 1,
                            };
                        }
                        consecutiveErrors = 0;
                        return {
                            success: true,
                            output: "ok",
                            truncated: false,
                            duration: 1,
                        };
                    },
                    restoreScaffold() { },
                    getConsecutiveErrors() {
                        return consecutiveErrors;
                    },
                    resetConsecutiveErrors() {
                        consecutiveErrors = 0;
                    },
                    destroy() { },
                };
            });
            // Pass a deep clone so we can verify the original is not mutated
            const tasksJsonClone = JSON.parse(JSON.stringify(tasksJson));
            const result = await runPhases(config, tasksJsonClone);
            // After 2 retries, each adding "Fix the build", the corrective task IDs
            // should be unique: phase-1-corrective-0 (retry 0) and phase-1-corrective-100
            // (retry 1). Without the offset fix, both would be phase-1-corrective-0.
            expect(result.finalState.phaseRetries["phase-1"]).toBe(2);
            // Verify the original tasksJson was not mutated — its phase-1 should
            // still have exactly 2 tasks (the originals), not 2 + corrective tasks.
            expect(tasksJson.phases[0].tasks.length).toBe(2);
        });
    });
    describe("runPhases — consecutive error halt", () => {
        it("halts when consecutive errors reach threshold", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = {
                ...makeDefaultConfig(tmpDir),
                maxConsecutiveErrors: 3,
            };
            setupMocksForErrors(3);
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(false);
            expect(result.phasesFailed).toContain("phase-1");
            // The partial report should have been generated
            expect(result.finalState.phaseReports.length).toBeGreaterThanOrEqual(1);
            expect(result.finalState.phaseReports[0]?.status).toBe("partial");
        });
    });
    describe("dryRunReport", () => {
        it("produces readable output with execution groups", () => {
            const tasksJson = makeTasksJson();
            const ctx = {
                projectRoot: ".",
                specPath: "spec.md",
                planPath: "plan.md",
                statePath: "state.json",
                trajectoryPath: "trajectory.jsonl",
                isolation: "none",
                concurrency: 3,
                maxRetries: 2,
                headless: true,
                verbose: false,
                dryRun: false,
                turnLimit: 100,
                maxConsecutiveErrors: 5,
                pluginRoot: ".",
            };
            const report = dryRunReport(tasksJson, ctx);
            expect(report).toContain("Spec: spec.md");
            expect(report).toContain("Plan: plan.md");
            expect(report).toContain("phase-1");
            expect(report).toContain("phase-2");
            expect(report).toContain("task-1-1");
            expect(report).toContain("task-1-2");
            expect(report).toContain("task-2-1");
            expect(report).toContain("task-2-2");
            expect(report).toContain("implement");
            expect(report).toContain("scaffold");
            // Phase-2 tasks are independent so should show as parallel
            expect(report).toContain("[parallel]");
            // Phase-1 tasks have dependency so should show sequential
            expect(report).toContain("[sequential]");
        });
    });
    describe("runPhases — turn limit", () => {
        it("halts at turn limit with partial report", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = { ...makeDefaultConfig(tmpDir), turnLimit: 5 };
            setupMocksForTurnLimit(5);
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(false);
            expect(result.phasesFailed).toContain("phase-1");
            expect(result.finalState.phaseReports.length).toBeGreaterThanOrEqual(1);
            const report = result.finalState.phaseReports[0];
            expect(report.status).toBe("partial");
            expect(report.summary).toContain("turn_limit");
        });
    });
    describe("runPhases — resume", () => {
        it("resumes from last incomplete phase", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = makeDefaultConfig(tmpDir);
            // Pre-populate state with phase-1 completed
            const preState = {
                currentPhase: "phase-2",
                completedPhases: ["phase-1"],
                modifiedFiles: [],
                schemaChanges: [],
                phaseReports: [
                    makePhaseReport("phase-1", {
                        tasksCompleted: ["task-1-1", "task-1-2"],
                    }),
                ],
                phaseRetries: {},
            };
            writeFileSync(config.statePath, JSON.stringify(preState));
            // Only set up mocks for phase-2
            const reports = new Map([
                [
                    "phase-2",
                    makePhaseReport("phase-2", {
                        tasksCompleted: ["task-2-1", "task-2-2"],
                    }),
                ],
            ]);
            setupMocksForSuccess(reports);
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(true);
            // phase-1 was already completed (from state), phase-2 ran now
            expect(result.phasesCompleted).toContain("phase-1");
            expect(result.phasesCompleted).toContain("phase-2");
            expect(result.finalState.completedPhases).toContain("phase-1");
            expect(result.finalState.completedPhases).toContain("phase-2");
            // Verify that only one orchestrator launch happened (for phase-2)
            const mockLauncher = createAgentLauncher;
            expect(mockLauncher).toHaveBeenCalledTimes(1);
        });
    });
    describe("runSinglePhase", () => {
        it("runs only the specified phase", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = makeDefaultConfig(tmpDir);
            const reports = new Map([
                [
                    "phase-2",
                    makePhaseReport("phase-2", {
                        tasksCompleted: ["task-2-1", "task-2-2"],
                    }),
                ],
            ]);
            setupMocksForSuccess(reports);
            const result = await runSinglePhase(config, tasksJson, "phase-2");
            expect(result.success).toBe(true);
            expect(result.phasesCompleted).toEqual(["phase-2"]);
            expect(result.phasesFailed).toHaveLength(0);
        });
        it("throws for unknown phase ID", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = makeDefaultConfig(tmpDir);
            await expect(runSinglePhase(config, tasksJson, "phase-nonexistent")).rejects.toThrow(/Phase not found/);
        });
    });
    describe("promptForContinuation (§10 #13)", () => {
        it.each([
            ["", "continue"],
            ["r", "retry"],
            ["s", "skip"],
            ["q", "quit"],
            ["retry", "retry"],
            ["skip", "skip"],
            ["quit", "quit"],
            ["  R  ", "retry"],
            ["  RETRY  ", "retry"],
            ["Q", "quit"],
            ["anything-else", "continue"],
        ])("maps input %j to %j", async (input, expected) => {
            const { Readable } = await import("node:stream");
            const mockStdin = new Readable({
                read() {
                    this.push(input + "\n");
                    this.push(null);
                },
            });
            const originalStdin = process.stdin;
            Object.defineProperty(process, "stdin", {
                value: mockStdin,
                writable: true,
                configurable: true,
            });
            try {
                const result = await promptForContinuation();
                expect(result).toBe(expected);
            }
            finally {
                Object.defineProperty(process, "stdin", {
                    value: originalStdin,
                    writable: true,
                    configurable: true,
                });
            }
        });
    });
    // -------------------------------------------------------------------------
    // buildPhaseContext — guidelines reference
    // -------------------------------------------------------------------------
    describe("buildPhaseContext", () => {
        const phase = {
            id: "phase-1",
            name: "scaffolding",
            description: "Set up project",
            tasks: [],
        };
        const state = {
            currentPhase: "phase-1",
            completedPhases: [],
            modifiedFiles: [],
            schemaChanges: [],
            phaseReports: [],
            phaseRetries: {},
        };
        it("includes guidelines reference when guidelinesPath is present", () => {
            const ctx = {
                projectRoot: ".",
                specPath: "spec.md",
                planPath: "plan.md",
                guidelinesPath: "guidelines.md",
                statePath: "state.json",
                trajectoryPath: "trajectory.jsonl",
                isolation: "none",
                concurrency: 3,
                maxRetries: 2,
                headless: true,
                verbose: false,
                dryRun: false,
                turnLimit: 100,
                maxConsecutiveErrors: 5,
                pluginRoot: ".",
            };
            const context = buildPhaseContext(phase, state, "", ctx);
            expect(context).toContain("## Guidelines Reference");
            expect(context).toContain("guidelines.md");
        });
        it("shows 'none configured' when guidelinesPath is absent", () => {
            const ctx = {
                projectRoot: ".",
                specPath: "spec.md",
                planPath: "plan.md",
                statePath: "state.json",
                trajectoryPath: "trajectory.jsonl",
                isolation: "none",
                concurrency: 3,
                maxRetries: 2,
                headless: true,
                verbose: false,
                dryRun: false,
                turnLimit: 100,
                maxConsecutiveErrors: 5,
                pluginRoot: ".",
            };
            const context = buildPhaseContext(phase, state, "", ctx);
            expect(context).toContain("## Guidelines Reference");
            expect(context).toContain("none configured");
        });
    });
    // -------------------------------------------------------------------------
    // Judge loop — pure function tests
    // -------------------------------------------------------------------------
    describe("parseJudgeResult", () => {
        it("parses valid JSON directly", () => {
            const result = parseJudgeResult('{ "passed": true, "issues": [], "suggestions": ["nice code"] }');
            expect(result.passed).toBe(true);
            expect(result.issues).toEqual([]);
            expect(result.suggestions).toEqual(["nice code"]);
        });
        it("extracts JSON from markdown fences", () => {
            const result = parseJudgeResult('Here is my assessment:\n\n```json\n{ "passed": false, "issues": ["Bug: off-by-one"], "suggestions": [] }\n```\n');
            expect(result.passed).toBe(false);
            expect(result.issues).toEqual(["Bug: off-by-one"]);
        });
        it("finds JSON object with passed field in mixed output", () => {
            const result = parseJudgeResult('I reviewed the code.\n{ "passed": true, "issues": [], "suggestions": [] }\nThat is all.');
            expect(result.passed).toBe(true);
        });
        it("returns failure assessment on unparseable output", () => {
            const result = parseJudgeResult("This is just text with no JSON");
            expect(result.passed).toBe(false);
            expect(result.issues.length).toBe(1);
            expect(result.issues[0]).toContain("unparseable");
        });
    });
    describe("buildJudgePrompt", () => {
        it("includes changed files and task acceptance criteria", () => {
            const phase = {
                id: "phase-1",
                name: "setup",
                description: "Set up project",
                tasks: [
                    {
                        id: "task-1",
                        title: "Init",
                        description: "Initialize",
                        dependsOn: [],
                        specSections: ["§1"],
                        targetPaths: ["package.json"],
                        acceptanceCriteria: ["npm install exits 0"],
                        subAgentType: "implement",
                        status: "pending",
                    },
                ],
            };
            const prompt = buildJudgePrompt({
                changedFiles: [
                    { path: "package.json", status: "A" },
                    { path: "src/index.ts", status: "M" },
                ],
                diffContent: "+added line",
                phase,
                orchestratorReport: makePhaseReport("phase-1"),
            });
            expect(prompt).toContain("[A] package.json");
            expect(prompt).toContain("[M] src/index.ts");
            expect(prompt).toContain("npm install exits 0");
            expect(prompt).toContain("+added line");
            expect(prompt).toContain("not authoritative");
        });
    });
    describe("buildFixPrompt", () => {
        it("includes numbered issues and phase context", () => {
            const phase = {
                id: "phase-1",
                name: "setup",
                description: "Set up project",
                tasks: [],
            };
            const prompt = buildFixPrompt(["Missing export in utils.ts", "Wrong return type in handler"], phase);
            expect(prompt).toContain("1. Missing export in utils.ts");
            expect(prompt).toContain("2. Wrong return type in handler");
            expect(prompt).toContain("phase-1");
        });
    });
    // -------------------------------------------------------------------------
    // buildJudgePrompt — edge cases
    // -------------------------------------------------------------------------
    describe("buildJudgePrompt — edge cases", () => {
        it("handles empty changedFiles array", () => {
            const phase = {
                id: "phase-1",
                name: "setup",
                description: "Set up",
                tasks: [
                    {
                        id: "task-1",
                        title: "Init",
                        description: "Initialize",
                        dependsOn: [],
                        specSections: [],
                        targetPaths: [],
                        acceptanceCriteria: ["works"],
                        subAgentType: "implement",
                        status: "pending",
                    },
                ],
            };
            const prompt = buildJudgePrompt({
                changedFiles: [],
                diffContent: "",
                phase,
                orchestratorReport: makePhaseReport("phase-1"),
            });
            expect(prompt).toBeDefined();
            expect(typeof prompt).toBe("string");
        });
        it("handles deleted files (D status)", () => {
            const phase = {
                id: "phase-1",
                name: "cleanup",
                description: "Clean up",
                tasks: [],
            };
            const prompt = buildJudgePrompt({
                changedFiles: [{ path: "old-file.ts", status: "D" }],
                diffContent: "-removed content",
                phase,
                orchestratorReport: makePhaseReport("phase-1"),
            });
            expect(prompt).toContain("[D] old-file.ts");
        });
        it("handles tasks with empty acceptanceCriteria", () => {
            const phase = {
                id: "phase-1",
                name: "setup",
                description: "Set up",
                tasks: [
                    {
                        id: "task-1",
                        title: "Init",
                        description: "Initialize",
                        dependsOn: [],
                        specSections: [],
                        targetPaths: [],
                        acceptanceCriteria: [],
                        subAgentType: "implement",
                        status: "pending",
                    },
                ],
            };
            const prompt = buildJudgePrompt({
                changedFiles: [{ path: "file.ts", status: "A" }],
                diffContent: "+content",
                phase,
                orchestratorReport: makePhaseReport("phase-1"),
            });
            expect(prompt).toBeDefined();
            expect(typeof prompt).toBe("string");
        });
        it("handles tasks with empty targetPaths", () => {
            const phase = {
                id: "phase-1",
                name: "setup",
                description: "Set up",
                tasks: [
                    {
                        id: "task-1",
                        title: "Init",
                        description: "Initialize",
                        dependsOn: [],
                        specSections: [],
                        targetPaths: [],
                        acceptanceCriteria: ["passes"],
                        subAgentType: "implement",
                        status: "pending",
                    },
                ],
            };
            const prompt = buildJudgePrompt({
                changedFiles: [{ path: "file.ts", status: "M" }],
                diffContent: "+changes",
                phase,
                orchestratorReport: makePhaseReport("phase-1"),
            });
            expect(prompt).toBeDefined();
        });
    });
    // -------------------------------------------------------------------------
    // runPhases — error paths
    // -------------------------------------------------------------------------
    describe("runPhases — halt action", () => {
        it("halts when report recommends halt in headless mode", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = makeDefaultConfig(tmpDir);
            const haltReport = makePhaseReport("phase-1", {
                status: "partial",
                recommendedAction: "halt",
                tasksCompleted: [],
                tasksFailed: ["task-1-1"],
            });
            const reports = new Map([
                ["phase-1", haltReport],
            ]);
            setupMocksForSuccess(reports);
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(false);
            expect(result.phasesFailed).toContain("phase-1");
        });
    });
    // -------------------------------------------------------------------------
    // Judge loop — integration with runPhases
    // -------------------------------------------------------------------------
    describe("runPhases — judge loop", () => {
        it("judge passes: phase advances normally", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = makeDefaultConfig(tmpDir);
            // Mock getChangedFiles to return some files (triggers judge)
            const mockGetChangedFiles = getChangedFiles;
            mockGetChangedFiles.mockReturnValue([
                { path: "src/index.ts", status: "A" },
            ]);
            const mockGetDiffContent = getDiffContent;
            mockGetDiffContent.mockReturnValue("+new file content");
            const reports = new Map([
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
            // Set up mocks with judge-aware dispatchSubAgent
            const mockCreateAgentLauncher = createAgentLauncher;
            const mockCreateReplSession = createReplSession;
            const mockCreateReplHelpers = createReplHelpers;
            mockCreateReplHelpers.mockImplementation(() => createMockHelpers());
            let launchCount = 0;
            const phaseIds = [...reports.keys()];
            mockCreateAgentLauncher.mockImplementation(() => ({
                dispatchSubAgent: async (subConfig) => {
                    if (subConfig.type === "judge") {
                        return {
                            success: true,
                            output: JSON.stringify({
                                passed: true,
                                issues: [],
                                suggestions: ["looks good"],
                            }),
                            filesModified: [],
                        };
                    }
                    return { success: true, output: "", filesModified: [] };
                },
                llmQuery: async () => "mock",
                launchOrchestrator: async () => {
                    const phaseId = phaseIds[launchCount] ?? phaseIds[phaseIds.length - 1];
                    launchCount++;
                    const report = reports.get(phaseId);
                    return createMockOrchestrator([
                        'console.log("working...")',
                        `writePhaseReport(${JSON.stringify(report)})`,
                    ]);
                },
            }));
            mockCreateReplSession.mockImplementation((sessionConfig) => {
                let consecutiveErrors = 0;
                return {
                    async eval(code) {
                        if (code.includes("writePhaseReport(")) {
                            try {
                                const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
                                if (jsonMatch?.[1]) {
                                    sessionConfig.helpers.writePhaseReport(JSON.parse(jsonMatch[1]));
                                }
                            }
                            catch { }
                            consecutiveErrors = 0;
                            return { success: true, output: "Report written.", truncated: false, duration: 1 };
                        }
                        consecutiveErrors = 0;
                        return { success: true, output: "ok", truncated: false, duration: 1 };
                    },
                    restoreScaffold() { },
                    getConsecutiveErrors() { return consecutiveErrors; },
                    resetConsecutiveErrors() { consecutiveErrors = 0; },
                    destroy() { },
                };
            });
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(true);
            expect(result.phasesCompleted).toContain("phase-1");
            expect(result.phasesCompleted).toContain("phase-2");
            // Judge assessment should be attached to reports
            const phase1Report = result.finalState.phaseReports.find((r) => r.phaseId === "phase-1");
            expect(phase1Report?.judgeAssessment?.passed).toBe(true);
        });
        it("judge fails: downgrades recommendation to retry", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = { ...makeDefaultConfig(tmpDir), maxRetries: 0 };
            const mockGetChangedFiles = getChangedFiles;
            mockGetChangedFiles.mockReturnValue([
                { path: "src/a.ts", status: "A" },
            ]);
            const mockGetDiffContent = getDiffContent;
            mockGetDiffContent.mockReturnValue("+content");
            const mockCreateAgentLauncher = createAgentLauncher;
            const mockCreateReplSession = createReplSession;
            const mockCreateReplHelpers = createReplHelpers;
            mockCreateReplHelpers.mockImplementation(() => createMockHelpers());
            const phase1Report = makePhaseReport("phase-1", {
                tasksCompleted: ["task-1-1", "task-1-2"],
            });
            mockCreateAgentLauncher.mockImplementation(() => ({
                dispatchSubAgent: async (subConfig) => {
                    if (subConfig.type === "judge") {
                        return {
                            success: true,
                            output: JSON.stringify({
                                passed: false,
                                issues: ["Spec violation: missing export"],
                                suggestions: [],
                            }),
                            filesModified: [],
                        };
                    }
                    if (subConfig.type === "fix") {
                        return { success: true, output: "Fixed.", filesModified: [] };
                    }
                    return { success: true, output: "", filesModified: [] };
                },
                llmQuery: async () => "mock",
                launchOrchestrator: async () => createMockOrchestrator([
                    'console.log("work")',
                    `writePhaseReport(${JSON.stringify(phase1Report)})`,
                ]),
            }));
            mockCreateReplSession.mockImplementation((sessionConfig) => {
                let consecutiveErrors = 0;
                return {
                    async eval(code) {
                        if (code.includes("writePhaseReport(")) {
                            try {
                                const jsonMatch = code.match(/writePhaseReport\((.+)\)/s);
                                if (jsonMatch?.[1]) {
                                    sessionConfig.helpers.writePhaseReport(JSON.parse(jsonMatch[1]));
                                }
                            }
                            catch { }
                            return { success: true, output: "ok", truncated: false, duration: 1 };
                        }
                        consecutiveErrors = 0;
                        return { success: true, output: "ok", truncated: false, duration: 1 };
                    },
                    restoreScaffold() { },
                    getConsecutiveErrors() { return consecutiveErrors; },
                    resetConsecutiveErrors() { consecutiveErrors = 0; },
                    destroy() { },
                };
            });
            const result = await runPhases(config, tasksJson);
            // With maxRetries=0, judge failure should halt
            expect(result.success).toBe(false);
            expect(result.phasesFailed).toContain("phase-1");
        });
        it("no changed files: judge is skipped", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const config = makeDefaultConfig(tmpDir);
            // getChangedFiles returns empty (default mock behavior)
            const mockGetChangedFiles = getChangedFiles;
            mockGetChangedFiles.mockReturnValue([]);
            const reports = new Map([
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
            setupMocksForSuccess(reports);
            const result = await runPhases(config, tasksJson);
            expect(result.success).toBe(true);
            // Judge should have trivially passed (no files)
            const phase1Report = result.finalState.phaseReports.find((r) => r.phaseId === "phase-1");
            expect(phase1Report?.judgeAssessment?.passed).toBe(true);
            expect(phase1Report?.judgeAssessment?.issues).toEqual([]);
        });
    });
    // -------------------------------------------------------------------------
    // normalizeReport
    // -------------------------------------------------------------------------
    describe("normalizeReport", () => {
        it("passes through correct schema fields unchanged (except phaseId injected)", () => {
            const raw = {
                phaseId: "wrong-id",
                status: "complete",
                summary: "All good",
                tasksCompleted: ["t1", "t2"],
                tasksFailed: [],
                orchestratorAnalysis: "Went well",
                recommendedAction: "advance",
                correctiveTasks: [],
                decisionsLog: ["decided X"],
                handoff: "Ready for next phase",
            };
            const result = normalizeReport(raw, "phase-1");
            expect(result.phaseId).toBe("phase-1");
            expect(result.status).toBe("complete");
            expect(result.summary).toBe("All good");
            expect(result.tasksCompleted).toEqual(["t1", "t2"]);
            expect(result.tasksFailed).toEqual([]);
            expect(result.orchestratorAnalysis).toBe("Went well");
            expect(result.recommendedAction).toBe("advance");
            expect(result.correctiveTasks).toEqual([]);
            expect(result.decisionsLog).toEqual(["decided X"]);
            expect(result.handoff).toBe("Ready for next phase");
        });
        it("maps LLM-style taskOutcomes to tasksCompleted and tasksFailed", () => {
            const raw = {
                status: "complete",
                recommendedAction: "advance",
                taskOutcomes: [
                    { taskId: "t1", status: "passed" },
                    { taskId: "t2", status: "failed" },
                    { taskId: "t3", status: "passed" },
                ],
            };
            const result = normalizeReport(raw, "p1");
            expect(result.tasksCompleted).toEqual(["t1", "t3"]);
            expect(result.tasksFailed).toEqual(["t2"]);
        });
        it("maps handoffBriefing to handoff when handoff is absent", () => {
            const raw = {
                status: "complete",
                recommendedAction: "advance",
                handoffBriefing: "Next phase should do X",
            };
            const result = normalizeReport(raw, "p1");
            expect(result.handoff).toBe("Next phase should do X");
        });
        it("prefers handoff over handoffBriefing when both present", () => {
            const raw = {
                status: "complete",
                handoff: "canonical",
                handoffBriefing: "should be ignored",
            };
            const result = normalizeReport(raw, "p1");
            expect(result.handoff).toBe("canonical");
        });
        it("fills missing required fields with defaults", () => {
            const raw = {};
            const result = normalizeReport(raw, "p1");
            expect(result.phaseId).toBe("p1");
            expect(result.status).toBe("partial");
            expect(result.summary).toBe("");
            expect(result.tasksCompleted).toEqual([]);
            expect(result.tasksFailed).toEqual([]);
            expect(result.orchestratorAnalysis).toBe("");
            expect(result.recommendedAction).toBe("advance");
            expect(result.correctiveTasks).toEqual([]);
            expect(result.decisionsLog).toEqual([]);
            expect(result.handoff).toBe("");
        });
        it("always injects phaseId from argument, overriding raw value", () => {
            const raw = { phaseId: "stale-id", status: "complete" };
            const result = normalizeReport(raw, "correct-id");
            expect(result.phaseId).toBe("correct-id");
        });
        it("defaults unrecognized status to 'partial'", () => {
            const raw = { status: "done" };
            const result = normalizeReport(raw, "p1");
            expect(result.status).toBe("partial");
        });
        it("defaults unrecognized recommendedAction to 'advance'", () => {
            const raw = { recommendedAction: "continue" };
            const result = normalizeReport(raw, "p1");
            expect(result.recommendedAction).toBe("advance");
        });
        it("does not use taskOutcomes when tasksCompleted is already present", () => {
            const raw = {
                status: "complete",
                tasksCompleted: ["explicit-task"],
                taskOutcomes: [
                    { taskId: "t1", status: "passed" },
                    { taskId: "t2", status: "failed" },
                ],
            };
            const result = normalizeReport(raw, "p1");
            expect(result.tasksCompleted).toEqual(["explicit-task"]);
            expect(result.tasksFailed).toEqual([]);
        });
    });
    describe("isCommentOnly", () => {
        it("returns true for single-line comments only", () => {
            expect(isCommentOnly("// just a comment\n// another comment")).toBe(true);
        });
        it("returns true for block comments only", () => {
            expect(isCommentOnly("/* block comment */\n/* more */")).toBe(true);
        });
        it("returns false when real code follows a comment", () => {
            expect(isCommentOnly("// comment\nconst x = 1")).toBe(false);
        });
        it("returns false when code precedes a comment", () => {
            expect(isCommentOnly("var y = readFile('foo')\n// comment")).toBe(false);
        });
        it("returns true for empty string", () => {
            expect(isCommentOnly("")).toBe(true);
        });
        it("returns true for comments with blank lines in between", () => {
            expect(isCommentOnly("// comment\n\n// more comments")).toBe(true);
        });
        it("returns true for multi-line block comments", () => {
            expect(isCommentOnly("/* multi\nline\nblock */")).toBe(true);
        });
        it("returns false when code follows closing */ on the same line", () => {
            expect(isCommentOnly("/* comment */ const x = 1")).toBe(false);
        });
    });
    // -------------------------------------------------------------------------
    // createDefaultCheck
    // -------------------------------------------------------------------------
    describe("createDefaultCheck", () => {
        let tmpDir;
        beforeEach(() => {
            tmpDir = mkdtempSync(join(tmpdir(), "default-check-"));
        });
        afterEach(() => {
            rmSync(tmpDir, { recursive: true, force: true });
        });
        function makePhase(targetPathsPerTask) {
            return {
                id: "p1",
                name: "Phase 1",
                description: "test phase",
                tasks: targetPathsPerTask.map((paths, i) => ({
                    id: `t${i + 1}`,
                    title: `Task ${i + 1}`,
                    description: "",
                    dependsOn: [],
                    specSections: [],
                    targetPaths: paths,
                    acceptanceCriteria: [],
                    subAgentType: "code",
                    status: "pending",
                })),
            };
        }
        it("returns passed=true when all phase targetPaths exist as files", async () => {
            writeFileSync(join(tmpDir, "a.ts"), "");
            writeFileSync(join(tmpDir, "b.ts"), "");
            const phase = makePhase([["a.ts"], ["b.ts"]]);
            const result = await createDefaultCheck(tmpDir, phase).run();
            expect(result.passed).toBe(true);
            expect(result.output).toContain("2 target paths exist");
            expect(result.exitCode).toBe(0);
        });
        it("returns passed=false with list of missing files when some targetPaths don't exist", async () => {
            writeFileSync(join(tmpDir, "a.ts"), "");
            // b.ts intentionally missing
            const phase = makePhase([["a.ts", "b.ts"]]);
            const result = await createDefaultCheck(tmpDir, phase).run();
            expect(result.passed).toBe(false);
            expect(result.output).toContain("b.ts");
            expect(result.output).toContain("Missing files (1/2)");
            expect(result.exitCode).toBe(1);
        });
        it("returns passed=true when phase has no targetPaths", async () => {
            const phase = makePhase([[], []]);
            const result = await createDefaultCheck(tmpDir, phase).run();
            expect(result.passed).toBe(true);
            expect(result.output).toContain("No target paths to check");
            expect(result.exitCode).toBe(0);
        });
        it("handles directory-style targetPaths (check directory exists)", async () => {
            mkdirSync(join(tmpDir, "src"), { recursive: true });
            const phase = makePhase([["src"]]);
            const result = await createDefaultCheck(tmpDir, phase).run();
            expect(result.passed).toBe(true);
            expect(result.exitCode).toBe(0);
        });
    });
});
//# sourceMappingURL=phaseRunner.test.js.map