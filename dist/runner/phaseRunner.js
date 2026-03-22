import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { TasksJsonSchema } from "../types/tasks.js";
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
function resolveDefaults(config) {
    const dir = dirname(resolve(config.tasksJsonPath));
    return {
        ...config,
        statePath: config.statePath ?? resolve(dir, "state.json"),
        trajectoryPath: config.trajectoryPath ?? resolve(dir, "trajectory.jsonl"),
    };
}
function loadAndValidateTasksJson(tasksJsonPath) {
    const raw = readFileSync(resolve(tasksJsonPath), "utf-8");
    try {
        return TasksJsonSchema.parse(JSON.parse(raw));
    }
    catch (err) {
        throw new Error(`Invalid tasks.json at ${tasksJsonPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function deriveProjectRoot(config, worktreeResult) {
    if (config.isolation === "worktree" &&
        worktreeResult &&
        worktreeResult.success) {
        return worktreeResult.worktreePath;
    }
    return config.projectRoot ?? dirname(resolve(config.tasksJsonPath));
}
function getHandoffFromState(state) {
    const last = state.phaseReports.at(-1);
    return last?.handoff ?? "";
}
/**
 * Read spec sections from a spec file by §N identifiers.
 * Returns a map of section key to content. Gracefully returns empty map on error.
 */
function parseSpecSections(specPath) {
    const sectionMap = new Map();
    let content;
    try {
        content = readFileSync(specPath, "utf-8");
    }
    catch {
        return sectionMap;
    }
    const lines = content.split("\n");
    let currentKey = null;
    let currentLines = [];
    for (const line of lines) {
        const match = line.match(/^## §(\d+)/);
        if (match) {
            if (currentKey !== null) {
                sectionMap.set(currentKey, currentLines.join("\n").trim());
            }
            currentKey = "§" + match[1];
            currentLines = [line];
        }
        else if (currentKey !== null) {
            currentLines.push(line);
        }
    }
    if (currentKey !== null) {
        sectionMap.set(currentKey, currentLines.join("\n").trim());
    }
    return sectionMap;
}
function buildPhaseContext(phase, state, handoff, tasksJson, specPath, checkCommand) {
    const lines = [];
    // Collect all spec sections referenced by this phase's tasks
    const referencedSections = new Set();
    for (const task of phase.tasks) {
        for (const section of task.specSections) {
            referencedSections.add(section);
        }
    }
    // Pre-load spec content so the agent has it in context
    const specSectionMap = referencedSections.size > 0
        ? parseSpecSections(specPath)
        : new Map();
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
    // Embed pre-loaded spec sections so the agent doesn't need to find them
    if (referencedSections.size > 0) {
        lines.push("");
        lines.push("## Spec Content");
        lines.push("The following spec sections are referenced by tasks in this phase:");
        const sortedSections = [...referencedSections].sort((a, b) => {
            const numA = parseInt(a.replace("§", ""), 10);
            const numB = parseInt(b.replace("§", ""), 10);
            return numA - numB;
        });
        for (const section of sortedSections) {
            const content = specSectionMap.get(section);
            lines.push("");
            if (content) {
                lines.push(content);
            }
            else {
                lines.push(`### ${section}`);
                lines.push(`[Section ${section} not found in spec]`);
            }
        }
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
    lines.push(tasksJson.specRef);
    lines.push("");
    lines.push("## Check Command");
    lines.push(checkCommand ?? "none configured");
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
    lines.push("- readSpecSections(...sections) — read specific spec sections");
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
export function dryRunReport(tasksJson) {
    const lines = [];
    lines.push(`Spec: ${tasksJson.specRef}`);
    lines.push(`Plan: ${tasksJson.planRef}`);
    lines.push(`Phases: ${tasksJson.phases.length}`);
    lines.push("");
    for (const phase of tasksJson.phases) {
        lines.push(`## ${phase.id}: ${phase.name}`);
        lines.push(phase.description);
        lines.push("");
        const groups = resolveExecutionOrder(phase.tasks);
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
// ---------------------------------------------------------------------------
// Single phase execution
// ---------------------------------------------------------------------------
async function executePhase(config, phase, state, tasksJson, projectRoot, logger) {
    const handoff = getHandoffFromState(state);
    const launcher = createAgentLauncher({
        pluginRoot: config.pluginRoot,
        projectRoot,
        dryRun: config.dryRun,
    });
    const checkRunner = config.checkCommand
        ? createCheckRunner({ command: config.checkCommand, cwd: projectRoot })
        : null;
    let capturedReport = null;
    const specPath = resolve(dirname(resolve(config.tasksJsonPath)), tasksJson.specRef);
    const baseHelpers = createReplHelpers({
        projectRoot,
        specPath,
        statePath: config.statePath,
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
    const phaseContext = buildPhaseContext(phase, state, handoff, tasksJson, specPath, config.checkCommand);
    let orchestrator = null;
    try {
        const launchConfig = {
            agentFile: resolve(config.pluginRoot, "agents/phase-orchestrator.md"),
            skillsDir: resolve(config.pluginRoot, "skills"),
            phaseContext,
            ...(config.model !== undefined ? { model: config.model } : {}),
        };
        orchestrator = await launcher.launchOrchestrator(launchConfig);
        const loopResult = await replTurnLoop(orchestrator, repl, logger, phase.id, config.turnLimit, config.maxConsecutiveErrors, config.verbose, () => capturedReport !== null);
        const report = capturedReport ??
            buildPartialReport(phase.id, phase, loopResult.reason);
        return {
            status: report.status === "complete" ? "complete" : report.status,
            report,
        };
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : "unexpected error";
        if (config.verbose) {
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
export async function runPhases(config) {
    const resolved = resolveDefaults(config);
    const tasksJson = loadAndValidateTasksJson(resolved.tasksJsonPath);
    // Validate dependencies for all phases upfront
    for (const phase of tasksJson.phases) {
        const validation = validateDependencies(phase.tasks);
        if (!validation.valid) {
            throw new Error(`Phase ${phase.id} has invalid dependencies: ${validation.errors.join("; ")}`);
        }
    }
    let state = loadState(resolved.statePath) ?? initState(tasksJson);
    const logger = createTrajectoryLogger(resolved.trajectoryPath);
    const phasesCompleted = [];
    const phasesFailed = [];
    // Worktree setup
    const baseProjectRoot = resolved.projectRoot ?? dirname(resolve(resolved.tasksJsonPath));
    let worktreeResult = null;
    if (resolved.isolation === "worktree") {
        worktreeResult = createWorktree({
            projectRoot: baseProjectRoot,
            specName: tasksJson.specRef,
        });
        if (!worktreeResult.success) {
            logger.close();
            throw new Error(`Failed to create worktree: ${worktreeResult.error ?? "unknown"}`);
        }
    }
    const projectRoot = deriveProjectRoot(resolved, worktreeResult);
    // Handle dry run early
    if (resolved.dryRun) {
        const report = dryRunReport(tasksJson);
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
            const phaseResult = await executePhase(resolved, phase, state, tasksJson, projectRoot, logger);
            const report = phaseResult.report;
            // Determine action: combine report recommendation with user input
            let action = report.recommendedAction === "advance" ? "advance" : "halt";
            if (!resolved.headless) {
                const userChoice = await promptForContinuation();
                if (userChoice === "quit") {
                    // Save report to state before exiting
                    state = {
                        ...state,
                        phaseReports: [...state.phaseReports, report],
                    };
                    phasesFailed.push(phase.id);
                    saveState(resolved.statePath, state);
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
            if (resolved.headless && report.recommendedAction === "retry") {
                action = "retry";
            }
            if (action === "retry") {
                const retryCount = state.phaseRetries[phase.id] ?? 0;
                if (retryCount < resolved.maxRetries) {
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
                    saveState(resolved.statePath, state);
                    // Don't increment phaseIndex — re-enter same phase
                    continue;
                }
                // Max retries exceeded — halt
                phasesFailed.push(phase.id);
                state = {
                    ...state,
                    phaseReports: [...state.phaseReports, report],
                };
                saveState(resolved.statePath, state);
                break;
            }
            if (action === "skip") {
                phasesCompleted.push(phase.id);
                state = {
                    ...state,
                    completedPhases: [...state.completedPhases, phase.id],
                    phaseReports: [...state.phaseReports, report],
                };
                saveState(resolved.statePath, state);
                phaseIndex++;
                continue;
            }
            if (action === "halt") {
                phasesFailed.push(phase.id);
                state = {
                    ...state,
                    phaseReports: [...state.phaseReports, report],
                };
                saveState(resolved.statePath, state);
                break;
            }
            // action === "advance"
            phasesCompleted.push(phase.id);
            state = updateStateAfterPhase(state, report, tasksJson.phases);
            if (worktreeResult) {
                commitPhase(worktreeResult.worktreePath, phase.id);
            }
            saveState(resolved.statePath, state);
            phaseIndex++;
        }
        // Merge worktree on success
        if (worktreeResult &&
            phasesFailed.length === 0 &&
            phasesCompleted.length > 0) {
            const mergeResult = mergeWorktree({
                projectRoot: baseProjectRoot,
                worktreePath: worktreeResult.worktreePath,
                branchName: worktreeResult.branchName,
            });
            if (!mergeResult.success) {
                console.error("Worktree merge failed:", mergeResult.error);
            }
        }
    }
    finally {
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
export async function runSinglePhase(config, phaseId) {
    const resolved = resolveDefaults(config);
    const tasksJson = loadAndValidateTasksJson(resolved.tasksJsonPath);
    const phase = tasksJson.phases.find((p) => p.id === phaseId);
    if (!phase) {
        throw new Error(`Phase not found: ${phaseId}`);
    }
    const validation = validateDependencies(phase.tasks);
    if (!validation.valid) {
        throw new Error(`Phase ${phase.id} has invalid dependencies: ${validation.errors.join("; ")}`);
    }
    let state = loadState(resolved.statePath) ?? initState(tasksJson);
    const logger = createTrajectoryLogger(resolved.trajectoryPath);
    const phasesCompleted = [];
    const phasesFailed = [];
    const baseProjectRoot = resolved.projectRoot ?? dirname(resolve(resolved.tasksJsonPath));
    let worktreeResult = null;
    if (resolved.isolation === "worktree") {
        worktreeResult = createWorktree({
            projectRoot: baseProjectRoot,
            specName: tasksJson.specRef,
        });
        if (!worktreeResult.success) {
            logger.close();
            throw new Error(`Failed to create worktree: ${worktreeResult.error ?? "unknown"}`);
        }
    }
    const projectRoot = deriveProjectRoot(resolved, worktreeResult);
    try {
        state = { ...state, currentPhase: phase.id };
        const phaseResult = await executePhase(resolved, phase, state, tasksJson, projectRoot, logger);
        const report = phaseResult.report;
        if (phaseResult.status === "complete") {
            phasesCompleted.push(phase.id);
            state = updateStateAfterPhase(state, report, tasksJson.phases);
            if (worktreeResult) {
                commitPhase(worktreeResult.worktreePath, phase.id);
                mergeWorktree({
                    projectRoot: baseProjectRoot,
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
        saveState(resolved.statePath, state);
    }
    finally {
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