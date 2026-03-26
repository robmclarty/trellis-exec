import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyCompletion } from "../completionVerifier.js";
// Mock git and fs modules
vi.mock("../../git.js", () => ({
    getChangedFilesRange: vi.fn(() => []),
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
import { getChangedFilesRange } from "../../git.js";
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockGetChangedFilesRange = vi.mocked(getChangedFilesRange);
function makePhase(overrides = {}) {
    return {
        id: "phase-1",
        name: "Test Phase",
        description: "A test phase",
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
    mockGetChangedFilesRange.mockReturnValue([]);
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
            mockGetChangedFilesRange.mockReturnValue([
                { path: "src/new.ts", status: "A" },
            ]);
            mockReadFileSync.mockReturnValue("const x = 1; // TODO: fix later\n");
            const result = verifyCompletion("/project", makePhase(), makeReport(), "abc123");
            expect(result.passed).toBe(false);
            expect(result.failures).toContainEqual(expect.stringContaining("contains TODO"));
        });
        it("ignores TODO in modified (non-added) files", () => {
            mockGetChangedFilesRange.mockReturnValue([
                { path: "src/existing.ts", status: "M" },
            ]);
            mockReadFileSync.mockReturnValue("// TODO: old todo\n");
            const result = verifyCompletion("/project", makePhase(), makeReport(), "abc123");
            expect(result.passed).toBe(true);
        });
        it("flags FIXME and HACK", () => {
            mockGetChangedFilesRange.mockReturnValue([
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
            expect(mockGetChangedFilesRange).not.toHaveBeenCalled();
            expect(result.passed).toBe(true);
        });
    });
});
//# sourceMappingURL=completionVerifier.test.js.map