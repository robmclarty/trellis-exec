import type { CheckResult } from "../types/state.js";
export type CheckConfig = {
    command: string;
    cwd: string;
    timeout?: number;
};
export type CheckRunner = {
    run(): Promise<CheckResult>;
};
/**
 * Creates a check runner that executes a shell command and captures the result.
 *
 * The runner executes the configured command in the specified working directory,
 * captures stdout and stderr, and returns a CheckResult indicating pass/fail.
 * On timeout, returns a failure with a descriptive message.
 *
 * @param config - Check runner configuration
 * @param config.command - Shell command to execute (e.g., "npm run lint && npm test")
 * @param config.cwd - Working directory for the command
 * @param config.timeout - Timeout in milliseconds (default: 120000)
 * @returns A CheckRunner object with a run() method
 */
export declare function createCheckRunner(config: CheckConfig): CheckRunner;
//# sourceMappingURL=checkRunner.d.ts.map