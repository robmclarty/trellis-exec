import type { SubAgentConfig, SubAgentResult } from "../types/agents.js";
export declare const COMPILE_TIMEOUT = 600000;
export declare const LONG_RUN_TIMEOUT = 7200000;
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
    /** Stream NDJSON events via --output-format stream-json */
    verbose?: boolean;
    /** Override the default orchestrator timeout (milliseconds) */
    timeout?: number;
    onStdout?: ((chunk: string) => void) | undefined;
    onStderr?: ((chunk: string) => void) | undefined;
};
export type AgentLauncher = {
    dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>;
    runPhaseOrchestrator(prompt: string, agentFile: string, model?: string, options?: OrchestratorOptions): Promise<ExecClaudeResult>;
};
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
export declare function execClaude(args: string[], cwd: string, options?: ExecClaudeOptions): Promise<ExecClaudeResult>;
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