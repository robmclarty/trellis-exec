import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildRunConfig, parseCompileArgs, parseStatusArgs, checkClaudeAvailable } from "../cli.js";

describe("buildRunConfig", () => {
  const emptyEnv: Record<string, string | undefined> = {};

  it("creates correct config from valid args", () => {
    const config = buildRunConfig(
      [
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
      ],
      emptyEnv,
    );

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
    const env: Record<string, string | undefined> = {
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
    const env: Record<string, string | undefined> = {
      TRELLIS_EXEC_MODEL: "haiku",
      TRELLIS_EXEC_CONCURRENCY: "8",
      TRELLIS_EXEC_MAX_RETRIES: "5",
    };

    const config = buildRunConfig(
      [
        "tasks.json",
        "--model",
        "opus",
        "--concurrency",
        "2",
        "--max-retries",
        "1",
      ],
      env,
    );

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

  // -------------------------------------------------------------------------
  // Issue #6: The compile CLI command previously only ran the deterministic
  // parsePlan stage and printed a note about flagged fields without offering
  // a way to actually enrich them. Fields like dependsOn, subAgentType, and
  // acceptanceCriteria remained at their inferred defaults.
  //
  // Mitigation: Added an opt-in --enrich flag. When present, the CLI calls
  // compilePlan (Stage 1 + Stage 2 LLM enrichment) instead of parsePlan
  // alone. The default behavior stays deterministic (no LLM calls), and the
  // informational message now suggests re-running with --enrich.
  // -------------------------------------------------------------------------
  it("defaults enrich to false when --enrich is not provided", () => {
    const result = parseCompileArgs([
      "plan.md",
      "--spec",
      "spec.md",
    ]);
    expect(result.enrich).toBe(false);
  });

  it("sets enrich to true when --enrich flag is provided", () => {
    const result = parseCompileArgs([
      "plan.md",
      "--spec",
      "spec.md",
      "--enrich",
    ]);
    expect(result.enrich).toBe(true);
  });
});

describe("parseStatusArgs", () => {
  it("parses tasks.json path", () => {
    const result = parseStatusArgs(["tasks.json"]);
    expect(result.tasksJsonPath).toContain("tasks.json");
    expect(result.tasksJsonPath).toMatch(/^\//);
  });
});

describe("checkClaudeAvailable", () => {
  it("returns true when claude CLI is available", () => {
    // This test assumes the test environment may or may not have claude.
    // We just verify it returns a boolean without throwing.
    const result = checkClaudeAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("CLI dispatch", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--spec"),
    );
  });

  it("parseStatusArgs exits when no positional arg given", () => {
    expect(() => parseStatusArgs([])).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
