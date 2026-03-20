#!/usr/bin/env node
import type { PhaseRunnerConfig } from "./runner/phaseRunner.js";
export declare function buildRunConfig(args: string[], env?: Record<string, string | undefined>): PhaseRunnerConfig;
export declare function parseCompileArgs(args: string[]): {
    planPath: string;
    specPath: string;
    outputPath: string;
};
export declare function parseStatusArgs(args: string[]): {
    tasksJsonPath: string;
};
//# sourceMappingURL=cli.d.ts.map