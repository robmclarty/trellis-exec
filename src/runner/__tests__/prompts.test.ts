import { describe, it, expect } from "vitest";
import type { Phase } from "../../types/tasks.js";
import type { SharedState, PhaseReport, JudgeIssue } from "../../types/state.js";
import type { ChangedFile } from "../../git.js";
import {
  buildRejudgePrompt,
  formatIssue,
  normalizeReport,
  parseJudgeResult,
  collectLearnings,
} from "../prompts.js";

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
