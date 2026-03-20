import type { ReplHelpers } from "./replHelpers.js";
export type ReplSessionConfig = {
    projectRoot: string;
    outputLimit: number;
    timeout: number;
    helpers: ReplHelpers;
};
export type ReplEvalResult = {
    success: boolean;
    output: string;
    truncated: boolean;
    error?: string;
    duration: number;
};
export type ReplSession = {
    eval(code: string): Promise<ReplEvalResult>;
    restoreScaffold(): void;
    getConsecutiveErrors(): number;
    resetConsecutiveErrors(): void;
    destroy(): void;
};
/**
 * Creates a sandboxed REPL session using node:vm. The session injects helper
 * functions into the vm context and provides eval, scaffold restoration, and
 * consecutive error tracking.
 */
export declare function createReplSession(config: ReplSessionConfig): ReplSession;
//# sourceMappingURL=replManager.d.ts.map