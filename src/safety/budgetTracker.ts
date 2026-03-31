// ---
// Budget enforcement for cumulative run-level spending
// ---

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

export function createBudgetState(): BudgetState {
  return { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 };
}

export function updateBudget(
  state: BudgetState,
  usage: UsageStats,
): BudgetState {
  return {
    totalInputTokens: state.totalInputTokens + usage.inputTokens,
    totalOutputTokens: state.totalOutputTokens + usage.outputTokens,
    totalCostUsd: state.totalCostUsd + usage.costUsd,
  };
}

export function checkBudget(
  state: BudgetState,
  config: BudgetConfig,
): BudgetCheckResult {
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
