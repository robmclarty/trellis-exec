/**
 * Returns true if any newly added files look like test files.
 */
export declare function hasNewTestFiles(projectRoot: string, startSha?: string): boolean;
/**
 * Attempts to detect a test command from the project.
 * Returns null if no test runner can be identified.
 */
export declare function detectTestCommand(projectRoot: string): string | null;
//# sourceMappingURL=testDetector.d.ts.map