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
    concurrency: number;
    model?: string;
    maxRetries: number;
    headless: boolean;
    verbose: boolean;
    dryRun: boolean;
    pluginRoot: string;
    judgeMode: "always" | "on-failure" | "never";
    judgeModel?: string;
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
    timeout?: number;
};
export declare function parseStatusArgs(args: string[]): {
    tasksJsonPath: string;
};
export declare function checkClaudeAvailable(): boolean;
//# sourceMappingURL=cli.d.ts.map