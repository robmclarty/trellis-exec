import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Phase } from "../../types/tasks.js";
import type { SharedState, PhaseReport, JudgeIssue } from "../../types/state.js";
import type { ChangedFile } from "../../git.js";
import type { RunContext } from "../../cli.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
  };
});

import { readFileSync } from "node:fs";
import {
  buildRejudgePrompt,
  buildReferenceContext,
  buildPhaseContext,
  buildFixPrompt,
  formatIssue,
  normalizeReport,
  parseJudgeResult,
  collectLearnings,
} from "../prompts.js";

const mockedReadFileSync = vi.mocked(readFileSync);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePhase(overrides?: Partial<Phase>): Phase {
  return {
    id: "phase-1",
    name: "scaffolding",
    description: "Set up project",
    requiresBrowserTest: false,
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
    ],
    ...overrides,
  };
}

function makeReport(overrides?: Partial<PhaseReport>): PhaseReport {
  return {
    phaseId: "phase-1",
    status: "complete",
    summary: "Done",
    tasksCompleted: ["task-1-1"],
    tasksFailed: [],
    orchestratorAnalysis: "",
    recommendedAction: "advance",
    correctiveTasks: [],
    decisionsLog: [],
    corrections: [],
    handoff: "",
    ...overrides,
  };
}

function makeState(overrides?: Partial<SharedState>): SharedState {
  return {
    currentPhase: "phase-1",
    completedPhases: [],
    phaseReports: [],
    phaseRetries: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildRejudgePrompt
// ---------------------------------------------------------------------------

describe("buildRejudgePrompt", () => {
  it("includes Re-Judge After Fix heading", () => {
    const result = buildRejudgePrompt({
      fixDiff: "",
      fixChangedFiles: [],
      previousIssues: ["something broke"],
      phase: makePhase(),
    });
    expect(result).toContain("# Re-Judge After Fix");
  });

  it("lists previous issues numbered", () => {
    const issues: JudgeIssue[] = [
      "first problem",
      { description: "second problem" },
    ];
    const result = buildRejudgePrompt({
      fixDiff: "",
      fixChangedFiles: [],
      previousIssues: issues,
      phase: makePhase(),
    });
    expect(result).toContain("1. first problem");
    expect(result).toContain("2. second problem");
  });

  it("includes fix diff in code fence", () => {
    const result = buildRejudgePrompt({
      fixDiff: "+added line\n-removed line",
      fixChangedFiles: [],
      previousIssues: ["issue"],
      phase: makePhase(),
    });
    expect(result).toContain("```diff");
    expect(result).toContain("+added line\n-removed line");
  });

  it("includes fix changed files", () => {
    const files: ChangedFile[] = [
      { path: "src/index.ts", status: "M" },
      { path: "src/new.ts", status: "A" },
    ];
    const result = buildRejudgePrompt({
      fixDiff: "diff",
      fixChangedFiles: files,
      previousIssues: ["issue"],
      phase: makePhase(),
    });
    expect(result).toContain("`src/index.ts` (M)");
    expect(result).toContain("`src/new.ts` (A)");
  });

  it("shows task acceptance criteria", () => {
    const result = buildRejudgePrompt({
      fixDiff: "",
      fixChangedFiles: [],
      previousIssues: ["issue"],
      phase: makePhase(),
    });
    expect(result).toContain("npm install exits 0");
    expect(result).toContain("Acceptance criteria:");
  });

  it("shows no-files message when fixChangedFiles is empty", () => {
    const result = buildRejudgePrompt({
      fixDiff: "",
      fixChangedFiles: [],
      previousIssues: ["issue"],
      phase: makePhase(),
    });
    expect(result).toContain("(no files changed by the fix)");
  });
});

// ---------------------------------------------------------------------------
// formatIssue
// ---------------------------------------------------------------------------

describe("formatIssue", () => {
  it("returns string input as-is", () => {
    expect(formatIssue("something broke")).toBe("something broke");
  });

  it("returns just description when no task", () => {
    expect(formatIssue({ description: "missing file" })).toBe("missing file");
  });

  it("returns task: description when task is present", () => {
    expect(
      formatIssue({ task: "task-1-1", description: "missing file" }),
    ).toBe("task-1-1: missing file");
  });
});

// ---------------------------------------------------------------------------
// normalizeReport edge cases
// ---------------------------------------------------------------------------

describe("normalizeReport", () => {
  it("gives sensible defaults for empty raw object", () => {
    const report = normalizeReport({}, "phase-1");
    expect(report.phaseId).toBe("phase-1");
    expect(report.status).toBe("partial");
    expect(report.recommendedAction).toBe("halt");
    expect(report.tasksCompleted).toEqual([]);
    expect(report.tasksFailed).toEqual([]);
    expect(report.decisionsLog).toEqual([]);
    expect(report.correctiveTasks).toEqual([]);
    expect(report.handoff).toBe("");
    expect(report.summary).toBe("");
  });

  it("accepts tasksCompleted and tasksFailed with overlapping IDs", () => {
    const report = normalizeReport(
      {
        status: "complete",
        recommendedAction: "advance",
        tasksCompleted: ["task-1"],
        tasksFailed: ["task-1"],
      },
      "phase-1",
    );
    // Both arrays preserve the ID — no dedup logic
    expect(report.tasksCompleted).toContain("task-1");
    expect(report.tasksFailed).toContain("task-1");
  });

  it("extracts from taskOutcomes as alternative to tasksCompleted/tasksFailed", () => {
    const report = normalizeReport(
      {
        status: "complete",
        recommendedAction: "advance",
        taskOutcomes: [
          { taskId: "task-1", status: "complete" },
          { taskId: "task-2", status: "completed" },
          { taskId: "task-3", status: "failed" },
        ],
      },
      "phase-1",
    );
    expect(report.tasksCompleted).toEqual(["task-1", "task-2"]);
    expect(report.tasksFailed).toEqual(["task-3"]);
  });

  it("uses handoffBriefing as fallback for handoff", () => {
    const report = normalizeReport(
      { handoffBriefing: "next phase context" },
      "phase-1",
    );
    expect(report.handoff).toBe("next phase context");
  });
});

// ---------------------------------------------------------------------------
// parseJudgeResult edge cases
// ---------------------------------------------------------------------------

describe("parseJudgeResult", () => {
  it("returns unparseable fallback for empty string", () => {
    const result = parseJudgeResult("");
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]).toMatch(/unparseable/i);
  });

  it("returns unparseable fallback for output with no JSON", () => {
    const result = parseJudgeResult("The code looks good overall.");
    expect(result.passed).toBe(false);
    expect(result.issues[0]).toMatch(/unparseable/i);
  });

  it("extracts JSON from the first code fence", () => {
    const output = [
      "Here is my review:",
      "```json",
      '{ "passed": true, "issues": [], "suggestions": [] }',
      "```",
      "```json",
      '{ "passed": false, "issues": ["bad"], "suggestions": [] }',
      "```",
    ].join("\n");
    const result = parseJudgeResult(output);
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("returns unparseable fallback for truncated JSON", () => {
    const result = parseJudgeResult('```json\n{ "passed": true, "issues": [\n```');
    expect(result.passed).toBe(false);
    expect(result.issues[0]).toMatch(/unparseable/i);
  });

  it("normalizes detail field to description in issues", () => {
    const output = JSON.stringify({
      passed: false,
      issues: [{ task: "task-1", detail: "missing export" }],
      suggestions: [],
    });
    const result = parseJudgeResult(output);
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0]!;
    expect(typeof issue === "object" && "description" in issue).toBe(true);
    if (typeof issue === "object") {
      expect(issue.description).toBe("missing export");
    }
  });
});

// ---------------------------------------------------------------------------
// collectLearnings edge cases
// ---------------------------------------------------------------------------

describe("collectLearnings", () => {
  it("returns empty arrays for empty phaseReports", () => {
    const result = collectLearnings(makeState());
    expect(result.architectural).toEqual([]);
    expect(result.tactical).toEqual([]);
    expect(result.constraint).toEqual([]);
  });

  it("truncates tactical entries beyond budget", () => {
    // Budget = max(10, 20 - arch - constraint). With 5 arch + 5 constraint,
    // budget = max(10, 10) = 10. Create 15 tactical entries; expect 10.
    const archEntries = Array.from({ length: 5 }, (_, i) => ({
      text: `arch-${i}`,
      tier: "architectural" as const,
    }));
    const constraintEntries = Array.from({ length: 5 }, (_, i) => ({
      text: `constraint-${i}`,
      tier: "constraint" as const,
    }));
    const tacticalEntries = Array.from({ length: 15 }, (_, i) => ({
      text: `tactical-${i}`,
      tier: "tactical" as const,
    }));

    const state = makeState({
      phaseReports: [
        makeReport({
          decisionsLog: [...archEntries, ...constraintEntries, ...tacticalEntries],
        }),
      ],
    });

    const result = collectLearnings(state);
    expect(result.architectural).toHaveLength(5);
    expect(result.constraint).toHaveLength(5);
    expect(result.tactical).toHaveLength(10);
    // Sliding window keeps the last N, so tactical-5 through tactical-14
    expect(result.tactical[0]).toContain("tactical-5");
    expect(result.tactical[9]).toContain("tactical-14");
  });

  it("sorts all three tiers correctly across multiple reports", () => {
    const state = makeState({
      phaseReports: [
        makeReport({
          phaseId: "phase-1",
          decisionsLog: [
            { text: "arch decision", tier: "architectural" },
            { text: "tac note", tier: "tactical" },
          ],
        }),
        makeReport({
          phaseId: "phase-2",
          decisionsLog: [
            { text: "binding constraint", tier: "constraint" },
          ],
        }),
      ],
    });

    const result = collectLearnings(state);
    expect(result.architectural).toEqual(["[phase-1] arch decision"]);
    expect(result.tactical).toEqual(["[phase-1] tac note"]);
    expect(result.constraint).toEqual(["[phase-2] binding constraint"]);
  });
});

// ---------------------------------------------------------------------------
// buildReferenceContext
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<RunContext>): RunContext {
  return {
    projectRoot: "/tmp/test",
    specPath: "/tmp/test/spec.md",
    planPath: "/tmp/test/plan.md",
    statePath: "/tmp/test/state.json",
    trajectoryPath: "/tmp/test/trajectory.jsonl",
    tasksJsonPath: "/tmp/test/tasks.json",
    concurrency: 3,
    maxRetries: 2,
    headless: true,
    verbose: false,
    dryRun: false,
    pluginRoot: "/tmp/test/plugin",
    judgeMode: "always",
    saveE2eTests: false,
    browserTestRetries: 3,
    ...overrides,
  };
}

describe("buildReferenceContext", () => {
  beforeEach(() => {
    mockedReadFileSync.mockImplementation((path: Parameters<typeof readFileSync>[0]) => {
      if (String(path).endsWith("spec.md")) return "# The Spec\nSpec content here.";
      if (String(path).endsWith("guidelines.md")) return "# Guidelines\nGuideline content.";
      return "";
    });
  });

  it("includes learnings, spec, and guidelines in correct order when learnings exist", () => {
    const state = makeState({
      phaseReports: [
        makeReport({
          decisionsLog: [
            { text: "use .jsx extensions for JSX files", tier: "constraint" },
            { text: "chose Tailwind for styling", tier: "architectural" },
          ],
        }),
      ],
    });
    const ctx = makeCtx({ guidelinesPath: "/tmp/test/guidelines.md" });

    const result = buildReferenceContext(state, ctx);

    // Learnings (Current Understanding) should appear BEFORE spec
    const learningsIdx = result.indexOf("Current Understanding");
    const specIdx = result.indexOf("Original Spec");
    const guidelinesIdx = result.indexOf("Guidelines Content");
    const authorityIdx = result.indexOf("Implementation Authority");

    expect(learningsIdx).toBeGreaterThanOrEqual(0);
    expect(specIdx).toBeGreaterThan(learningsIdx);
    expect(authorityIdx).toBeGreaterThan(learningsIdx);
    expect(guidelinesIdx).toBeGreaterThan(authorityIdx);
    expect(specIdx).toBeGreaterThan(guidelinesIdx);

    // Content checks
    expect(result).toContain("use .jsx extensions for JSX files");
    expect(result).toContain("chose Tailwind for styling");
    expect(result).toContain("Spec content here.");
    expect(result).toContain("Guideline content.");
  });

  it("omits Current Understanding and Implementation Authority when no learnings exist", () => {
    const state = makeState();
    const ctx = makeCtx({ guidelinesPath: "/tmp/test/guidelines.md" });

    const result = buildReferenceContext(state, ctx);

    expect(result).not.toContain("Current Understanding");
    expect(result).not.toContain("Implementation Authority");
    // Spec heading should NOT be demoted
    expect(result).toContain("## Spec Content");
    expect(result).not.toContain("Original Spec");
  });

  it("includes anti-hack instructions when learnings exist", () => {
    const state = makeState({
      phaseReports: [
        makeReport({
          decisionsLog: [{ text: "something learned", tier: "tactical" }],
        }),
      ],
    });
    const ctx = makeCtx();

    const result = buildReferenceContext(state, ctx);

    expect(result).toContain("Implementation Authority");
    expect(result).toContain("NEVER create wrapper files");
  });

  it("handles missing guidelinesPath gracefully", () => {
    const state = makeState();
    const ctx = makeCtx();

    const result = buildReferenceContext(state, ctx);

    expect(result).toContain("Guidelines Content");
    expect(result).toContain("none configured");
  });
});

// ---------------------------------------------------------------------------
// buildPhaseContext ordering
// ---------------------------------------------------------------------------

describe("buildPhaseContext ordering", () => {
  beforeEach(() => {
    mockedReadFileSync.mockImplementation((path: Parameters<typeof readFileSync>[0]) => {
      if (String(path).endsWith("spec.md")) return "# The Spec";
      if (String(path).endsWith("guidelines.md")) return "# Guidelines";
      return "";
    });
  });

  it("puts learnings before spec when learnings exist", () => {
    const state = makeState({
      phaseReports: [
        makeReport({
          decisionsLog: [{ text: "discovered constraint", tier: "constraint" }],
        }),
      ],
    });
    const ctx = makeCtx({ guidelinesPath: "/tmp/test/guidelines.md" });
    const phase = makePhase();

    const result = buildPhaseContext(phase, state, "prior handoff", ctx);

    const learningsIdx = result.indexOf("Current Understanding");
    const specIdx = result.indexOf("Original Spec");

    expect(learningsIdx).toBeGreaterThanOrEqual(0);
    expect(specIdx).toBeGreaterThan(learningsIdx);
  });
});

// ---------------------------------------------------------------------------
// buildFixPrompt with reference context
// ---------------------------------------------------------------------------

describe("buildFixPrompt with reference context", () => {
  beforeEach(() => {
    mockedReadFileSync.mockImplementation((path: Parameters<typeof readFileSync>[0]) => {
      if (String(path).endsWith("spec.md")) return "# The Spec\nFull spec.";
      if (String(path).endsWith("guidelines.md")) return "# Guidelines\nFull guidelines.";
      return "";
    });
  });

  it("includes same reference context as orchestrator", () => {
    const state = makeState({
      phaseReports: [
        makeReport({
          decisionsLog: [{ text: "use CSS modules", tier: "architectural" }],
        }),
      ],
    });
    const ctx = makeCtx({ guidelinesPath: "/tmp/test/guidelines.md" });
    const phase = makePhase();

    const result = buildFixPrompt(["some issue"], phase, state, ctx);

    // Fix agent should get learnings
    expect(result).toContain("use CSS modules");
    // Fix agent should get spec
    expect(result).toContain("Full spec.");
    // Fix agent should get guidelines
    expect(result).toContain("Full guidelines.");
    // Fix agent should get anti-hack
    expect(result).toContain("Implementation Authority");
  });
});

// ---------------------------------------------------------------------------
// normalizeReport corrections
// ---------------------------------------------------------------------------

describe("normalizeReport corrections", () => {
  it("parses valid corrections array", () => {
    const report = normalizeReport(
      {
        status: "complete",
        recommendedAction: "advance",
        corrections: [
          { type: "targetPath", taskId: "task-1", old: "src/a.js", new: "src/a.jsx", reason: "JSX" },
        ],
      },
      "phase-1",
    );
    expect(report.corrections).toHaveLength(1);
    expect(report.corrections[0]!.taskId).toBe("task-1");
    expect(report.corrections[0]!.old).toBe("src/a.js");
    expect(report.corrections[0]!.new).toBe("src/a.jsx");
  });

  it("defaults corrections to empty array when missing", () => {
    const report = normalizeReport({}, "phase-1");
    expect(report.corrections).toEqual([]);
  });

  it("filters out invalid correction entries", () => {
    const report = normalizeReport(
      {
        corrections: [
          { type: "targetPath", taskId: "task-1", old: "a.js", new: "a.jsx", reason: "JSX" },
          { invalid: true },
          "not-an-object",
        ],
      },
      "phase-1",
    );
    expect(report.corrections).toHaveLength(1);
    expect(report.corrections[0]!.taskId).toBe("task-1");
  });
});
