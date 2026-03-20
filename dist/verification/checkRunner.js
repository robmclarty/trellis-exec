import { exec } from "node:child_process";
const DEFAULT_TIMEOUT = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;
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
export function createCheckRunner(config) {
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    return {
        run() {
            return new Promise((resolve) => {
                exec(config.command, { cwd: config.cwd, timeout, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
                    const output = (stdout + stderr).trim();
                    if (!error) {
                        resolve({ passed: true, output, exitCode: 0 });
                        return;
                    }
                    if ("killed" in error && error.killed) {
                        resolve({
                            passed: false,
                            output: `Check timed out after ${timeout}ms`,
                            exitCode: 1,
                        });
                        return;
                    }
                    const exitCode = "code" in error && typeof error.code === "number"
                        ? error.code
                        : 1;
                    resolve({ passed: false, output, exitCode });
                });
            });
        },
    };
}
//# sourceMappingURL=checkRunner.js.map