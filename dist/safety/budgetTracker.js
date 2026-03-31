// ---
// Budget enforcement for cumulative run-level spending
// ---
export function createBudgetState() {
    return { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 };
}
export function updateBudget(state, usage) {
    return {
        totalInputTokens: state.totalInputTokens + usage.inputTokens,
        totalOutputTokens: state.totalOutputTokens + usage.outputTokens,
        totalCostUsd: state.totalCostUsd + usage.costUsd,
    };
}
export function checkBudget(state, config) {
    const totalTokens = state.totalInputTokens + state.totalOutputTokens;
    if (config.maxTokens !== undefined && totalTokens >= config.maxTokens) {
        return {
            exceeded: true,
            reason: `Token budget exceeded: ${totalTokens.toLocaleString()} used, limit ${config.maxTokens.toLocaleString()}`,
        };
    }
    if (config.maxCostUsd !== undefined && state.totalCostUsd >= config.maxCostUsd) {
        return {
            exceeded: true,
            reason: `Cost budget exceeded: $${state.totalCostUsd.toFixed(2)} spent, limit $${config.maxCostUsd.toFixed(2)}`,
        };
    }
    return { exceeded: false };
}
//# sourceMappingURL=budgetTracker.js.map