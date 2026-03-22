import type { SharedState, PhaseReport, CheckResult } from "../types/state.js";
import type { SubAgentConfig, SubAgentResult } from "../types/agents.js";
export type AgentLauncher = (config: SubAgentConfig) => Promise<SubAgentResult>;
export type ReplHelpersConfig = {
    projectRoot: string;
    statePath: string;
    agentLauncher: AgentLauncher | null;
};
export type ReplHelpers = {
    readFile(path: string): string;
    listDir(path: string): Array<{
        name: string;
        type: "file" | "dir";
        size: number;
    }>;
    searchFiles(pattern: string, glob?: string): Array<{
        path: string;
        line: number;
        content: string;
    }>;
    getState(): SharedState;
    writePhaseReport(report: PhaseReport): void;
    dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>;
    runCheck(): Promise<CheckResult>;
    llmQuery(prompt: string, options?: {
        model?: string;
    }): Promise<string>;
};
/**
 * Creates the REPL helper functions that are injected into the orchestrator's
 * vm sandbox. Filesystem helpers use real implementations; LLM-dependent
 * helpers are stubs that log and return mock responses.
 */
export declare function createReplHelpers(config: ReplHelpersConfig): ReplHelpers;
//# sourceMappingURL=replHelpers.d.ts.map