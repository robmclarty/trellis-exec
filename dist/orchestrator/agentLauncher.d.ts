import type { SubAgentConfig, SubAgentResult } from "../types/agents.js";
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
    llmQuery(prompt: string, options?: {
        model?: string;
    }): Promise<string>;
    launchOrchestrator(config: OrchestratorLaunchConfig): Promise<OrchestratorHandle>;
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
 * Builds the CLI args array for an llmQuery call.
 */
export declare function buildLlmQueryArgs(model: string): string[];
/**
 * Builds the CLI args for the first orchestrator turn.
 * Subsequent turns use --continue to resume the session.
 */
export declare function buildOrchestratorArgs(config: OrchestratorLaunchConfig): string[];
/**
 * Builds the CLI args for continuing an orchestrator session (turn 2+).
 */
export declare function buildOrchestratorContinueArgs(config: OrchestratorLaunchConfig): string[];
/**
 * Creates an AgentLauncher that manages claude CLI subprocesses for sub-agent
 * dispatch, LLM queries, and long-running orchestrator sessions.
 *
 * Supports three modes:
 * - **real**: spawns actual `claude` CLI processes
 * - **dryRun**: logs commands without executing, returns mock results
 * - **mock**: returns pre-configured responses from `mockResponses` map
 */
export declare function createAgentLauncher(config: AgentLauncherConfig): AgentLauncher;
//# sourceMappingURL=agentLauncher.d.ts.map