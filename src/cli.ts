#!/usr/bin/env node

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { TasksJsonSchema } from "./types/tasks.js";
import type { TasksJson } from "./types/tasks.js";
import { loadState } from "./runner/stateManager.js";
import { parsePlan } from "./compile/planParser.js";
import { getGitRoot } from "./git.js";
import { compilePlan } from "./compile/compilePlan.js";
import { execClaude, COMPILE_TIMEOUT, LONG_RUN_TIMEOUT } from "./orchestrator/agentLauncher.js";
import {
  runPhases,
  runSinglePhase,
  dryRunReport,
} from "./runner/phaseRunner.js";
import { startSpinner } from "./ui/spinner.js";
import { formatSummaryReport } from "./ui/summaryReport.js";

import type { RunContext } from "./types/runner.js";
export type { RunContext } from "./types/runner.js";

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP = `Usage: trellis-exec <command> [options]

Commands:
  run <tasks.json>       Execute phases from a tasks.json file
  compile <plan.md>      Compile a plan.md into tasks.json
  status <tasks.json>    Show execution status

Run options:
  --phase <id>           Run a specific phase only
  --dry-run              Print execution plan without running
  --resume               Resume from last incomplete task
  --check <command>      Override check command
  --concurrency <n>      Max parallel sub-agents (default: 3)
  --model <model>        Override orchestrator model
  --max-retries <n>      Max phase retries (default: 2)
  --project-root <path>  Override project root from tasks.json
  --spec <path>          Override spec path from tasks.json
  --plan <path>          Override plan path from tasks.json
  --guidelines <path>    Override guidelines path from tasks.json
  --judge <mode>         Judge mode: always|on-failure|never (default: always)
  --judge-model <model>  Override judge model (default: adaptive)
  --headless             Disable interactive prompts
  --long-run             Set 2-hour timeout for complex phases
  --verbose              Print debug output
  --dev-server <cmd>     Dev server start command for browser testing
  --save-e2e-tests       Save generated acceptance tests to project
  --browser-test-retries <n>  Max retries for browser acceptance (default: 3)

Compile options:
  --spec <spec.md>       Path to the spec (required)
  --guidelines <path>    Path to project guidelines (optional)
  --project-root <path>  Project root relative to output (default: ".")
  --output <path>        Output path (default: ./tasks.json)
  --enrich               Run LLM enrichment to fill ambiguous fields

Environment variables:
  TRELLIS_EXEC_MODEL                Override orchestrator model
  TRELLIS_EXEC_MAX_RETRIES          Max phase retries
  TRELLIS_EXEC_CONCURRENCY          Max parallel sub-agents
  TRELLIS_EXEC_JUDGE_MODE           Judge mode (always|on-failure|never)
  TRELLIS_EXEC_JUDGE_MODEL          Override judge model
  TRELLIS_EXEC_LONG_RUN             Enable long-run mode (2-hour timeout)
  TRELLIS_EXEC_DEV_SERVER           Dev server start command
  TRELLIS_EXEC_BROWSER_TEST_RETRIES Max browser acceptance retries
`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function loadAndValidateTasksJson(tasksJsonPath: string): TasksJson {
  const raw = readFileSync(resolve(tasksJsonPath), "utf-8");
  try {
    return TasksJsonSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new Error(
      `Invalid tasks.json at ${tasksJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Run context builder
// ---------------------------------------------------------------------------

export function buildRunContext(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): { context: RunContext; tasksJson: TasksJson; phaseId?: string } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      phase: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      check: { type: "string" },
      concurrency: { type: "string" },
      model: { type: "string" },
      "max-retries": { type: "string" },
      "project-root": { type: "string" },
      spec: { type: "string" },
      plan: { type: "string" },
      guidelines: { type: "string" },
      judge: { type: "string" },
      "judge-model": { type: "string" },
      timeout: { type: "string" },
      headless: { type: "boolean", default: false },
      "long-run": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "dev-server": { type: "string" },
      "save-e2e-tests": { type: "boolean", default: false },
      "browser-test-retries": { type: "string" },
    },
    allowPositionals: true,
  });

  const tasksJsonPathRaw = positionals[0];
  if (!tasksJsonPathRaw) {
    console.error("Error: <tasks.json> path is required for 'run' command.");
    process.exit(1);
  }

  const tasksJsonPath = resolve(tasksJsonPathRaw);
  const tasksDir = dirname(tasksJsonPath);

  // Load and validate tasks.json for both phase data and ref fields
  const tasksJson = loadAndValidateTasksJson(tasksJsonPath);

  // Merge: CLI flag > tasks.json field (all resolved to absolute paths)
  const projectRoot = values["project-root"]
    ? resolve(values["project-root"])
    : resolve(tasksDir, tasksJson.projectRoot);

  const specPath = values.spec
    ? resolve(values.spec)
    : resolve(tasksDir, tasksJson.specRef);

  const planPath = values.plan
    ? resolve(values.plan)
    : resolve(tasksDir, tasksJson.planRef);

  const guidelinesPath = values.guidelines
    ? resolve(values.guidelines)
    : tasksJson.guidelinesRef
      ? resolve(tasksDir, tasksJson.guidelinesRef)
      : undefined;

  // State files always live alongside tasks.json
  const statePath = resolve(tasksDir, "state.json");
  const trajectoryPath = resolve(tasksDir, "trajectory.jsonl");

  // Execution settings
  const concurrency =
    (values.concurrency !== undefined ? Number(values.concurrency) : undefined) ??
    (env.TRELLIS_EXEC_CONCURRENCY !== undefined ? Number(env.TRELLIS_EXEC_CONCURRENCY) : undefined) ??
    3;

  const maxRetries =
    (values["max-retries"] !== undefined ? Number(values["max-retries"]) : undefined) ??
    (env.TRELLIS_EXEC_MAX_RETRIES !== undefined ? Number(env.TRELLIS_EXEC_MAX_RETRIES) : undefined) ??
    2;

  const model =
    values.model ??
    env.TRELLIS_EXEC_MODEL ??
    undefined;

  const validJudgeModes = ["always", "on-failure", "never"] as const;
  const judgeModeRaw = values.judge ?? env.TRELLIS_EXEC_JUDGE_MODE ?? "always";
  if (!(validJudgeModes as readonly string[]).includes(judgeModeRaw)) {
    console.error(`Error: --judge must be one of: ${validJudgeModes.join(", ")}`);
    process.exit(1);
  }
  const judgeMode = judgeModeRaw as RunContext["judgeMode"];
  const judgeModel =
    values["judge-model"] ??
    env.TRELLIS_EXEC_JUDGE_MODEL ??
    undefined;

  const timeoutRaw =
    values.timeout ?? env.TRELLIS_EXEC_TIMEOUT ?? undefined;
  const longRun = values["long-run"] || env.TRELLIS_EXEC_LONG_RUN === "true" || env.TRELLIS_EXEC_LONG_RUN === "1";
  const explicitTimeout = timeoutRaw ? parseInt(timeoutRaw, 10) : undefined;
  if (explicitTimeout !== undefined && (isNaN(explicitTimeout) || explicitTimeout <= 0)) {
    console.error("Error: --timeout must be a positive integer (milliseconds).");
    process.exit(1);
  }
  // Explicit --timeout wins over --long-run
  const timeout = explicitTimeout ?? (longRun ? LONG_RUN_TIMEOUT : undefined);

  // Browser testing settings
  const devServerCommand =
    values["dev-server"] ??
    env.TRELLIS_EXEC_DEV_SERVER ??
    undefined;

  const browserTestRetries =
    (values["browser-test-retries"] !== undefined ? Number(values["browser-test-retries"]) : undefined) ??
    (env.TRELLIS_EXEC_BROWSER_TEST_RETRIES !== undefined ? Number(env.TRELLIS_EXEC_BROWSER_TEST_RETRIES) : undefined) ??
    3;

  const context: RunContext = {
    projectRoot,
    specPath,
    planPath,
    ...(guidelinesPath !== undefined ? { guidelinesPath } : {}),
    statePath,
    trajectoryPath,
    tasksJsonPath,
    ...(values.check !== undefined ? { checkCommand: values.check } : {}),
    concurrency,
    ...(model !== undefined ? { model } : {}),
    maxRetries,
    headless: values.headless ?? false,
    verbose: values.verbose ?? false,
    dryRun: values["dry-run"] ?? false,
    pluginRoot: env.CLAUDE_PLUGIN_ROOT ?? process.cwd(),
    ...(timeout !== undefined ? { timeout } : {}),
    judgeMode,
    ...(judgeModel !== undefined ? { judgeModel } : {}),
    ...(devServerCommand !== undefined ? { devServerCommand } : {}),
    saveE2eTests: values["save-e2e-tests"] ?? false,
    browserTestRetries,
  };

  return {
    context,
    tasksJson,
    ...(values.phase !== undefined ? { phaseId: values.phase } : {}),
  };
}

// ---------------------------------------------------------------------------
// Compile arg parsing
// ---------------------------------------------------------------------------

export function parseCompileArgs(args: string[]): {
  planPath: string;
  specPath: string;
  guidelinesPath?: string;
  projectRoot: string;
  outputPath: string;
  enrich: boolean;
  timeout?: number;
} {
  const { values, positionals } = parseArgs({
    args,
    options: {
      spec: { type: "string" },
      guidelines: { type: "string" },
      "project-root": { type: "string" },
      output: { type: "string" },
      enrich: { type: "boolean", default: false },
      timeout: { type: "string" },
    },
    allowPositionals: true,
  });

  const planPath = positionals[0];
  if (!planPath) {
    console.error("Error: <plan.md> path is required for 'compile' command.");
    process.exit(1);
  }

  if (!values.spec) {
    console.error("Error: --spec <spec.md> is required for 'compile' command.");
    process.exit(1);
  }

  const outputPath = resolve(values.output ?? "./tasks.json");

  // projectRoot stored as relative path from output dir to project root
  const outputDir = dirname(outputPath);
  const projectRoot = values["project-root"]
    ? relative(outputDir, resolve(values["project-root"])) || "."
    : relative(outputDir, getGitRoot(resolve(outputDir)) ?? resolve(".")) || ".";

  const timeout = values.timeout ? parseInt(values.timeout, 10) : undefined;
  if (timeout !== undefined && (isNaN(timeout) || timeout <= 0)) {
    console.error("Error: --timeout must be a positive integer (milliseconds).");
    process.exit(1);
  }

  return {
    planPath: resolve(planPath),
    specPath: resolve(values.spec),
    ...(values.guidelines ? { guidelinesPath: resolve(values.guidelines) } : {}),
    projectRoot,
    outputPath,
    enrich: values.enrich ?? false,
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

export function parseStatusArgs(args: string[]): { tasksJsonPath: string } {
  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
  });

  const tasksJsonPath = positionals[0];
  if (!tasksJsonPath) {
    console.error(
      "Error: <tasks.json> path is required for 'status' command.",
    );
    process.exit(1);
  }

  return { tasksJsonPath: resolve(tasksJsonPath) };
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

export function checkClaudeAvailable(): boolean {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleRun(args: string[]): Promise<void> {
  const { context, tasksJson, phaseId } = buildRunContext(args);

  if (!context.dryRun && !checkClaudeAvailable()) {
    console.error(
      "Error: Claude Code CLI is required but not found on PATH.\n" +
        "Install it from: https://docs.anthropic.com/en/docs/claude-code",
    );
    process.exit(1);
  }

  if (context.dryRun) {
    console.log(dryRunReport(tasksJson, context));
    return;
  }

  const result = typeof phaseId === "string"
    ? await runSinglePhase(context, tasksJson, phaseId)
    : await runPhases(context, tasksJson);

  console.log("");
  console.log(formatSummaryReport(result));

  if (!result.success) {
    process.exit(1);
  }
}

async function handleCompile(args: string[]): Promise<void> {
  const { planPath, specPath, guidelinesPath, projectRoot, outputPath, enrich, timeout } = parseCompileArgs(args);

  const planContent = readFileSync(planPath, "utf-8");

  // Compute refs relative to the output directory so tasks.json is portable
  const outputDir = dirname(resolve(outputPath));
  const specRef = relative(outputDir, resolve(specPath)) || ".";
  const planRef = relative(outputDir, resolve(planPath)) || ".";

  console.log("Parsing plan structure...");
  const result = parsePlan(planContent, specRef, planRef, projectRoot);

  // Deterministic parse failed — decompose via LLM using spec + plan + guidelines
  const needsDecompose = !result.success || !result.tasksJson;
  // Deterministic parse succeeded but has fields that need LLM enrichment
  const needsEnrichment = enrich && result.enrichmentNeeded.length > 0;

  if (needsDecompose || needsEnrichment) {
    if (!checkClaudeAvailable()) {
      if (needsDecompose) {
        console.error(
          "Error: Plan requires LLM decomposition but Claude Code CLI is not available.\n" +
            "The deterministic parser could not identify phase boundaries.\n" +
            "Install Claude Code CLI from: https://docs.anthropic.com/en/docs/claude-code",
        );
      } else {
        console.error(
          "Error: --enrich requires the Claude Code CLI but it is not available.\n" +
            "Install it from: https://docs.anthropic.com/en/docs/claude-code",
        );
      }
      process.exit(1);
    }

    const compileTimeout = timeout ?? COMPILE_TIMEOUT;
    const cwd = dirname(resolve(planPath));

    // Haiku for lightweight enrichment, Opus for full decomposition
    const enrichQuery = async (prompt: string) => {
      const result = await execClaude(["--print", "--model", "haiku"], cwd, { stdin: prompt, timeout: compileTimeout });
      return result.stdout;
    };
    const decomposeQuery = async (prompt: string) => {
      console.log("Decomposing plan via LLM (this may take a few minutes)...");
      const spinner = startSpinner("Decomposing");
      const result = await execClaude(
        ["--print", "--model", "opus"],
        cwd,
        {
          stdin: prompt,
          timeout: compileTimeout,
        },
      );
      spinner.stop();
      return result.stdout;
    };

    if (needsEnrichment && !needsDecompose) {
      console.log(`Enriching ${result.enrichmentNeeded.length} flagged field(s) via LLM...`);
    }

    const spinner = needsDecompose ? undefined : startSpinner("Enriching");
    const tasksJson = await compilePlan({
      planPath,
      specPath,
      ...(guidelinesPath ? { guidelinesPath } : {}),
      projectRoot,
      outputPath,
      query: enrichQuery,
      decomposeQuery,
    });
    spinner?.stop();

    console.log("Validating output...");
    const taskCount = tasksJson.phases.reduce(
      (sum, phase) => sum + phase.tasks.length,
      0,
    );
    const suffix = needsDecompose ? " (decomposed)" : " (enriched)";
    console.log(
      `Compiled ${tasksJson.phases.length} phases, ${taskCount} tasks${suffix} → ${outputPath}`,
    );
    return;
  }

  // At this point, deterministic parse succeeded (needsLlmFallback is false)
  const tasksJson = result.tasksJson!;

  writeFileSync(outputPath, JSON.stringify(tasksJson, null, 2) + "\n");

  const taskCount = tasksJson.phases.reduce(
    (sum, phase) => sum + phase.tasks.length,
    0,
  );
  console.log(
    `Compiled ${tasksJson.phases.length} phases, ${taskCount} tasks → ${outputPath}`,
  );

  if (result.enrichmentNeeded.length > 0) {
    console.log(
      `Note: ${result.enrichmentNeeded.length} field(s) flagged for enrichment. Re-run with --enrich to fill gaps.`,
    );
  }
}

function handleStatus(args: string[]): void {
  const { tasksJsonPath } = parseStatusArgs(args);
  const stateDir = dirname(tasksJsonPath);
  const statePath = resolve(stateDir, "state.json");

  const state = loadState(statePath);
  if (!state) {
    console.log("No execution state found. Run 'trellis-exec run' first.");
    return;
  }

  console.log(`Current phase: ${state.currentPhase}`);
  console.log(
    `Completed phases: ${state.completedPhases.length > 0 ? state.completedPhases.join(", ") : "none"}`,
  );

  if (Object.keys(state.phaseRetries).length > 0) {
    console.log("\nRetry counts:");
    for (const [phaseId, count] of Object.entries(state.phaseRetries)) {
      console.log(`  ${phaseId}: ${count}`);
    }
  }

  if (state.phaseReports.length > 0) {
    console.log("\nPhase reports:");
    for (const report of state.phaseReports) {
      console.log(
        `  ${report.phaseId}: ${report.status} — ${report.summary}`,
      );
      if (report.tasksCompleted.length > 0) {
        console.log(`    Completed: ${report.tasksCompleted.join(", ")}`);
      }
      if (report.tasksFailed.length > 0) {
        console.log(`    Failed: ${report.tasksFailed.join(", ")}`);
      }
    }
  }

}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(HELP);
    if (!subcommand) process.exit(1);
    return;
  }

  switch (subcommand) {
    case "run":
      await handleRun(rest);
      break;
    case "compile":
      await handleCompile(rest);
      break;
    case "status":
      handleStatus(rest);
      break;
    default:
      console.error(`Unknown command: ${subcommand}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

// Detect whether this module is the entrypoint.  `npx`, `npm link`, and
// similar runners invoke the bin through symlinks or wrapper shims, so a
// simple path comparison against process.argv[1] is not reliable.  We
// resolve the real path of argv[1] to handle symlinks.
function detectEntryPoint(): boolean {
  if (import.meta.url === `file://${process.argv[1]}`) return true;

  try {
    const realArgv = realpathSync(process.argv[1] ?? "");
    const selfPath = new URL(import.meta.url).pathname;
    return realArgv === selfPath;
  } catch {
    return false;
  }
}

const isEntryPoint = detectEntryPoint();

if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
