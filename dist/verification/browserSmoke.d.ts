import type { BrowserSmokeReport } from "../types/state.js";
export type BrowserSmokeConfig = {
    url: string;
    phaseId: string;
    timeout?: number;
    screenshotDir?: string;
};
/**
 * Checks if Playwright is importable. Caches the result.
 */
export declare function isPlaywrightAvailable(): Promise<boolean>;
/**
 * Runs a deterministic browser smoke test against a URL.
 * No LLM involved — fixed Playwright script that:
 * 1. Loads the page
 * 2. Collects console errors
 * 3. Checks the page isn't blank
 * 4. Clicks interactive elements and checks nothing crashes
 * 5. Takes a screenshot
 */
export declare function runBrowserSmoke(config: BrowserSmokeConfig): Promise<BrowserSmokeReport>;
//# sourceMappingURL=browserSmoke.d.ts.map