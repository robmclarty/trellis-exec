import type { AgentLauncher } from "../orchestrator/agentLauncher.js";
import type { DevServerHandle } from "./devServer.js";
import type { BrowserAcceptanceReport } from "../types/state.js";
export type BrowserAcceptanceConfig = {
    specPath: string;
    projectRoot: string;
    devServerHandle: DevServerHandle;
    maxRetries: number;
    saveTests: boolean;
    testOutputDir?: string;
    agentLauncher: AgentLauncher;
    verbose?: boolean;
};
/**
 * Runs the end-of-build browser acceptance test cycle.
 *
 * 1. Dispatches the browser-tester agent to generate and run Playwright tests
 * 2. If failures exist, dispatches the browser-fixer agent to fix app code
 * 3. Re-runs the browser-tester to verify fixes
 * 4. Loops up to maxRetries times
 * 5. Optionally saves generated tests to the project
 */
export declare function runBrowserAcceptance(config: BrowserAcceptanceConfig): Promise<BrowserAcceptanceReport>;
//# sourceMappingURL=browserAcceptance.d.ts.map