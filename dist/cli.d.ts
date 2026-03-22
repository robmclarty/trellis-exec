#!/usr/bin/env node
import type { TasksJson } from "./types/tasks.js";
export type RunContext = {
    projectRoot: string;
    specPath: string;
    planPath: string;
    guidelinesPath?: string;
    statePath: string;
    trajectoryPath: string;
    checkCommand?: string;
    isolation: "worktree" | "none";
    concurrency: number;
    model?: string;
    maxRetries: number;
    headless: boolean;
    verbose: boolean;
    dryRun: boolean;
    turnLimit: number;
    maxConsecutiveErrors: number;
    pluginRoot: string;
};
export declare function buildRunContext(args: string[], env?: Record<string, string | undefined>): {
    context: RunContext;
    tasksJson: TasksJson;
    phaseId?: string;
};
export declare function parseCompileArgs(args: string[]): {
    planPath: string;
    specPath: string;
    guidelinesPath?: string;
    projectRoot: string;
    outputPath: string;
    enrich: boolean;
};
export declare function parseStatusArgs(args: string[]): {
    tasksJsonPath: string;
};
export declare function checkClaudeAvailable(): boolean;
//# sourceMappingURL=cli.d.ts.map