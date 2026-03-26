import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TasksJson } from "../../types/tasks.js";
import type { ParseResult } from "../../types/compile.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports of the module under test
// ---------------------------------------------------------------------------

vi.mock("../planParser.js", () => ({
  parsePlan: vi.fn(),
}));

vi.mock("../planEnricher.js", () => ({
  enrichPlan: vi.fn(),
}));

vi.mock("../prompts.js", () => ({
  buildDecomposePrompt: vi.fn(() => "decompose prompt"),
}));

// Import module under test and mocked modules AFTER vi.mock declarations
import { compilePlan, stripCodeFences } from "../compilePlan.js";
import { parsePlan } from "../planParser.js";
import { enrichPlan } from "../planEnricher.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeValidTasksJson(overrides?: Partial<TasksJson>): TasksJson {
  return {
    projectRoot: ".",
    specRef: "./spec.md",
    planRef: "./plan.md",
    createdAt: new Date().toISOString(),
    phases: [
      {
        id: "phase-1",
        name: "setup",
        description: "Set up project",
        requiresBrowserTest: false,
        tasks: [
          {
            id: "task-1-1",
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
      },
    ],
    ...overrides,
  };
}

function makeSuccessParseResult(tasksJson: TasksJson): ParseResult {
  return {
    success: true,
    tasksJson,
    enrichmentNeeded: [],
    errors: [],
  };
}

function makeFailedParseResult(): ParseResult {
  return {
    success: false,
    tasksJson: null,
    enrichmentNeeded: [],
    errors: ["Could not parse plan"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stripCodeFences", () => {
  it("removes ```json prefix and ``` suffix", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });

  it("removes plain ``` fences", () => {
    const input = '```\n{"key": "value"}\n```';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });

  it("returns unchanged string when no fences present", () => {
    const input = '{"key": "value"}';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });

  it("handles extra whitespace around fences", () => {
    const input = '```json  \n{"key": "value"}\n```  ';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });
});

describe("compilePlan", () => {
  let tmpDir: string;

  const mockParsePlan = parsePlan as ReturnType<typeof vi.fn>;
  const mockEnrichPlan = enrichPlan as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "trellis-compile-test-"));
    writeFileSync(join(tmpDir, "plan.md"), "# Plan\n## Phase 1: Setup\n- Task 1");
    writeFileSync(join(tmpDir, "spec.md"), "# Spec\nSome spec content");
    mkdirSync(join(tmpDir, "output"), { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Parser success path
  // -----------------------------------------------------------------------

  describe("parser success path", () => {
    it("parses, enriches, and writes output", async () => {
      const tj = makeValidTasksJson();
      mockParsePlan.mockReturnValue(makeSuccessParseResult(tj));
      mockEnrichPlan.mockResolvedValue(tj);

      const mockQuery = vi.fn();

      const result = await compilePlan({
        planPath: join(tmpDir, "plan.md"),
        specPath: join(tmpDir, "spec.md"),
        projectRoot: tmpDir,
        outputPath: join(tmpDir, "output", "tasks.json"),
        query: mockQuery,
      });

      expect(result.phases).toHaveLength(1);
      // Verify file was written
      const written = JSON.parse(
        readFileSync(join(tmpDir, "output", "tasks.json"), "utf-8"),
      );
      expect(written.phases).toHaveLength(1);
    });

    it("includes guidelinesRef when provided", async () => {
      writeFileSync(join(tmpDir, "guidelines.md"), "# Guidelines");
      const tj = makeValidTasksJson();
      mockParsePlan.mockReturnValue(makeSuccessParseResult(tj));
      mockEnrichPlan.mockResolvedValue(tj);

      const result = await compilePlan({
        planPath: join(tmpDir, "plan.md"),
        specPath: join(tmpDir, "spec.md"),
        guidelinesPath: join(tmpDir, "guidelines.md"),
        projectRoot: tmpDir,
        outputPath: join(tmpDir, "output", "tasks.json"),
        query: vi.fn(),
      });

      expect(result.guidelinesRef).toBeDefined();
    });

    it("throws when final validation fails", async () => {
      const badTj = { not: "valid" } as unknown as TasksJson;
      mockParsePlan.mockReturnValue(makeSuccessParseResult(badTj));
      mockEnrichPlan.mockResolvedValue(badTj);

      await expect(
        compilePlan({
          planPath: join(tmpDir, "plan.md"),
          specPath: join(tmpDir, "spec.md"),
          projectRoot: tmpDir,
          outputPath: join(tmpDir, "output", "tasks.json"),
          query: vi.fn(),
        }),
      ).rejects.toThrow("Final TasksJson validation failed");
    });
  });

  // -----------------------------------------------------------------------
  // Parser failure (LLM decompose) path
  // -----------------------------------------------------------------------

  describe("parser failure path (LLM decompose)", () => {
    it("falls back to LLM decomposition when parser fails", async () => {
      mockParsePlan.mockReturnValue(makeFailedParseResult());

      const tj = makeValidTasksJson();
      const mockQuery = vi.fn().mockResolvedValue(JSON.stringify(tj));

      const result = await compilePlan({
        planPath: join(tmpDir, "plan.md"),
        specPath: join(tmpDir, "spec.md"),
        projectRoot: tmpDir,
        outputPath: join(tmpDir, "output", "tasks.json"),
        query: mockQuery,
      });

      expect(mockQuery).toHaveBeenCalled();
      expect(result.phases).toHaveLength(1);
    });

    it("strips code fences from LLM JSON response", async () => {
      mockParsePlan.mockReturnValue(makeFailedParseResult());

      const tj = makeValidTasksJson();
      const fencedResponse = "```json\n" + JSON.stringify(tj) + "\n```";
      const mockQuery = vi.fn().mockResolvedValue(fencedResponse);

      const result = await compilePlan({
        planPath: join(tmpDir, "plan.md"),
        specPath: join(tmpDir, "spec.md"),
        projectRoot: tmpDir,
        outputPath: join(tmpDir, "output", "tasks.json"),
        query: mockQuery,
      });

      expect(result.phases).toHaveLength(1);
    });

    it("throws on invalid LLM JSON output", async () => {
      mockParsePlan.mockReturnValue(makeFailedParseResult());

      const mockQuery = vi.fn().mockResolvedValue('{"invalid": true}');

      await expect(
        compilePlan({
          planPath: join(tmpDir, "plan.md"),
          specPath: join(tmpDir, "spec.md"),
          projectRoot: tmpDir,
          outputPath: join(tmpDir, "output", "tasks.json"),
          query: mockQuery,
        }),
      ).rejects.toThrow("LLM decomposition produced invalid TasksJson");
    });

    it("writes output file to correct path", async () => {
      mockParsePlan.mockReturnValue(makeFailedParseResult());

      const tj = makeValidTasksJson();
      const mockQuery = vi.fn().mockResolvedValue(JSON.stringify(tj));

      await compilePlan({
        planPath: join(tmpDir, "plan.md"),
        specPath: join(tmpDir, "spec.md"),
        projectRoot: tmpDir,
        outputPath: join(tmpDir, "output", "tasks.json"),
        query: mockQuery,
      });

      const written = readFileSync(join(tmpDir, "output", "tasks.json"), "utf-8");
      expect(JSON.parse(written)).toHaveProperty("phases");
    });
  });
});
