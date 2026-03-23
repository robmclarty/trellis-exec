import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReplHelpers } from "../replHelpers.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTempDir() {
    return mkdtempSync(join(tmpdir(), "trellis-replhelpers-test-"));
}
function makeHelpers(projectRoot, overrides) {
    return createReplHelpers({
        projectRoot,
        statePath: overrides?.statePath ?? join(projectRoot, "state.json"),
        agentLauncher: overrides?.agentLauncher ?? null,
    });
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("createReplHelpers", () => {
    let tmpDir;
    let helpers;
    beforeEach(() => {
        tmpDir = makeTempDir();
        helpers = makeHelpers(tmpDir);
    });
    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });
    // -------------------------------------------------------------------------
    // readFile
    // -------------------------------------------------------------------------
    describe("readFile", () => {
        it("reads a file that exists", () => {
            writeFileSync(join(tmpDir, "hello.txt"), "hello world");
            expect(helpers.readFile("hello.txt")).toBe("hello world");
        });
        it("reads a file in a subdirectory", () => {
            mkdirSync(join(tmpDir, "sub"));
            writeFileSync(join(tmpDir, "sub", "nested.txt"), "nested content");
            expect(helpers.readFile("sub/nested.txt")).toBe("nested content");
        });
        it("throws on path traversal with ../", () => {
            expect(() => helpers.readFile("../../../etc/passwd")).toThrow("Path is outside project root");
        });
        it("throws on absolute path outside project root", () => {
            expect(() => helpers.readFile("/etc/passwd")).toThrow("Path is outside project root");
        });
        it("throws when file does not exist", () => {
            expect(() => helpers.readFile("nonexistent.txt")).toThrow();
        });
    });
    // -------------------------------------------------------------------------
    // listDir
    // -------------------------------------------------------------------------
    describe("listDir", () => {
        it("lists files and directories with correct types", () => {
            writeFileSync(join(tmpDir, "file.txt"), "content");
            mkdirSync(join(tmpDir, "subdir"));
            const result = helpers.listDir(".");
            const file = result.find((e) => e.name === "file.txt");
            const dir = result.find((e) => e.name === "subdir");
            expect(file).toMatchObject({ type: "file" });
            expect(dir).toMatchObject({ type: "dir", size: 0 });
        });
        it("reports file sizes correctly", () => {
            writeFileSync(join(tmpDir, "sized.txt"), "12345");
            const result = helpers.listDir(".");
            const entry = result.find((e) => e.name === "sized.txt");
            expect(entry?.size).toBe(5);
        });
        it("returns entries sorted alphabetically", () => {
            writeFileSync(join(tmpDir, "c.txt"), "");
            writeFileSync(join(tmpDir, "a.txt"), "");
            writeFileSync(join(tmpDir, "b.txt"), "");
            const names = helpers.listDir(".").map((e) => e.name);
            expect(names).toEqual(["a.txt", "b.txt", "c.txt"]);
        });
        it("throws on path traversal", () => {
            expect(() => helpers.listDir("../../")).toThrow("Path is outside project root");
        });
        it("throws on nonexistent directory", () => {
            expect(() => helpers.listDir("no-such-dir")).toThrow();
        });
    });
    // -------------------------------------------------------------------------
    // searchFiles
    // -------------------------------------------------------------------------
    describe("searchFiles", () => {
        beforeEach(() => {
            mkdirSync(join(tmpDir, "src"));
            writeFileSync(join(tmpDir, "src", "app.ts"), "const x = 1;\nconst y = 2;\n");
            writeFileSync(join(tmpDir, "src", "util.ts"), "export function helper() {}\n");
            writeFileSync(join(tmpDir, "readme.md"), "# Hello\nsome text\n");
        });
        it("finds matching lines by regex pattern", () => {
            const results = helpers.searchFiles("const");
            expect(results.length).toBeGreaterThanOrEqual(2);
            expect(results[0]).toHaveProperty("path");
            expect(results[0]).toHaveProperty("line");
            expect(results[0]).toHaveProperty("content");
        });
        it("returns correct 1-based line numbers", () => {
            const results = helpers.searchFiles("const y");
            const match = results.find((r) => r.content.includes("const y"));
            expect(match?.line).toBe(2);
        });
        it("respects glob filter for *.ts files", () => {
            const results = helpers.searchFiles(".*", "**/*.ts");
            const paths = results.map((r) => r.path);
            expect(paths.every((p) => p.endsWith(".ts"))).toBe(true);
        });
        it("glob ** matches nested paths", () => {
            const results = helpers.searchFiles("helper", "**/*.ts");
            expect(results.some((r) => r.path.includes("src/util.ts"))).toBe(true);
        });
        it("returns empty array when pattern exceeds 200 chars", () => {
            const longPattern = "a".repeat(201);
            expect(helpers.searchFiles(longPattern)).toEqual([]);
        });
        it("returns empty array for invalid regex", () => {
            expect(helpers.searchFiles("[invalid")).toEqual([]);
        });
        it("caps results at 100", () => {
            // Create a file with 150 matching lines
            const lines = Array.from({ length: 150 }, (_, i) => `match-line-${i}`);
            writeFileSync(join(tmpDir, "big.txt"), lines.join("\n"));
            const results = helpers.searchFiles("match-line");
            expect(results.length).toBe(100);
        });
        it("auto-detects glob pattern when no explicit glob provided", () => {
            // Pattern with * and no explicit glob should be treated as file filter
            // *.ts won't match src/app.ts (no **), so use **/*.ts
            const results = helpers.searchFiles("**/*.ts");
            // Should match .ts files by treating the pattern as a glob + ".*" regex
            expect(results.length).toBeGreaterThan(0);
            expect(results.every((r) => r.path.endsWith(".ts"))).toBe(true);
        });
        it("skips unreadable files silently", () => {
            // Write a binary-ish file — searchFiles should not throw
            const buf = Buffer.from([0x00, 0x01, 0x02, 0xff]);
            writeFileSync(join(tmpDir, "binary.bin"), buf);
            expect(() => helpers.searchFiles("const")).not.toThrow();
        });
        it("returns relative paths", () => {
            const results = helpers.searchFiles("const");
            for (const r of results) {
                expect(r.path).not.toMatch(/^\//);
            }
        });
    });
    // -------------------------------------------------------------------------
    // getState
    // -------------------------------------------------------------------------
    describe("getState", () => {
        it("returns parsed state from valid state.json", () => {
            const state = {
                currentPhase: "phase-1",
                completedPhases: [],
                phaseReports: [],
                phaseRetries: {},
                modifiedFiles: [],
                schemaChanges: [],
            };
            writeFileSync(join(tmpDir, "state.json"), JSON.stringify(state));
            const result = helpers.getState();
            expect(result.currentPhase).toBe("phase-1");
        });
        it("returns default state when file is missing", () => {
            const result = helpers.getState();
            expect(result.currentPhase).toBe("");
            expect(result.completedPhases).toEqual([]);
        });
        it("throws on malformed JSON", () => {
            writeFileSync(join(tmpDir, "state.json"), "not json{{{");
            expect(() => helpers.getState()).toThrow();
        });
        it("throws on invalid schema", () => {
            writeFileSync(join(tmpDir, "state.json"), JSON.stringify({ wrong: "shape" }));
            expect(() => helpers.getState()).toThrow();
        });
    });
    // -------------------------------------------------------------------------
    // dispatchSubAgent
    // -------------------------------------------------------------------------
    describe("dispatchSubAgent", () => {
        const stubConfig = {
            type: "implement",
            taskId: "task-1",
            instructions: "do stuff",
            filePaths: [],
            outputPaths: [],
        };
        it("returns stub response when agentLauncher is null", async () => {
            const result = await helpers.dispatchSubAgent(stubConfig);
            expect(result.success).toBe(true);
            expect(result.output).toContain("stub");
        });
        it("delegates to agentLauncher when provided", async () => {
            const mockLauncher = async (_config) => ({
                success: true,
                output: "launched",
                filesModified: ["src/a.ts"],
            });
            const h = makeHelpers(tmpDir, { agentLauncher: mockLauncher });
            const result = await h.dispatchSubAgent(stubConfig);
            expect(result.output).toBe("launched");
            expect(result.filesModified).toEqual(["src/a.ts"]);
        });
        it("passes config to agentLauncher correctly", async () => {
            let receivedConfig;
            const mockLauncher = async (config) => {
                receivedConfig = config;
                return { success: true, output: "", filesModified: [] };
            };
            const h = makeHelpers(tmpDir, { agentLauncher: mockLauncher });
            await h.dispatchSubAgent(stubConfig);
            expect(receivedConfig).toEqual(stubConfig);
        });
    });
    // -------------------------------------------------------------------------
    // Stubs
    // -------------------------------------------------------------------------
    describe("stubs", () => {
        it("writePhaseReport does not throw", () => {
            expect(() => helpers.writePhaseReport({
                phaseId: "phase-1",
                status: "complete",
                summary: "done",
                tasksCompleted: [],
                tasksFailed: [],
                orchestratorAnalysis: "",
                recommendedAction: "advance",
                correctiveTasks: [],
                decisionsLog: [],
                handoff: "",
            })).not.toThrow();
        });
        it("runCheck returns passing result", async () => {
            const result = await helpers.runCheck();
            expect(result.passed).toBe(true);
            expect(result.exitCode).toBe(0);
        });
        it("llmQuery returns stub string", async () => {
            const result = await helpers.llmQuery("test prompt");
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        });
    });
});
//# sourceMappingURL=replHelpers.test.js.map