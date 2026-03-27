import type { TasksJson, Phase } from "../types/tasks.js";
import type { RunContext } from "../types/runner.js";
import type { BrowserSmokeReport, BrowserAcceptanceReport } from "../types/state.js";
export declare function runBrowserSmokeForPhase(ctx: RunContext, phase: Phase, projectRoot: string): Promise<BrowserSmokeReport | null>;
export declare function runEndOfBuildAcceptance(ctx: RunContext, tasksJson: TasksJson, projectRoot: string): Promise<BrowserAcceptanceReport | null>;
//# sourceMappingURL=browserRunner.d.ts.map