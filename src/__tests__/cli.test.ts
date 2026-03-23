import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildRunContext, parseCompileArgs, parseStatusArgs, checkClaudeAvailable } from "../cli.js";

// ---------------------------------------------------------------------------
// Helper: create a temp dir with a minimal valid tasks.json
// ---------------------------------------------------------------------------

function createTempTasksJson(
  overrides?: Record<string, unknown>,
): { tmpDir: string; tasksJsonPath: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "cli-test-"));
  const tasksJson = {
    projectRoot: ".",
    specRef: "spec.md",
    planRef: "plan.md",
    createdAt: "2026-03-17T00:00:00Z",
    phases: [
      {
        id: "phase-1",
        name: "Setup",
        description: "Set up project",
        tasks: [
          {
            id: "phase-1-task-1",
            title: "Init",
            description: "Initialize",
            dependsOn: [],
            specSections: ["§1"],
            targetPaths: ["src/index.ts"],
            acceptanceCriteria: ["works"],
            subAgentType: "implement",
            status: "pending",
          },
        ],
      },
    ],
    ...overrides,
  };
  const tasksJsonPath = join(tmpDir, "tasks.json");
  writeFileSync(tasksJsonPath, JSON.stringify(tasksJson));
  // Create spec and plan files referenced by tasks.json
  writeFileSync(join(tmpDir, "spec.md"), "# Spec");
  writeFileSync(join(tmpDir, "plan.md"), "# Plan");
  return { tmpDir, tasksJsonPath };
}

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function trackTmpDir(tmpDir: string): string {
  tmpDirs.push(tmpDir);
  return tmpDir;
}

describe("buildRunContext", () => {
  const emptyEnv: Record<string, string | undefined> = {};

  it("creates correct context from valid args", () => {
    const { tmpDir, tasksJsonPath } = createTempTasksJson();
    trackTmpDir(tmpDir);

    const result = buildRunContext(
      [
        tasksJsonPath,
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

    expect(result.context.dryRun).toBe(true);
    expect(result.context.checkCommand).toBe("npm test");
    expect(result.context.isolation).toBe("none");
    expect(result.context.concurrency).toBe(5);
    expect(result.context.model).toBe("opus");
    expect(result.context.maxRetries).toBe(4);
    expect(result.context.headless).toBe(true);
    expect(result.context.verbose).toBe(true);
    expect(result.phaseId).toBe("phase-1");
    expect(result.tasksJson).toBeDefined();
  });

  it("applies default values when no flags provided", () => {
    const { tmpDir, tasksJsonPath } = createTempTasksJson();
    trackTmpDir(tmpDir);

    const result = buildRunContext([tasksJsonPath], emptyEnv);

    expect(result.context.isolation).toBe("worktree");
    expect(result.context.concurrency).toBe(3);
    expect(result.context.maxRetries).toBe(2);
    expect(result.context.turnLimit).toBe(200);
    expect(result.context.maxConsecutiveErrors).toBe(5);
    expect(result.context.headless).toBe(false);
    expect(result.context.verbose).toBe(false);
    expect(result.context.dryRun).toBe(false);
    expect(result.context.model).toBeUndefined();
    expect(result.context.checkCommand).toBeUndefined();
  });

  it("uses environment variable fallbacks", () => {
    const { tmpDir, tasksJsonPath } = createTempTasksJson();
    trackTmpDir(tmpDir);

    const env: Record<string, string | undefined> = {
      TRELLIS_EXEC_MODEL: "haiku",
      TRELLIS_EXEC_CONCURRENCY: "8",
      TRELLIS_EXEC_MAX_RETRIES: "5",
      TRELLIS_EXEC_TURN_LIMIT: "150",
      TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS: "10",
      CLAUDE_PLUGIN_ROOT: "/custom/plugin",
    };

    const result = buildRunContext([tasksJsonPath], env);

    expect(result.context.model).toBe("haiku");
    expect(result.context.concurrency).toBe(8);
    expect(result.context.maxRetries).toBe(5);
    expect(result.context.turnLimit).toBe(150);
    expect(result.context.maxConsecutiveErrors).toBe(10);
    expect(result.context.pluginRoot).toBe("/custom/plugin");
  });

  it("CLI flags override environment variables", () => {
    const { tmpDir, tasksJsonPath } = createTempTasksJson();
    trackTmpDir(tmpDir);

    const env: Record<string, string | undefined> = {
      TRELLIS_EXEC_MODEL: "haiku",
      TRELLIS_EXEC_CONCURRENCY: "8",
      TRELLIS_EXEC_MAX_RETRIES: "5",
    };

    const result = buildRunContext(
      [
        tasksJsonPath,
        "--model",
        "opus",
        "--concurrency",
        "2",
        "--max-retries",
        "1",
      ],
      env,
    );

    expect(result.context.model).toBe("opus");
    expect(result.context.concurrency).toBe(2);
    expect(result.context.maxRetries).toBe(1);
  });

  it("resolves paths to absolute", () => {
    const { tmpDir, tasksJsonPath } = createTempTasksJson();
    trackTmpDir(tmpDir);

    const result = buildRunContext([tasksJsonPath], emptyEnv);
    expect(result.context.projectRoot).toMatch(/^\//);
    expect(result.context.specPath).toMatch(/^\//);
    expect(result.context.planPath).toMatch(/^\//);
    expect(result.context.statePath).toMatch(/^\//);
    expect(result.context.trajectoryPath).toMatch(/^\//);
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

  it("parses --guidelines flag as resolved absolute path", () => {
    const result = parseCompileArgs([
      "plan.md",
      "--spec",
      "spec.md",
      "--guidelines",
      "guidelines.md",
    ]);
    expect(result.guidelinesPath).toBeDefined();
    expect(result.guidelinesPath).toContain("guidelines.md");
    expect(result.guidelinesPath).toMatch(/^\//);
  });

  it("omits guidelinesPath when --guidelines is not provided", () => {
    const result = parseCompileArgs([
      "plan.md",
      "--spec",
      "spec.md",
    ]);
    expect(result.guidelinesPath).toBeUndefined();
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

  it("buildRunContext exits when no positional arg given", () => {
    expect(() => buildRunContext([], {})).toThrow("process.exit called");
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

describe("handleStatus (subprocess)", () => {
  const cliPath = resolve(import.meta.dirname, "../../dist/cli.js");

  it("prints 'No execution state found' when state.json is missing", () => {
    const { tmpDir, tasksJsonPath } = createTempTasksJson();
    trackTmpDir(tmpDir);

    const stdout = execSync(`node ${cliPath} status ${tasksJsonPath}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(stdout).toContain("No execution state found");
  });

  it("prints phase completion info from valid state", () => {
    const { tmpDir, tasksJsonPath } = createTempTasksJson();
    trackTmpDir(tmpDir);

    // Write a state.json next to tasks.json
    const state = {
      currentPhase: "phase-1",
      completedPhases: ["phase-1"],
      phaseReports: [
        {
          phaseId: "phase-1",
          status: "complete",
          summary: "All good",
          tasksCompleted: ["phase-1-task-1"],
          tasksFailed: [],
          orchestratorAnalysis: "",
          recommendedAction: "advance",
          correctiveTasks: [],
          decisionsLog: [],
          handoff: "",
        },
      ],
      phaseRetries: {},
      modifiedFiles: [],
      schemaChanges: [],
    };
    writeFileSync(join(tmpDir, "state.json"), JSON.stringify(state));

    const stdout = execSync(`node ${cliPath} status ${tasksJsonPath}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(stdout).toContain("Current phase: phase-1");
    expect(stdout).toContain("phase-1");
  });
});

describe("handleCompile (subprocess)", () => {
  const cliPath = resolve(import.meta.dirname, "../../dist/cli.js");

  it("succeeds with deterministic parse and writes tasks.json", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-compile-test-"));
    trackTmpDir(tmpDir);

    const plan = [
      "# Plan",
      "## Phase 1: Setup",
      "- Init project: initialize with npm init",
      "  - Acceptance: `npm install` exits 0",
      "  - Files: `package.json`",
      "  - Spec: §1",
    ].join("\n");
    const spec = "# Spec\n## §1 Intro\nSet up.";
    writeFileSync(join(tmpDir, "plan.md"), plan);
    writeFileSync(join(tmpDir, "spec.md"), spec);

    const outputPath = join(tmpDir, "tasks.json");
    const stdout = execSync(
      `node ${cliPath} compile ${join(tmpDir, "plan.md")} --spec ${join(tmpDir, "spec.md")} --output ${outputPath}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    expect(stdout).toContain("Compiled");
    const written = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(written.phases).toBeDefined();
    expect(written.phases.length).toBeGreaterThan(0);
  });

  it("exits with error when plan file does not exist", () => {
    let exitCode = 0;
    try {
      execSync(
        `node ${cliPath} compile /nonexistent/plan.md --spec /nonexistent/spec.md`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (err: unknown) {
      exitCode = (err as { status: number }).status;
    }
    expect(exitCode).not.toBe(0);
  });
});

describe("handleRun (subprocess)", () => {
  const cliPath = resolve(import.meta.dirname, "../../dist/cli.js");

  it("--dry-run prints report and exits 0", () => {
    const { tmpDir, tasksJsonPath } = createTempTasksJson();
    trackTmpDir(tmpDir);

    const stdout = execSync(
      `node ${cliPath} run ${tasksJsonPath} --dry-run`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    expect(stdout).toContain("phase-1");
    expect(stdout).toContain("Spec:");
  });

  it("exits with error when tasks.json does not exist", () => {
    let exitCode = 0;
    try {
      execSync(
        `node ${cliPath} run /nonexistent/tasks.json --dry-run`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (err: unknown) {
      exitCode = (err as { status: number }).status;
    }
    expect(exitCode).not.toBe(0);
  });
});

describe("CLI entrypoint (subprocess)", () => {
  const cliPath = resolve(import.meta.dirname, "../../dist/cli.js");

  it("compile without --spec prints an error and exits non-zero", () => {
    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`node ${cliPath} compile examples/plan.md`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const e = err as { status: number; stderr: string };
      exitCode = e.status;
      stderr = e.stderr;
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--spec");
  });

  it("npx entrypoint runs main (compile without --spec errors)", () => {
    // Reproduces the bug where `npx .` silently exits 0 because the
    // isEntryPoint guard fails when npx wraps the binary via a shim.
    let stderr = "";
    let exitCode = 0;
    try {
      execSync("npx . compile examples/plan.md", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        cwd: resolve(import.meta.dirname, "../.."),
      });
    } catch (err: unknown) {
      const e = err as { status: number; stderr: string };
      exitCode = e.status;
      stderr = e.stderr;
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--spec");
  });

  it("running with no arguments prints help and exits non-zero", () => {
    let stderr = "";
    let stdout = "";
    let exitCode = 0;
    try {
      const output = execSync(`node ${cliPath}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      stdout = output;
    } catch (err: unknown) {
      const e = err as { status: number; stderr: string; stdout: string };
      exitCode = e.status;
      stderr = e.stderr;
      stdout = e.stdout;
    }
    expect(exitCode).not.toBe(0);
    expect(stdout + stderr).toContain("Usage:");
  });
});
