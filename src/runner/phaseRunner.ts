import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync, realpathSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { TasksJson, Phase, Task } from "../types/tasks.js";
import type { SharedState, PhaseReport, CheckResult } from "../types/state.js";
import type { TrajectoryLogger } from "../logging/trajectoryLogger.js";
import type { RunContext } from "../types/runner.js";
import {
  initState,
  loadState,
  saveState,
  updateStateAfterPhase,
  applyReportToTasks,
  applyCorrections,
} from "./stateManager.js";
import {
  validateDependencies,
  resolveExecutionOrder,
  detectTargetPathOverlaps,
} from "./scheduler.js";
import { createTrajectoryLogger } from "../logging/trajectoryLogger.js";
import { startSpinner } from "../ui/spinner.js";
import { createStreamHandler, extractResultText, extractUsage } from "../ui/streamParser.js";
import type { UsageStats } from "../ui/streamParser.js";
import {
  getChangedFiles,
  getDiffContent,
  getCurrentSha,
  ensureInitialCommit,
  commitAll,
  getGitRoot,
} from "../git.js";
import { verifyCompletion } from "../verification/completionVerifier.js";
import type { BrowserAcceptanceReport } from "../types/state.js";
import { createAgentLauncher } from "../orchestrator/agentLauncher.js";
import {
  REPORT_FILENAME,
  buildPhaseContext,
  normalizeReport,
  buildReporterPrompt,
} from "./prompts.js";
import { judgePhase, applyJudgeOutcome } from "./judgeRunner.js";
import { runBrowserSmokeForPhase, runEndOfBuildAcceptance } from "./browserRunner.js";
import { hasNewTestFiles, detectTestCommand } from "./testDetector.js";

/**
 * Warn if projectRoot looks misconfigured (e.g. points inside .specs/).
 * This is advisory — it doesn't block execution, but surfaces the problem
 * early instead of waiting for the completion verifier to fail.
 */
function warnIfProjectRootSuspect(projectRoot: string): void {
  const resolved = resolve(projectRoot);
  if (/[/\\]\.specs([/\\]|$)/.test(resolved)) {
    console.warn(
      `⚠ Warning: projectRoot resolves inside .specs/ (${resolved}). ` +
      `This is likely a misconfiguration — target path checks will fail. ` +
      `Set "projectRoot" in tasks.json to a relative path from the tasks.json directory to the actual project root (e.g. "../..").`,
    );
  }
  const gitRoot = getGitRoot(resolved);
  try {
    if (gitRoot && realpathSync(gitRoot) !== realpathSync(resolved)) {
      console.warn(
        `⚠ Warning: projectRoot (${resolved}) differs from git root (${gitRoot}). ` +
        `Files committed by the orchestrator may not be found by the completion verifier.`,
      );
    }
  } catch {
    // realpathSync can fail on broken symlinks — skip the warning
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PhaseRunnerResult = {
  success: boolean;
  phasesCompleted: string[];
  phasesFailed: string[];
  finalState: SharedState;
  phaseDurations: Record<string, number>;
  totalDuration: number;
  browserAcceptanceReport?: BrowserAcceptanceReport;
  phaseTokens: Record<string, UsageStats>;
};

type PhaseExecResult = {
  status: "complete" | "partial" | "failed";
  report: PhaseReport;
  usage?: UsageStats | undefined;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function getHandoffFromState(state: SharedState): string {
  const last = state.phaseReports.at(-1);
  return last?.handoff ?? "";
}

function buildPartialReport(
  phaseId: string,
  phase: Phase,
  reason: string,
): PhaseReport {
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
    corrections: [],
    handoff: "",
  };
}

/**
 * Lightweight pre-phase contract review. Checks acceptance criteria for
 * common issues without invoking an LLM. Returns warnings (advisory only).
 */
export function reviewPhaseContract(phase: Phase): string[] {
  const warnings: string[] = [];

  for (const task of phase.tasks) {
    // Corrective tasks are auto-generated with empty criteria/paths — skip them
    if (task.id.includes("-corrective-")) continue;

    // Flag tasks with no acceptance criteria
    if (task.acceptanceCriteria.length === 0) {
      warnings.push(`[${task.id}] has no acceptance criteria`);
    }

    // Flag vague criteria (too short to be testable)
    for (const criterion of task.acceptanceCriteria) {
      if (criterion.length < 10) {
        warnings.push(
          `[${task.id}] vague criterion: "${criterion}"`,
        );
      }
    }

    // Flag tasks with no target paths
    if (task.targetPaths.length === 0) {
      warnings.push(`[${task.id}] has no target paths`);
    }
  }

  return warnings;
}

function makeCorrectiveTask(
  phaseId: string,
  description: string,
  index: number,
): Task {
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

export function dryRunReport(tasksJson: TasksJson, ctx: RunContext): string {
  const lines: string[] = [];
  lines.push(`Spec: ${basename(ctx.specPath)}`);
  lines.push(`Plan: ${basename(ctx.planPath)}`);
  lines.push(`Project root: ${ctx.projectRoot}`);
  lines.push(`Phases: ${tasksJson.phases.length}`);
  lines.push("");

  const priorIds = new Set<string>();
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
          lines.push(
            `    - ${task.id}: ${task.title} (${task.subAgentType})`,
          );
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

export async function promptForContinuation(options?: {
  phaseId?: string;
  retryCount?: number;
  maxRetries?: number;
  recommendedAction?: "advance" | "retry" | "halt";
  reason?: string;
}): Promise<"continue" | "retry" | "skip" | "quit"> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const lines: string[] = [];

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
    rl.question(
      `\n${lines.join("\n")}\n> `,
      (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === "r" || trimmed === "retry") resolvePromise("retry");
        else if (trimmed === "s" || trimmed === "skip")
          resolvePromise("skip");
        else if (trimmed === "q" || trimmed === "quit")
          resolvePromise("quit");
        else resolvePromise("continue");
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Default file-existence check (used when no --check command is provided)
// ---------------------------------------------------------------------------

export function createDefaultCheck(
  projectRoot: string,
  phase: Phase,
): { run: () => Promise<CheckResult> } {
  const allTargetPaths = phase.tasks.flatMap((t) => t.targetPaths);
  return {
    run: async (): Promise<CheckResult> => {
      if (allTargetPaths.length === 0) {
        return { passed: true, output: "No target paths to check", exitCode: 0 };
      }
      const missing: string[] = [];
      for (const p of allTargetPaths) {
        const fullPath = resolve(projectRoot, p);
        try {
          statSync(fullPath);
        } catch {
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

/**
 * Reads, parses, normalizes, and validates a `.trellis-phase-report.json` file.
 * Returns a PhaseExecResult or null if the file is missing or unparseable.
 * Cleans up the report file after reading.
 */
function parseReportFile(
  reportPath: string,
  phase: Phase,
  startSha: string,
): PhaseExecResult | null {
  if (!existsSync(reportPath)) return null;

  let rawReport: Record<string, unknown>;
  try {
    rawReport = JSON.parse(readFileSync(reportPath, "utf-8"));
  } catch {
    return null;
  }

  const report = normalizeReport(rawReport, phase.id);
  try { unlinkSync(reportPath); } catch { /* ignore */ }

  // Validate all task IDs are accounted for
  const allTaskIds = phase.tasks.map((t) => t.id);
  const accountedFor = new Set([...report.tasksCompleted, ...report.tasksFailed]);
  const missing = allTaskIds.filter((id) => !accountedFor.has(id));

  if (missing.length > 0) {
    console.log(
      `Report missing ${missing.length} task(s): ${missing.join(", ")}. Marking as partial.`,
    );
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

// ---------------------------------------------------------------------------
// Single phase execution
// ---------------------------------------------------------------------------

async function executePhase(
  ctx: RunContext,
  phase: Phase,
  state: SharedState,
  projectRoot: string,
  logger: TrajectoryLogger,
): Promise<PhaseExecResult> {
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
  } catch {
    // Ignore — file may not exist
  }

  const agentFile = resolve(ctx.pluginRoot, "agents/phase-orchestrator.md");

  const spinnerMessages = [
    "Orchestrating…",
    "Noodling…",
    "Tinkering…",
    "Pondering…",
    "Cooking…",
    "Mulling…",
    "Conjuring…",
    "Brewing…",
    "Weaving…",
    "Scheming…",
  ];
  const spinnerLabel =
    spinnerMessages[Math.floor(Math.random() * spinnerMessages.length)];

  console.log("Starting phase orchestrator…");
  const spinner = startSpinner(spinnerLabel);

  try {
    const startTime = Date.now();

    const orchestratorOptions = {
      ...(ctx.verbose
        ? {
            verbose: true,
            onStdout: createStreamHandler((event) => {
              if (event.type === "text" && event.text.length > 0) {
                spinner.pause();
                process.stdout.write(event.text);
                if (!event.text.endsWith("\n")) process.stdout.write("\n");
                spinner.resume();
              }
            }),
          }
        : {}),
      ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}),
    };
    const result = await launcher.runPhaseOrchestrator(
      phaseContext,
      agentFile,
      ctx.model,
      Object.keys(orchestratorOptions).length > 0 ? orchestratorOptions : undefined,
    );
    const duration = Date.now() - startTime;
    spinner.stop();

    // stdout is NDJSON — extract the result text and usage
    const outputText = extractResultText(result.stdout) || result.stdout;
    const orchestratorUsage = extractUsage(result.stdout);

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

    // Read and parse the report file
    const parsed = parseReportFile(reportPath, phase, startSha);
    if (!parsed) {
      const reason = result.exitCode !== 0
        ? `orchestrator exited with code ${result.exitCode}`
        : "orchestrator did not write report file or it contained invalid JSON";
      console.log(`Warning: ${reason}`);
      return {
        status: "failed",
        report: { ...buildPartialReport(phase.id, phase, reason), startSha },
        usage: orchestratorUsage,
      };
    }

    return { ...parsed, usage: orchestratorUsage };
  } catch (err) {
    spinner.stop();
    const reason =
      err instanceof Error ? err.message : "unexpected error";
    if (ctx.verbose) {
      console.error(`[executePhase] error:`, err);
    }

    // Reporter fallback: if orchestrator timed out but committed work,
    // dispatch a lightweight reporter agent to generate the report
    const isTimeout = reason.includes("timed out");
    const changedFiles = getChangedFiles(projectRoot, startSha);

    if (isTimeout && changedFiles.length > 0 && !existsSync(reportPath)) {
      console.log("Orchestrator timed out with committed work. Dispatching reporter…");
      try {
        const diffContent = getDiffContent(projectRoot, startSha);
        const reporterPrompt = buildReporterPrompt(phase, changedFiles, diffContent);
        await launcher.dispatchSubAgent({
          type: "reporter",
          taskId: `${phase.id}-reporter`,
          instructions: reporterPrompt,
          filePaths: changedFiles.map((f) => f.path),
          outputPaths: [".trellis-phase-report.json"],
        });

        // If reporter wrote the report, parse it normally
        const parsed = parseReportFile(reportPath, phase, startSha);
        if (parsed) return parsed;
      } catch {
        // Reporter failed — fall through to partial report
      }
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
export function extractScopes(phase: Phase, report: PhaseReport): string[] {
  const scopes = new Set<string>();
  for (const taskId of report.tasksCompleted) {
    const task = phase.tasks.find((t) => t.id === taskId);
    if (!task) continue;
    for (const targetPath of task.targetPaths) {
      const parts = targetPath.split("/").filter(Boolean);
      // Skip generic top-level dirs like "src", "lib", "app" to find meaningful scope
      const skipDirs = new Set(["src", "lib", "app", "packages", "public", "static", "assets"]);
      const scope = parts.find((p) => !skipDirs.has(p) && !p.includes("."));
      if (scope) scopes.add(scope);
    }
  }
  return [...scopes];
}

/**
 * Commits any remaining uncommitted changes as a phase-level summary commit.
 * Returns the new SHA, or null if nothing to commit.
 */
export function makePhaseCommit(
  projectRoot: string,
  phase: Phase,
  report: PhaseReport,
): string | null {
  const changedFiles = getChangedFiles(projectRoot);
  if (changedFiles.length === 0) return null;

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
// Post-execution pipeline (shared by runPhases and runSinglePhase)
// ---------------------------------------------------------------------------

type PhasePipelineConfig = {
  phase: Phase;
  phaseExecStatus: "complete" | "partial" | "failed";
  report: PhaseReport;
  state: SharedState;
  tasksJson: TasksJson;
  localCtx: RunContext;
  projectRoot: string;
  logger: TrajectoryLogger;
};

type PhasePipelineResult = {
  report: PhaseReport;
  tasksJson: TasksJson;
};

/**
 * Shared post-execution pipeline: browser smoke → orchestrator corrections →
 * judge loop → completion verification → test detection.
 *
 * Both `runPhases` and `runSinglePhase` delegate here after `executePhase`
 * returns, ensuring corrections, judging, and verification stay in sync.
 */
async function runPostExecutionPipeline(
  config: PhasePipelineConfig,
): Promise<PhasePipelineResult> {
  const { phase, phaseExecStatus, state, localCtx, projectRoot, logger } = config;
  let { report, tasksJson } = config;

  // Browser smoke check (Tier 1) — before judge
  if (phase.requiresBrowserTest && report.status !== "failed") {
    const smokeReport = await runBrowserSmokeForPhase(localCtx, phase, projectRoot);
    if (smokeReport) {
      report = { ...report, browserSmokeReport: smokeReport };
    }
  }

  // Apply orchestrator-reported corrections before judge
  const orchCorrections = report.corrections ?? [];
  if (orchCorrections.length > 0) {
    const { tasksJson: corrected, decisions } = applyCorrections(
      tasksJson, orchCorrections,
    );
    tasksJson = corrected;
    report = {
      ...report,
      decisionsLog: [...report.decisionsLog, ...decisions],
    };
    writeFileSync(localCtx.tasksJsonPath, JSON.stringify(tasksJson, null, 2), "utf-8");
    if (localCtx.verbose) {
      console.log(`Applied ${orchCorrections.length} orchestrator correction(s) to tasks.json`);
    }
  }

  // Judge loop: runs based on judgeMode setting
  const hasChanges = getChangedFiles(projectRoot, report.startSha).length > 0;
  const shouldJudge =
    localCtx.judgeMode !== "never" &&
    (localCtx.judgeMode === "always" ||
      (localCtx.judgeMode === "on-failure" && phaseExecStatus !== "complete"));
  if (shouldJudge && (phaseExecStatus !== "failed" || hasChanges)) {
    console.log(`Judging phase "${phase.id}"…`);

    const judgeResult = await judgePhase({
      phase,
      report,
      state,
      projectRoot,
      ctx: localCtx,
      logger,
      ...(report.startSha ? { startSha: report.startSha } : {}),
    });

    const judgeOutcome = applyJudgeOutcome({
      judgeResult,
      report,
      tasksJson,
      phaseId: phase.id,
      phaseExecStatus,
      tasksJsonPath: localCtx.tasksJsonPath,
      verbose: localCtx.verbose,
    });
    report = judgeOutcome.report;
    tasksJson = judgeOutcome.tasksJson;
  }

  // Completion verification — runs after judge so corrected targetPaths are used
  const correctedPhase = tasksJson.phases.find((p) => p.id === phase.id) ?? phase;
  if (report.status === "complete" || report.status === "partial") {
    const verification = verifyCompletion(
      projectRoot, correctedPhase, report, report.startSha,
    );
    if (!verification.passed) {
      console.log(`Completion verification failed for "${phase.id}":`);
      for (const f of verification.failures) console.log(`  - ${f}`);
      report = {
        ...report,
        status: "partial",
        recommendedAction: "retry",
        correctiveTasks: [...report.correctiveTasks, ...verification.failures],
      };
    } else {
      console.log(`Completion verification passed for "${phase.id}".`);
    }
  }

  // Auto-detect test suites if no --check was provided
  if (!localCtx.checkCommand && hasNewTestFiles(projectRoot, report.startSha)) {
    const detected = detectTestCommand(projectRoot);
    if (detected) {
      console.log(`Detected new test files. Setting check command: ${detected}`);
      localCtx.checkCommand = detected;
    }
  }

  return { report, tasksJson };
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function runPhases(
  ctx: RunContext,
  tasksJson: TasksJson,
): Promise<PhaseRunnerResult> {
  // Deep-clone to avoid mutating the caller's object (e.g. corrective task appends)
  let mutableTasksJson = structuredClone(tasksJson);

  console.log(`Starting phase runner with ${mutableTasksJson.phases.length} phase(s)…`);

  // Validate dependencies for all phases upfront, allowing cross-phase refs
  const priorPhaseTaskIds = new Set<string>();
  for (const phase of mutableTasksJson.phases) {
    const validation = validateDependencies(phase.tasks, priorPhaseTaskIds);
    if (!validation.valid) {
      throw new Error(
        `Phase ${phase.id} has invalid dependencies: ${validation.errors.join("; ")}`,
      );
    }
    for (const task of phase.tasks) {
      priorPhaseTaskIds.add(task.id);
    }
  }

  const runStartTime = Date.now();
  let state = loadState(ctx.statePath) ?? initState(mutableTasksJson);
  const logger = createTrajectoryLogger(ctx.trajectoryPath);
  const phasesCompleted: string[] = [];
  const phasesFailed: string[] = [];
  const phaseDurations: Record<string, number> = {};
  const phaseTokens: Record<string, UsageStats> = {};

  const projectRoot = ctx.projectRoot;
  warnIfProjectRootSuspect(projectRoot);

  // Handle dry run early
  if (ctx.dryRun) {
    const report = dryRunReport(mutableTasksJson, ctx);
    console.log(report);
    logger.close();
    return {
      success: true,
      phasesCompleted: [],
      phasesFailed: [],
      finalState: state,
      phaseDurations: {},
      totalDuration: 0,
      phaseTokens: {},
    };
  }

  // Shallow-copy ctx so auto-detected checkCommand doesn't mutate the caller's object
  const localCtx = { ...ctx };

  try {
    let phaseIndex = 0;
    while (phaseIndex < mutableTasksJson.phases.length) {
      const phase = mutableTasksJson.phases[phaseIndex]!;

      // Skip completed phases (resume support)
      if (state.completedPhases.includes(phase.id)) {
        phasesCompleted.push(phase.id);
        phaseIndex++;
        continue;
      }

      state = { ...state, currentPhase: phase.id };
      const phaseStartTime = Date.now();

      const taskCount = phase.tasks.length;
      console.log(
        `\nStarting phase "${phase.id}" (${taskCount} task${taskCount === 1 ? "" : "s"})…`,
      );

      // Pre-phase contract review (advisory only)
      if (localCtx.judgeMode !== "never") {
        const warnings = reviewPhaseContract(phase);
        if (warnings.length > 0) {
          console.log(`Contract review warnings for "${phase.id}":`);
          for (const w of warnings) console.log(`  - ${w}`);
        }
      }

      const phaseResult = await executePhase(
        localCtx,
        phase,
        state,
        projectRoot,
        logger,
      );

      // Accumulate token usage
      if (phaseResult.usage) {
        const prev = phaseTokens[phase.id];
        phaseTokens[phase.id] = prev
          ? {
              inputTokens: prev.inputTokens + phaseResult.usage.inputTokens,
              outputTokens: prev.outputTokens + phaseResult.usage.outputTokens,
              costUsd: prev.costUsd + phaseResult.usage.costUsd,
            }
          : { ...phaseResult.usage };
      }

      let report = phaseResult.report;

      saveState(localCtx.statePath, state);

      const pipeline = await runPostExecutionPipeline({
        phase,
        phaseExecStatus: phaseResult.status,
        report,
        state,
        tasksJson: mutableTasksJson,
        localCtx,
        projectRoot,
        logger,
      });
      report = pipeline.report;
      mutableTasksJson = pipeline.tasksJson;

      // Determine action: combine report recommendation with user input
      let action: "advance" | "retry" | "skip" | "halt" =
        report.recommendedAction === "advance"
          ? "advance"
          : report.recommendedAction === "retry"
            ? "retry"
            : "halt";

      if (!localCtx.headless) {
        const retryCount = state.phaseRetries[phase.id] ?? 0;
        const userChoice = await promptForContinuation({
          phaseId: phase.id,
          retryCount,
          maxRetries: localCtx.maxRetries,
          recommendedAction: report.recommendedAction,
          reason: report.summary,
        });
        if (userChoice === "quit") {
          // Save report to state before exiting
          phaseDurations[phase.id] = (phaseDurations[phase.id] ?? 0) + (Date.now() - phaseStartTime);
          state = {
            ...state,
            phaseReports: [...state.phaseReports, report],
          };
          phasesFailed.push(phase.id);
          saveState(localCtx.statePath, state);
          break;
        }
        if (userChoice === "retry") {
          action = "retry";
        } else if (userChoice === "skip") {
          action = "skip";
        }
        // "continue" defers to report's recommendation
      }

      // In headless mode, follow the report's recommendation
      if (localCtx.headless && report.recommendedAction === "retry") {
        action = "retry";
      }

      if (action === "retry") {
        const retryCount = state.phaseRetries[phase.id] ?? 0;
        if (retryCount < localCtx.maxRetries) {
          state = {
            ...state,
            phaseReports: [...state.phaseReports, report],
            phaseRetries: {
              ...state.phaseRetries,
              [phase.id]: retryCount + 1,
            },
          };
          // Append corrective tasks (immutable update)
          if (report.correctiveTasks.length > 0) {
            const newTasks = report.correctiveTasks.map((desc, i) =>
              makeCorrectiveTask(phase.id, desc, i + retryCount * 100),
            );
            mutableTasksJson = {
              ...mutableTasksJson,
              phases: mutableTasksJson.phases.map((p, i) =>
                i === phaseIndex ? { ...phase, tasks: [...phase.tasks, ...newTasks] } : p,
              ),
            };
          }
          saveState(localCtx.statePath, state);
          // Don't increment phaseIndex — re-enter same phase
          phaseDurations[phase.id] = (phaseDurations[phase.id] ?? 0) + (Date.now() - phaseStartTime);
          continue;
        }
        // Max retries exceeded — halt
        phaseDurations[phase.id] = (phaseDurations[phase.id] ?? 0) + (Date.now() - phaseStartTime);
        console.log(
          `Max retries (${localCtx.maxRetries}) exceeded for phase "${phase.id}". Halting.`,
        );
        phasesFailed.push(phase.id);
        state = {
          ...state,
          phaseReports: [...state.phaseReports, report],
        };
        saveState(localCtx.statePath, state);
        break;
      }

      if (action === "skip") {
        phaseDurations[phase.id] = (phaseDurations[phase.id] ?? 0) + (Date.now() - phaseStartTime);
        phasesCompleted.push(phase.id);
        state = {
          ...state,
          completedPhases: [...state.completedPhases, phase.id],
          phaseReports: [...state.phaseReports, report],
        };
        saveState(localCtx.statePath, state);
        phaseIndex++;
        continue;
      }

      if (action === "halt") {
        phaseDurations[phase.id] = (phaseDurations[phase.id] ?? 0) + (Date.now() - phaseStartTime);
        phasesFailed.push(phase.id);
        state = {
          ...state,
          phaseReports: [...state.phaseReports, report],
        };
        saveState(localCtx.statePath, state);
        break;
      }

      // action === "advance"
      phaseDurations[phase.id] = (phaseDurations[phase.id] ?? 0) + (Date.now() - phaseStartTime);
      // Commit any remaining uncommitted changes as a phase-level commit
      makePhaseCommit(projectRoot, phase, report);
      report = { ...report, endSha: getCurrentSha(projectRoot) ?? report.startSha };

      phasesCompleted.push(phase.id);
      state = updateStateAfterPhase(state, report, mutableTasksJson.phases);
      saveState(localCtx.statePath, state);

      // Sync task statuses back to tasks.json
      mutableTasksJson = applyReportToTasks(mutableTasksJson, phase.id, report);
      writeFileSync(localCtx.tasksJsonPath, JSON.stringify(mutableTasksJson, null, 2), "utf-8");

      phaseIndex++;
    }
  } finally {
    logger.close();
  }

  // Tier 2: End-of-build browser acceptance tests (runs once after all phases pass)
  let browserAcceptanceReport: BrowserAcceptanceReport | undefined;
  if (phasesFailed.length === 0) {
    browserAcceptanceReport = await runEndOfBuildAcceptance(
      localCtx, mutableTasksJson, projectRoot,
    ) ?? undefined;
  }

  return {
    success: phasesFailed.length === 0,
    phasesCompleted,
    phasesFailed,
    finalState: state,
    phaseDurations,
    totalDuration: Date.now() - runStartTime,
    phaseTokens,
    ...(browserAcceptanceReport ? { browserAcceptanceReport } : {}),
  };
}

// ---------------------------------------------------------------------------
// Single phase runner
// ---------------------------------------------------------------------------

export async function runSinglePhase(
  ctx: RunContext,
  tasksJson: TasksJson,
  phaseId: string,
): Promise<PhaseRunnerResult> {
  const phase = tasksJson.phases.find((p) => p.id === phaseId);
  if (!phase) {
    throw new Error(`Phase not found: ${phaseId}`);
  }

  const taskCount = phase.tasks.length;
  console.log(
    `Starting single phase "${phaseId}" (${taskCount} task${taskCount === 1 ? "" : "s"})…`,
  );

  // Collect task IDs from all phases prior to the target phase
  const priorPhaseTaskIds = new Set<string>();
  for (const p of tasksJson.phases) {
    if (p.id === phaseId) break;
    for (const t of p.tasks) {
      priorPhaseTaskIds.add(t.id);
    }
  }

  const validation = validateDependencies(phase.tasks, priorPhaseTaskIds);
  if (!validation.valid) {
    throw new Error(
      `Phase ${phase.id} has invalid dependencies: ${validation.errors.join("; ")}`,
    );
  }

  // Shallow-copy ctx so auto-detected checkCommand doesn't mutate the caller's object
  const localCtx = { ...ctx };

  const runStartTime = Date.now();
  let state = loadState(localCtx.statePath) ?? initState(tasksJson);
  const logger = createTrajectoryLogger(localCtx.trajectoryPath);
  const phasesCompleted: string[] = [];
  const phasesFailed: string[] = [];

  const projectRoot = localCtx.projectRoot;
  warnIfProjectRootSuspect(projectRoot);

  let phaseUsage: UsageStats | undefined;

  try {
    state = { ...state, currentPhase: phase.id };

    // Pre-phase contract review (advisory only)
    if (localCtx.judgeMode !== "never") {
      const warnings = reviewPhaseContract(phase);
      if (warnings.length > 0) {
        console.log(`Contract review warnings for "${phase.id}":`);
        for (const w of warnings) console.log(`  - ${w}`);
      }
    }

    const phaseResult = await executePhase(
      localCtx,
      phase,
      state,
      projectRoot,
      logger,
    );

    phaseUsage = phaseResult.usage;
    let report = phaseResult.report;

    const pipeline = await runPostExecutionPipeline({
      phase,
      phaseExecStatus: phaseResult.status,
      report,
      state,
      tasksJson,
      localCtx,
      projectRoot,
      logger,
    });
    report = pipeline.report;
    const correctedTasksJson = pipeline.tasksJson;

    if (report.status === "complete" && report.recommendedAction === "advance") {
      makePhaseCommit(projectRoot, phase, report);
      report = { ...report, endSha: getCurrentSha(projectRoot) ?? report.startSha };

      phasesCompleted.push(phase.id);
      state = updateStateAfterPhase(state, report, correctedTasksJson.phases);

      // Sync task statuses back to tasks.json
      const updatedTasks = applyReportToTasks(correctedTasksJson, phase.id, report);
      writeFileSync(localCtx.tasksJsonPath, JSON.stringify(updatedTasks, null, 2), "utf-8");
    } else {
      phasesFailed.push(phase.id);
      state = {
        ...state,
        phaseReports: [...state.phaseReports, report],
      };
    }

    saveState(localCtx.statePath, state);
  } finally {
    logger.close();
  }

  const totalDuration = Date.now() - runStartTime;
  return {
    success: phasesFailed.length === 0,
    phasesCompleted,
    phasesFailed,
    finalState: state,
    phaseDurations: { [phaseId]: totalDuration },
    totalDuration,
    phaseTokens: phaseUsage ? { [phaseId]: phaseUsage } : {},
  };
}

