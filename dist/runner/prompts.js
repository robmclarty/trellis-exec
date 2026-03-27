import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { JudgeAssessmentSchema } from "../types/state.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const REPORT_FILENAME = ".trellis-phase-report.json";
const MAX_TACTICAL_LEARNINGS = 20;
// ---------------------------------------------------------------------------
// Learnings
// ---------------------------------------------------------------------------
export function collectLearnings(state) {
    const architectural = [];
    const tactical = [];
    const constraint = [];
    for (const report of state.phaseReports) {
        for (const entry of report.decisionsLog) {
            const label = `[${report.phaseId}] ${entry.text}`;
            if (entry.tier === "constraint") {
                constraint.push(label);
            }
            else if (entry.tier === "architectural") {
                architectural.push(label);
            }
            else {
                tactical.push(label);
            }
        }
    }
    // Architectural and constraint entries are never evicted. Tactical use a sliding window.
    const tacticalBudget = Math.max(10, MAX_TACTICAL_LEARNINGS - architectural.length - constraint.length);
    return {
        architectural,
        tactical: tactical.slice(-tacticalBudget),
        constraint,
    };
}
// ---------------------------------------------------------------------------
// Phase context prompt
// ---------------------------------------------------------------------------
export function buildPhaseContext(phase, state, handoff, ctx) {
    const lines = [];
    lines.push(`# Phase: ${phase.name} (${phase.id})`);
    lines.push("");
    lines.push("## Description");
    lines.push(phase.description);
    lines.push("");
    lines.push("## Tasks");
    for (const task of phase.tasks) {
        lines.push("");
        lines.push(`### ${task.id}: ${task.title}`);
        lines.push(`Status: ${task.status}`);
        lines.push(`Dependencies: ${task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none"}`);
        lines.push(`Target paths: ${task.targetPaths.join(", ")}`);
        lines.push(`Spec sections: ${task.specSections.join(", ")}`);
        lines.push(`Sub-agent type: ${task.subAgentType}`);
        lines.push("Acceptance criteria:");
        for (const criterion of task.acceptanceCriteria) {
            lines.push(`- ${criterion}`);
        }
        lines.push(`Description: ${task.description}`);
    }
    // Task type summary — helps orchestrator plan execution strategy
    const typeCounts = new Map();
    for (const task of phase.tasks) {
        const list = typeCounts.get(task.subAgentType) ?? [];
        list.push(task.id);
        typeCounts.set(task.subAgentType, list);
    }
    if (typeCounts.size > 0) {
        lines.push("");
        lines.push("## Task Type Summary");
        for (const [type, ids] of typeCounts) {
            lines.push(`- **${type}**: ${ids.join(", ")}`);
        }
    }
    lines.push("");
    lines.push("## Prior Phase Handoff (authoritative — reflects current codebase state)");
    lines.push(handoff || "This is the first phase.");
    lines.push("");
    lines.push("## Shared State Summary");
    lines.push(`Completed phases: ${state.completedPhases.length > 0 ? state.completedPhases.join(", ") : "none"}`);
    // Pre-load spec and guidelines content so the orchestrator doesn't waste
    // turns reading these. They're still available on disk if the orchestrator
    // needs to re-read them after context compaction.
    lines.push("");
    lines.push("## Spec Content");
    lines.push(`(Pre-loaded from \`${basename(ctx.specPath)}\`. Also available on disk via the Read tool.)`);
    lines.push("");
    lines.push(readFileSync(ctx.specPath, "utf-8"));
    lines.push("");
    lines.push("## Guidelines Content");
    if (ctx.guidelinesPath) {
        lines.push(`(Pre-loaded from \`${basename(ctx.guidelinesPath)}\`. Also available on disk via the Read tool.)`);
        lines.push("");
        lines.push(readFileSync(ctx.guidelinesPath, "utf-8"));
    }
    else {
        lines.push("none configured");
    }
    // Spec amendments appear AFTER spec/guidelines so they get "last word" authority.
    const learnings = collectLearnings(state);
    if (learnings.constraint.length > 0 || learnings.architectural.length > 0 || learnings.tactical.length > 0) {
        lines.push("");
        lines.push("## Spec Amendments from Prior Phases");
        lines.push("Authoritative findings from completed phases. " +
            "Where these conflict with the spec above, amendments take precedence — " +
            "they reflect the actual codebase state and runtime constraints discovered during implementation.");
        if (learnings.constraint.length > 0) {
            lines.push("");
            lines.push("### Discovered Constraints (binding — override spec assumptions)");
            for (const entry of learnings.constraint) {
                lines.push(`- ${entry}`);
            }
        }
        if (learnings.architectural.length > 0) {
            lines.push("");
            lines.push("### Architectural Decisions (binding — chosen approaches)");
            for (const entry of learnings.architectural) {
                lines.push(`- ${entry}`);
            }
        }
        if (learnings.tactical.length > 0) {
            lines.push("");
            lines.push("### Tactical Notes (recent — context for current work)");
            for (const entry of learnings.tactical) {
                lines.push(`- ${entry}`);
            }
        }
    }
    lines.push("");
    lines.push("## Check Command");
    if (ctx.checkCommand) {
        lines.push(`Run this with Bash after completing tasks: ${ctx.checkCommand}`);
    }
    else {
        lines.push("none configured");
    }
    // Git commit protocol
    lines.push("");
    lines.push("## Git Commit Protocol");
    lines.push("After each task passes the check command, commit all changes:");
    lines.push("```bash");
    lines.push('git add -A && git commit -m "<type>(<scope>): <summary>');
    lines.push("");
    lines.push("- <change 1>");
    lines.push("- <change 2>");
    lines.push('- <change 3>"');
    lines.push("```");
    lines.push("Use conventional commit format (feat, fix, refactor, test, docs, chore).");
    lines.push("The scope should be the main module/area affected. The body should list 3-5 significant changes.");
    lines.push("If `git commit` fails (nothing to commit), continue to the next task.");
    lines.push("Do NOT commit the `.trellis-phase-report.json` file.");
    // Long-running phase protocol
    if (ctx.timeout && ctx.timeout > 1_800_000) {
        lines.push("");
        lines.push("## Long-Running Phase");
        lines.push("This phase has an extended timeout. Commit intermediate progress every 3-5 tasks " +
            "to preserve work in case of timeout. The reporter fallback depends on committed work.");
    }
    // Completion protocol
    lines.push("");
    lines.push("## Completion Protocol");
    const reportAbsPath = join(ctx.projectRoot, REPORT_FILENAME);
    lines.push(`When ALL tasks have been attempted, use the Write tool to create the report file at exactly this absolute path: ${reportAbsPath}` +
        "\n\nThe JSON must contain:");
    lines.push("");
    lines.push("```json");
    lines.push('{');
    lines.push(`  "phaseId": "${phase.id}",`);
    lines.push('  "status": "complete | partial",');
    lines.push('  "recommendedAction": "advance | retry | halt",');
    lines.push('  "tasksCompleted": ["task-id-1"],');
    lines.push('  "tasksFailed": ["task-id-2"],');
    lines.push('  "summary": "Brief description",');
    lines.push('  "handoff": "Briefing for next phase",');
    lines.push('  "correctiveTasks": [],');
    lines.push('  "decisionsLog": [');
    lines.push('    { "text": "Decision description", "tier": "architectural | tactical" }');
    lines.push('  ],');
    lines.push('  "orchestratorAnalysis": "Phase outcome assessment"');
    lines.push('}');
    lines.push("```");
    lines.push("");
    lines.push("CRITICAL: Every task ID must appear in EITHER tasksCompleted OR tasksFailed. " +
        "The report will be rejected if any tasks are unaccounted for.");
    // Previous attempt context (retries)
    const retryCount = state.phaseRetries[phase.id] ?? 0;
    if (retryCount > 0) {
        const lastReport = state.phaseReports.at(-1);
        lines.push("");
        lines.push("## Previous Attempt");
        lines.push("");
        lines.push(`This is retry attempt ${retryCount}. The prior attempt did not fully pass the judge review.`);
        if (lastReport) {
            lines.push("");
            lines.push(`**Last report status:** ${lastReport.status}`);
            lines.push(`**Last summary:** ${lastReport.summary}`);
            lines.push(`**Tasks completed:** ${lastReport.tasksCompleted.join(", ") || "none"}`);
            lines.push(`**Tasks failed:** ${lastReport.tasksFailed.join(", ") || "none"}`);
            lines.push(`**Orchestrator analysis:** ${lastReport.orchestratorAnalysis}`);
            if (lastReport.judgeAssessment) {
                const assessment = lastReport.judgeAssessment;
                if (assessment.issues.length > 0) {
                    lines.push("");
                    lines.push("**Judge issues (must fix):**");
                    for (const issue of assessment.issues) {
                        lines.push(`- ${formatIssue(issue)}`);
                    }
                }
                if (assessment.suggestions.length > 0) {
                    lines.push("");
                    lines.push("**Judge suggestions (non-blocking):**");
                    for (const suggestion of assessment.suggestions) {
                        lines.push(`- ${formatIssue(suggestion)}`);
                    }
                }
            }
            if (lastReport.correctiveTasks.length > 0) {
                lines.push("");
                lines.push("**Corrective tasks appended:**");
                for (const ct of lastReport.correctiveTasks) {
                    lines.push(`- ${ct}`);
                }
            }
        }
        lines.push("");
        lines.push("**Retry strategy:**");
        lines.push("1. Read existing files first — prior attempts may have partially completed work.");
        lines.push("2. Focus on judge issues — they are the primary reason for this retry.");
        lines.push("3. Run checks after each fix.");
        lines.push("4. All tasks (original + corrective) must appear in the report.");
    }
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Report normalization
// ---------------------------------------------------------------------------
/**
 * Normalizes a raw report object (as produced by the orchestrator LLM) into
 * a valid PhaseReport.  Maps common LLM-style field names to the canonical
 * schema fields and fills in defaults for anything missing.
 */
export function normalizeReport(raw, phaseId) {
    const r = raw;
    const validStatuses = new Set(["complete", "partial", "failed"]);
    const validActions = new Set(["advance", "retry", "halt"]);
    const status = validStatuses.has(r["status"])
        ? r["status"]
        : "partial";
    const recommendedAction = validActions.has(r["recommendedAction"])
        ? r["recommendedAction"]
        : "halt";
    const tasksCompleted = asStringArray(r["tasksCompleted"] ??
        (r["taskOutcomes"] && Array.isArray(r["taskOutcomes"])
            ? r["taskOutcomes"]
                .filter((o) => o["status"] === "complete" || o["status"] === "completed")
                .map((o) => o["taskId"])
            : []));
    const tasksFailed = asStringArray(r["tasksFailed"] ??
        (r["taskOutcomes"] && Array.isArray(r["taskOutcomes"])
            ? r["taskOutcomes"]
                .filter((o) => o["status"] === "failed")
                .map((o) => o["taskId"])
            : []));
    return {
        phaseId: typeof r["phaseId"] === "string" ? r["phaseId"] : phaseId,
        status,
        summary: typeof r["summary"] === "string" ? r["summary"] : "",
        tasksCompleted,
        tasksFailed,
        orchestratorAnalysis: typeof r["orchestratorAnalysis"] === "string"
            ? r["orchestratorAnalysis"]
            : "",
        recommendedAction,
        correctiveTasks: asStringArray(r["correctiveTasks"] ?? []),
        decisionsLog: asDecisionEntryArray(r["decisionsLog"] ?? []),
        handoff: typeof r["handoff"] === "string"
            ? r["handoff"]
            : typeof r["handoffBriefing"] === "string"
                ? r["handoffBriefing"]
                : "",
    };
}
/** Safely coerce a value to string[]. */
function asStringArray(val) {
    if (!Array.isArray(val))
        return [];
    return val.filter((v) => typeof v === "string");
}
/** Safely coerce a value to DecisionEntry[]. Plain strings become tactical. */
function asDecisionEntryArray(val) {
    if (!Array.isArray(val))
        return [];
    return val
        .map((v) => {
        if (typeof v === "string") {
            return { text: v, tier: "tactical" };
        }
        if (v && typeof v === "object" && "text" in v && typeof v.text === "string") {
            const tier = "tier" in v && (v.tier === "architectural" || v.tier === "tactical" || v.tier === "constraint")
                ? v.tier
                : "tactical";
            return { text: v.text, tier };
        }
        return null;
    })
        .filter((v) => v !== null);
}
// ---------------------------------------------------------------------------
// Judge prompts & parsing
// ---------------------------------------------------------------------------
/** Renders task details and acceptance criteria for judge prompts. */
function formatTasksWithCriteria(tasks) {
    const lines = [];
    lines.push("## Phase Tasks & Acceptance Criteria");
    lines.push("");
    for (const task of tasks) {
        lines.push(`### ${task.id}: ${task.title}`);
        lines.push(`Description: ${task.description}`);
        lines.push(`Target paths: ${task.targetPaths.join(", ")}`);
        lines.push(`Spec sections: ${task.specSections.join(", ")}`);
        lines.push("Acceptance criteria:");
        for (const criterion of task.acceptanceCriteria) {
            lines.push(`- ${criterion}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
/** Renders the JSON response format instructions shared by judge/rejudge. */
function judgeResponseFormat(correctionExample) {
    const lines = [];
    lines.push("```json");
    lines.push('{');
    lines.push('  "passed": true,');
    lines.push('  "issues": [');
    lines.push('    { "task": "phase-1-task-2", "severity": "must-fix", "description": "..." }');
    lines.push('  ],');
    lines.push('  "suggestions": [');
    lines.push('    { "task": "phase-1-task-1", "severity": "minor", "description": "..." }');
    lines.push('  ],');
    lines.push('  "corrections": [');
    lines.push(`    ${correctionExample}`);
    lines.push('  ]');
    lines.push('}');
    lines.push("```");
    return lines.join("\n");
}
/** Shared judge evaluation guidance. */
function judgeEvaluationGuidance() {
    return ("Set `passed` to false only for must-fix problems: spec violations, bugs, " +
        "missing requirements, incomplete tasks. Style suggestions alone do not cause failure.");
}
/** Shared corrections guidance. */
function judgeCorrectionsGuidance(detail) {
    return ("If a task's targetPaths don't match the actual filenames on disk" +
        (detail ? ` ${detail}` : "") +
        ", add a `corrections` entry to reconcile the metadata. " +
        "Corrections are NOT issues and do not affect the `passed` verdict.");
}
export function buildJudgePrompt(config) {
    const lines = [];
    lines.push("# Judge Review");
    lines.push("");
    lines.push("## Changed Files (from git diff — system-verified)");
    lines.push("");
    for (const f of config.changedFiles) {
        lines.push(`- [${f.status}] ${f.path}`);
    }
    lines.push("");
    lines.push("## Diff");
    lines.push("");
    lines.push("```diff");
    lines.push(config.diffContent);
    lines.push("```");
    lines.push("");
    lines.push(formatTasksWithCriteria(config.phase.tasks));
    lines.push("## Spec & Guidelines");
    lines.push("");
    lines.push("Read `spec.md` and `guidelines.md` in the project root for full context.");
    lines.push("");
    lines.push("## Orchestrator Self-Report (context only — not authoritative)");
    lines.push("");
    lines.push(`Status: ${config.orchestratorReport.status}`);
    lines.push(`Summary: ${config.orchestratorReport.summary}`);
    lines.push(`Tasks completed: ${config.orchestratorReport.tasksCompleted.join(", ") || "none"}`);
    lines.push(`Tasks failed: ${config.orchestratorReport.tasksFailed.join(", ") || "none"}`);
    // Browser smoke check results (if available)
    const smoke = config.orchestratorReport.browserSmokeReport;
    if (smoke && !smoke.skipped) {
        lines.push("");
        lines.push("## Browser Smoke Check Results (automated, no LLM)");
        lines.push("");
        lines.push(`- Passed: ${smoke.passed}`);
        if (smoke.consoleErrors.length > 0) {
            lines.push(`- Console errors:`);
            for (const err of smoke.consoleErrors)
                lines.push(`  - ${err}`);
        }
        if (smoke.interactionFailures.length > 0) {
            lines.push(`- Interaction failures:`);
            for (const f of smoke.interactionFailures)
                lines.push(`  - ${f}`);
        }
        if (smoke.screenshot) {
            lines.push(`- Screenshot: ${smoke.screenshot}`);
        }
        lines.push("");
        lines.push("Use this evidence when evaluating spec compliance. Console errors and " +
            "interaction failures may indicate bugs or missing requirements.");
    }
    lines.push("");
    lines.push("## Instructions");
    lines.push("");
    lines.push("Evaluate the changes against the spec and acceptance criteria. " +
        "Return ONLY a JSON block — no prose before or after — in this exact format:");
    lines.push("");
    lines.push(judgeResponseFormat('{ "type": "targetPath", "taskId": "phase-1-task-2", "old": "src/Nav.css", "new": "src/Nav.module.css", "reason": "CSS Modules convention requires .module.css suffix" }'));
    lines.push("");
    lines.push(judgeEvaluationGuidance());
    lines.push("");
    lines.push(judgeCorrectionsGuidance("\n(e.g., `Nav.css` specified but `Nav.module.css` created, or `App.js` but `App.jsx` on disk)"));
    lines.push("Only include corrections when the file exists at a different path, not when a file is genuinely missing.");
    return lines.join("\n");
}
/**
 * Builds a targeted re-judge prompt after a fix has been applied.
 * Instead of the full phase diff, includes only the fix diff and the
 * previous issues so the judge can evaluate whether they were resolved.
 */
export function buildRejudgePrompt(config) {
    const lines = [];
    lines.push("# Re-Judge After Fix");
    lines.push("");
    lines.push("A fix agent was dispatched to resolve the issues below. " +
        "Evaluate whether each issue has been resolved and check for regressions.");
    lines.push("");
    lines.push("## Previous Issues");
    lines.push("");
    for (let i = 0; i < config.previousIssues.length; i++) {
        lines.push(`${i + 1}. ${formatIssue(config.previousIssues[i])}`);
    }
    lines.push("");
    lines.push("## Fix Changes");
    lines.push("");
    if (config.fixChangedFiles.length > 0) {
        for (const f of config.fixChangedFiles) {
            lines.push(`- \`${f.path}\` (${f.status})`);
        }
    }
    else {
        lines.push("(no files changed by the fix)");
    }
    lines.push("");
    lines.push("```diff");
    lines.push(config.fixDiff);
    lines.push("```");
    lines.push("");
    lines.push(formatTasksWithCriteria(config.phase.tasks));
    lines.push("## Spec & Guidelines");
    lines.push("");
    lines.push("Read `spec.md` and `guidelines.md` in the project root for full context.");
    lines.push("");
    lines.push("## Instructions");
    lines.push("");
    lines.push("Evaluate whether the previous issues have been resolved by the fix. " +
        "Check for regressions introduced by the fix. " +
        "Return ONLY a JSON block — no prose before or after — in this exact format:");
    lines.push("");
    lines.push(judgeResponseFormat('{ "type": "targetPath", "taskId": "phase-1-task-2", "old": "src/Nav.css", "new": "src/Nav.module.css", "reason": "CSS Modules convention" }'));
    lines.push("");
    lines.push(judgeEvaluationGuidance());
    lines.push("");
    lines.push(judgeCorrectionsGuidance(""));
    return lines.join("\n");
}
/**
 * Normalize issue arrays before Zod validation.
 * Coerces `detail` → `description` for objects (the LLM alternates between the two).
 */
function normalizeIssueArray(arr) {
    return arr.map((item) => {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            const obj = item;
            // Coerce `detail` → `description` if `description` is missing
            if (typeof obj["detail"] === "string" && typeof obj["description"] !== "string") {
                const { detail, ...rest } = obj;
                return { ...rest, description: detail };
            }
        }
        return item;
    });
}
function tryParseAssessment(raw) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const obj = raw;
    // Normalize issue/suggestion arrays before Zod validation
    if (Array.isArray(obj["issues"])) {
        obj["issues"] = normalizeIssueArray(obj["issues"]);
    }
    if (Array.isArray(obj["suggestions"])) {
        obj["suggestions"] = normalizeIssueArray(obj["suggestions"]);
    }
    try {
        return JudgeAssessmentSchema.parse(obj);
    }
    catch {
        return null;
    }
}
export function parseJudgeResult(output) {
    // Try to extract JSON from the output (may be in markdown fences)
    const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = fenceMatch ? fenceMatch[1] : output;
    try {
        const parsed = JSON.parse(jsonStr.trim());
        const result = tryParseAssessment(parsed);
        if (result)
            return result;
    }
    catch {
        // JSON parse failed, try fallback
    }
    // Try to find any JSON object in the output
    const objectMatch = output.match(/\{[\s\S]*"passed"[\s\S]*\}/);
    if (objectMatch) {
        try {
            const parsed = JSON.parse(objectMatch[0]);
            const result = tryParseAssessment(parsed);
            if (result)
                return result;
        }
        catch {
            // Fall through to failure
        }
    }
    return {
        passed: false,
        issues: [
            `Judge output was unparseable: ${output.slice(0, 200)}`,
        ],
        suggestions: [],
        corrections: [],
    };
}
// ---------------------------------------------------------------------------
// Fix & reporter prompts
// ---------------------------------------------------------------------------
/** Format a JudgeIssue (string or object) to a display string. */
export function formatIssue(issue) {
    if (typeof issue === "string")
        return issue;
    const prefix = issue.task ? `${issue.task}: ` : "";
    return `${prefix}${issue.description}`;
}
export function buildFixPrompt(issues, phase) {
    const lines = [];
    lines.push("# Fix Request");
    lines.push("");
    lines.push("The judge found the following issues after reviewing this phase's work. " +
        "Fix each one. Do not refactor or restructure beyond what is needed.");
    lines.push("");
    lines.push("## Issues to Fix");
    lines.push("");
    for (let i = 0; i < issues.length; i++) {
        lines.push(`${i + 1}. ${formatIssue(issues[i])}`);
    }
    lines.push("");
    lines.push("## Context");
    lines.push("");
    lines.push(`Phase: ${phase.name} (${phase.id})`);
    lines.push("Read `spec.md` and `guidelines.md` in the project root for full spec context.");
    lines.push("");
    lines.push("## Output");
    lines.push("");
    lines.push("After fixing, print a brief summary of what you changed for each issue.");
    return lines.join("\n");
}
/**
 * Builds a prompt for the reporter fallback agent that generates a phase
 * report from git diff and task context when the orchestrator times out.
 */
export function buildReporterPrompt(phase, changedFiles, diffContent) {
    const lines = [];
    lines.push("# Phase Report Request");
    lines.push("");
    lines.push(`Phase: ${phase.name} (${phase.id})`);
    lines.push("The orchestrator timed out after completing implementation work.");
    lines.push("Generate a phase report based on the git changes below.");
    lines.push("");
    lines.push("## Tasks");
    lines.push("");
    for (const task of phase.tasks) {
        lines.push(`### ${task.id}: ${task.title}`);
        lines.push(`Target paths: ${task.targetPaths.join(", ")}`);
        lines.push(`Acceptance criteria: ${task.acceptanceCriteria.join("; ")}`);
        lines.push("");
    }
    lines.push("## Changed Files");
    lines.push("");
    for (const f of changedFiles) {
        lines.push(`- [${f.status}] ${f.path}`);
    }
    lines.push("");
    lines.push("## Diff");
    lines.push("```");
    lines.push(diffContent.slice(0, 50_000));
    lines.push("```");
    return lines.join("\n");
}
//# sourceMappingURL=prompts.js.map