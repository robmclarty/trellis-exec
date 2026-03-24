import type { SubAgentConfig, SubAgentResult } from "../types/agents.js";
export declare const COMPILE_TIMEOUT = 600000;
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
export type AgentLauncher = {
    dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>;
    runPhaseOrchestrator(prompt: string, agentFile: string, model?: string): Promise<ExecClaudeResult>;
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
export declare function buildSubAgentPrompt(config: SubAgentConfig): string;
/**
 * Builds the CLI args array for a dispatchSubAgent call.
 */
export declare function buildSubAgentArgs(agentFile: string, model: string): string[];
/**
 * Spawns a `claude` CLI subprocess, optionally pipes stdin, and collects
 * stdout/stderr. Rejects on timeout.
 */
export declare function execClaude(args: string[], cwd: string, stdin?: string, timeout?: number, onStderr?: (chunk: string) => void): Promise<ExecClaudeResult>;
/**
 * Creates an AgentLauncher that manages claude CLI subprocesses for sub-agent
 * dispatch and phase orchestration.
 *
 * Supports two modes:
 * - **real**: spawns actual `claude` CLI processes
 * - **dryRun**: logs commands without executing, returns mock results
 */
export declare function createAgentLauncher(config: AgentLauncherConfig): AgentLauncher;
//# sourceMappingURL=agentLauncher.d.ts.map