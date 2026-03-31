export type PermissionArgsConfig = {
    unsafeMode?: boolean | undefined;
    containerMode?: boolean | undefined;
    readOnly?: boolean | undefined;
    maxBudgetUsd?: number | undefined;
};
declare const READ_ONLY_TOOLS: string[];
declare const SAFE_MODE_TOOLS: string[];
declare const SAFE_MODE_ALLOWED: string[];
declare const SAFE_MODE_DENIED: string[];
export { READ_ONLY_TOOLS, SAFE_MODE_TOOLS, SAFE_MODE_ALLOWED, SAFE_MODE_DENIED };
export declare function isReadOnlyAgent(type: string): boolean;
/**
 * Builds CLI permission args for a Claude subprocess based on execution mode
 * and agent role. Checked in priority order:
 *
 * 1. readOnly (judge/reporter) — applies in ALL modes
 * 2. containerMode (worker) — full access, container is the boundary
 * 3. unsafeMode (worker) — legacy unrestricted
 * 4. default/safe (worker) — granular allow/deny
 */
export declare function buildPermissionArgs(config: PermissionArgsConfig): string[];
//# sourceMappingURL=permissionArgs.d.ts.map