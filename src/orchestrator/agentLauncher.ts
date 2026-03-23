import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { SubAgentConfig, SubAgentResult } from "../types/agents.js";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes for sub-agent execution

export type AgentLauncherConfig = {
  pluginRoot: string;
  projectRoot: string;
  dryRun?: boolean;
  mockResponses?: Map<string, SubAgentResult>;
};

export type OrchestratorLaunchConfig = {
  agentFile: string;
  skillsDir: string;
  phaseContext: string;
  model?: string;
};

export type OrchestratorHandle = {
  send(input: string): Promise<string>;
  isAlive(): boolean;
  kill(): void;
};

export type AgentLauncher = {
  dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>;
  llmQuery(prompt: string, options?: { model?: string }): Promise<string>;
  launchOrchestrator(
    config: OrchestratorLaunchConfig,
  ): Promise<OrchestratorHandle>;
};

/**
 * Assembles the sub-agent prompt following the §5 input contract.
 * Lists file paths (rather than inlining contents) since the claude agent
 * can read files directly from the filesystem.
 *
 * Note on permission enforcement (§10 #6): outputPaths are listed in the prompt
 * as a soft constraint. Runtime enforcement is handled by Claude CLI's --agent-file
 * permission model, not by this TypeScript code.
 */
export function buildSubAgentPrompt(config: SubAgentConfig): string {
  const lines: string[] = [];

  lines.push(`You are a ${config.type} sub-agent. Your task:`);
  lines.push("");
  lines.push(config.instructions);
  lines.push("");

  if (config.outputPaths.length > 0) {
    lines.push("You may ONLY create or modify these files:");
    for (const p of config.outputPaths) {
      lines.push(p);
    }
    lines.push("");
  }

  if (config.filePaths.length > 0) {
    lines.push("Context files to reference:");
    for (const p of config.filePaths) {
      lines.push(p);
    }
    lines.push("");
  }

  lines.push(
    "Use the Write tool to create new files and the Edit tool to modify existing files. Do not just output code as text.",
  );

  return lines.join("\n");
}

/**
 * Builds the CLI args array for a dispatchSubAgent call.
 */
export function buildSubAgentArgs(
  agentFile: string,
  model: string,
): string[] {
  return [
    "--agent",
    agentFile,
    "--print",
    "--dangerously-skip-permissions",
    "--model",
    model,
  ];
}

/**
 * Builds the CLI args array for an llmQuery call.
 */
export function buildLlmQueryArgs(model: string): string[] {
  return ["--print", "--model", model];
}

const REPL_SYSTEM_PROMPT =
  "CRITICAL: You are communicating through a JavaScript REPL. " +
  "Your ENTIRE response must be valid JavaScript code. " +
  "Do NOT include any natural language, markdown, or explanations. " +
  "Output ONLY plain JavaScript (no TypeScript, no export/import, no module.exports). " +
  "Use REPL helpers: readFile(), listDir(), dispatchSubAgent(), runCheck(), writePhaseReport(), llmQuery(). " +
  "After dispatchSubAgent succeeds, call runCheck() then writePhaseReport().";

/**
 * Builds the CLI args for the first orchestrator turn.
 * Subsequent turns use --continue to resume the session.
 */
export function buildOrchestratorArgs(
  config: OrchestratorLaunchConfig,
): string[] {
  const args = [
    "--agent",
    config.agentFile,
    "--print",
    "--dangerously-skip-permissions",
    "--disallowedTools",
    "Write,Edit,Bash,Read,Glob,Grep,NotebookEdit,Agent,WebFetch,WebSearch,TodoWrite",
    "--append-system-prompt",
    REPL_SYSTEM_PROMPT,
    "--add-dir",
    config.skillsDir,
  ];
  if (config.model) {
    args.push("--model", config.model);
  }
  return args;
}

/**
 * Builds the CLI args for continuing an orchestrator session (turn 2+).
 */
export function buildOrchestratorContinueArgs(
  config: OrchestratorLaunchConfig,
): string[] {
  const args = [
    "--print",
    "--continue",
    "--dangerously-skip-permissions",
    "--disallowedTools",
    "Write,Edit,Bash,Read,Glob,Grep,NotebookEdit,Agent,WebFetch,WebSearch,TodoWrite",
    "--append-system-prompt",
    REPL_SYSTEM_PROMPT,
    "--add-dir",
    config.skillsDir,
  ];
  if (config.model) {
    args.push("--model", config.model);
  }
  return args;
}

type ExecClaudeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Spawns a `claude` CLI subprocess, optionally pipes stdin, and collects
 * stdout/stderr. Rejects on timeout.
 */
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

/**
 * Creates an AgentLauncher that manages claude CLI subprocesses for sub-agent
 * dispatch, LLM queries, and long-running orchestrator sessions.
 *
 * Supports three modes:
 * - **real**: spawns actual `claude` CLI processes
 * - **dryRun**: logs commands without executing, returns mock results
 * - **mock**: returns pre-configured responses from `mockResponses` map
 */
export function createAgentLauncher(config: AgentLauncherConfig): AgentLauncher {
  const { pluginRoot, projectRoot, dryRun, mockResponses } = config;

  async function dispatchSubAgent(
    subAgentConfig: SubAgentConfig,
  ): Promise<SubAgentResult> {
    const agentFile = resolve(pluginRoot, "agents", subAgentConfig.type + ".md");
    const model = subAgentConfig.model ?? "sonnet";
    const args = buildSubAgentArgs(agentFile, model);
    const prompt = buildSubAgentPrompt(subAgentConfig);

    if (dryRun) {
      console.log("[dry-run] dispatchSubAgent:", "claude", args.join(" "));
      console.log("[dry-run] prompt:", prompt.slice(0, 200));
      return { success: true, output: "[dry-run]", filesModified: [] };
    }

    if (mockResponses) {
      const mock = mockResponses.get(subAgentConfig.type);
      if (mock) return mock;
      return {
        success: true,
        output: "[mock] default response",
        filesModified: [],
      };
    }

    let result: ExecClaudeResult;
    try {
      result = await execClaude(args, projectRoot, prompt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output:
          `${message} Task "${subAgentConfig.taskId}" was NOT completed. ` +
          `Retry with simpler/smaller instructions, or mark this task as failed.`,
        filesModified: [],
        error: message,
      };
    }

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout,
        filesModified: [],
        error: result.stderr || `claude exited with code ${result.exitCode}`,
      };
    }

    return {
      success: true,
      output: result.stdout,
      filesModified: [],
    };
  }

  async function llmQuery(
    prompt: string,
    options?: { model?: string },
  ): Promise<string> {
    const model = options?.model ?? "haiku";
    const args = buildLlmQueryArgs(model);

    if (dryRun) {
      console.log("[dry-run] llmQuery:", prompt.slice(0, 80), "model:", model);
      return "[dry-run] llmQuery response";
    }

    if (mockResponses) {
      return "[mock] llmQuery response";
    }

    const result = await execClaude(args, projectRoot, prompt);
    return result.stdout;
  }

  async function launchOrchestrator(
    orchestratorConfig: OrchestratorLaunchConfig,
  ): Promise<OrchestratorHandle> {
    const firstArgs = buildOrchestratorArgs(orchestratorConfig);

    if (dryRun) {
      console.log("[dry-run] launchOrchestrator:", "claude", firstArgs.join(" "));
      return createDryRunHandle();
    }

    // Use sequential one-shot calls with --continue for multi-turn.
    // Turn 1: claude --print --agent ... <phaseContext>
    // Turn 2+: claude --print --continue ... <input>
    const continueArgs = buildOrchestratorContinueArgs(orchestratorConfig);
    return createSequentialHandle(
      firstArgs,
      continueArgs,
      projectRoot,
      orchestratorConfig.phaseContext,
    );
  }

  return { dispatchSubAgent, llmQuery, launchOrchestrator };
}

/**
 * Creates a mock OrchestratorHandle for dryRun mode.
 */
function createDryRunHandle(): OrchestratorHandle {
  let alive = true;

  return {
    async send(input: string): Promise<string> {
      console.log("[dry-run] orchestrator.send:", input.slice(0, 80));
      return "[dry-run] orchestrator response";
    },
    isAlive(): boolean {
      return alive;
    },
    kill(): void {
      alive = false;
    },
  };
}

/**
 * Creates an OrchestratorHandle using sequential one-shot claude calls.
 *
 * Turn 1 uses the full args (--agent, etc.) with the phaseContext as stdin.
 * Subsequent turns use --continue to resume the session.
 * Each turn spawns a fresh claude process via execClaude().
 */
function createSequentialHandle(
  firstArgs: string[],
  continueArgs: string[],
  projectRoot: string,
  phaseContext: string,
): OrchestratorHandle {
  let turnCount = 0;
  let alive = true;
  let lastError: string | null = null;

  return {
    async send(input: string): Promise<string> {
      if (!alive) {
        throw new Error(
          `Orchestrator has been killed${lastError ? `: ${lastError}` : ""}`,
        );
      }

      turnCount++;
      const isFirstTurn = turnCount === 1;
      const args = isFirstTurn ? firstArgs : continueArgs;
      const prompt = isFirstTurn ? phaseContext + "\n\n" + input : input;

      const result = await execClaude(args, projectRoot, prompt);

      if (result.exitCode !== 0) {
        lastError = result.stderr || `exit code ${result.exitCode}`;
        throw new Error(`Orchestrator turn failed: ${lastError}`);
      }

      return result.stdout;
    },

    isAlive(): boolean {
      return alive;
    },

    kill(): void {
      alive = false;
    },
  };
}
