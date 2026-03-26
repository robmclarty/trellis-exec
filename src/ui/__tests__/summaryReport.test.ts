import { describe, it, expect } from "vitest";
import { formatSummaryReport, formatTokenCount } from "../summaryReport.js";
import type { PhaseRunnerResult } from "../../runner/phaseRunner.js";
import type { SharedState, PhaseReport } from "../../types/state.js";

function makeReport(overrides: Partial<PhaseReport> = {}): PhaseReport {
  return {
    phaseId: "phase-1",
    status: "complete",
    summary: "All tasks done",
    tasksCompleted: ["t1", "t2"],
    tasksFailed: [],
    orchestratorAnalysis: "",
    recommendedAction: "advance",
    correctiveTasks: [],
    decisionsLog: [],
    handoff: "",
    ...overrides,
  };
}

function makeResult(overrides: Partial<PhaseRunnerResult> & { finalState: SharedState }): PhaseRunnerResult {
  return {
    success: true,
    phasesCompleted: [],
    phasesFailed: [],
    phaseDurations: {},
    totalDuration: 0,
    phaseTokens: {},
    ...overrides,
  };
}

function makeState(overrides: Partial<SharedState> = {}): SharedState {
  return {
    currentPhase: "phase-1",
    completedPhases: [],
    phaseReports: [],
    phaseRetries: {},
    phaseReport: null,
    ...overrides,
  };
}

describe("formatTokenCount", () => {
  it("formats small numbers as-is", () => {
    expect(formatTokenCount(500)).toBe("500");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(50_000)).toBe("50.0k");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
    expect(formatTokenCount(2_000_000)).toBe("2.0M");
  });
});

describe("formatSummaryReport", () => {
  it("handles no phases executed", () => {
    const result = makeResult({
      finalState: makeState(),
      totalDuration: 5000,
    });
    const output = formatSummaryReport(result);
    expect(output).toContain("no phases executed");
    expect(output).toContain("5s");
  });

  it("formats single phase, all pass, judge passes", () => {
    const report = makeReport({
      phaseId: "phase-1",
      tasksCompleted: ["t1", "t2", "t3"],
      tasksFailed: [],
      judgeAssessment: { passed: true, issues: [], suggestions: [], corrections: [] },
    });
    const result = makeResult({
      success: true,
      phasesCompleted: ["phase-1"],
      finalState: makeState({ phaseReports: [report], phaseRetries: {} }),
      phaseDurations: { "phase-1": 83_000 },
      totalDuration: 83_000,
    });

    const output = formatSummaryReport(result);
    expect(output).toContain("Run Complete");
    expect(output).toContain("phase-1");
    expect(output).toContain("3/3");
    expect(output).toContain("0/3");
    expect(output).toContain("pass");
    expect(output).toContain("1m 23s");
  });

  it("formats multi-phase with mixed results and retries", () => {
    const report1 = makeReport({
      phaseId: "phase-1",
      tasksCompleted: ["t1", "t2"],
      tasksFailed: [],
      judgeAssessment: { passed: true, issues: [], suggestions: [], corrections: [] },
    });
    const report2 = makeReport({
      phaseId: "phase-2",
      status: "partial",
      tasksCompleted: ["t3"],
      tasksFailed: ["t4"],
      judgeAssessment: {
        passed: false,
        issues: [
          { description: "missing test", severity: "high" },
          { description: "wrong return type", severity: "medium" },
        ],
        suggestions: [],
        corrections: [],
      },
    });

    const result = makeResult({
      success: false,
      phasesCompleted: ["phase-1"],
      phasesFailed: ["phase-2"],
      finalState: makeState({
        phaseReports: [report1, report2],
        phaseRetries: { "phase-2": 1 },
      }),
      phaseDurations: { "phase-1": 60_000, "phase-2": 47_000 },
      totalDuration: 107_000,
    });

    const output = formatSummaryReport(result);
    expect(output).toContain("Run Failed");
    expect(output).toContain("phase-1");
    expect(output).toContain("phase-2");
    expect(output).toContain("fail(2)");
    expect(output).toContain("2 issues");
    expect(output).toContain("1m 47s");
  });

  it("shows dash when judge was not run", () => {
    const report = makeReport({
      phaseId: "phase-1",
      tasksCompleted: ["t1"],
      tasksFailed: [],
    });
    const result = makeResult({
      success: true,
      phasesCompleted: ["phase-1"],
      finalState: makeState({ phaseReports: [report] }),
      phaseDurations: { "phase-1": 10_000 },
      totalDuration: 10_000,
    });

    const output = formatSummaryReport(result);
    const lines = output.split("\n");
    const phaseRow = lines.find((l) => l.includes("phase-1"));
    expect(phaseRow).toContain("-");
  });

  it("shows dash for duration when phase was resumed/skipped", () => {
    const report = makeReport({ phaseId: "phase-1" });
    const result = makeResult({
      success: true,
      phasesCompleted: ["phase-1"],
      finalState: makeState({ phaseReports: [report] }),
      phaseDurations: {},
      totalDuration: 1000,
    });

    const output = formatSummaryReport(result);
    const lines = output.split("\n");
    const phaseRow = lines.find((l) => l.includes("phase-1"));
    expect(phaseRow).toBeDefined();
    expect(phaseRow).toMatch(/phase-1\s+-/);
  });

  it("deduplicates reports from retries, keeping the last", () => {
    const report1 = makeReport({
      phaseId: "phase-1",
      status: "partial",
      tasksCompleted: ["t1"],
      tasksFailed: ["t2"],
    });
    const report2 = makeReport({
      phaseId: "phase-1",
      status: "complete",
      tasksCompleted: ["t1", "t2"],
      tasksFailed: [],
    });

    const result = makeResult({
      success: true,
      phasesCompleted: ["phase-1"],
      finalState: makeState({
        phaseReports: [report1, report2],
        phaseRetries: { "phase-1": 1 },
      }),
      phaseDurations: { "phase-1": 90_000 },
      totalDuration: 90_000,
    });

    const output = formatSummaryReport(result);
    expect(output).toContain("2/2");
    expect(output).toContain("0/2");
    const phaseRows = output.split("\n").filter((l) => l.includes("phase-1"));
    expect(phaseRows).toHaveLength(1);
  });

  it("includes token columns when usage data is available", () => {
    const report = makeReport({
      phaseId: "phase-1",
      tasksCompleted: ["t1", "t2"],
      tasksFailed: [],
    });
    const result = makeResult({
      success: true,
      phasesCompleted: ["phase-1"],
      finalState: makeState({ phaseReports: [report] }),
      phaseDurations: { "phase-1": 30_000 },
      totalDuration: 30_000,
      phaseTokens: {
        "phase-1": { inputTokens: 50_000, outputTokens: 12_000, costUsd: 0.15 },
      },
    });

    const output = formatSummaryReport(result);
    expect(output).toContain("Tokens");
    expect(output).toContain("Cost");
    expect(output).toContain("62.0k");
    expect(output).toContain("$0.15");
  });

  it("hides token columns when no usage data exists", () => {
    const report = makeReport({
      phaseId: "phase-1",
      tasksCompleted: ["t1"],
      tasksFailed: [],
    });
    const result = makeResult({
      success: true,
      phasesCompleted: ["phase-1"],
      finalState: makeState({ phaseReports: [report] }),
      phaseDurations: { "phase-1": 10_000 },
      totalDuration: 10_000,
      phaseTokens: {},
    });

    const output = formatSummaryReport(result);
    expect(output).not.toContain("Tokens");
    expect(output).not.toContain("Cost");
  });

  it("sums tokens across multiple phases", () => {
    const report1 = makeReport({
      phaseId: "phase-1",
      tasksCompleted: ["t1"],
      tasksFailed: [],
    });
    const report2 = makeReport({
      phaseId: "phase-2",
      tasksCompleted: ["t2"],
      tasksFailed: [],
    });

    const result = makeResult({
      success: true,
      phasesCompleted: ["phase-1", "phase-2"],
      finalState: makeState({ phaseReports: [report1, report2] }),
      phaseDurations: { "phase-1": 20_000, "phase-2": 30_000 },
      totalDuration: 50_000,
      phaseTokens: {
        "phase-1": { inputTokens: 30_000, outputTokens: 10_000, costUsd: 0.10 },
        "phase-2": { inputTokens: 40_000, outputTokens: 15_000, costUsd: 0.14 },
      },
    });

    const output = formatSummaryReport(result);
    // Total tokens: 30k+10k+40k+15k = 95k
    expect(output).toContain("95.0k");
    // Total cost: $0.24
    expect(output).toContain("$0.24");
  });
});
