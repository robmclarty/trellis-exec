import type { UsageStats } from "../ui/streamParser.js";
export type BudgetConfig = {
    maxTokens?: number | undefined;
    maxCostUsd?: number | undefined;
};
export type BudgetState = {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
};
export type BudgetCheckResult = {
    exceeded: boolean;
    reason?: string;
};
export declare function createBudgetState(): BudgetState;
export declare function updateBudget(state: BudgetState, usage: UsageStats): BudgetState;
export declare function checkBudget(state: BudgetState, config: BudgetConfig): BudgetCheckResult;
//# sourceMappingURL=budgetTracker.d.ts.map