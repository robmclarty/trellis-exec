import type { PhaseRunnerResult } from "../runner/phaseRunner.js";
import type { PhaseReport } from "../types/state.js";
import type { UsageStats } from "./streamParser.js";
import { formatElapsed } from "./spinner.js";

type PhaseRow = {
  phase: string;
  time: string;
  tasks: string;
  failed: string;
  judge: string;
  retries: string;
  tokens: string;
  cost: string;
};

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
}

function formatCost(usd: number): string {
  if (usd === 0) return "-";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function getJudgeLabel(report: PhaseReport): string {
  const assessment = report.judgeAssessment;
  if (!assessment) return "-";
  if (assessment.passed) return "pass";
  const count = assessment.issues.length;
  return `fail(${count})`;
}

function formatTokensLabel(usage: UsageStats | undefined): string {
  if (!usage) return "-";
  const total = usage.inputTokens + usage.outputTokens;
  if (total === 0) return "-";
  return formatTokenCount(total);
}

const COLUMN_KEYS = ["phase", "time", "tasks", "failed", "judge", "retries", "tokens", "cost"] as const;
const RIGHT_ALIGNED = new Set(["time", "tasks", "failed", "judge", "retries", "tokens", "cost"]);

function padColumns(rows: PhaseRow[], totals: PhaseRow, hasTokens: boolean): string {
  const header: PhaseRow = {
    phase: "Phase",
    time: "Time",
    tasks: "Tasks",
    failed: "Failed",
    judge: "Judge",
    retries: "Retries",
    tokens: "Tokens",
    cost: "Cost",
  };

  const cols = hasTokens
    ? COLUMN_KEYS
    : COLUMN_KEYS.filter((k) => k !== "tokens" && k !== "cost");

  const all = [header, ...rows, totals];
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col] = Math.max(...all.map((r) => r[col].length));
  }

  function formatRow(r: PhaseRow): string {
    return cols
      .map((col) =>
        RIGHT_ALIGNED.has(col)
          ? r[col].padStart(widths[col]!)
          : r[col].padEnd(widths[col]!),
      )
      .join("  ");
  }

  const lines: string[] = [];
  const headerLine = formatRow(header);
  const separator = "\u2500".repeat(headerLine.length);

  lines.push(headerLine);
  lines.push(separator);
  for (const row of rows) {
    lines.push(formatRow(row));
  }
  lines.push(separator);
  lines.push(formatRow(totals));

  return lines.join("\n");
}

export function formatSummaryReport(result: PhaseRunnerResult): string {
  const { finalState, phaseDurations, phaseTokens } = result;
  const reports = finalState.phaseReports;

  if (reports.length === 0) {
    return `Run Summary: no phases executed (${formatElapsed(result.totalDuration)})`;
  }

  // Deduplicate reports — keep the last report per phaseId (retries produce multiple)
  const reportsByPhase = new Map<string, PhaseReport>();
  for (const report of reports) {
    reportsByPhase.set(report.phaseId, report);
  }

  let totalTasks = 0;
  let totalFailed = 0;
  let totalIssues = 0;
  let totalRetries = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let hasAnyTokens = false;

  const rows: PhaseRow[] = [];

  for (const [phaseId, report] of reportsByPhase) {
    const completed = report.tasksCompleted.length;
    const failed = report.tasksFailed.length;
    const taskTotal = completed + failed;
    const retries = finalState.phaseRetries[phaseId] ?? 0;
    const duration = phaseDurations[phaseId];
    const issueCount = report.judgeAssessment?.issues.length ?? 0;
    const usage = phaseTokens[phaseId];

    totalTasks += taskTotal;
    totalFailed += failed;
    totalIssues += issueCount;
    totalRetries += retries;
    if (usage) {
      totalInput += usage.inputTokens;
      totalOutput += usage.outputTokens;
      totalCost += usage.costUsd;
      hasAnyTokens = true;
    }

    rows.push({
      phase: phaseId,
      time: duration !== undefined ? formatElapsed(duration) : "-",
      tasks: `${completed}/${taskTotal}`,
      failed: `${failed}/${taskTotal}`,
      judge: getJudgeLabel(report),
      retries: String(retries),
      tokens: formatTokensLabel(usage),
      cost: usage ? formatCost(usage.costUsd) : "-",
    });
  }

  const totalCompleted = totalTasks - totalFailed;
  const totals: PhaseRow = {
    phase: "Total",
    time: formatElapsed(result.totalDuration),
    tasks: `${totalCompleted}/${totalTasks}`,
    failed: `${totalFailed}/${totalTasks}`,
    judge: totalIssues > 0 ? `${totalIssues} issue${totalIssues === 1 ? "" : "s"}` : "-",
    retries: String(totalRetries),
    tokens: hasAnyTokens ? formatTokenCount(totalInput + totalOutput) : "-",
    cost: hasAnyTokens ? formatCost(totalCost) : "-",
  };

  const lines: string[] = [];
  lines.push(result.success ? "Run Complete" : "Run Failed");
  lines.push("");
  lines.push(padColumns(rows, totals, hasAnyTokens));

  return lines.join("\n");
}
