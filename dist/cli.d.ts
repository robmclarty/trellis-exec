#!/usr/bin/env node
import type { TasksJson } from "./types/tasks.js";
import type { RunContext } from "./types/runner.js";
export type { RunContext } from "./types/runner.js";
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