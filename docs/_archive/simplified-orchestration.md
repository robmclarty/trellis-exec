# Trellis Exec v2: Simplified Architecture

## What changes

The REPL layer, worktree isolation, and multi-turn orchestrator handle are removed. Each phase becomes a single `claude --print` invocation with native tools enabled. The orchestrator communicates its result by writing a JSON file to disk, which the runner reads after the subprocess exits.

## What stays

- Phase sequencing, resume, retry (`runPhases`, `runSinglePhase`)
- State management (`stateManager.ts`)
- Judge loop (simplified)
- Plan compilation (`compile/`)
- Scheduler and dependency validation
- CLI entry point
- Types (unchanged)

## Files to delete

```text
src/orchestrator/replManager.ts      # entire file
src/orchestrator/replHelpers.ts      # entire file
src/isolation/worktreeManager.ts     # entire file
```

## Files to heavily simplify

- `src/orchestrator/agentLauncher.ts` - keep only `execClaude` and `dispatchSubAgent`
- `src/runner/phaseRunner.ts` - delete `replTurnLoop`, `extractCode`, `isCommentOnly`, `detectStuck`, REPL protocol from `buildPhaseContext`

---

## New `agentLauncher.ts`

```typescript
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { SubAgentConfig, SubAgentResult } from "../types/agents.js";

const DEFAULT_TIMEOUT = 600_000; // 10 minutes per phase

export type AgentLauncherConfig = {
  pluginRoot: string;
  projectRoot: string;
  dryRun?: boolean;
};

type ExecClaudeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function execClaude(
  args: string[],
  cwd: string,
  stdin?: string,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<ExecClaudeResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude subprocess timed out after ${timeout}ms`));
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

function buildSubAgentPrompt(config: SubAgentConfig): string {
  const lines: string[] = [];
  lines.push(`You are a ${config.type} sub-agent. Your task:`);
  lines.push("");
  lines.push(config.instructions);
  lines.push("");

  if (config.outputPaths.length > 0) {
    lines.push("You may ONLY create or modify these files:");
    for (const p of config.outputPaths) lines.push(p);
    lines.push("");
  }

  if (config.filePaths.length > 0) {
    lines.push("Context files to reference:");
    for (const p of config.filePaths) lines.push(p);
    lines.push("");
  }

  return lines.join("\n");
}

// ── Public API ──────────────────────────────────────────────────────

export type AgentLauncher = {
  dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>;
  runPhaseOrchestrator(prompt: string, agentFile: string, model?: string): Promise<ExecClaudeResult>;
};

export function createAgentLauncher(config: AgentLauncherConfig): AgentLauncher {
  const { pluginRoot, projectRoot, dryRun } = config;

  async function dispatchSubAgent(
    subAgentConfig: SubAgentConfig,
  ): Promise<SubAgentResult> {
    const agentFile = resolve(pluginRoot, "agents", subAgentConfig.type + ".md");
    const model = subAgentConfig.model ?? "sonnet";
    const args = [
      "--agent", agentFile,
      "--print",
      "--dangerously-skip-permissions",
      "--model", model,
    ];
    const prompt = buildSubAgentPrompt(subAgentConfig);

    if (dryRun) {
      console.log("[dry-run] dispatchSubAgent:", subAgentConfig.type);
      return { success: true, output: "[dry-run]", filesModified: [] };
    }

    try {
      const result = await execClaude(args, projectRoot, prompt);
      if (result.exitCode !== 0) {
        return {
          success: false,
          output: result.stdout,
          filesModified: [],
          error: result.stderr || `exit code ${result.exitCode}`,
        };
      }
      return { success: true, output: result.stdout, filesModified: [] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", filesModified: [], error: message };
    }
  }

  async function runPhaseOrchestrator(
    prompt: string,
    agentFile: string,
    model?: string,
  ): Promise<ExecClaudeResult> {
    // Native tools enabled. No --disallowedTools. No REPL.
    // The orchestrator uses Read, Write, Edit, Bash, Task natively.
    const args = [
      "--agent", agentFile,
      "--print",
      "--dangerously-skip-permissions",
      ...(model ? ["--model", model] : []),
    ];

    if (dryRun) {
      console.log("[dry-run] runPhaseOrchestrator");
      return { stdout: "[dry-run]", stderr: "", exitCode: 0 };
    }

    return execClaude(args, projectRoot, prompt);
  }

  return { dispatchSubAgent, runPhaseOrchestrator };
}
```

Key change: `runPhaseOrchestrator` is a single fire-and-forget call. No multi-turn handle, no `--continue`, no `--disallowedTools`. Claude gets full tool access and runs until it's done.

---

## New `executePhase` (in `phaseRunner.ts`)

This replaces the current ~120-line version plus the entire `replTurnLoop`:

```typescript
import { readFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Phase } from "../types/tasks.js";
import type { SharedState, PhaseReport } from "../types/state.js";
import type { TrajectoryLogger } from "../logging/trajectoryLogger.js";
import type { RunContext } from "../cli.js";
import { createAgentLauncher } from "../orchestrator/agentLauncher.js";
import { startSpinner } from "../ui/spinner.js";

const REPORT_FILENAME = ".trellis-phase-report.json";

async function executePhase(
  ctx: RunContext,
  phase: Phase,
  state: SharedState,
  projectRoot: string,
  logger: TrajectoryLogger,
): Promise<PhaseExecResult> {
  const launcher = createAgentLauncher({
    pluginRoot: ctx.pluginRoot,
    projectRoot,
    dryRun: ctx.dryRun,
  });

  const phaseContext = buildPhaseContext(phase, state, getHandoffFromState(state), ctx);
  const agentFile = resolve(ctx.pluginRoot, "agents/phase-orchestrator.md");
  const reportPath = join(projectRoot, REPORT_FILENAME);

  // Clean up stale report from a prior attempt (matters on retries)
  try { unlinkSync(reportPath); } catch { /* not found is fine */ }

  // Single invocation. Claude uses native tools internally.
  const spinner = startSpinner(`Phase: ${phase.id}`);
  const startTime = performance.now();

  let result;
  try {
    result = await launcher.runPhaseOrchestrator(
      phaseContext,
      agentFile,
      ctx.model,
    );
  } catch (err) {
    spinner.stop();
    const reason = err instanceof Error ? err.message : "unexpected error";
    return { status: "failed", report: buildPartialReport(phase.id, phase, reason) };
  }

  const duration = performance.now() - startTime;
  spinner.stop();

  logger.append({
    phaseId: phase.id,
    turnNumber: 0,
    type: "orchestrator_run",
    input: `[${phaseContext.length} chars]`,
    output: result.stdout.slice(0, 2000),
    duration,
  });

  if (result.exitCode !== 0) {
    console.error(`Orchestrator exited with code ${result.exitCode}`);
    if (ctx.verbose) console.error(result.stderr);
    return { status: "failed", report: buildPartialReport(phase.id, phase, "non-zero exit") };
  }

  // Read the report file the orchestrator wrote
  let report: PhaseReport;
  try {
    const raw = JSON.parse(readFileSync(reportPath, "utf-8"));
    report = normalizeReport(raw, phase.id);
  } catch {
    console.error(`Orchestrator did not write ${REPORT_FILENAME}. Treating as partial.`);
    return { status: "partial", report: buildPartialReport(phase.id, phase, "no report file") };
  }

  // Validate all tasks are accounted for
  const allTaskIds = phase.tasks.map((t) => t.id);
  const accountedFor = new Set([...report.tasksCompleted, ...report.tasksFailed]);
  const missing = allTaskIds.filter((id) => !accountedFor.has(id));
  if (missing.length > 0) {
    console.warn(`Report missing tasks: ${missing.join(", ")}`);
    report = {
      ...report,
      tasksFailed: [...report.tasksFailed, ...missing],
      status: "partial",
      recommendedAction: "retry",
    };
  }

  return {
    status: report.status === "complete" ? "complete" : report.status,
    report,
  };
}
```

That's roughly 80 lines vs the current ~350 (executePhase + replTurnLoop + extractCode + isCommentOnly + detectStuck).

---

## New `buildPhaseContext`

Strip the REPL protocol. The orchestrator gets the phase info, retry context when applicable, and is told to write a report file when done:

```typescript
export function buildPhaseContext(
  phase: Phase,
  state: SharedState,
  handoff: string,
  ctx: RunContext,
): string {
  const lines: string[] = [];
  const retryCount = state.phaseRetries[phase.id] ?? 0;

  lines.push(`# Phase: ${phase.name} (${phase.id})`);
  if (retryCount > 0) {
    lines.push(`**This is retry attempt ${retryCount}.** See "Previous Attempt" below.`);
  }
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

  // ── Previous attempt context (only on retries) ────────────────────
  if (retryCount > 0) {
    lines.push("");
    lines.push("## Previous Attempt");
    lines.push("");
    lines.push(`This phase has been attempted ${retryCount} time(s) before.`);
    lines.push("The files on disk reflect work from prior attempts and any");
    lines.push("corrections applied by the fix agent. Review them before starting.");

    // Find the most recent report for this phase
    const priorReports = state.phaseReports.filter(
      (r) => r.phaseId === phase.id,
    );
    const lastReport = priorReports.at(-1);

    if (lastReport) {
      lines.push("");
      lines.push("### Last Orchestrator Report");
      lines.push(`Status: ${lastReport.status}`);
      lines.push(`Summary: ${lastReport.summary}`);
      if (lastReport.tasksCompleted.length > 0) {
        lines.push(`Tasks completed: ${lastReport.tasksCompleted.join(", ")}`);
      }
      if (lastReport.tasksFailed.length > 0) {
        lines.push(`Tasks failed: ${lastReport.tasksFailed.join(", ")}`);
      }
      if (lastReport.orchestratorAnalysis) {
        lines.push(`Analysis: ${lastReport.orchestratorAnalysis}`);
      }

      // Judge feedback is the most important part for the retry
      if (lastReport.judgeAssessment && !lastReport.judgeAssessment.passed) {
        lines.push("");
        lines.push("### Judge Issues (from last attempt)");
        lines.push("");
        lines.push(
          "These are the specific problems the judge identified. Your primary",
        );
        lines.push(
          "objective on this retry is to resolve these issues.",
        );
        lines.push("");
        for (const issue of lastReport.judgeAssessment.issues) {
          lines.push(`- ${formatIssue(issue)}`);
        }
        if (lastReport.judgeAssessment.suggestions.length > 0) {
          lines.push("");
          lines.push("### Judge Suggestions (non-blocking)");
          for (const suggestion of lastReport.judgeAssessment.suggestions) {
            lines.push(`- ${formatIssue(suggestion)}`);
          }
        }
      }

      // Corrective tasks appended by the runner
      if (lastReport.correctiveTasks.length > 0) {
        lines.push("");
        lines.push("### Corrective Tasks");
        lines.push(
          "These corrective tasks were added to the phase based on judge feedback.",
        );
        lines.push(
          "They appear in the task list above. Prioritize them.",
        );
        lines.push("");
        for (const ct of lastReport.correctiveTasks) {
          lines.push(`- ${ct}`);
        }
      }
    }

    lines.push("");
    lines.push("### Retry Strategy");
    lines.push("");
    lines.push("1. Read the files on disk that were created/modified by the prior attempt.");
    lines.push("2. Focus on the judge's issues first. Do not redo work that already passed.");
    lines.push("3. Tasks marked as completed in the prior report may still need fixes");
    lines.push("   if the judge flagged issues in their output files.");
    lines.push("4. Run the check command after each fix to verify.");
    lines.push("5. All tasks (original + corrective) must appear in your report.");
  }

  // ── Standard context sections ─────────────────────────────────────

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

  // Pre-load spec
  lines.push("");
  lines.push("## Spec Content");
  try {
    lines.push(readFileSync(ctx.specPath, "utf-8"));
  } catch {
    lines.push("[ERROR: Could not read spec file]");
  }

  // Pre-load guidelines
  lines.push("");
  lines.push("## Guidelines Content");
  if (ctx.guidelinesPath) {
    try {
      lines.push(readFileSync(ctx.guidelinesPath, "utf-8"));
    } catch {
      lines.push("[ERROR: Could not read guidelines file]");
    }
  } else {
    lines.push("none configured");
  }

  // Check command
  lines.push("");
  lines.push("## Check Command");
  lines.push(ctx.checkCommand ?? "none configured");
  if (ctx.checkCommand) {
    lines.push(`Run this with: Bash(\`${ctx.checkCommand}\`) after completing tasks.`);
  }

  // Completion protocol (replaces the entire REPL protocol section)
  lines.push("");
  lines.push("## Completion Protocol");
  lines.push("");
  lines.push(
    `When ALL tasks are complete (or failed after retries), write a JSON report to \`${REPORT_FILENAME}\`:`,
  );
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify({
    phaseId: phase.id,
    status: "complete",
    summary: "Brief description of what was accomplished",
    tasksCompleted: ["task-id-1", "task-id-2"],
    tasksFailed: [],
    orchestratorAnalysis: "Your assessment of the phase outcome",
    recommendedAction: "advance",
    correctiveTasks: [],
    decisionsLog: ["Key decisions made"],
    handoff: "Briefing for the next phase",
  }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("IMPORTANT: Every task ID must appear in either tasksCompleted or tasksFailed.");
  lines.push("The `status` field must be 'complete', 'partial', or 'failed'.");
  lines.push("The `recommendedAction` field must be 'advance', 'retry', or 'halt'.");

  return lines.join("\n");
}
```

---

## New `agents/phase-orchestrator.md`

```markdown
---
name: phase-orchestrator
description: Orchestrates task execution within a single phase using Claude's native tools
model: sonnet
---

# Phase Orchestrator

You are a phase orchestrator in the Trellis execution system. You execute
all tasks within a single phase, then write a completion report.

## How you work

You have full access to Claude's native tools: Read, Write, Edit, Bash,
Glob, Grep, and Task. Use them directly. There is no REPL or sandbox.

For complex implementation tasks, use the **Task** tool to delegate to
sub-agents. Task gives each sub-agent a fresh context window, which
keeps your own context clean. For simple file creation (config files,
single files with known content), just use Write directly.

## Execution flow

1. Read the phase context provided in your prompt. The spec and
   guidelines are pre-loaded -- do not waste time re-reading them.

2. Work through tasks in dependency order. Only start a task when all
   tasks in its `dependsOn` list are complete.

3. For each task:
   - Read relevant existing files to understand current state
   - Use Task to delegate implementation work, or Write/Edit for
     simple changes
   - Run the check command (if configured) with Bash after each task
   - If a task fails, retry up to 3 times with adjusted instructions
   - If retries are exhausted, mark the task as failed and continue

4. After ALL tasks are attempted, write the phase report JSON to
   `.trellis-phase-report.json` using the Write tool. The format is
   specified in the "Completion Protocol" section of your phase context.

## Task delegation

When using the Task tool for sub-agents, provide:
- Clear, specific instructions
- The list of files to reference
- The list of files the sub-agent may create or modify
- The acceptance criteria from the task definition

Example:

```text
Task: Implement the authentication middleware.
Read src/middleware/auth.ts for the existing structure.
Create src/middleware/jwt.ts with the JWT validation logic.
Acceptance criteria:

- Exports a validateToken function
- Returns 401 for invalid tokens
- Passes the user object to req.user
```

## Retries

If your phase context includes a "Previous Attempt" section, this is a
retry. The files on disk already reflect prior work plus any fixes
applied by the fix agent. Your job is NOT to redo everything from
scratch. Instead:

1. Read the judge's issues from the previous attempt carefully
2. Inspect the files on disk to see what already exists
3. Focus your effort on resolving the judge's specific complaints
4. Tasks that passed before may still need targeted fixes if the
   judge flagged issues in their output
5. Corrective tasks (appended to the task list) take priority
6. All tasks, both original and corrective, must appear in your report

## Important rules

- Do NOT create tasks in other phases
- Do NOT skip tasks. Every task must be attempted or explicitly failed.
- If the check command is configured, run it after each task completes
- Write the report file as your final action
- The report MUST account for every task ID in the phase

---

## Simplified judge loop

The judge currently goes through the full `dispatchSubAgent` path, which is fine. But the fix agent also goes through it, then the check runner, then back to judge. This stays mostly the same, just without worktree references:

```typescript
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

  const changedFiles = getChangedFiles(projectRoot);
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
    const prompt = buildJudgePrompt({ changedFiles, diffContent, phase, orchestratorReport: report });

    const result = await launcher.dispatchSubAgent({
      type: "judge",
      model: "opus",
      taskId: `${phase.id}-judge-${attempt}`,
      instructions: prompt,
      filePaths: changedFiles.map((f) => f.path),
      outputPaths: [],
    });

    assessment = parseJudgeResult(result.output);

    if (assessment.passed) {
      return { assessment, correctionAttempts: attempt };
    }

    if (attempt >= maxCorrections) break;

    // Dispatch fix agent
    const fixPrompt = buildFixPrompt(assessment.issues, phase);
    await launcher.dispatchSubAgent({
      type: "fix",
      taskId: `${phase.id}-fix-${attempt}`,
      instructions: fixPrompt,
      filePaths: changedFiles.map((f) => f.path),
      outputPaths: changedFiles.filter((f) => f.status !== "D").map((f) => f.path),
    });
  }

  return { assessment, correctionAttempts: maxCorrections };
}
```

Note: `getChangedFiles` and `getDiffContent` can stay as utility functions. They're just `git diff` wrappers and don't depend on the worktree system. Remove `createWorktree`, `mergeWorktree`, `cleanupWorktree`, and `commitPhase`. Keep the git diff helpers in a smaller `src/git.ts` utility file.

---

## Correction and retry flow

There are two correction loops. They're nested but independent.

### Loop 1: Judge → Fix → Re-judge (post-orchestrator, same attempt)

```text
Orchestrator exits
  → Runner reads git diff
  → Judge agent evaluates diff against acceptance criteria
  → If passed: done, advance
  → If issues found:
      → Fix agent edits files on disk
      → Runner runs check command
      → Judge re-evaluates updated diff
      → Repeat up to maxCorrections (default 2) times
  → If still failing after maxCorrections: return assessment with passed=false
```

All participants here are one-shot `dispatchSubAgent` calls. They communicate
through the filesystem: the fix agent modifies files, the judge reads the new
diff. The orchestrator is not involved.

### Loop 2: Phase-level retry (new orchestrator)

```text
Runner receives judge assessment with passed=false
  → Runner downgrades report to recommendedAction="retry"
  → Runner appends corrective tasks (from judge issues) to phase definition
  → Runner increments phaseRetries counter
  → Runner re-enters same phase (does NOT increment phaseIndex)
  → New executePhase call:
      → Deletes stale .trellis-phase-report.json
      → buildPhaseContext includes "Previous Attempt" section:
          - Last orchestrator report (status, summary, tasks completed/failed)
          - Judge issues from last attempt (primary focus for retry)
          - Judge suggestions (non-blocking)
          - Corrective tasks added to the task list
          - Retry strategy instructions
      → Fresh orchestrator spawned with full native tool access
      → Orchestrator reads files on disk (from prior attempt + fixes)
      → Orchestrator focuses on judge issues, not redoing passed work
      → Orchestrator writes new report
  → Runner reads report → Judge evaluates → (Loop 1 again)
  → If max retries exceeded: halt
```

### What each participant knows

| Participant | Knows about prior attempts via | Communicates result via |
|------------|-------------------------------|------------------------|
| Orchestrator | "Previous Attempt" section in phase context + files on disk | `.trellis-phase-report.json` |
| Judge | Git diff + acceptance criteria (stateless, no memory of prior judges) | JSON assessment in stdout |
| Fix agent | Judge issue list in prompt + files on disk | Direct file edits |
| Runner | `state.json` (phaseReports, phaseRetries) | Orchestrates everything, reads all outputs |

The runner is the only stateful component. Everything else is a fresh context
window that receives exactly the information it needs through its prompt and
the filesystem.

---

## Migration summary

### Delete entirely

| File | Lines | Reason |
|------|-------|--------|
| `src/orchestrator/replManager.ts` | 330 | vm sandbox no longer needed |
| `src/orchestrator/replHelpers.ts` | 331 | reimplemented tools no longer needed |
| `src/isolation/worktreeManager.ts` | 266 | worktree isolation removed |

### Extract and simplify

| File | Current lines | Estimated lines | What changes |
|------|--------------|-----------------|--------------|
| `src/orchestrator/agentLauncher.ts` | 395 | ~130 | Remove orchestrator handle, REPL prompt, --disallowedTools, --continue. Add `runPhaseOrchestrator`. |
| `src/runner/phaseRunner.ts` | 1590 | ~700 | Delete replTurnLoop, extractCode, isCommentOnly, detectStuck, REPL protocol in buildPhaseContext. Simplify executePhase to spawn-and-read-report. buildPhaseContext grows with retry context. |

### New file

| File | Estimated lines | Purpose |
|------|----------------|---------|
| `src/git.ts` | ~60 | `getChangedFiles` + `getDiffContent` extracted from worktreeManager |

### Unchanged

| File | Lines |
|------|-------|
| `src/runner/stateManager.ts` | 111 |
| `src/runner/scheduler.ts` | 240 |
| `src/compile/*` | ~850 |
| `src/types/*` | 170 |
| `src/cli.ts` | 522 |
| `src/logging/trajectoryLogger.ts` | 39 |
| `src/verification/checkRunner.ts` | 66 |
| `src/lint/agentLint.ts` | 117 |
| `src/ui/spinner.ts` | 53 |

### Totals

Before: ~5,100 lines
After: ~3,050 lines
Removed: ~2,050 lines (40% reduction)

Of the removed code, nearly all of it was REPL mediation, tool reimplementation, and code-extraction heuristics. The actual build-pipeline logic (phase sequencing, state, judge, compilation) is preserved intact.

---

## Migration order

1. Create `src/git.ts` with `getChangedFiles` and `getDiffContent` extracted from `worktreeManager.ts`
2. Update imports in `phaseRunner.ts` to use `src/git.ts`
3. Rewrite `agentLauncher.ts` (new version above)
4. Rewrite `executePhase` and `buildPhaseContext` in `phaseRunner.ts`
5. Delete `replTurnLoop`, `extractCode`, `isCommentOnly`, `detectStuck` from `phaseRunner.ts`
6. Replace `agents/phase-orchestrator.md` with the new version
7. Delete `src/orchestrator/replManager.ts`
8. Delete `src/orchestrator/replHelpers.ts`
9. Delete `src/isolation/worktreeManager.ts`
10. Remove `--isolation` / `--worktree` CLI flags from `cli.ts`
11. Update tests (the REPL-specific tests can be deleted; phase runner tests need updating for the new file-based report contract)
