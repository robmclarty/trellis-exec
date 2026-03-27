import type { Phase } from "../types/tasks.js";
import type { PhaseReport } from "../types/state.js";
export type CompletionVerification = {
    passed: boolean;
    failures: string[];
};
/**
 * Lightweight deterministic verification after judge corrections are applied.
 * Catches lazy-completion patterns (missing files, leftover TODOs).
 *
 * Target path mismatches (e.g., .css vs .module.css, .js vs .jsx) are handled
 * upstream by the judge's corrections mechanism, which updates tasks.json
 * before this function runs. No extension-variant guessing needed here.
 */
export declare function verifyCompletion(projectRoot: string, phase: Phase, report: PhaseReport, startSha?: string): CompletionVerification;
//# sourceMappingURL=completionVerifier.d.ts.map