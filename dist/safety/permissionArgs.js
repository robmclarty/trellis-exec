// ---
// Permission args builder for Claude CLI subprocesses
// ---
// ---
// Tool lists
// ---
const READ_ONLY_TOOLS = [
    "Read", "Glob", "Grep", "WebFetch", "WebSearch",
];
const SAFE_MODE_TOOLS = [
    "Read", "Write", "Edit", "Glob", "Grep",
    "WebFetch", "WebSearch", "Agent", "Bash",
];
const SAFE_MODE_ALLOWED = [
    "Read", "Write", "Edit", "Glob", "Grep",
    "WebFetch", "WebSearch", "Agent",
    "Bash(npm test)", "Bash(npm run build)", "Bash(npx tsc)",
    "Bash(npx vitest run)", "Bash(npx jest)",
    "Bash(git status)", "Bash(git diff)", "Bash(git log)",
    "Bash(git add)", "Bash(git commit)",
    "Bash(ls)", "Bash(mkdir)", "Bash(cp)", "Bash(mv)",
    "Bash(cat)", "Bash(head)", "Bash(tail)",
    "Bash(node)",
];
const SAFE_MODE_DENIED = [
    "Bash(curl)", "Bash(wget)", "Bash(ssh)", "Bash(scp)",
    "Bash(git push)", "Bash(git remote)", "Bash(npm publish)",
    "Bash(npx -y)", "Bash(rm -rf /)", "Bash(rm -rf ~)",
    "Bash(sudo)", "Bash(chmod)", "Bash(chown)",
];
// ---
// Exports
// ---
export { READ_ONLY_TOOLS, SAFE_MODE_TOOLS, SAFE_MODE_ALLOWED, SAFE_MODE_DENIED };
const READ_ONLY_AGENT_TYPES = new Set(["judge", "reporter"]);
export function isReadOnlyAgent(type) {
    return READ_ONLY_AGENT_TYPES.has(type);
}
/**
 * Builds CLI permission args for a Claude subprocess based on execution mode
 * and agent role. Checked in priority order:
 *
 * 1. readOnly (judge/reporter) — applies in ALL modes
 * 2. containerMode (worker) — full access, container is the boundary
 * 3. unsafeMode (worker) — legacy unrestricted
 * 4. default/safe (worker) — granular allow/deny
 */
export function buildPermissionArgs(config) {
    const { unsafeMode, containerMode, readOnly, maxBudgetUsd } = config;
    const budgetArgs = maxBudgetUsd
        ? ["--max-budget-usd", String(maxBudgetUsd)]
        : [];
    // Role constraint: read-only agents (judge, reporter).
    // Checked FIRST. Applies in ALL modes — safe, unsafe, container.
    // --tools removes tools from context so Claude never attempts them.
    if (readOnly) {
        return [
            "--permission-mode", "dontAsk",
            ...READ_ONLY_TOOLS.flatMap((t) => ["--tools", t]),
            ...READ_ONLY_TOOLS.flatMap((t) => ["--allowedTools", t]),
            ...budgetArgs,
        ];
    }
    // Container mode: full access for worker agents.
    // The container (network=none, bind-mount, resource limits) is the boundary.
    // --bare skips hooks/LSP/plugins/CLAUDE.md for faster startup.
    if (containerMode) {
        return ["--dangerously-skip-permissions", "--bare", ...budgetArgs];
    }
    // Unsafe mode: legacy behavior, explicit opt-in.
    if (unsafeMode) {
        return ["--dangerously-skip-permissions", ...budgetArgs];
    }
    // Default (safe mode): locked-down worker agents.
    // --permission-mode dontAsk: anything not in allowedTools is denied silently.
    // --tools: limits what Claude sees in context.
    // --allowedTools: auto-approves specific patterns.
    // --disallowedTools: hard-blocks dangerous patterns.
    return [
        "--permission-mode", "dontAsk",
        ...SAFE_MODE_TOOLS.flatMap((t) => ["--tools", t]),
        ...SAFE_MODE_ALLOWED.flatMap((t) => ["--allowedTools", t]),
        ...SAFE_MODE_DENIED.flatMap((t) => ["--disallowedTools", t]),
        ...budgetArgs,
    ];
}
//# sourceMappingURL=permissionArgs.js.map