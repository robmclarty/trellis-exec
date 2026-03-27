import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyCompletion } from "../completionVerifier.js";
// Mock git and fs modules
vi.mock("../../git.js", () => ({
    getChangedFiles: vi.fn(() => []),
}));
vi.mock("node:fs", async () => {
    const actual = await vi.importActual("node:fs");
    return {
        ...actual,
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => ""),
    };
});
import { existsSync, readFileSync } from "node:fs";
import { getChangedFiles } from "../../git.js";
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockGetChangedFiles = vi.mocked(getChangedFiles);
function makePhase(overrides = {}) {
    return {
        id: "phase-1",
        name: "Test Phase",
        description: "A test phase",
        requiresBrowserTest: false,
        tasks: [
            {
                id: "task-1",
                title: "Create module",
                description: "Create a module",
                dependsOn: [],
                specSections: [],
                targetPaths: ["src/foo.ts", "src/bar.ts"],
                acceptanceCriteria: ["Module exports work correctly"],
                subAgentType: "implement",
                status: "pending",
            },
        ],
        ...overrides,
    };
}
function makeReport(overrides = {}) {
    return {
        phaseId: "phase-1",
        status: "complete",
        summary: "All done",
        tasksCompleted: ["task-1"],
        tasksFailed: [],
        orchestratorAnalysis: "Looks good",
        recommendedAction: "advance",
        correctiveTasks: [],
        decisionsLog: [],
        handoff: "",
        ...overrides,
    };
}
beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("");
    mockGetChangedFiles.mockReturnValue([]);
});
describe("verifyCompletion", () => {
    describe("target path existence", () => {
        it("passes when all target paths exist", () => {
            const result = verifyCompletion("/project", makePhase(), makeReport());
            expect(result.passed).toBe(true);
            expect(result.failures).toHaveLength(0);
        });
        it("fails when a target path is missing", () => {
            mockExistsSync.mockImplementation((p) => {
                return !String(p).endsWith("bar.ts");
            });
            const result = verifyCompletion("/project", makePhase(), makeReport());
            expect(result.passed).toBe(false);
            expect(result.failures).toContainEqual(expect.stringContaining("target path missing: src/bar.ts"));
        });
        it("returns single diagnostic when ALL target paths are missing (projectRoot misconfiguration)", () => {
            mockExistsSync.mockReturnValue(false);
            const phase = makePhase({
                tasks: [
                    {
                        id: "task-1",
                        title: "Create module",
                        description: "Create a module",
                        dependsOn: [],
                        specSections: [],
                        targetPaths: ["src/foo.ts", "src/bar.ts"],
                        acceptanceCriteria: [],
                        subAgentType: "implement",
                        status: "pending",
                    },
                    {
                        id: "task-2",
                        title: "Create config",
                        description: "Create config",
                        dependsOn: [],
                        specSections: [],
                        targetPaths: ["config.json"],
                        acceptanceCriteria: [],
                        subAgentType: "implement",
                        status: "pending",
                    },
                ],
            });
            const report = makeReport({
                tasksCompleted: ["task-1", "task-2"],
            });
            const result = verifyCompletion("/wrong/root", phase, report);
            expect(result.passed).toBe(false);
            // Should return a single diagnostic, not per-file failures
            expect(result.failures).toHaveLength(1);
            expect(result.failures[0]).toContain("All 3 target paths missing");
            expect(result.failures[0]).toContain("projectRoot may be misconfigured");
        });
        it("returns per-file failures when only some target paths are missing", () => {
            mockExistsSync.mockImplementation((p) => {
                return !String(p).endsWith("bar.ts");
            });
            const result = verifyCompletion("/project", makePhase(), makeReport());
            expect(result.passed).toBe(false);
            // Should have individual failure, not the blanket diagnostic
            expect(result.failures).toHaveLength(1);
            expect(result.failures[0]).toContain("target path missing: src/bar.ts");
        });
        it("skips target path check for failed tasks", () => {
            mockExistsSync.mockReturnValue(false);
            const report = makeReport({
                tasksCompleted: [],
                tasksFailed: ["task-1"],
            });
            const result = verifyCompletion("/project", makePhase(), report);
            expect(result.passed).toBe(true);
        });
    });
    describe("TODO/FIXME scan", () => {
        it("flags TODO in newly added files", () => {
            mockGetChangedFiles.mockReturnValue([
                { path: "src/new.ts", status: "A" },
            ]);
            mockReadFileSync.mockReturnValue("const x = 1; // TODO: fix later\n");
            const result = verifyCompletion("/project", makePhase(), makeReport(), "abc123");
            expect(result.passed).toBe(false);
            expect(result.failures).toContainEqual(expect.stringContaining("contains TODO"));
        });
        it("ignores TODO in modified (non-added) files", () => {
            mockGetChangedFiles.mockReturnValue([
                { path: "src/existing.ts", status: "M" },
            ]);
            mockReadFileSync.mockReturnValue("// TODO: old todo\n");
            const result = verifyCompletion("/project", makePhase(), makeReport(), "abc123");
            expect(result.passed).toBe(true);
        });
        it("flags FIXME and HACK", () => {
            mockGetChangedFiles.mockReturnValue([
                { path: "src/a.ts", status: "A" },
                { path: "src/b.ts", status: "A" },
            ]);
            mockReadFileSync
                .mockReturnValueOnce("// FIXME: broken\n")
                .mockReturnValueOnce("// HACK: workaround\n");
            const result = verifyCompletion("/project", makePhase(), makeReport(), "abc123");
            expect(result.passed).toBe(false);
            expect(result.failures).toHaveLength(2);
        });
        it("skips scan when no startSha provided", () => {
            const result = verifyCompletion("/project", makePhase(), makeReport());
            expect(mockGetChangedFiles).not.toHaveBeenCalled();
            expect(result.passed).toBe(true);
        });
    });
    describe("TODO/FIXME scan edge cases", () => {
        it("flags multiple TODOs in a single added file", () => {
            mockGetChangedFiles.mockReturnValue([
                { path: "src/multi.ts", status: "A" },
            ]);
            mockReadFileSync.mockReturnValue("const a = 1; // TODO: first\nconst b = 2; // TODO: second\nconst c = 3; // FIXME: third\n");
            const result = verifyCompletion("/project", makePhase(), makeReport(), "abc123");
            expect(result.passed).toBe(false);
            expect(result.failures).toHaveLength(3);
            expect(result.failures[0]).toContain("src/multi.ts:1");
            expect(result.failures[0]).toContain("TODO");
            expect(result.failures[1]).toContain("src/multi.ts:2");
            expect(result.failures[1]).toContain("TODO");
            expect(result.failures[2]).toContain("src/multi.ts:3");
            expect(result.failures[2]).toContain("FIXME");
        });
        it("does NOT flag lowercase 'todo'", () => {
            mockGetChangedFiles.mockReturnValue([
                { path: "src/lower.ts", status: "A" },
            ]);
            mockReadFileSync.mockReturnValue("// todo: this should not be flagged\n// fixme: also not flagged\n// hack: also not flagged\n");
            const result = verifyCompletion("/project", makePhase(), makeReport(), "abc123");
            expect(result.passed).toBe(true);
            expect(result.failures).toHaveLength(0);
        });
    });
});
//# sourceMappingURL=completionVerifier.test.js.map