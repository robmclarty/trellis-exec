import { copyFileSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { TasksJson, Phase, Task } from "../types/tasks.js";
import type { SharedState, PhaseReport, JudgeAssessment } from "../types/state.js";
import { JudgeAssessmentSchema } from "../types/state.js";
import type { TrajectoryLogger } from "../logging/trajectoryLogger.js";
import type { OrchestratorHandle } from "../orchestrator/agentLauncher.js";
import type { ReplSession } from "../orchestrator/replManager.js";
import type { ReplHelpers } from "../orchestrator/replHelpers.js";
import type { RunContext } from "../cli.js";
import {
  initState,
  loadState,
  saveState,
  updateStateAfterPhase,
} from "./stateManager.js";
import {
  validateDependencies,
  resolveExecutionOrder,
  detectTargetPathOverlaps,
} from "./scheduler.js";
import { createTrajectoryLogger } from "../logging/trajectoryLogger.js";
import {
  createWorktree,
  commitPhase,
  mergeWorktree,
  cleanupWorktree,
  getChangedFiles,
  getDiffContent,
} from "../isolation/worktreeManager.js";
import type { WorktreeResult, ChangedFile } from "../isolation/worktreeManager.js";
import { createCheckRunner } from "../verification/checkRunner.js";
import { createAgentLauncher } from "../orchestrator/agentLauncher.js";
import { createReplHelpers } from "../orchestrator/replHelpers.js";
import { createReplSession } from "../orchestrator/replManager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PhaseRunnerResult = {
  success: boolean;
  phasesCompleted: string[];
  phasesFailed: string[];
  finalState: SharedState;
};

type PhaseExecResult = {
  status: "complete" | "partial" | "failed";
  report: PhaseReport;
};

type TurnLoopResult = {
  reason: "complete" | "turn_limit" | "errors" | "dead";
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function deriveProjectRoot(
  baseProjectRoot: string,
  worktreeResult: WorktreeResult | null,
  isolation: "worktree" | "none",
): string {
  if (
    isolation === "worktree" &&
    worktreeResult &&
    worktreeResult.success
  ) {
    return worktreeResult.worktreePath;
  }
  return baseProjectRoot;
}

function getHandoffFromState(state: SharedState): string {
  const last = state.phaseReports.at(-1);
  return last?.handoff ?? "";
}

export function buildPhaseContext(
  phase: Phase,
  state: SharedState,
  handoff: string,
  ctx: RunContext,
): string {
  const lines: string[] = [];

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
    lines.push(
      `Dependencies: ${task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none"}`,
    );
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
  lines.push(
    `Completed phases: ${state.completedPhases.length > 0 ? state.completedPhases.join(", ") : "none"}`,
  );
  lines.push(`Modified files: ${state.modifiedFiles.length}`);
  lines.push(`Schema changes: ${state.schemaChanges.length}`);
  lines.push("");
  lines.push("## Spec Reference");
  lines.push(
    `The spec file is available at \`${basename(ctx.specPath)}\` in the project root. ` +
      `Use readFile('${basename(ctx.specPath)}') to read it.`,
  );
  lines.push("");
  lines.push("## Guidelines Reference");
  if (ctx.guidelinesPath) {
    lines.push(
      `The guidelines file is available at \`${basename(ctx.guidelinesPath)}\` in the project root. ` +
        `Use readFile('${basename(ctx.guidelinesPath)}') to read it.`,
    );
  } else {
    lines.push("none configured");
  }
  lines.push("");
  lines.push("## Check Command");
  lines.push(ctx.checkCommand ?? "none configured");
  lines.push("");
  lines.push("## REPL Protocol");
  lines.push(
    "IMPORTANT: You are communicating through a JavaScript REPL. " +
      "Every response you give will be eval'd as JavaScript. " +
      "Do NOT include any natural language, explanations, or markdown. " +
      "Output ONLY plain JavaScript code (no TypeScript, no `export`, no `module.exports`).",
  );
  lines.push(
    "Use `var` (not `const` or `let`) for variables you need to reference in later turns. " +
      "`var` declarations persist across eval calls; `const` and `let` do not.",
  );
  lines.push("");
  lines.push("Available REPL helper functions:");
  lines.push("- readFile(path) — read a file, returns string");
  lines.push("- listDir(path) — list directory contents");
  lines.push(
    "- searchFiles(pattern, glob?) — search file contents by regex, optionally filtered by glob. " +
      "If pattern contains * or **, it is treated as a glob file filter",
  );
  lines.push(
    "- await dispatchSubAgent({ type, taskId, instructions, filePaths, outputPaths }) — dispatch a sub-agent to create/modify files",
  );
  lines.push("- await runCheck() — run the project check command");
  lines.push("- getState() — get current shared state");
  lines.push(
    "- await writePhaseReport({ status, recommendedAction, ... }) — write the phase report (signals completion)",
  );
  lines.push(
    "- await llmQuery(prompt, options?) — quick LLM query for analysis",
  );

  return lines.join("\n");
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
    orchestratorAnalysis: `Phase terminated due to ${reason}. Manual intervention required.`,
    recommendedAction: "halt",
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
export function normalizeReport(
  raw: Record<string, unknown>,
  phaseId: string,
): PhaseReport {
  const validStatuses = new Set(["complete", "partial", "failed"]);
  const validActions = new Set(["advance", "retry", "halt"]);

  const status = validStatuses.has(raw.status as string)
    ? (raw.status as PhaseReport["status"])
    : "partial";

  const recommendedAction = validActions.has(raw.recommendedAction as string)
    ? (raw.recommendedAction as PhaseReport["recommendedAction"])
    : "advance";

  // Map taskOutcomes → tasksCompleted / tasksFailed when canonical fields absent
  let tasksCompleted = asStringArray(raw.tasksCompleted);
  let tasksFailed = asStringArray(raw.tasksFailed);

  if (
    tasksCompleted.length === 0 &&
    tasksFailed.length === 0 &&
    Array.isArray(raw.taskOutcomes)
  ) {
    for (const outcome of raw.taskOutcomes as Array<Record<string, unknown>>) {
      const id = typeof outcome.taskId === "string" ? outcome.taskId : "";
      if (!id) continue;
      if (outcome.status === "failed") {
        tasksFailed.push(id);
      } else {
        tasksCompleted.push(id);
      }
    }
  }

  // Map handoffBriefing → handoff when canonical field absent
  const handoff =
    typeof raw.handoff === "string"
      ? raw.handoff
      : typeof raw.handoffBriefing === "string"
        ? raw.handoffBriefing
        : "";

  return {
    phaseId,
    status,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    tasksCompleted,
    tasksFailed,
    orchestratorAnalysis:
      typeof raw.orchestratorAnalysis === "string"
        ? raw.orchestratorAnalysis
        : "",
    recommendedAction,
    correctiveTasks: asStringArray(raw.correctiveTasks),
    decisionsLog: asStringArray(raw.decisionsLog),
    handoff,
  };
}

/** Safely coerce a value to string[]. */
function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string");
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

export async function promptForContinuation(): Promise<
  "continue" | "retry" | "skip" | "quit"
> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolvePromise) => {
    rl.question(
      "\n[Enter] continue  [r] retry  [s] skip  [q] quit\n> ",
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
export function extractCode(response: string): string {
  // Match fenced code blocks: ```js, ```javascript, ```typescript, or plain ```
  const fencePattern = /```(?:js|javascript|typescript|ts)?\s*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(response)) !== null) {
    blocks.push(match[1]!.trim());
  }

  if (blocks.length > 0) {
    return blocks.join("\n\n");
  }

  const trimmed = response.trim();

  // Heuristic: detect natural language responses.
  // JS code typically starts with: const, let, var, await, function, //, (,
  // or an identifier followed by ( or =.
  // Natural language starts with: The, I, This, It, File, Task, etc.
  const jsStartPattern =
    /^(?:const |let |var |await |function |\/\/|\/\*|\(|[a-z_$][a-z0-9_$]*\s*[=(.])/i;
  if (!jsStartPattern.test(trimmed)) {
    return "";
  }

  // Additional check: if the first line is a sentence (contains spaces and
  // no operators), it's likely natural language
  const firstLine = trimmed.split("\n")[0]!;
  if (
    /^[A-Z][a-z]/.test(firstLine) &&
    firstLine.includes(" ") &&
    !/[=;{}[\]]/.test(firstLine)
  ) {
    return "";
  }

  return trimmed;
}

/**
 * Returns true if every non-empty line in the string is a comment
 * (single-line `//` or block `/* ... *​/`). An empty string returns true.
 */
export function isCommentOnly(code: string): boolean {
  const lines = code.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return true;

  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();

    if (inBlock) {
      const closeIdx = line.indexOf("*/");
      if (closeIdx === -1) {
        // still inside block comment
        continue;
      }
      // Check if there's code after the closing */
      const afterClose = line.slice(closeIdx + 2).trim();
      inBlock = false;
      if (afterClose.length > 0) {
        return false;
      }
      continue;
    }

    if (line.startsWith("//")) {
      continue;
    }

    if (line.startsWith("/*")) {
      const closeIdx = line.indexOf("*/", 2);
      if (closeIdx === -1) {
        inBlock = true;
      } else {
        // Check if there's code after the closing */ on the same line
        const afterClose = line.slice(closeIdx + 2).trim();
        if (afterClose.length > 0) {
          return false;
        }
      }
      continue;
    }

    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// REPL turn loop
// ---------------------------------------------------------------------------

async function replTurnLoop(
  orchestrator: OrchestratorHandle,
  repl: ReplSession,
  logger: TrajectoryLogger,
  phaseId: string,
  turnLimit: number,
  maxConsecutiveErrors: number,
  verbose: boolean,
  isCaptured: () => boolean,
): Promise<TurnLoopResult> {
  let previousOutput = "Begin phase execution.";

  for (let turnNumber = 1; turnNumber <= turnLimit; turnNumber++) {
    if (!orchestrator.isAlive()) {
      return { reason: "dead" };
    }

    if (turnNumber === 1) {
      console.log("Waiting for orchestrator first response (this may take a moment)…");
    }

    const rawResponse = await orchestrator.send(previousOutput);
    const code = extractCode(rawResponse);

    // Check if writePhaseReport was triggered by the orchestrator's response
    if (isCaptured()) {
      return { reason: "complete" };
    }

    // If extractCode returned empty (natural language response) or the
    // extracted code is nothing but comments, skip eval and send a
    // corrective nudge.
    if (!code || isCommentOnly(code)) {
      if (verbose) {
        const preview = rawResponse.length > 500
          ? rawResponse.slice(0, 500) + `… [${rawResponse.length} chars total]`
          : rawResponse;
        console.log(`[turn ${turnNumber}] skipped: response was natural language`);
        console.log(`[turn ${turnNumber}] raw response: ${preview}`);
      }
      previousOutput =
        "REPL: Your response was natural language (or comments only) and was skipped. " +
        "You MUST output ONLY JavaScript code. The functions runCheck() and " +
        "writePhaseReport() are real JavaScript functions available in this REPL. " +
        "Example of what you should output next:\n\n" +
        "await runCheck()\n\n" +
        "Or if checks pass, write the report:\n\n" +
        'await writePhaseReport({ status: "complete", recommendedAction: "advance", ' +
        'tasksCompleted: ["task-1", "task-2"], tasksFailed: [], ' +
        'summary: "All tasks done.", handoff: "Phase complete." })';
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
      console.log(
        `[turn ${turnNumber}] result: ${evalResult.output.slice(0, 200)}`,
      );
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
// Spec/guidelines file copy helpers
// ---------------------------------------------------------------------------

type CopiedFile = {
  destPath: string;
  copied: boolean;
};

function copySpecToProjectRoot(specPath: string, projectRoot: string): CopiedFile {
  const destPath = join(projectRoot, basename(specPath));
  const copied = resolve(specPath) !== resolve(destPath);
  if (copied) {
    copyFileSync(specPath, destPath);
  }
  return { destPath, copied };
}

function copyGuidelinesToProjectRoot(
  guidelinesPath: string | undefined,
  projectRoot: string,
): CopiedFile {
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

function cleanupCopiedFile(file: CopiedFile): void {
  if (file.copied) {
    try {
      unlinkSync(file.destPath);
    } catch {
      // Ignore — file may already be gone
    }
  }
}

// ---------------------------------------------------------------------------
// Judge loop
// ---------------------------------------------------------------------------

type JudgePhaseResult = {
  assessment: JudgeAssessment;
  correctionAttempts: number;
};

export function buildJudgePrompt(config: {
  changedFiles: ChangedFile[];
  diffContent: string;
  phase: Phase;
  orchestratorReport: PhaseReport;
}): string {
  const lines: string[] = [];

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
  lines.push(
    "Read `spec.md` and `guidelines.md` in the project root for full context.",
  );

  lines.push("");
  lines.push("## Orchestrator Self-Report (context only — not authoritative)");
  lines.push("");
  lines.push(`Status: ${config.orchestratorReport.status}`);
  lines.push(`Summary: ${config.orchestratorReport.summary}`);
  lines.push(
    `Tasks completed: ${config.orchestratorReport.tasksCompleted.join(", ") || "none"}`,
  );
  lines.push(
    `Tasks failed: ${config.orchestratorReport.tasksFailed.join(", ") || "none"}`,
  );

  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push(
    "Evaluate the changes against the spec and acceptance criteria. " +
      "Return a JSON assessment in this exact format:",
  );
  lines.push("");
  lines.push("```json");
  lines.push('{  "passed": true | false,  "issues": [...],  "suggestions": [...] }');
  lines.push("```");
  lines.push("");
  lines.push(
    "Set `passed` to false only for must-fix problems: spec violations, bugs, " +
      "missing requirements, incomplete tasks. Style suggestions alone do not cause failure.",
  );

  return lines.join("\n");
}

export function parseJudgeResult(output: string): JudgeAssessment {
  // Try to extract JSON from the output (may be in markdown fences)
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1]! : output;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    return JudgeAssessmentSchema.parse(parsed);
  } catch {
    // Try to find any JSON object in the output
    const objectMatch = output.match(/\{[\s\S]*"passed"[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        return JudgeAssessmentSchema.parse(parsed);
      } catch {
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
}

export function buildFixPrompt(issues: string[], phase: Phase): string {
  const lines: string[] = [];

  lines.push("# Fix Request");
  lines.push("");
  lines.push(
    "The judge found the following issues after reviewing this phase's work. " +
      "Fix each one. Do not refactor or restructure beyond what is needed.",
  );
  lines.push("");
  lines.push("## Issues to Fix");
  lines.push("");
  for (let i = 0; i < issues.length; i++) {
    lines.push(`${i + 1}. ${issues[i]}`);
  }

  lines.push("");
  lines.push("## Context");
  lines.push("");
  lines.push(`Phase: ${phase.name} (${phase.id})`);
  lines.push(
    "Read `spec.md` and `guidelines.md` in the project root for full spec context.",
  );

  lines.push("");
  lines.push("## Output");
  lines.push("");
  lines.push(
    "After fixing, print a brief summary of what you changed for each issue.",
  );

  return lines.join("\n");
}

async function judgePhase(config: {
  phase: Phase;
  report: PhaseReport;
  projectRoot: string;
  ctx: RunContext;
  logger: TrajectoryLogger;
  maxCorrections?: number;
}): Promise<JudgePhaseResult> {
  const maxCorrections = config.maxCorrections ?? 2;
  const { phase, report, projectRoot, ctx, logger } = config;

  let changedFiles = getChangedFiles(projectRoot);
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

  let assessment: JudgeAssessment = { passed: true, issues: [], suggestions: [] };

  for (let attempt = 0; attempt <= maxCorrections; attempt++) {
    const diffContent = getDiffContent(projectRoot);
    const prompt = buildJudgePrompt({
      changedFiles,
      diffContent,
      phase,
      orchestratorReport: report,
    });

    if (ctx.verbose) {
      console.log(
        `[judge] attempt ${attempt}, reviewing ${changedFiles.length} changed file(s)`,
      );
    }

    const startTime = Date.now();
    const result = await launcher.dispatchSubAgent({
      type: "judge",
      model: "opus",
      taskId: `${phase.id}-judge-${attempt}`,
      instructions: prompt,
      filePaths: changedFiles.map((f) => f.path),
      outputPaths: [],
    });
    const duration = Date.now() - startTime;

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

    // Judge found issues
    console.log(
      `Judge found ${assessment.issues.length} issue(s) in phase "${phase.id}":`,
    );
    for (const issue of assessment.issues) {
      console.log(`  - ${issue}`);
    }

    if (attempt >= maxCorrections) {
      break;
    }

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
        console.log(
          `[check] after fix: ${checkResult.passed ? "passed" : "failed"}`,
        );
      }
    }

    // Refresh changed files for next judge pass
    changedFiles = getChangedFiles(projectRoot);
  }

  return { assessment, correctionAttempts: maxCorrections };
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

  const launcher = createAgentLauncher({
    pluginRoot: ctx.pluginRoot,
    projectRoot,
    dryRun: ctx.dryRun,
  });

  const checkRunner = ctx.checkCommand
    ? createCheckRunner({ command: ctx.checkCommand, cwd: projectRoot })
    : null;

  let capturedReport: PhaseReport | null = null;

  const baseHelpers = createReplHelpers({
    projectRoot,
    statePath: ctx.statePath,
    agentLauncher: (c) => launcher.dispatchSubAgent(c),
  });

  const helpers: ReplHelpers = {
    ...baseHelpers,
    writePhaseReport: (report: PhaseReport) => {
      capturedReport = normalizeReport(report as unknown as Record<string, unknown>, phase.id);
    },
    runCheck: checkRunner
      ? () => checkRunner.run()
      : baseHelpers.runCheck,
    llmQuery: (prompt: string, options?: { model?: string }) =>
      launcher.llmQuery(prompt, options),
  };

  const repl = createReplSession({
    projectRoot,
    outputLimit: 8192,
    timeout: 30_000,
    helpers,
  });

  const phaseContext = buildPhaseContext(
    phase,
    state,
    handoff,
    ctx,
  );

  let orchestrator: OrchestratorHandle | null = null;

  try {
    const launchConfig = {
      agentFile: resolve(ctx.pluginRoot, "agents/phase-orchestrator.md"),
      skillsDir: resolve(ctx.pluginRoot, "skills"),
      phaseContext,
      ...(ctx.model !== undefined ? { model: ctx.model } : {}),
    };
    console.log("Launching orchestrator…");
    orchestrator = await launcher.launchOrchestrator(launchConfig);

    console.log("Orchestrator ready. Starting REPL turn loop…");
    const loopResult = await replTurnLoop(
      orchestrator,
      repl,
      logger,
      phase.id,
      ctx.turnLimit,
      ctx.maxConsecutiveErrors,
      ctx.verbose,
      () => capturedReport !== null,
    );

    const report =
      capturedReport ??
      buildPartialReport(phase.id, phase, loopResult.reason);

    return {
      status: report.status === "complete" ? "complete" : report.status,
      report,
    };
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "unexpected error";
    if (ctx.verbose) {
      console.error(`[executePhase] error:`, err);
    }
    const report =
      capturedReport ?? buildPartialReport(phase.id, phase, reason);
    return { status: "failed", report };
  } finally {
    repl.destroy();
    if (orchestrator) {
      orchestrator.kill();
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function runPhases(
  ctx: RunContext,
  tasksJson: TasksJson,
): Promise<PhaseRunnerResult> {
  console.log(`Starting phase runner with ${tasksJson.phases.length} phase(s)…`);

  // Validate dependencies for all phases upfront, allowing cross-phase refs
  const priorPhaseTaskIds = new Set<string>();
  for (const phase of tasksJson.phases) {
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

  let state = loadState(ctx.statePath) ?? initState(tasksJson);
  const logger = createTrajectoryLogger(ctx.trajectoryPath);
  const phasesCompleted: string[] = [];
  const phasesFailed: string[] = [];

  // Worktree setup
  let worktreeResult: WorktreeResult | null = null;
  if (ctx.isolation === "worktree") {
    console.log("Creating isolated worktree…");
    worktreeResult = createWorktree({
      projectRoot: ctx.projectRoot,
      specName: basename(ctx.specPath),
    });
    if (!worktreeResult.success) {
      logger.close();
      throw new Error(
        `Failed to create worktree: ${worktreeResult.error ?? "unknown"}`,
      );
    }
  }

  const projectRoot = deriveProjectRoot(ctx.projectRoot, worktreeResult, ctx.isolation);

  // Ensure the project root directory exists (worktree may not have been created yet).
  mkdirSync(projectRoot, { recursive: true });

  // Copy spec and guidelines into project root so the sandbox can read them.
  console.log("Copying spec and guidelines into project root…");
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
      const phase = tasksJson.phases[phaseIndex]!;

      // Skip completed phases (resume support)
      if (state.completedPhases.includes(phase.id)) {
        phasesCompleted.push(phase.id);
        phaseIndex++;
        continue;
      }

      state = { ...state, currentPhase: phase.id };

      const taskCount = phase.tasks.length;
      console.log(
        `\nStarting phase "${phase.id}" (${taskCount} task${taskCount === 1 ? "" : "s"})…`,
      );

      const phaseResult = await executePhase(
        ctx,
        phase,
        state,
        projectRoot,
        logger,
      );

      let report = phaseResult.report;

      // Judge loop: always runs unless phase outright failed
      if (phaseResult.status !== "failed") {
        console.log(`Judging phase "${phase.id}"…`);

        const judgeResult = await judgePhase({
          phase,
          report,
          projectRoot,
          ctx,
          logger,
        });

        report = { ...report, judgeAssessment: judgeResult.assessment };

        if (
          !judgeResult.assessment.passed &&
          report.recommendedAction === "advance"
        ) {
          console.log(
            `Judge found unresolved issues in phase "${phase.id}". Recommending retry.`,
          );
          report = {
            ...report,
            recommendedAction: "retry",
            correctiveTasks: [
              ...report.correctiveTasks,
              ...judgeResult.assessment.issues,
            ],
          };
        }
      }

      // Determine action: combine report recommendation with user input
      let action: "advance" | "retry" | "skip" | "halt" =
        report.recommendedAction === "advance" ? "advance" : "halt";

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
        } else if (userChoice === "skip") {
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
            const newTasks = report.correctiveTasks.map((desc, i) =>
              makeCorrectiveTask(phase.id, desc, i + retryCount * 100),
            );
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
    if (
      worktreeResult &&
      phasesFailed.length === 0 &&
      phasesCompleted.length > 0
    ) {
      const mergeResult = mergeWorktree({
        projectRoot: ctx.projectRoot,
        worktreePath: worktreeResult.worktreePath,
        branchName: worktreeResult.branchName,
      });
      if (!mergeResult.success) {
        console.error("Worktree merge failed:", mergeResult.error);
      }
    }
  } finally {
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

  let state = loadState(ctx.statePath) ?? initState(tasksJson);
  const logger = createTrajectoryLogger(ctx.trajectoryPath);
  const phasesCompleted: string[] = [];
  const phasesFailed: string[] = [];

  let worktreeResult: WorktreeResult | null = null;
  if (ctx.isolation === "worktree") {
    console.log("Creating isolated worktree…");
    worktreeResult = createWorktree({
      projectRoot: ctx.projectRoot,
      specName: basename(ctx.specPath),
    });
    if (!worktreeResult.success) {
      logger.close();
      throw new Error(
        `Failed to create worktree: ${worktreeResult.error ?? "unknown"}`,
      );
    }
  }

  const projectRoot = deriveProjectRoot(ctx.projectRoot, worktreeResult, ctx.isolation);

  // Ensure the project root directory exists (worktree may not have been created yet).
  mkdirSync(projectRoot, { recursive: true });

  // Copy spec and guidelines into project root so the sandbox can read them.
  console.log("Copying spec and guidelines into project root…");
  const specFile = copySpecToProjectRoot(ctx.specPath, projectRoot);
  const guidelinesFile = copyGuidelinesToProjectRoot(ctx.guidelinesPath, projectRoot);

  try {
    state = { ...state, currentPhase: phase.id };

    const phaseResult = await executePhase(
      ctx,
      phase,
      state,
      projectRoot,
      logger,
    );

    let report = phaseResult.report;

    // Judge loop: always runs unless phase outright failed
    if (phaseResult.status !== "failed") {
      console.log(`Judging phase "${phase.id}"…`);

      const judgeResult = await judgePhase({
        phase,
        report,
        projectRoot,
        ctx,
        logger,
      });

      report = { ...report, judgeAssessment: judgeResult.assessment };

      if (
        !judgeResult.assessment.passed &&
        report.recommendedAction === "advance"
      ) {
        console.log(
          `Judge found unresolved issues in phase "${phase.id}". Downgrading to partial.`,
        );
        report = {
          ...report,
          status: "partial",
          recommendedAction: "retry",
          correctiveTasks: [
            ...report.correctiveTasks,
            ...judgeResult.assessment.issues,
          ],
        };
      }
    }

    if (report.status === "complete" && report.recommendedAction === "advance") {
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
    } else {
      phasesFailed.push(phase.id);
      state = {
        ...state,
        phaseReports: [...state.phaseReports, report],
      };
    }

    saveState(ctx.statePath, state);
  } finally {
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
