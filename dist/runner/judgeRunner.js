import { writeFileSync } from "node:fs";
import { getChangedFiles, getDiffContent, getCurrentSha } from "../git.js";
import { createCheckRunner } from "../verification/checkRunner.js";
import { createAgentLauncher } from "../orchestrator/agentLauncher.js";
import { applyCorrections } from "./stateManager.js";
import { startSpinner } from "../ui/spinner.js";
import { formatIssue, parseJudgeResult, buildJudgePrompt, buildRejudgePrompt, buildFixPrompt, } from "./prompts.js";
// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------
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
// ---------------------------------------------------------------------------
// Judge loop
// ---------------------------------------------------------------------------
export async function judgePhase(config) {
    const maxCorrections = config.maxCorrections ?? 2;
    const { phase, report, state, projectRoot, ctx, logger, startSha } = config;
    const usageOrEmpty = (u) => u.inputTokens > 0 || u.outputTokens > 0 ? { usage: u } : {};
    let changedFiles = getChangedFiles(projectRoot, startSha);
    if (changedFiles.length === 0) {
        return {
            assessment: { passed: true, issues: [], suggestions: [], corrections: [] },
            correctionAttempts: 0,
        };
    }
    const launcher = createAgentLauncher({
        pluginRoot: ctx.pluginRoot,
        projectRoot,
        dryRun: ctx.dryRun,
    });
    let assessment = { passed: true, issues: [], suggestions: [], corrections: [] };
    let previousIssues;
    let fixDiffContent;
    let fixChangedFiles;
    const accUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
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
            const diffContent = getDiffContent(projectRoot, startSha);
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
            console.log(`[judge] attempt ${attempt + 1}, reviewing ${changedFiles.length} changed file(s), model: ${judgeModel} (${diffLineCount} diff lines, ${phase.tasks.length} tasks)`);
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
        if (result.usage) {
            accUsage.inputTokens += result.usage.inputTokens;
            accUsage.outputTokens += result.usage.outputTokens;
            accUsage.costUsd += result.usage.costUsd;
        }
        logger.append({
            phaseId: phase.id,
            turnNumber: 0,
            type: "judge_invoke",
            input: { attempt, fileCount: changedFiles.length },
            output: result.output.slice(0, 2000),
            duration,
        });
        // If the sub-agent process itself failed (e.g. CLI error), treat as
        // infrastructure failure and skip the fix-judge cycle entirely.
        if (!result.success) {
            const reason = result.error || "unknown sub-agent failure";
            console.log(`[judge] sub-agent failed on attempt ${attempt + 1}: ${reason}`);
            // Pass through — treat as if judge approved so we don't waste cycles
            // on fix-agent retries for infra issues.
            return {
                assessment: { passed: true, issues: [], suggestions: [], corrections: [] },
                correctionAttempts: attempt,
                ...usageOrEmpty(accUsage),
            };
        }
        assessment = parseJudgeResult(result.output);
        if (assessment.passed) {
            if (ctx.verbose) {
                console.log(`[judge] passed on attempt ${attempt + 1}`);
            }
            return { assessment, correctionAttempts: attempt, ...usageOrEmpty(accUsage) };
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
        const fixPrompt = buildFixPrompt(assessment.issues, phase, state, ctx);
        const fixResult = await launcher.dispatchSubAgent({
            type: "fix",
            taskId: `${phase.id}-fix-${attempt}`,
            instructions: fixPrompt,
            filePaths: changedFiles.map((f) => f.path),
            outputPaths: changedFiles
                .filter((f) => f.status !== "D")
                .map((f) => f.path),
        });
        if (fixResult.usage) {
            accUsage.inputTokens += fixResult.usage.inputTokens;
            accUsage.outputTokens += fixResult.usage.outputTokens;
            accUsage.costUsd += fixResult.usage.costUsd;
        }
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
            fixDiffContent = getDiffContent(projectRoot, preFixSha);
            fixChangedFiles = getChangedFiles(projectRoot, preFixSha);
        }
        else {
            // Fallback: use full diff if no SHA available
            fixDiffContent = getDiffContent(projectRoot, startSha);
            fixChangedFiles = changedFiles;
        }
        // Refresh changed files for file paths context
        changedFiles = getChangedFiles(projectRoot, startSha);
    }
    return { assessment, correctionAttempts: maxCorrections, ...usageOrEmpty(accUsage) };
}
// ---------------------------------------------------------------------------
// Judge outcome application
// ---------------------------------------------------------------------------
/**
 * Applies judge assessment to report and tasks.json:
 * - Applies corrections (targetPath renames) and writes tasks.json to disk
 * - Upgrades report to "complete" if judge passed but orchestrator failed
 * - Downgrades report to "retry" if judge found issues but orchestrator said advance
 *
 * Returns the updated report and tasks.json.
 */
export function applyJudgeOutcome(config) {
    let { report, tasksJson } = config;
    const { judgeResult, phaseId, phaseExecStatus, tasksJsonPath, verbose } = config;
    report = { ...report, judgeAssessment: judgeResult.assessment, judgeFixCycles: judgeResult.correctionAttempts };
    // Apply judge corrections to tasks.json (e.g., targetPath renames)
    const corrections = judgeResult.assessment.corrections ?? [];
    if (corrections.length > 0) {
        const result = applyCorrections(tasksJson, corrections);
        tasksJson = result.tasksJson;
        writeFileSync(tasksJsonPath, JSON.stringify(tasksJson, null, 2), "utf-8");
        report = { ...report, decisionsLog: [...report.decisionsLog, ...result.decisions] };
        if (verbose) {
            console.log(`Applied ${corrections.length} judge correction(s) to tasks.json`);
        }
    }
    // Upgrade: orchestrator failed/partial but judge confirms work is correct
    if (judgeResult.assessment.passed &&
        report.recommendedAction === "retry" &&
        phaseExecStatus !== "complete") {
        console.log(`Judge passed phase "${phaseId}" despite orchestrator failure. Advancing.`);
        report = {
            ...report,
            status: "complete",
            recommendedAction: "advance",
        };
    }
    // Downgrade: orchestrator said advance but judge found issues
    if (!judgeResult.assessment.passed &&
        report.recommendedAction === "advance") {
        console.log(`Judge found unresolved issues in phase "${phaseId}". Recommending retry.`);
        report = {
            ...report,
            recommendedAction: "retry",
            correctiveTasks: [
                ...report.correctiveTasks,
                ...judgeResult.assessment.issues.map(formatIssue),
            ],
        };
    }
    return { report, tasksJson };
}
//# sourceMappingURL=judgeRunner.js.map