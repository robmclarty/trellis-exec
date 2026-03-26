import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { createInterface } from "node:readline";
import { JudgeAssessmentSchema } from "../types/state.js";
import { initState, loadState, saveState, updateStateAfterPhase, applyReportToTasks, } from "./stateManager.js";
import { validateDependencies, resolveExecutionOrder, detectTargetPathOverlaps, } from "./scheduler.js";
import { createTrajectoryLogger } from "../logging/trajectoryLogger.js";
import { startSpinner } from "../ui/spinner.js";
import { createStreamHandler, extractResultText } from "../ui/streamParser.js";
import { getChangedFiles, getDiffContent, getCurrentSha, ensureInitialCommit, commitAll, getChangedFilesRange, getDiffContentRange, } from "../git.js";
import { createCheckRunner } from "../verification/checkRunner.js";
import { createAgentLauncher } from "../orchestrator/agentLauncher.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REPORT_FILENAME = ".trellis-phase-report.json";
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function getHandoffFromState(state) {
    const last = state.phaseReports.at(-1);
    return last?.handoff ?? "";
}
const MAX_LEARNINGS = 20;
export function collectLearnings(state) {
    const all = [];
    for (const report of state.phaseReports) {
        for (const entry of report.decisionsLog) {
            all.push(`[${report.phaseId}] ${entry}`);
        }
    }
    return all.slice(-MAX_LEARNINGS);
}
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
    lines.push("");
    lines.push("## Prior Phase Handoff");
    lines.push(handoff || "This is the first phase.");
    lines.push("");
    lines.push("## Shared State Summary");
    lines.push(`Completed phases: ${state.completedPhases.length > 0 ? state.completedPhases.join(", ") : "none"}`);
    const learnings = collectLearnings(state);
    if (learnings.length > 0) {
        lines.push("");
        lines.push("## Learnings from Prior Phases");
        lines.push("Important decisions and discoveries from earlier phases. " +
            "Apply these to avoid repeating mistakes:");
        for (const entry of learnings) {
            lines.push(`- ${entry}`);
        }
    }
    // Pre-load spec and guidelines content so the orchestrator doesn't waste
    // turns reading these. They're still available on disk if the orchestrator
    // needs to re-read them after context compaction.
    lines.push("");
    lines.push("## Spec Content");
    lines.push(`(Pre-loaded from \`${basename(ctx.specPath)}\`. Also available on disk via the Read tool.)`);
    lines.push("");
    try {
        lines.push(readFileSync(ctx.specPath, "utf-8"));
    }
    catch {
        lines.push("[ERROR: Could not read spec file]");
    }
    lines.push("");
    lines.push("## Guidelines Content");
    if (ctx.guidelinesPath) {
        lines.push(`(Pre-loaded from \`${basename(ctx.guidelinesPath)}\`. Also available on disk via the Read tool.)`);
        lines.push("");
        try {
            lines.push(readFileSync(ctx.guidelinesPath, "utf-8"));
        }
        catch {
            lines.push("[ERROR: Could not read guidelines file]");
        }
    }
    else {
        lines.push("none configured");
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
    lines.push('  "decisionsLog": [],');
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
function buildPartialReport(phaseId, phase, reason) {
    const tasksCompleted = phase.tasks
        .filter((t) => t.status === "complete")
        .map((t) => t.id);
    const tasksFailed = phase.tasks
        .filter((t) => t.status !== "complete" && t.status !== "skipped")
        .map((t) => t.id);
    return {
        phaseId,
        status: "partial",
        summary: `Phase halted: ${reason}`,
        tasksCompleted,
        tasksFailed,
        orchestratorAnalysis: `Phase terminated due to ${reason}.`,
        recommendedAction: "retry",
        correctiveTasks: [],
        decisionsLog: [],
        handoff: "",
    };
}
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
        decisionsLog: asStringArray(r["decisionsLog"] ?? []),
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
function makeCorrectiveTask(phaseId, description, index) {
    return {
        id: `${phaseId}-corrective-${index}`,
        title: description,
        description,
        dependsOn: [],
        specSections: [],
        targetPaths: [],
        acceptanceCriteria: [],
        subAgentType: "implement",
        status: "pending",
    };
}
// ---------------------------------------------------------------------------
// Dry run report
// ---------------------------------------------------------------------------
export function dryRunReport(tasksJson, ctx) {
    const lines = [];
    lines.push(`Spec: ${basename(ctx.specPath)}`);
    lines.push(`Plan: ${basename(ctx.planPath)}`);
    lines.push(`Project root: ${ctx.projectRoot}`);
    lines.push(`Phases: ${tasksJson.phases.length}`);
    lines.push("");
    const priorIds = new Set();
    for (const phase of tasksJson.phases) {
        lines.push(`## ${phase.id}: ${phase.name}`);
        lines.push(phase.description);
        lines.push("");
        const groups = resolveExecutionOrder(phase.tasks, priorIds);
        for (const group of groups) {
            const label = group.parallelizable ? "[parallel]" : "[sequential]";
            lines.push(`  Group ${group.groupIndex} ${label}:`);
            for (const taskId of group.taskIds) {
                const task = phase.tasks.find((t) => t.id === taskId);
                if (task) {
                    lines.push(`    - ${task.id}: ${task.title} (${task.subAgentType})`);
                    lines.push(`      targets: ${task.targetPaths.join(", ")}`);
                }
            }
        }
        const overlaps = detectTargetPathOverlaps(phase.tasks);
        if (overlaps.length > 0) {
            lines.push("  Implicit dependencies (path overlaps):");
            for (const [a, b] of overlaps) {
                lines.push(`    ${a} <-> ${b}`);
            }
        }
        lines.push("");
        for (const task of phase.tasks) {
            priorIds.add(task.id);
        }
    }
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Test auto-detection
// ---------------------------------------------------------------------------
const TEST_FILE_PATTERNS = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /__tests__\//,
    /\.test\.\w+$/,
];
/**
 * Returns true if any newly added files look like test files.
 */
export function hasNewTestFiles(projectRoot, startSha) {
    const changed = startSha
        ? getChangedFilesRange(projectRoot, startSha)
        : getChangedFiles(projectRoot);
    return changed.some((f) => (f.status === "A" || f.status === "?" || f.status === "M") &&
        TEST_FILE_PATTERNS.some((re) => re.test(f.path)));
}
/**
 * Attempts to detect a test command from the project.
 * Returns null if no test runner can be identified.
 */
export function detectTestCommand(projectRoot) {
    // Check package.json test script
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            const testScript = pkg?.scripts?.test;
            if (typeof testScript === "string" &&
                testScript.length > 0 &&
                !testScript.includes("no test specified")) {
                return "npm test";
            }
        }
        catch {
            // ignore parse errors
        }
    }
    // Check for common test runner configs
    const configs = [
        { file: "vitest.config.ts", command: "npx vitest run" },
        { file: "vitest.config.js", command: "npx vitest run" },
        { file: "vitest.config.mts", command: "npx vitest run" },
        { file: "jest.config.ts", command: "npx jest" },
        { file: "jest.config.js", command: "npx jest" },
        { file: "jest.config.cjs", command: "npx jest" },
        { file: "jest.config.mjs", command: "npx jest" },
    ];
    for (const { file, command } of configs) {
        if (existsSync(join(projectRoot, file))) {
            return command;
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// Interactive prompt
// ---------------------------------------------------------------------------
export async function promptForContinuation(options) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const lines = [];
    if (options?.phaseId && options.retryCount !== undefined && options.maxRetries !== undefined) {
        lines.push(`[${options.phaseId}] retries used: ${options.retryCount}/${options.maxRetries}`);
    }
    if (options?.recommendedAction && options.recommendedAction !== "advance") {
        const reasonSuffix = options.reason ? ` — ${options.reason}` : "";
        lines.push(`Recommendation: ${options.recommendedAction}${reasonSuffix}`);
    }
    const rec = options?.recommendedAction ?? "advance";
    const enterLabel = rec === "advance" ? "advance" : rec;
    lines.push(`[Enter] ${enterLabel}  [r] retry  [s] skip  [q] quit`);
    return new Promise((resolvePromise) => {
        rl.question(`\n${lines.join("\n")}\n> `, (answer) => {
            rl.close();
            const trimmed = answer.trim().toLowerCase();
            if (trimmed === "r" || trimmed === "retry")
                resolvePromise("retry");
            else if (trimmed === "s" || trimmed === "skip")
                resolvePromise("skip");
            else if (trimmed === "q" || trimmed === "quit")
                resolvePromise("quit");
            else
                resolvePromise("continue");
        });
    });
}
const SMALL_DIFF_LINE_THRESHOLD = 150;
const SMALL_TASK_THRESHOLD = 3;
/**
 * Selects the judge model based on diff size and task count.
 * Small diffs with few tasks use Sonnet; larger work uses Opus.
 * An explicit override (from --judge-model) takes precedence.
 */
export function selectJudgeModel(diffLineCount, taskCount, override) {
    if (override)
        return override;
    if (diffLineCount < SMALL_DIFF_LINE_THRESHOLD && taskCount < SMALL_TASK_THRESHOLD) {
        return "sonnet";
    }
    return "opus";
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
    lines.push("## Phase Tasks & Acceptance Criteria");
    lines.push("");
    for (const task of config.phase.tasks) {
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
    lines.push("");
    lines.push("## Instructions");
    lines.push("");
    lines.push("Evaluate the changes against the spec and acceptance criteria. " +
        "Return ONLY a JSON block — no prose before or after — in this exact format:");
    lines.push("");
    lines.push("```json");
    lines.push('{');
    lines.push('  "passed": true,');
    lines.push('  "issues": [');
    lines.push('    { "task": "phase-1-task-2", "severity": "must-fix", "description": "..." }');
    lines.push('  ],');
    lines.push('  "suggestions": [');
    lines.push('    { "task": "phase-1-task-1", "severity": "minor", "description": "..." }');
    lines.push('  ]');
    lines.push('}');
    lines.push("```");
    lines.push("");
    lines.push("Set `passed` to false only for must-fix problems: spec violations, bugs, " +
        "missing requirements, incomplete tasks. Style suggestions alone do not cause failure.");
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
    lines.push("## Phase Tasks & Acceptance Criteria");
    lines.push("");
    for (const task of config.phase.tasks) {
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
    lines.push("```json");
    lines.push('{');
    lines.push('  "passed": true,');
    lines.push('  "issues": [');
    lines.push('    { "task": "phase-1-task-2", "severity": "must-fix", "description": "..." }');
    lines.push('  ],');
    lines.push('  "suggestions": [');
    lines.push('    { "task": "phase-1-task-1", "severity": "minor", "description": "..." }');
    lines.push('  ]');
    lines.push('}');
    lines.push("```");
    lines.push("");
    lines.push("Set `passed` to false only for must-fix problems: spec violations, bugs, " +
        "missing requirements, regressions. Style suggestions alone do not cause failure.");
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
    };
}
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
async function judgePhase(config) {
    const maxCorrections = config.maxCorrections ?? 2;
    const { phase, report, projectRoot, ctx, logger, startSha } = config;
    let changedFiles = startSha
        ? getChangedFilesRange(projectRoot, startSha)
        : getChangedFiles(projectRoot);
    if (changedFiles.length === 0) {
        return {
            assessment: { passed: true, issues: [], suggestions: [] },
            correctionAttempts: 0,
        };
    }
    const launcher = createAgentLauncher({
        pluginRoot: ctx.pluginRoot,
        projectRoot,
        dryRun: ctx.dryRun,
    });
    let assessment = { passed: true, issues: [], suggestions: [] };
    let previousIssues;
    let fixDiffContent;
    let fixChangedFiles;
    for (let attempt = 0; attempt <= maxCorrections; attempt++) {
        // Build prompt: first pass uses full phase diff, subsequent passes use fix-only diff
        let prompt;
        let diffForModel;
        if (attempt > 0 && previousIssues && fixDiffContent && fixChangedFiles) {
            prompt = buildRejudgePrompt({
                fixDiff: fixDiffContent,
                fixChangedFiles,
                previousIssues,
                phase,
            });
            diffForModel = fixDiffContent;
        }
        else {
            const diffContent = startSha
                ? getDiffContentRange(projectRoot, startSha)
                : getDiffContent(projectRoot);
            prompt = buildJudgePrompt({
                changedFiles,
                diffContent,
                phase,
                orchestratorReport: report,
            });
            diffForModel = diffContent;
        }
        const diffLineCount = diffForModel.split("\n").length;
        const judgeModel = selectJudgeModel(diffLineCount, phase.tasks.length, ctx.judgeModel);
        if (ctx.verbose) {
            console.log(`[judge] attempt ${attempt}, reviewing ${changedFiles.length} changed file(s), model: ${judgeModel} (${diffLineCount} diff lines, ${phase.tasks.length} tasks)`);
        }
        const judgeSpinner = startSpinner("Judging");
        const startTime = Date.now();
        const result = await launcher.dispatchSubAgent({
            type: "judge",
            model: judgeModel,
            taskId: `${phase.id}-judge-${attempt}`,
            instructions: prompt,
            filePaths: changedFiles.map((f) => f.path),
            outputPaths: [],
        });
        const duration = Date.now() - startTime;
        judgeSpinner.stop();
        logger.append({
            phaseId: phase.id,
            turnNumber: 0,
            type: "judge_invoke",
            input: { attempt, fileCount: changedFiles.length },
            output: result.output.slice(0, 2000),
            duration,
        });
        assessment = parseJudgeResult(result.output);
        if (assessment.passed) {
            if (ctx.verbose) {
                console.log(`[judge] passed on attempt ${attempt}`);
            }
            return { assessment, correctionAttempts: attempt };
        }
        // Judge found issues — save for targeted re-judging
        previousIssues = assessment.issues;
        console.log(`Judge found ${assessment.issues.length} issue(s) in phase "${phase.id}":`);
        for (const issue of assessment.issues) {
            console.log(`  - ${formatIssue(issue)}`);
        }
        if (attempt >= maxCorrections) {
            break;
        }
        // Capture SHA before fix for targeted diff
        const preFixSha = getCurrentSha(projectRoot);
        // Dispatch fix agent
        console.log(`Dispatching fix agent (attempt ${attempt + 1})…`);
        const fixPrompt = buildFixPrompt(assessment.issues, phase);
        await launcher.dispatchSubAgent({
            type: "fix",
            taskId: `${phase.id}-fix-${attempt}`,
            instructions: fixPrompt,
            filePaths: changedFiles.map((f) => f.path),
            outputPaths: changedFiles
                .filter((f) => f.status !== "D")
                .map((f) => f.path),
        });
        // Run check command after fix if configured
        if (ctx.checkCommand) {
            const checkRunner = createCheckRunner({
                command: ctx.checkCommand,
                cwd: projectRoot,
            });
            const checkResult = await checkRunner.run();
            if (ctx.verbose) {
                console.log(`[check] after fix: ${checkResult.passed ? "passed" : "failed"}`);
            }
        }
        // Capture fix-only diff for targeted re-judging
        if (preFixSha) {
            fixDiffContent = getDiffContentRange(projectRoot, preFixSha);
            fixChangedFiles = getChangedFilesRange(projectRoot, preFixSha);
        }
        else {
            // Fallback: use full diff if no SHA available
            fixDiffContent = startSha
                ? getDiffContentRange(projectRoot, startSha)
                : getDiffContent(projectRoot);
            fixChangedFiles = changedFiles;
        }
        // Refresh changed files for file paths context
        changedFiles = startSha
            ? getChangedFilesRange(projectRoot, startSha)
            : getChangedFiles(projectRoot);
    }
    return { assessment, correctionAttempts: maxCorrections };
}
// ---------------------------------------------------------------------------
// Default file-existence check (used when no --check command is provided)
// ---------------------------------------------------------------------------
export function createDefaultCheck(projectRoot, phase) {
    const allTargetPaths = phase.tasks.flatMap((t) => t.targetPaths);
    return {
        run: async () => {
            if (allTargetPaths.length === 0) {
                return { passed: true, output: "No target paths to check", exitCode: 0 };
            }
            const missing = [];
            for (const p of allTargetPaths) {
                const fullPath = resolve(projectRoot, p);
                try {
                    statSync(fullPath);
                }
                catch {
                    missing.push(p);
                }
            }
            if (missing.length === 0) {
                return { passed: true, output: `All ${allTargetPaths.length} target paths exist`, exitCode: 0 };
            }
            return {
                passed: false,
                output: `Missing files (${missing.length}/${allTargetPaths.length}): ${missing.join(", ")}`,
                exitCode: 1,
            };
        },
    };
}
// ---------------------------------------------------------------------------
// Single phase execution
// ---------------------------------------------------------------------------
async function executePhase(ctx, phase, state, projectRoot, logger) {
    const handoff = getHandoffFromState(state);
    // Capture the baseline SHA before orchestrator runs so we can diff the phase's changes
    const startSha = ensureInitialCommit(projectRoot);
    const launcher = createAgentLauncher({
        pluginRoot: ctx.pluginRoot,
        projectRoot,
        dryRun: ctx.dryRun,
    });
    const phaseContext = buildPhaseContext(phase, state, handoff, ctx);
    // Delete stale report file (important for retries)
    const reportPath = join(projectRoot, REPORT_FILENAME);
    try {
        if (existsSync(reportPath)) {
            unlinkSync(reportPath);
        }
    }
    catch {
        // Ignore — file may not exist
    }
    const agentFile = resolve(ctx.pluginRoot, "agents/phase-orchestrator.md");
    console.log("Orchestrating…");
    const spinner = startSpinner("Orchestrating…");
    try {
        const startTime = Date.now();
        const result = await launcher.runPhaseOrchestrator(phaseContext, agentFile, ctx.model, ctx.verbose
            ? {
                verbose: true,
                onStdout: createStreamHandler((event) => {
                    if (event.type === "text" && event.text.length > 0) {
                        spinner.pause();
                        process.stdout.write(event.text);
                        if (!event.text.endsWith("\n"))
                            process.stdout.write("\n");
                        spinner.resume();
                    }
                }),
            }
            : undefined);
        const duration = Date.now() - startTime;
        spinner.stop();
        // When streaming, stdout is raw NDJSON — extract the result text
        const outputText = ctx.verbose
            ? extractResultText(result.stdout)
            : result.stdout;
        logger.append({
            phaseId: phase.id,
            turnNumber: 0,
            type: "phase_exec",
            input: { taskCount: phase.tasks.length },
            output: outputText.slice(0, 2000),
            duration,
        });
        if (ctx.verbose) {
            console.log(`[orchestrator] exit code: ${result.exitCode} (${Math.round(duration / 1000)}s)`);
            if (result.stderr) {
                console.log(`[orchestrator] stderr: ${result.stderr.slice(0, 500)}`);
            }
        }
        // Read the report file
        if (!existsSync(reportPath)) {
            const reason = result.exitCode !== 0
                ? `orchestrator exited with code ${result.exitCode}`
                : "orchestrator did not write report file";
            console.log(`Warning: ${reason}`);
            return {
                status: "failed",
                report: { ...buildPartialReport(phase.id, phase, reason), startSha },
            };
        }
        let rawReport;
        try {
            rawReport = JSON.parse(readFileSync(reportPath, "utf-8"));
        }
        catch {
            return {
                status: "failed",
                report: { ...buildPartialReport(phase.id, phase, "report file contained invalid JSON"), startSha },
            };
        }
        const report = normalizeReport(rawReport, phase.id);
        // Clean up temp report file — data is now stored in state.phaseReport
        try {
            unlinkSync(reportPath);
        }
        catch { /* ignore */ }
        // Validate all task IDs are accounted for
        const allTaskIds = phase.tasks.map((t) => t.id);
        const accountedFor = new Set([...report.tasksCompleted, ...report.tasksFailed]);
        const missing = allTaskIds.filter((id) => !accountedFor.has(id));
        if (missing.length > 0) {
            console.log(`Report missing ${missing.length} task(s): ${missing.join(", ")}. Marking as partial.`);
            return {
                status: "partial",
                report: {
                    ...report,
                    startSha,
                    status: "partial",
                    recommendedAction: "retry",
                    tasksFailed: [...report.tasksFailed, ...missing],
                    correctiveTasks: [
                        ...report.correctiveTasks,
                        `Tasks not accounted for in report: ${missing.join(", ")}`,
                    ],
                },
            };
        }
        return {
            status: report.status === "complete" ? "complete" : report.status,
            report: { ...report, startSha },
        };
    }
    catch (err) {
        spinner.stop();
        const reason = err instanceof Error ? err.message : "unexpected error";
        if (ctx.verbose) {
            console.error(`[executePhase] error:`, err);
        }
        return {
            status: "failed",
            report: { ...buildPartialReport(phase.id, phase, reason), startSha },
        };
    }
}
// ---------------------------------------------------------------------------
// Phase commit helpers
// ---------------------------------------------------------------------------
/**
 * Extracts scope names from completed tasks' targetPaths.
 * E.g., ["src/auth/login.tsx", "src/db/schema.ts"] → ["auth", "db"]
 */
export function extractScopes(phase, report) {
    const scopes = new Set();
    for (const taskId of report.tasksCompleted) {
        const task = phase.tasks.find((t) => t.id === taskId);
        if (!task)
            continue;
        for (const targetPath of task.targetPaths) {
            const parts = targetPath.split("/").filter(Boolean);
            // Skip generic top-level dirs like "src", "lib", "app" to find meaningful scope
            const skipDirs = new Set(["src", "lib", "app", "packages", "public", "static", "assets"]);
            const scope = parts.find((p) => !skipDirs.has(p) && !p.includes("."));
            if (scope)
                scopes.add(scope);
        }
    }
    return [...scopes];
}
/**
 * Commits any remaining uncommitted changes as a phase-level summary commit.
 * Returns the new SHA, or null if nothing to commit.
 */
export function makePhaseCommit(projectRoot, phase, report) {
    const changedFiles = getChangedFiles(projectRoot);
    if (changedFiles.length === 0)
        return null;
    const scopes = extractScopes(phase, report);
    const scopeStr = scopes.length > 0 ? `(${scopes.join(",")})` : "";
    const taskBullets = report.tasksCompleted
        .map((taskId) => {
        const task = phase.tasks.find((t) => t.id === taskId);
        return task ? `- ${task.title}` : `- ${taskId}`;
    })
        .join("\n");
    const message = `feat${scopeStr}: [trellis ${phase.id}] ${report.summary}\n\n${taskBullets}`;
    return commitAll(projectRoot, message);
}
// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
export async function runPhases(ctx, tasksJson) {
    console.log(`Starting phase runner with ${tasksJson.phases.length} phase(s)…`);
    // Validate dependencies for all phases upfront, allowing cross-phase refs
    const priorPhaseTaskIds = new Set();
    for (const phase of tasksJson.phases) {
        const validation = validateDependencies(phase.tasks, priorPhaseTaskIds);
        if (!validation.valid) {
            throw new Error(`Phase ${phase.id} has invalid dependencies: ${validation.errors.join("; ")}`);
        }
        for (const task of phase.tasks) {
            priorPhaseTaskIds.add(task.id);
        }
    }
    let state = loadState(ctx.statePath) ?? initState(tasksJson);
    const logger = createTrajectoryLogger(ctx.trajectoryPath);
    const phasesCompleted = [];
    const phasesFailed = [];
    const projectRoot = ctx.projectRoot;
    // Handle dry run early
    if (ctx.dryRun) {
        const report = dryRunReport(tasksJson, ctx);
        console.log(report);
        logger.close();
        return {
            success: true,
            phasesCompleted: [],
            phasesFailed: [],
            finalState: state,
        };
    }
    try {
        let phaseIndex = 0;
        while (phaseIndex < tasksJson.phases.length) {
            const phase = tasksJson.phases[phaseIndex];
            // Skip completed phases (resume support)
            if (state.completedPhases.includes(phase.id)) {
                phasesCompleted.push(phase.id);
                phaseIndex++;
                continue;
            }
            state = { ...state, currentPhase: phase.id, phaseReport: null };
            const taskCount = phase.tasks.length;
            console.log(`\nStarting phase "${phase.id}" (${taskCount} task${taskCount === 1 ? "" : "s"})…`);
            const phaseResult = await executePhase(ctx, phase, state, projectRoot, logger);
            let report = phaseResult.report;
            state = { ...state, phaseReport: report };
            saveState(ctx.statePath, state);
            // Judge loop: runs based on judgeMode setting
            const hasChanges = report.startSha
                ? getChangedFilesRange(projectRoot, report.startSha).length > 0
                : getChangedFiles(projectRoot).length > 0;
            const shouldJudge = ctx.judgeMode !== "never" &&
                (ctx.judgeMode === "always" ||
                    (ctx.judgeMode === "on-failure" && phaseResult.status !== "complete"));
            if (shouldJudge && (phaseResult.status !== "failed" || hasChanges)) {
                console.log(`Judging phase "${phase.id}"…`);
                const judgeResult = await judgePhase({
                    phase,
                    report,
                    projectRoot,
                    ctx,
                    logger,
                    ...(report.startSha ? { startSha: report.startSha } : {}),
                });
                report = { ...report, judgeAssessment: judgeResult.assessment };
                // Upgrade: orchestrator failed/partial but judge confirms work is correct
                if (judgeResult.assessment.passed &&
                    report.recommendedAction === "retry" &&
                    phaseResult.status !== "complete") {
                    console.log(`Judge passed phase "${phase.id}" despite orchestrator failure. Advancing.`);
                    report = {
                        ...report,
                        status: "complete",
                        recommendedAction: "advance",
                    };
                }
                // Downgrade: orchestrator said advance but judge found issues
                if (!judgeResult.assessment.passed &&
                    report.recommendedAction === "advance") {
                    console.log(`Judge found unresolved issues in phase "${phase.id}". Recommending retry.`);
                    report = {
                        ...report,
                        recommendedAction: "retry",
                        correctiveTasks: [
                            ...report.correctiveTasks,
                            ...judgeResult.assessment.issues.map(formatIssue),
                        ],
                    };
                }
            }
            // Auto-detect test suites if no --check was provided
            if (!ctx.checkCommand && hasNewTestFiles(projectRoot, report.startSha)) {
                const detected = detectTestCommand(projectRoot);
                if (detected) {
                    console.log(`Detected new test files. Setting check command: ${detected}`);
                    ctx.checkCommand = detected;
                }
            }
            // Determine action: combine report recommendation with user input
            let action = report.recommendedAction === "advance"
                ? "advance"
                : report.recommendedAction === "retry"
                    ? "retry"
                    : "halt";
            if (!ctx.headless) {
                const retryCount = state.phaseRetries[phase.id] ?? 0;
                const userChoice = await promptForContinuation({
                    phaseId: phase.id,
                    retryCount,
                    maxRetries: ctx.maxRetries,
                    recommendedAction: report.recommendedAction,
                    reason: report.summary,
                });
                if (userChoice === "quit") {
                    // Save report to state before exiting
                    state = {
                        ...state,
                        phaseReports: [...state.phaseReports, report],
                    };
                    phasesFailed.push(phase.id);
                    saveState(ctx.statePath, state);
                    break;
                }
                if (userChoice === "retry") {
                    action = "retry";
                }
                else if (userChoice === "skip") {
                    action = "skip";
                }
                // "continue" defers to report's recommendation
            }
            // In headless mode, follow the report's recommendation
            if (ctx.headless && report.recommendedAction === "retry") {
                action = "retry";
            }
            if (action === "retry") {
                const retryCount = state.phaseRetries[phase.id] ?? 0;
                if (retryCount < ctx.maxRetries) {
                    state = {
                        ...state,
                        phaseReports: [...state.phaseReports, report],
                        phaseRetries: {
                            ...state.phaseRetries,
                            [phase.id]: retryCount + 1,
                        },
                    };
                    // Append corrective tasks
                    if (report.correctiveTasks.length > 0) {
                        const newTasks = report.correctiveTasks.map((desc, i) => makeCorrectiveTask(phase.id, desc, i + retryCount * 100));
                        tasksJson.phases[phaseIndex] = {
                            ...phase,
                            tasks: [...phase.tasks, ...newTasks],
                        };
                    }
                    saveState(ctx.statePath, state);
                    // Don't increment phaseIndex — re-enter same phase
                    continue;
                }
                // Max retries exceeded — halt
                console.log(`Max retries (${ctx.maxRetries}) exceeded for phase "${phase.id}". Halting.`);
                phasesFailed.push(phase.id);
                state = {
                    ...state,
                    phaseReports: [...state.phaseReports, report],
                };
                saveState(ctx.statePath, state);
                break;
            }
            if (action === "skip") {
                phasesCompleted.push(phase.id);
                state = {
                    ...state,
                    completedPhases: [...state.completedPhases, phase.id],
                    phaseReports: [...state.phaseReports, report],
                };
                saveState(ctx.statePath, state);
                phaseIndex++;
                continue;
            }
            if (action === "halt") {
                phasesFailed.push(phase.id);
                state = {
                    ...state,
                    phaseReports: [...state.phaseReports, report],
                };
                saveState(ctx.statePath, state);
                break;
            }
            // action === "advance"
            // Commit any remaining uncommitted changes as a phase-level commit
            makePhaseCommit(projectRoot, phase, report);
            report = { ...report, endSha: getCurrentSha(projectRoot) ?? report.startSha };
            phasesCompleted.push(phase.id);
            state = updateStateAfterPhase(state, report, tasksJson.phases);
            saveState(ctx.statePath, state);
            // Sync task statuses back to tasks.json
            tasksJson = applyReportToTasks(tasksJson, phase.id, report);
            writeFileSync(ctx.tasksJsonPath, JSON.stringify(tasksJson, null, 2), "utf-8");
            phaseIndex++;
        }
    }
    finally {
        logger.close();
    }
    return {
        success: phasesFailed.length === 0,
        phasesCompleted,
        phasesFailed,
        finalState: state,
    };
}
// ---------------------------------------------------------------------------
// Single phase runner
// ---------------------------------------------------------------------------
export async function runSinglePhase(ctx, tasksJson, phaseId) {
    const phase = tasksJson.phases.find((p) => p.id === phaseId);
    if (!phase) {
        throw new Error(`Phase not found: ${phaseId}`);
    }
    const taskCount = phase.tasks.length;
    console.log(`Starting single phase "${phaseId}" (${taskCount} task${taskCount === 1 ? "" : "s"})…`);
    // Collect task IDs from all phases prior to the target phase
    const priorPhaseTaskIds = new Set();
    for (const p of tasksJson.phases) {
        if (p.id === phaseId)
            break;
        for (const t of p.tasks) {
            priorPhaseTaskIds.add(t.id);
        }
    }
    const validation = validateDependencies(phase.tasks, priorPhaseTaskIds);
    if (!validation.valid) {
        throw new Error(`Phase ${phase.id} has invalid dependencies: ${validation.errors.join("; ")}`);
    }
    let state = loadState(ctx.statePath) ?? initState(tasksJson);
    const logger = createTrajectoryLogger(ctx.trajectoryPath);
    const phasesCompleted = [];
    const phasesFailed = [];
    const projectRoot = ctx.projectRoot;
    try {
        state = { ...state, currentPhase: phase.id };
        const phaseResult = await executePhase(ctx, phase, state, projectRoot, logger);
        let report = phaseResult.report;
        // Judge loop: runs based on judgeMode setting
        const hasChanges = report.startSha
            ? getChangedFilesRange(projectRoot, report.startSha).length > 0
            : getChangedFiles(projectRoot).length > 0;
        const shouldJudge = ctx.judgeMode !== "never" &&
            (ctx.judgeMode === "always" ||
                (ctx.judgeMode === "on-failure" && phaseResult.status !== "complete"));
        if (shouldJudge && (phaseResult.status !== "failed" || hasChanges)) {
            console.log(`Judging phase "${phase.id}"…`);
            const judgeResult = await judgePhase({
                phase,
                report,
                projectRoot,
                ctx,
                logger,
                ...(report.startSha ? { startSha: report.startSha } : {}),
            });
            report = { ...report, judgeAssessment: judgeResult.assessment };
            // Upgrade: orchestrator failed/partial but judge confirms work is correct
            if (judgeResult.assessment.passed &&
                report.recommendedAction === "retry" &&
                phaseResult.status !== "complete") {
                console.log(`Judge passed phase "${phase.id}" despite orchestrator failure. Advancing.`);
                report = {
                    ...report,
                    status: "complete",
                    recommendedAction: "advance",
                };
            }
            // Downgrade: orchestrator said advance but judge found issues
            if (!judgeResult.assessment.passed &&
                report.recommendedAction === "advance") {
                console.log(`Judge found unresolved issues in phase "${phase.id}". Downgrading to partial.`);
                report = {
                    ...report,
                    status: "partial",
                    recommendedAction: "retry",
                    correctiveTasks: [
                        ...report.correctiveTasks,
                        ...judgeResult.assessment.issues.map(formatIssue),
                    ],
                };
            }
        }
        // Auto-detect test suites if no --check was provided
        if (!ctx.checkCommand && hasNewTestFiles(projectRoot, report.startSha)) {
            const detected = detectTestCommand(projectRoot);
            if (detected) {
                console.log(`Detected new test files. Setting check command: ${detected}`);
                ctx.checkCommand = detected;
            }
        }
        if (report.status === "complete" && report.recommendedAction === "advance") {
            makePhaseCommit(projectRoot, phase, report);
            report = { ...report, endSha: getCurrentSha(projectRoot) ?? report.startSha };
            phasesCompleted.push(phase.id);
            state = updateStateAfterPhase(state, report, tasksJson.phases);
            // Sync task statuses back to tasks.json
            const updatedTasks = applyReportToTasks(tasksJson, phase.id, report);
            writeFileSync(ctx.tasksJsonPath, JSON.stringify(updatedTasks, null, 2), "utf-8");
        }
        else {
            phasesFailed.push(phase.id);
            state = {
                ...state,
                phaseReports: [...state.phaseReports, report],
            };
        }
        saveState(ctx.statePath, state);
    }
    finally {
        logger.close();
    }
    return {
        success: phasesFailed.length === 0,
        phasesCompleted,
        phasesFailed,
        finalState: state,
    };
}
//# sourceMappingURL=phaseRunner.js.map