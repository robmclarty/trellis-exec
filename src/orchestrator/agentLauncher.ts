import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { SubAgentConfig, SubAgentResult } from "../types/agents.js";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes for sub-agent execution
const ORCHESTRATOR_TIMEOUT = 600_000; // 10 minutes for phase orchestration
export const COMPILE_TIMEOUT = 600_000; // 10 minutes for plan decomposition

export type ExecClaudeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type AgentLauncherConfig = {
  pluginRoot: string;
  projectRoot: string;
  dryRun?: boolean;
};

export type OrchestratorOptions = {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type AgentLauncher = {
  dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>;
  runPhaseOrchestrator(
    prompt: string,
    agentFile: string,
    model?: string,
    options?: OrchestratorOptions,
  ): Promise<ExecClaudeResult>;
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
 * Spawns a `claude` CLI subprocess, optionally pipes stdin, and collects
 * stdout/stderr. Rejects on timeout.
 */
export type ExecClaudeOptions = {
  stdin?: string;
  timeout?: number;
  onStderr?: ((chunk: string) => void) | undefined;
  onStdout?: ((chunk: string) => void) | undefined;
};

export function execClaude(
  args: string[],
  cwd: string,
  options: ExecClaudeOptions = {},
): Promise<ExecClaudeResult> {
  const {
    stdin,
    timeout = DEFAULT_TIMEOUT,
    onStderr,
    onStdout,
  } = options;
  return new Promise((resolvePromise, reject) => {
    const child = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (onStdout) onStdout(chunk.toString("utf-8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (onStderr) onStderr(chunk.toString("utf-8"));
    });

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
 * dispatch and phase orchestration.
 *
 * Supports two modes:
 * - **real**: spawns actual `claude` CLI processes
 * - **dryRun**: logs commands without executing, returns mock results
 */
export function createAgentLauncher(config: AgentLauncherConfig): AgentLauncher {
  const { pluginRoot, projectRoot, dryRun } = config;

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

    let result: ExecClaudeResult;
    try {
      result = await execClaude(args, projectRoot, { stdin: prompt });
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

  async function runPhaseOrchestrator(
    prompt: string,
    agentFile: string,
    model?: string,
    options?: OrchestratorOptions,
  ): Promise<ExecClaudeResult> {
    const args = [
      "--agent",
      agentFile,
      "--print",
      "--dangerously-skip-permissions",
      ...(model ? ["--model", model] : []),
    ];

    if (dryRun) {
      console.log("[dry-run] runPhaseOrchestrator:", "claude", args.join(" "));
      console.log("[dry-run] prompt:", prompt.slice(0, 200));
      return { stdout: "[dry-run]", stderr: "", exitCode: 0 };
    }

    return execClaude(args, projectRoot, {
      stdin: prompt,
      timeout: ORCHESTRATOR_TIMEOUT,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });
  }

  return { dispatchSubAgent, runPhaseOrchestrator };
}
