import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildRunConfig, parseCompileArgs, parseStatusArgs } from "../cli.js";
describe("buildRunConfig", () => {
    const emptyEnv = {};
    it("creates correct config from valid args", () => {
        const config = buildRunConfig([
            "tasks.json",
            "--phase",
            "phase-1",
            "--dry-run",
            "--check",
            "npm test",
            "--isolation",
            "none",
            "--concurrency",
            "5",
            "--model",
            "opus",
            "--max-retries",
            "4",
            "--headless",
            "--verbose",
        ], emptyEnv);
        expect(config.tasksJsonPath).toContain("tasks.json");
        expect(config.dryRun).toBe(true);
        expect(config.checkCommand).toBe("npm test");
        expect(config.isolation).toBe("none");
        expect(config.concurrency).toBe(5);
        expect(config.model).toBe("opus");
        expect(config.maxRetries).toBe(4);
        expect(config.headless).toBe(true);
        expect(config.verbose).toBe(true);
    });
    it("applies default values when no flags provided", () => {
        const config = buildRunConfig(["tasks.json"], emptyEnv);
        expect(config.isolation).toBe("worktree");
        expect(config.concurrency).toBe(3);
        expect(config.maxRetries).toBe(2);
        expect(config.turnLimit).toBe(200);
        expect(config.maxConsecutiveErrors).toBe(5);
        expect(config.headless).toBe(false);
        expect(config.verbose).toBe(false);
        expect(config.dryRun).toBe(false);
        expect(config.model).toBeUndefined();
        expect(config.checkCommand).toBeUndefined();
    });
    it("uses environment variable fallbacks", () => {
        const env = {
            TRELLIS_EXEC_MODEL: "haiku",
            TRELLIS_EXEC_CONCURRENCY: "8",
            TRELLIS_EXEC_MAX_RETRIES: "5",
            TRELLIS_EXEC_TURN_LIMIT: "150",
            TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS: "10",
            CLAUDE_PLUGIN_ROOT: "/custom/plugin",
        };
        const config = buildRunConfig(["tasks.json"], env);
        expect(config.model).toBe("haiku");
        expect(config.concurrency).toBe(8);
        expect(config.maxRetries).toBe(5);
        expect(config.turnLimit).toBe(150);
        expect(config.maxConsecutiveErrors).toBe(10);
        expect(config.pluginRoot).toBe("/custom/plugin");
    });
    it("CLI flags override environment variables", () => {
        const env = {
            TRELLIS_EXEC_MODEL: "haiku",
            TRELLIS_EXEC_CONCURRENCY: "8",
            TRELLIS_EXEC_MAX_RETRIES: "5",
        };
        const config = buildRunConfig([
            "tasks.json",
            "--model",
            "opus",
            "--concurrency",
            "2",
            "--max-retries",
            "1",
        ], env);
        expect(config.model).toBe("opus");
        expect(config.concurrency).toBe(2);
        expect(config.maxRetries).toBe(1);
    });
    it("resolves tasksJsonPath to absolute path", () => {
        const config = buildRunConfig(["relative/tasks.json"], emptyEnv);
        expect(config.tasksJsonPath).toMatch(/^\//);
        expect(config.tasksJsonPath).toContain("relative/tasks.json");
    });
});
describe("parseCompileArgs", () => {
    it("parses plan path and --spec flag", () => {
        const result = parseCompileArgs([
            "plan.md",
            "--spec",
            "spec.md",
        ]);
        expect(result.planPath).toContain("plan.md");
        expect(result.specPath).toContain("spec.md");
        expect(result.outputPath).toContain("tasks.json");
    });
    it("uses custom --output path", () => {
        const result = parseCompileArgs([
            "plan.md",
            "--spec",
            "spec.md",
            "--output",
            "custom/output.json",
        ]);
        expect(result.outputPath).toContain("custom/output.json");
    });
    it("resolves all paths to absolute", () => {
        const result = parseCompileArgs([
            "plan.md",
            "--spec",
            "spec.md",
        ]);
        expect(result.planPath).toMatch(/^\//);
        expect(result.specPath).toMatch(/^\//);
        expect(result.outputPath).toMatch(/^\//);
    });
});
describe("parseStatusArgs", () => {
    it("parses tasks.json path", () => {
        const result = parseStatusArgs(["tasks.json"]);
        expect(result.tasksJsonPath).toContain("tasks.json");
        expect(result.tasksJsonPath).toMatch(/^\//);
    });
});
describe("CLI dispatch", () => {
    let exitSpy;
    let errorSpy;
    beforeEach(() => {
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit called");
        });
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
    });
    afterEach(() => {
        exitSpy.mockRestore();
        errorSpy.mockRestore();
    });
    it("buildRunConfig exits when no positional arg given", () => {
        expect(() => buildRunConfig([], {})).toThrow("process.exit called");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
    it("parseCompileArgs exits when --spec is missing", () => {
        expect(() => parseCompileArgs(["plan.md"])).toThrow("process.exit called");
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--spec"));
    });
    it("parseStatusArgs exits when no positional arg given", () => {
        expect(() => parseStatusArgs([])).toThrow("process.exit called");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
//# sourceMappingURL=cli.test.js.map