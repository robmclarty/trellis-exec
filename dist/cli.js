#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import { TasksJsonSchema } from "./types/tasks.js";
import { loadState } from "./runner/stateManager.js";
import { parsePlan } from "./compile/planParser.js";
import { runPhases, runSinglePhase, dryRunReport, } from "./runner/phaseRunner.js";
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

Environment variables:
  TRELLIS_EXEC_MODEL                Override orchestrator model
  TRELLIS_EXEC_TURN_LIMIT           Max REPL turns per phase
  TRELLIS_EXEC_REPL_OUTPUT_LIMIT    Max chars per REPL turn
  TRELLIS_EXEC_MAX_RETRIES          Max phase retries
  TRELLIS_EXEC_CONCURRENCY          Max parallel sub-agents
  TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS  Consecutive errors before halt
  TRELLIS_EXEC_COMPACTION_THRESHOLD    Context compaction threshold %
`;
// ---------------------------------------------------------------------------
// Arg parsing helpers (exported for testing)
// ---------------------------------------------------------------------------
export function buildRunConfig(args, env = process.env) {
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
    const concurrency = (values.concurrency !== undefined ? Number(values.concurrency) : undefined) ??
        (env.TRELLIS_EXEC_CONCURRENCY !== undefined ? Number(env.TRELLIS_EXEC_CONCURRENCY) : undefined) ??
        3;
    const maxRetries = (values["max-retries"] !== undefined ? Number(values["max-retries"]) : undefined) ??
        (env.TRELLIS_EXEC_MAX_RETRIES !== undefined ? Number(env.TRELLIS_EXEC_MAX_RETRIES) : undefined) ??
        2;
    const turnLimit = (env.TRELLIS_EXEC_TURN_LIMIT !== undefined ? Number(env.TRELLIS_EXEC_TURN_LIMIT) : undefined) ??
        200;
    const maxConsecutiveErrors = (env.TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS !== undefined
        ? Number(env.TRELLIS_EXEC_MAX_CONSECUTIVE_ERRORS)
        : undefined) ?? 5;
    const model = values.model ??
        env.TRELLIS_EXEC_MODEL ??
        undefined;
    const isolation = (values.isolation ?? "worktree");
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
export function parseCompileArgs(args) {
    const { values, positionals } = parseArgs({
        args,
        options: {
            spec: { type: "string" },
            output: { type: "string" },
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
    };
}
export function parseStatusArgs(args) {
    const { positionals } = parseArgs({
        args,
        options: {},
        allowPositionals: true,
    });
    const tasksJsonPath = positionals[0];
    if (!tasksJsonPath) {
        console.error("Error: <tasks.json> path is required for 'status' command.");
        process.exit(1);
    }
    return { tasksJsonPath: resolve(tasksJsonPath) };
}
// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------
async function handleRun(args) {
    const config = buildRunConfig(args);
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
        console.error(`Execution failed. Phases completed: ${result.phasesCompleted.join(", ") || "none"}`);
        process.exit(1);
    }
    console.log(`Execution complete. Phases completed: ${result.phasesCompleted.join(", ")}`);
}
async function handleCompile(args) {
    const { planPath, specPath, outputPath } = parseCompileArgs(args);
    const planContent = readFileSync(planPath, "utf-8");
    const result = parsePlan(planContent, specPath, planPath);
    if (!result.success || !result.tasksJson) {
        console.error("Compilation failed:");
        for (const err of result.errors) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }
    writeFileSync(outputPath, JSON.stringify(result.tasksJson, null, 2) + "\n");
    const taskCount = result.tasksJson.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
    console.log(`Compiled ${result.tasksJson.phases.length} phases, ${taskCount} tasks → ${outputPath}`);
    if (result.enrichmentNeeded.length > 0) {
        console.log(`Note: ${result.enrichmentNeeded.length} field(s) flagged for enrichment.`);
    }
}
function handleStatus(args) {
    const { tasksJsonPath } = parseStatusArgs(args);
    const stateDir = dirname(tasksJsonPath);
    const statePath = resolve(stateDir, "state.json");
    const state = loadState(statePath);
    if (!state) {
        console.log("No execution state found. Run 'trellis-exec run' first.");
        return;
    }
    console.log(`Current phase: ${state.currentPhase}`);
    console.log(`Completed phases: ${state.completedPhases.length > 0 ? state.completedPhases.join(", ") : "none"}`);
    if (Object.keys(state.phaseRetries).length > 0) {
        console.log("\nRetry counts:");
        for (const [phaseId, count] of Object.entries(state.phaseRetries)) {
            console.log(`  ${phaseId}: ${count}`);
        }
    }
    if (state.phaseReports.length > 0) {
        console.log("\nPhase reports:");
        for (const report of state.phaseReports) {
            console.log(`  ${report.phaseId}: ${report.status} — ${report.summary}`);
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
async function main() {
    const [subcommand, ...rest] = process.argv.slice(2);
    if (!subcommand || subcommand === "--help" || subcommand === "-h") {
        console.log(HELP);
        if (!subcommand)
            process.exit(1);
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
const isEntryPoint = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith("/cli.js");
if (isEntryPoint) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
//# sourceMappingURL=cli.js.map