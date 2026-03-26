import type { Phase } from "../types/tasks.js";
import type { PhaseReport } from "../types/state.js";
export type CompletionVerification = {
    passed: boolean;
    failures: string[];
};
/**
 * Lightweight deterministic verification after orchestrator reports "complete."
 * Catches lazy-completion patterns before the expensive judge invocation.
 */
export declare function verifyCompletion(projectRoot: string, phase: Phase, report: PhaseReport, startSha?: string): CompletionVerification;
//# sourceMappingURL=completionVerifier.d.ts.map