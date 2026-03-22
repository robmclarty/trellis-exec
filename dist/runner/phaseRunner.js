import { copyFileSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { createInterface } from "node:readline";
import { initState, loadState, saveState, updateStateAfterPhase, } from "./stateManager.js";
import { validateDependencies, resolveExecutionOrder, detectTargetPathOverlaps, } from "./scheduler.js";
import { createTrajectoryLogger } from "../logging/trajectoryLogger.js";
import { createWorktree, commitPhase, mergeWorktree, cleanupWorktree, } from "../isolation/worktreeManager.js";
import { createCheckRunner } from "../verification/checkRunner.js";
import { createAgentLauncher } from "../orchestrator/agentLauncher.js";
import { createReplHelpers } from "../orchestrator/replHelpers.js";
import { createReplSession } from "../orchestrator/replManager.js";
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function deriveProjectRoot(baseProjectRoot, worktreeResult, isolation) {
    if (isolation === "worktree" &&
        worktreeResult &&
        worktreeResult.success) {
        return worktreeResult.worktreePath;
    }
    return baseProjectRoot;
}
function getHandoffFromState(state) {
    const last = state.phaseReports.at(-1);
    return last?.handoff ?? "";
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
    lines.push(`Modified files: ${state.modifiedFiles.length}`);
    lines.push(`Schema changes: ${state.schemaChanges.length}`);
    lines.push("");
    lines.push("## Spec Reference");
    lines.push(basename(ctx.specPath));
    lines.push("");
    lines.push("## Guidelines Reference");
    lines.push(ctx.guidelinesPath ? basename(ctx.guidelinesPath) : "none configured");
    lines.push("");
    lines.push("## Check Command");
    lines.push(ctx.checkCommand ?? "none configured");
    lines.push("");
    lines.push("## REPL Protocol");
    lines.push("IMPORTANT: You are communicating through a JavaScript REPL. " +
        "Every response you give will be eval'd as JavaScript. " +
        "Do NOT include any natural language, explanations, or markdown. " +
        "Output ONLY plain JavaScript code (no TypeScript, no `export`, no `module.exports`).");
    lines.push("");
    lines.push("Available REPL helper functions:");
    lines.push("- readFile(path) — read a file, returns string");
    lines.push("- listDir(path) — list directory contents");
    lines.push("- searchFiles(pattern) — search files by glob pattern");
    lines.push("- await dispatchSubAgent({ type, taskId, instructions, filePaths, outputPaths }) — dispatch a sub-agent to create/modify files");
    lines.push("- await runCheck() — run the project check command");
    lines.push("- getState() — get current shared state");
    lines.push("- await writePhaseReport({ status, recommendedAction, ... }) — write the phase report (signals completion)");
    lines.push("- await llmQuery(prompt, options?) — quick LLM query for analysis");
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
        orchestratorAnalysis: `Phase terminated due to ${reason}. Manual intervention required.`,
        recommendedAction: "halt",
        correctiveTasks: [],
        decisionsLog: [],
        handoff: "",
    };
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
// Interactive prompt
// ---------------------------------------------------------------------------
export async function promptForContinuation() {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolvePromise) => {
        rl.question("\n[Enter] continue  [r] retry  [s] skip  [q] quit\n> ", (answer) => {
            rl.close();
            const trimmed = answer.trim().toLowerCase();
            if (trimmed === "r")
                resolvePromise("retry");
            else if (trimmed === "s")
                resolvePromise("skip");
            else if (trimmed === "q")
                resolvePromise("quit");
            else
                resolvePromise("continue");
        });
    });
}
// ---------------------------------------------------------------------------
// Code extraction from orchestrator responses
// ---------------------------------------------------------------------------
/**
 * Extracts executable JS code from an orchestrator response.
 *
 * The orchestrator may wrap code in markdown fences (```js ... ```) or
 * include explanatory text alongside code. This function extracts the
 * code blocks, falling back to the raw response if no fences are found.
 * If the response is clearly natural language (not JS), returns empty string.
 */
export function extractCode(response) {
    // Match fenced code blocks: ```js, ```javascript, ```typescript, or plain ```
    const fencePattern = /```(?:js|javascript|typescript|ts)?\s*\n([\s\S]*?)```/g;
    const blocks = [];
    let match;
    while ((match = fencePattern.exec(response)) !== null) {
        blocks.push(match[1].trim());
    }
    if (blocks.length > 0) {
        return blocks.join("\n\n");
    }
    const trimmed = response.trim();
    // Heuristic: detect natural language responses.
    // JS code typically starts with: const, let, var, await, function, //, (,
    // or an identifier followed by ( or =.
    // Natural language starts with: The, I, This, It, File, Task, etc.
    const jsStartPattern = /^(?:const |let |var |await |function |\/\/|\/\*|\(|[a-z_$][a-z0-9_$]*\s*[=(.])/i;
    if (!jsStartPattern.test(trimmed)) {
        return "";
    }
    // Additional check: if the first line is a sentence (contains spaces and
    // no operators), it's likely natural language
    const firstLine = trimmed.split("\n")[0];
    if (/^[A-Z][a-z]/.test(firstLine) &&
        firstLine.includes(" ") &&
        !/[=;{}[\]]/.test(firstLine)) {
        return "";
    }
    return trimmed;
}
// ---------------------------------------------------------------------------
// REPL turn loop
// ---------------------------------------------------------------------------
async function replTurnLoop(orchestrator, repl, logger, phaseId, turnLimit, maxConsecutiveErrors, verbose, isCaptured) {
    let previousOutput = "Begin phase execution.";
    for (let turnNumber = 1; turnNumber <= turnLimit; turnNumber++) {
        if (!orchestrator.isAlive()) {
            return { reason: "dead" };
        }
        const rawResponse = await orchestrator.send(previousOutput);
        const code = extractCode(rawResponse);
        // Check if writePhaseReport was triggered by the orchestrator's response
        if (isCaptured()) {
            return { reason: "complete" };
        }
        // If extractCode returned empty (natural language response), skip eval
        // and send a corrective nudge
        if (!code) {
            if (verbose) {
                console.log(`[turn ${turnNumber}] skipped: response was natural language`);
            }
            previousOutput =
                "REPL: Your response was natural language and was skipped. " +
                    "You MUST output ONLY JavaScript code. The functions runCheck() and " +
                    "writePhaseReport() are real JavaScript functions available in this REPL. " +
                    "Example of what you should output next:\n\n" +
                    "await runCheck()\n\n" +
                    "Or if checks pass, write the report:\n\n" +
                    'await writePhaseReport({ status: "complete", recommendedAction: "advance", ' +
                    'taskOutcomes: [{ taskId: "phase-1-task-1", status: "passed" }], ' +
                    'handoffBriefing: "Phase 1 complete." })';
            continue;
        }
        const startTime = performance.now();
        const evalResult = await repl.eval(code);
        const duration = performance.now() - startTime;
        repl.restoreScaffold();
        logger.append({
            phaseId,
            turnNumber,
            type: "repl_exec",
            input: code,
            output: evalResult.output,
            duration,
        });
        if (verbose) {
            console.log(`[turn ${turnNumber}] code: ${code.slice(0, 200)}`);
            console.log(`[turn ${turnNumber}] result: ${evalResult.output.slice(0, 200)}`);
        }
        if (repl.getConsecutiveErrors() >= maxConsecutiveErrors) {
            return { reason: "errors" };
        }
        const rawOutput = evalResult.success
            ? evalResult.output
            : `ERROR: ${evalResult.error ?? "unknown"}\n${evalResult.output}`;
        // Ensure we never send an empty string (claude --print requires input)
        previousOutput = rawOutput.trim() || "(no output)";
        // Check if writePhaseReport was called inside the eval'd code
        if (isCaptured()) {
            return { reason: "complete" };
        }
    }
    return { reason: "turn_limit" };
}
function copySpecToProjectRoot(specPath, projectRoot) {
    const destPath = join(projectRoot, basename(specPath));
    const copied = resolve(specPath) !== resolve(destPath);
    if (copied) {
        copyFileSync(specPath, destPath);
    }
    return { destPath, copied };
}
function copyGuidelinesToProjectRoot(guidelinesPath, projectRoot) {
    if (!guidelinesPath) {
        return { destPath: "", copied: false };
    }
    const destPath = join(projectRoot, basename(guidelinesPath));
    const copied = resolve(guidelinesPath) !== resolve(destPath);
    if (copied) {
        copyFileSync(guidelinesPath, destPath);
    }
    return { destPath, copied };
}
function cleanupCopiedFile(file) {
    if (file.copied) {
        try {
            unlinkSync(file.destPath);
        }
        catch {
            // Ignore — file may already be gone
        }
    }
}
// ---------------------------------------------------------------------------
// Single phase execution
// ---------------------------------------------------------------------------
async function executePhase(ctx, phase, state, projectRoot, logger) {
    const handoff = getHandoffFromState(state);
    const launcher = createAgentLauncher({
        pluginRoot: ctx.pluginRoot,
        projectRoot,
        dryRun: ctx.dryRun,
    });
    const checkRunner = ctx.checkCommand
        ? createCheckRunner({ command: ctx.checkCommand, cwd: projectRoot })
        : null;
    let capturedReport = null;
    const baseHelpers = createReplHelpers({
        projectRoot,
        statePath: ctx.statePath,
        agentLauncher: (c) => launcher.dispatchSubAgent(c),
    });
    const helpers = {
        ...baseHelpers,
        writePhaseReport: (report) => {
            capturedReport = report;
        },
        runCheck: checkRunner
            ? () => checkRunner.run()
            : baseHelpers.runCheck,
        llmQuery: (prompt, options) => launcher.llmQuery(prompt, options),
    };
    const repl = createReplSession({
        projectRoot,
        outputLimit: 8192,
        timeout: 30_000,
        helpers,
    });
    const phaseContext = buildPhaseContext(phase, state, handoff, ctx);
    let orchestrator = null;
    try {
        const launchConfig = {
            agentFile: resolve(ctx.pluginRoot, "agents/phase-orchestrator.md"),
            skillsDir: resolve(ctx.pluginRoot, "skills"),
            phaseContext,
            ...(ctx.model !== undefined ? { model: ctx.model } : {}),
        };
        orchestrator = await launcher.launchOrchestrator(launchConfig);
        const loopResult = await replTurnLoop(orchestrator, repl, logger, phase.id, ctx.turnLimit, ctx.maxConsecutiveErrors, ctx.verbose, () => capturedReport !== null);
        const report = capturedReport ??
            buildPartialReport(phase.id, phase, loopResult.reason);
        return {
            status: report.status === "complete" ? "complete" : report.status,
            report,
        };
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : "unexpected error";
        if (ctx.verbose) {
            console.error(`[executePhase] error:`, err);
        }
        const report = capturedReport ?? buildPartialReport(phase.id, phase, reason);
        return { status: "failed", report };
    }
    finally {
        repl.destroy();
        if (orchestrator) {
            orchestrator.kill();
        }
    }
}
// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
export async function runPhases(ctx, tasksJson) {
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
    // Worktree setup
    let worktreeResult = null;
    if (ctx.isolation === "worktree") {
        worktreeResult = createWorktree({
            projectRoot: ctx.projectRoot,
            specName: basename(ctx.specPath),
        });
        if (!worktreeResult.success) {
            logger.close();
            throw new Error(`Failed to create worktree: ${worktreeResult.error ?? "unknown"}`);
        }
    }
    const projectRoot = deriveProjectRoot(ctx.projectRoot, worktreeResult, ctx.isolation);
    // Ensure the project root directory exists (worktree may not have been created yet).
    mkdirSync(projectRoot, { recursive: true });
    // Copy spec and guidelines into project root so the sandbox can read them.
    const specFile = copySpecToProjectRoot(ctx.specPath, projectRoot);
    const guidelinesFile = copyGuidelinesToProjectRoot(ctx.guidelinesPath, projectRoot);
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
            state = { ...state, currentPhase: phase.id };
            const phaseResult = await executePhase(ctx, phase, state, projectRoot, logger);
            const report = phaseResult.report;
            // Determine action: combine report recommendation with user input
            let action = report.recommendedAction === "advance" ? "advance" : "halt";
            if (!ctx.headless) {
                const userChoice = await promptForContinuation();
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
            phasesCompleted.push(phase.id);
            state = updateStateAfterPhase(state, report, tasksJson.phases);
            if (worktreeResult) {
                commitPhase(worktreeResult.worktreePath, phase.id);
            }
            saveState(ctx.statePath, state);
            phaseIndex++;
        }
        // Merge worktree on success
        if (worktreeResult &&
            phasesFailed.length === 0 &&
            phasesCompleted.length > 0) {
            const mergeResult = mergeWorktree({
                projectRoot: ctx.projectRoot,
                worktreePath: worktreeResult.worktreePath,
                branchName: worktreeResult.branchName,
            });
            if (!mergeResult.success) {
                console.error("Worktree merge failed:", mergeResult.error);
            }
        }
    }
    finally {
        cleanupCopiedFile(specFile);
        cleanupCopiedFile(guidelinesFile);
        if (worktreeResult) {
            cleanupWorktree(worktreeResult.worktreePath);
        }
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
    let worktreeResult = null;
    if (ctx.isolation === "worktree") {
        worktreeResult = createWorktree({
            projectRoot: ctx.projectRoot,
            specName: basename(ctx.specPath),
        });
        if (!worktreeResult.success) {
            logger.close();
            throw new Error(`Failed to create worktree: ${worktreeResult.error ?? "unknown"}`);
        }
    }
    const projectRoot = deriveProjectRoot(ctx.projectRoot, worktreeResult, ctx.isolation);
    // Ensure the project root directory exists (worktree may not have been created yet).
    mkdirSync(projectRoot, { recursive: true });
    // Copy spec and guidelines into project root so the sandbox can read them.
    const specFile = copySpecToProjectRoot(ctx.specPath, projectRoot);
    const guidelinesFile = copyGuidelinesToProjectRoot(ctx.guidelinesPath, projectRoot);
    try {
        state = { ...state, currentPhase: phase.id };
        const phaseResult = await executePhase(ctx, phase, state, projectRoot, logger);
        const report = phaseResult.report;
        if (phaseResult.status === "complete") {
            phasesCompleted.push(phase.id);
            state = updateStateAfterPhase(state, report, tasksJson.phases);
            if (worktreeResult) {
                commitPhase(worktreeResult.worktreePath, phase.id);
                mergeWorktree({
                    projectRoot: ctx.projectRoot,
                    worktreePath: worktreeResult.worktreePath,
                    branchName: worktreeResult.branchName,
                });
            }
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
        cleanupCopiedFile(specFile);
        cleanupCopiedFile(guidelinesFile);
        if (worktreeResult) {
            cleanupWorktree(worktreeResult.worktreePath);
        }
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