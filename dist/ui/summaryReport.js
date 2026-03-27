import { formatElapsed } from "./spinner.js";
export function formatTokenCount(count) {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1)}k`;
    }
    return String(count);
}
function formatCost(usd) {
    if (usd === 0)
        return "-";
    if (usd < 0.01)
        return "<$0.01";
    return `$${usd.toFixed(2)}`;
}
function getJudgeLabel(report) {
    const assessment = report.judgeAssessment;
    if (!assessment)
        return "-";
    if (assessment.passed)
        return "pass";
    const count = assessment.issues.length;
    return `fail(${count})`;
}
function formatTokensLabel(usage) {
    if (!usage)
        return "-";
    const total = usage.inputTokens + usage.outputTokens;
    if (total === 0)
        return "-";
    return formatTokenCount(total);
}
const COLUMN_KEYS = ["phase", "time", "tasks", "failed", "judge", "retries", "tokens", "cost"];
const RIGHT_ALIGNED = new Set(["time", "tasks", "failed", "judge", "retries", "tokens", "cost"]);
function padColumns(rows, totals, hasTokens) {
    const header = {
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
    const widths = {};
    for (const col of cols) {
        widths[col] = Math.max(...all.map((r) => r[col].length));
    }
    function formatCell(col, value) {
        return RIGHT_ALIGNED.has(col)
            ? value.padStart(widths[col])
            : value.padEnd(widths[col]);
    }
    function formatRow(r) {
        return " " + cols.map((col) => formatCell(col, r[col])).join(" \u2502 ");
    }
    function formatSeparator() {
        return "\u2500" + cols.map((col) => "\u2500".repeat(widths[col])).join("\u2500\u253C\u2500");
    }
    const lines = [];
    lines.push(formatRow(header));
    lines.push(formatSeparator());
    for (const row of rows) {
        lines.push(formatRow(row));
    }
    lines.push(formatSeparator());
    lines.push(formatRow(totals));
    return lines.join("\n");
}
export function formatSummaryReport(result) {
    const { finalState, phaseDurations, phaseTokens } = result;
    const reports = finalState.phaseReports;
    if (reports.length === 0) {
        return `Run Summary: no phases executed (${formatElapsed(result.totalDuration)})`;
    }
    // Deduplicate reports — keep the last report per phaseId (retries produce multiple)
    const reportsByPhase = new Map();
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
    const rows = [];
    for (const [phaseId, report] of reportsByPhase) {
        const completed = report.tasksCompleted.length;
        const failed = report.tasksFailed.length;
        const taskTotal = completed + failed;
        const phaseRetries = finalState.phaseRetries[phaseId] ?? 0;
        const judgeFixCycles = report.judgeFixCycles ?? 0;
        const retries = phaseRetries + judgeFixCycles;
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
    const totals = {
        phase: "Total",
        time: formatElapsed(result.totalDuration),
        tasks: `${totalCompleted}/${totalTasks}`,
        failed: `${totalFailed}/${totalTasks}`,
        judge: totalIssues > 0 ? `${totalIssues} issue${totalIssues === 1 ? "" : "s"}` : "-",
        retries: String(totalRetries),
        tokens: hasAnyTokens ? formatTokenCount(totalInput + totalOutput) : "-",
        cost: hasAnyTokens ? formatCost(totalCost) : "-",
    };
    const lines = [];
    lines.push(result.success ? "Run Complete" : "Run Failed");
    lines.push("");
    lines.push(padColumns(rows, totals, hasAnyTokens));
    // Browser acceptance test summary (Tier 2)
    if (result.browserAcceptanceReport) {
        const bar = result.browserAcceptanceReport;
        lines.push("");
        lines.push("Browser Acceptance Tests");
        if (bar.results.length === 0) {
            lines.push("  No structured results returned by browser-tester agent.");
            if (bar.retries > 0) {
                lines.push(`  ${bar.retries} fix attempt(s) were dispatched before stopping.`);
            }
        }
        else {
            const passedCount = bar.results.filter((r) => r.passed).length;
            const totalCount = bar.results.length;
            lines.push(`  ${passedCount}/${totalCount} criteria passed (${bar.retries} retries)`);
            for (const r of bar.results) {
                if (!r.passed) {
                    lines.push(`  FAIL: ${r.criterion}${r.detail ? ` \u2014 ${r.detail}` : ""}`);
                }
            }
        }
        if (bar.generatedTestPath) {
            lines.push(`  Generated tests saved to: ${bar.generatedTestPath}`);
        }
    }
    // Check if browser smoke was skipped across all phases
    const smokeReports = reports
        .map((r) => r.browserSmokeReport)
        .filter((s) => s !== undefined);
    if (smokeReports.length > 0 && smokeReports.every((s) => s.skipped)) {
        const reason = smokeReports[0]?.reason ?? "unknown";
        lines.push("");
        lines.push(`Browser smoke checks: skipped (${reason})`);
    }
    return lines.join("\n");
}
//# sourceMappingURL=summaryReport.js.map