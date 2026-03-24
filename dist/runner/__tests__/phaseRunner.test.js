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
    execClaude: vi.fn(),
}));
vi.mock("../../git.js", () => ({
    getChangedFiles: vi.fn(() => []),
    getDiffContent: vi.fn(() => ""),
    getCurrentSha: vi.fn(() => "abc123"),
    ensureInitialCommit: vi.fn(() => "abc123"),
    commitAll: vi.fn(() => null),
    getChangedFilesRange: vi.fn(() => []),
    getDiffContentRange: vi.fn(() => ""),
}));
// Import module under test and mocked modules AFTER vi.mock declarations
import { runPhases, dryRunReport, buildPhaseContext, buildJudgePrompt, parseJudgeResult, buildFixPrompt, normalizeReport, createDefaultCheck, extractScopes, makePhaseCommit, } from "../phaseRunner.js";
import { createAgentLauncher } from "../../orchestrator/agentLauncher.js";
import { getChangedFiles, commitAll } from "../../git.js";
const mockedGetChangedFiles = vi.mocked(getChangedFiles);
const mockedCommitAll = vi.mocked(commitAll);
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
function makeDefaultConfig(tmpDir) {
    return {
        projectRoot: tmpDir,
        specPath: join(tmpDir, "spec.md"),
        planPath: join(tmpDir, "plan.md"),
        statePath: join(tmpDir, "state.json"),
        trajectoryPath: join(tmpDir, "trajectory.jsonl"),
        concurrency: 3,
        maxRetries: 2,
        headless: true,
        verbose: false,
        dryRun: false,
        pluginRoot: join(tmpDir, "plugin"),
    };
}
function setupTmpDir(tasksJson) {
    const tmpDir = mkdtempSync(join(tmpdir(), "phaserunner-test-"));
    writeFileSync(join(tmpDir, "tasks.json"), JSON.stringify(tasksJson));
    // Create plugin dirs that the runner references
    mkdirSync(join(tmpDir, "plugin", "agents"), { recursive: true });
    writeFileSync(join(tmpDir, "plugin", "agents", "phase-orchestrator.md"), "---\nname: phase-orchestrator\n---\n");
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
function setupMocksForSuccess(tmpDir, phaseReports) {
    const mockCreateAgentLauncher = createAgentLauncher;
    let launchCount = 0;
    const phaseIds = [...phaseReports.keys()];
    mockCreateAgentLauncher.mockImplementation(() => ({
        dispatchSubAgent: async () => ({
            success: true,
            output: '{"passed": true, "issues": [], "suggestions": []}',
            filesModified: [],
        }),
        runPhaseOrchestrator: async () => {
            const phaseId = phaseIds[launchCount] ?? phaseIds[phaseIds.length - 1];
            launchCount++;
            const report = phaseReports.get(phaseId);
            // Write the report file to disk (simulates orchestrator behavior)
            writeFileSync(join(tmpDir, ".trellis-phase-report.json"), JSON.stringify(report));
            return { stdout: "done", stderr: "", exitCode: 0 };
        },
    }));
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
            const mockCreateAgentLauncher = createAgentLauncher;
            mockCreateAgentLauncher.mockImplementation(() => ({
                dispatchSubAgent: async () => ({
                    success: true,
                    output: '{"passed": true, "issues": [], "suggestions": []}',
                    filesModified: [],
                }),
                runPhaseOrchestrator: async () => {
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
            const config = { ...makeDefaultConfig(tmpDir), maxRetries: 0 };
            const mockCreateAgentLauncher = createAgentLauncher;
            mockCreateAgentLauncher.mockImplementation(() => ({
                dispatchSubAgent: async () => ({
                    success: true,
                    output: '{"passed": true, "issues": [], "suggestions": []}',
                    filesModified: [],
                }),
                runPhaseOrchestrator: async () => {
                    // Report only accounts for 1 of 2 tasks
                    const report = makePhaseReport("phase-1", {
                        tasksCompleted: ["task-1-1"],
                        tasksFailed: [],
                    });
                    writeFileSync(join(tmpDir, ".trellis-phase-report.json"), JSON.stringify(report));
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
            const report = normalizeReport({
                taskOutcomes: [
                    { taskId: "task-1", status: "complete" },
                    { taskId: "task-2", status: "failed" },
                    { taskId: "task-3", status: "completed" },
                ],
            }, "p1");
            expect(report.tasksCompleted).toEqual(["task-1", "task-3"]);
            expect(report.tasksFailed).toEqual(["task-2"]);
        });
        it("maps handoffBriefing to handoff", () => {
            const report = normalizeReport({ handoffBriefing: "Next phase should..." }, "p1");
            expect(report.handoff).toBe("Next phase should...");
        });
        it("preserves valid status and action", () => {
            const report = normalizeReport({
                status: "complete",
                recommendedAction: "advance",
                tasksCompleted: ["a", "b"],
            }, "p1");
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
            const state = {
                currentPhase: "",
                completedPhases: [],
                modifiedFiles: [],
                schemaChanges: [],
                phaseReports: [],
                phaseRetries: {},
                phaseReport: null,
            };
            const context = buildPhaseContext(tasksJson.phases[0], state, "", config);
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
            const state = {
                currentPhase: "phase-1",
                completedPhases: [],
                modifiedFiles: [],
                schemaChanges: [],
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
            const context = buildPhaseContext(tasksJson.phases[0], state, "", config);
            expect(context).toContain("Previous Attempt");
            expect(context).toContain("retry attempt 1");
            expect(context).toContain("Build failed");
        });
    });
    describe("buildJudgePrompt", () => {
        it("includes changed files and acceptance criteria", () => {
            const phase = makeTasksJson().phases[0];
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
            const result = parseJudgeResult('{"passed": false, "issues": [{"task": "t1", "severity": "must-fix", "description": "missing"}], "suggestions": []}');
            expect(result.passed).toBe(false);
            expect(result.issues).toHaveLength(1);
        });
        it("returns failure for unparseable output", () => {
            const result = parseJudgeResult("This is not JSON at all.");
            expect(result.passed).toBe(false);
            expect(result.issues).toHaveLength(1);
        });
    });
    describe("buildFixPrompt", () => {
        it("includes issue descriptions", () => {
            const phase = makeTasksJson().phases[0];
            const prompt = buildFixPrompt([{ task: "task-1-1", severity: "must-fix", description: "Missing export" }], phase);
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
            const check = createDefaultCheck(tmpDir, tasksJson.phases[0]);
            const result = await check.run();
            expect(result.passed).toBe(true);
        });
        it("fails when target paths are missing", async () => {
            const tasksJson = makeTasksJson();
            tmpDir = setupTmpDir(tasksJson);
            const check = createDefaultCheck(tmpDir, tasksJson.phases[0]);
            const result = await check.run();
            expect(result.passed).toBe(false);
            expect(result.output).toContain("package.json");
        });
    });
    describe("extractScopes", () => {
        it("extracts meaningful directory names from targetPaths", () => {
            const tasks = makeTasksJson();
            const phase = {
                ...tasks.phases[1],
                tasks: [
                    { ...tasks.phases[1].tasks[0], targetPaths: ["src/auth/login.tsx", "src/auth/schema.ts"] },
                    { ...tasks.phases[1].tasks[1], targetPaths: ["src/db/migrations/001.sql"] },
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
                ...tasks.phases[0],
                tasks: [
                    { ...tasks.phases[0].tasks[0], targetPaths: ["src/components/Button.tsx"] },
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
                ...tasks.phases[1],
                tasks: [
                    { ...tasks.phases[1].tasks[0], targetPaths: ["src/auth/login.tsx"] },
                    { ...tasks.phases[1].tasks[1], targetPaths: ["src/auth/register.tsx"] },
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
                ...tasks.phases[0],
                tasks: [
                    { ...tasks.phases[0].tasks[0], targetPaths: ["package.json"] },
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
            const phase = tasks.phases[1];
            const report = makePhaseReport("phase-2", {
                tasksCompleted: ["task-2-1"],
                tasksFailed: ["task-2-2"],
            });
            const scopes = extractScopes(phase, report);
            // task-2-1 has targetPaths: ["src/a.ts"] → "a" would be the scope
            // task-2-2 has targetPaths: ["src/b.ts"] → should be excluded
            expect(scopes).toContain("a");
            expect(scopes).not.toContain("b");
        });
    });
    describe("makePhaseCommit", () => {
        it("returns null when there are no uncommitted changes", () => {
            // getChangedFiles mock already returns [] by default
            const tasks = makeTasksJson();
            const phase = tasks.phases[0];
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
            const phase = tasks.phases[0];
            const report = makePhaseReport("phase-1", {
                tasksCompleted: ["task-1-1", "task-1-2"],
                summary: "Set up project scaffolding",
            });
            const result = makePhaseCommit("/tmp/project", phase, report);
            expect(result).toBe("def456");
            expect(mockedCommitAll).toHaveBeenCalledWith("/tmp/project", expect.stringContaining("[trellis phase-1]"));
            expect(mockedCommitAll).toHaveBeenCalledWith("/tmp/project", expect.stringContaining("Set up project scaffolding"));
        });
        it("includes task titles in commit body", () => {
            mockedGetChangedFiles.mockReturnValueOnce([
                { path: "file.txt", status: "M" },
            ]);
            mockedCommitAll.mockReturnValueOnce("sha123");
            const tasks = makeTasksJson();
            const phase = tasks.phases[0];
            const report = makePhaseReport("phase-1", {
                tasksCompleted: ["task-1-1", "task-1-2"],
                summary: "Done",
            });
            makePhaseCommit("/tmp/project", phase, report);
            const commitMsg = mockedCommitAll.mock.calls[0][1];
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
                modifiedFiles: [],
                schemaChanges: [],
                phaseReports: [],
                phaseRetries: {},
                phaseReport: null,
            };
            tmpDir = setupTmpDir(tasks);
            const ctx = makeDefaultConfig(tmpDir);
            const context = buildPhaseContext(tasks.phases[0], state, "", ctx);
            expect(context).toContain("## Git Commit Protocol");
            expect(context).toContain("conventional commit format");
            expect(context).toContain(".trellis-phase-report.json");
        });
    });
});
//# sourceMappingURL=phaseRunner.test.js.map