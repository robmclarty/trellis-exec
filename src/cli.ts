#!/usr/bin/env node

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import { TasksJsonSchema } from "./types/tasks.js";
import { loadState } from "./runner/stateManager.js";
import { parsePlan } from "./compile/planParser.js";
import { compilePlan } from "./compile/compilePlan.js";
import { createAgentLauncher } from "./orchestrator/agentLauncher.js";
import {
  runPhases,
  runSinglePhase,
  dryRunReport,
} from "./runner/phaseRunner.js";
import type { PhaseRunnerConfig } from "./runner/phaseRunner.js";

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
  --isolation <mode>     "worktree" | "none" (default: "worktree")
  --concurrency <n>      Max parallel sub-agents (default: 3)
  --model <model>        Override orchestrator model
  --max-retries <n>      Max phase retries (default: 2)
  --headless             Disable interactive prompts
  --verbose              Print REPL interactions

Compile options:
  --spec <spec.md>       Path to the spec (required)
  --output <path>        Output path (default: ./tasks.json)
  --enrich               Run LLM enrichment to fill ambiguous fields

Environment variables:
  TRELLIS_EXEC_MODEL                Override orchestrator model
  TRELLIS_EXEC_TURN_LIMIT           Max REPL turns per phase
  TRELLIS_EXEC_REPL_OUTPUT_LIMIT    Max chars per REPL turn
  TRELLIS_EXEC_MAX_RETRIES          Max phase retries
  TRELLIS_EXEC_CONCURRENCY          Max parallel sub-agents
  TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS  Consecutive errors before halt
`;

// ---------------------------------------------------------------------------
// Arg parsing helpers (exported for testing)
// ---------------------------------------------------------------------------

export function buildRunConfig(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): PhaseRunnerConfig {
  const { values, positionals } = parseArgs({
    args,
    options: {
      phase: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      check: { type: "string" },
      isolation: { type: "string" },
      concurrency: { type: "string" },
      model: { type: "string" },
      "max-retries": { type: "string" },
      headless: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const tasksJsonPath = positionals[0];
  if (!tasksJsonPath) {
    console.error("Error: <tasks.json> path is required for 'run' command.");
    process.exit(1);
  }

  const concurrency =
    (values.concurrency !== undefined ? Number(values.concurrency) : undefined) ??
    (env.TRELLIS_EXEC_CONCURRENCY !== undefined ? Number(env.TRELLIS_EXEC_CONCURRENCY) : undefined) ??
    3;

  const maxRetries =
    (values["max-retries"] !== undefined ? Number(values["max-retries"]) : undefined) ??
    (env.TRELLIS_EXEC_MAX_RETRIES !== undefined ? Number(env.TRELLIS_EXEC_MAX_RETRIES) : undefined) ??
    2;

  const turnLimit =
    (env.TRELLIS_EXEC_TURN_LIMIT !== undefined ? Number(env.TRELLIS_EXEC_TURN_LIMIT) : undefined) ??
    200;

  const maxConsecutiveErrors =
    (env.TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS !== undefined
      ? Number(env.TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS)
      : undefined) ?? 5;

  const model =
    values.model ??
    env.TRELLIS_EXEC_MODEL ??
    undefined;

  const isolation = (values.isolation ?? "worktree") as "worktree" | "none";

  return {
    tasksJsonPath: resolve(tasksJsonPath),
    ...(values.check !== undefined ? { checkCommand: values.check } : {}),
    isolation,
    concurrency,
    ...(model !== undefined ? { model } : {}),
    maxRetries,
    headless: values.headless ?? false,
    verbose: values.verbose ?? false,
    dryRun: values["dry-run"] ?? false,
    turnLimit,
    maxConsecutiveErrors,
    pluginRoot: env.CLAUDE_PLUGIN_ROOT ?? process.cwd(),
  };
}

export function parseCompileArgs(args: string[]): {
  planPath: string;
  specPath: string;
  outputPath: string;
  enrich: boolean;
} {
  const { values, positionals } = parseArgs({
    args,
    options: {
      spec: { type: "string" },
      output: { type: "string" },
      enrich: { type: "boolean", default: false },
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

  return {
    planPath: resolve(planPath),
    specPath: resolve(values.spec),
    outputPath: resolve(values.output ?? "./tasks.json"),
    enrich: values.enrich ?? false,
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
  const config = buildRunConfig(args);

  if (!config.dryRun && !checkClaudeAvailable()) {
    console.error(
      "Error: Claude Code CLI is required but not found on PATH.\n" +
        "Install it from: https://docs.anthropic.com/en/docs/claude-code",
    );
    process.exit(1);
  }

  if (config.dryRun) {
    const raw = readFileSync(config.tasksJsonPath, "utf-8");
    const tasksJson = TasksJsonSchema.parse(JSON.parse(raw));
    console.log(dryRunReport(tasksJson));
    return;
  }

  // Check if --phase was specified
  const { values: phaseValues } = parseArgs({
    args,
    options: { phase: { type: "string" } },
    allowPositionals: true,
    strict: false,
  });

  const phaseId = phaseValues.phase;
  const result = typeof phaseId === "string"
    ? await runSinglePhase(config, phaseId)
    : await runPhases(config);

  if (!result.success) {
    console.error(
      `Execution failed. Phases completed: ${result.phasesCompleted.join(", ") || "none"}`,
    );
    process.exit(1);
  }

  console.log(
    `Execution complete. Phases completed: ${result.phasesCompleted.join(", ")}`,
  );
}

async function handleCompile(args: string[]): Promise<void> {
  const { planPath, specPath, outputPath, enrich } = parseCompileArgs(args);

  const planContent = readFileSync(planPath, "utf-8");
  const result = parsePlan(planContent, specPath, planPath);

  if (!result.success || !result.tasksJson) {
    console.error("Compilation failed:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  if (enrich && result.enrichmentNeeded.length > 0) {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
    const launcher = createAgentLauncher({
      pluginRoot,
      projectRoot: dirname(resolve(planPath)),
    });
    const tasksJson = await compilePlan({
      planPath,
      specPath,
      outputPath,
      agentLauncher: launcher,
    });
    const taskCount = tasksJson.phases.reduce(
      (sum, phase) => sum + phase.tasks.length,
      0,
    );
    console.log(
      `Compiled and enriched ${tasksJson.phases.length} phases, ${taskCount} tasks → ${outputPath}`,
    );
    return;
  }

  writeFileSync(outputPath, JSON.stringify(result.tasksJson, null, 2) + "\n");

  const taskCount = result.tasksJson.phases.reduce(
    (sum, phase) => sum + phase.tasks.length,
    0,
  );
  console.log(
    `Compiled ${result.tasksJson.phases.length} phases, ${taskCount} tasks → ${outputPath}`,
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

  if (state.modifiedFiles.length > 0) {
    console.log(`\nModified files: ${state.modifiedFiles.length}`);
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
