import { describe, it, expect } from "vitest";
import {
  createBudgetState,
  updateBudget,
  checkBudget,
} from "../budgetTracker.js";

describe("createBudgetState", () => {
  it("returns zeroed state", () => {
    const state = createBudgetState();
    expect(state.totalInputTokens).toBe(0);
    expect(state.totalOutputTokens).toBe(0);
    expect(state.totalCostUsd).toBe(0);
  });
});

describe("updateBudget", () => {
  it("accumulates usage stats", () => {
    let state = createBudgetState();
    state = updateBudget(state, { inputTokens: 100, outputTokens: 50, costUsd: 0.5 });
    expect(state.totalInputTokens).toBe(100);
    expect(state.totalOutputTokens).toBe(50);
    expect(state.totalCostUsd).toBe(0.5);

    state = updateBudget(state, { inputTokens: 200, outputTokens: 75, costUsd: 1.0 });
    expect(state.totalInputTokens).toBe(300);
    expect(state.totalOutputTokens).toBe(125);
    expect(state.totalCostUsd).toBe(1.5);
  });

  it("returns a new object (immutable)", () => {
    const state = createBudgetState();
    const updated = updateBudget(state, { inputTokens: 10, outputTokens: 5, costUsd: 0.1 });
    expect(state.totalInputTokens).toBe(0);
    expect(updated.totalInputTokens).toBe(10);
  });
});

describe("checkBudget", () => {
  it("returns not exceeded when under limits", () => {
    const state = { totalInputTokens: 100, totalOutputTokens: 50, totalCostUsd: 1.0 };
    const result = checkBudget(state, { maxTokens: 1000, maxCostUsd: 10.0 });
    expect(result.exceeded).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("detects token budget exceeded", () => {
    const state = { totalInputTokens: 600, totalOutputTokens: 500, totalCostUsd: 1.0 };
    const result = checkBudget(state, { maxTokens: 1000 });
    expect(result.exceeded).toBe(true);
    expect(result.reason).toContain("Token budget exceeded");
    expect(result.reason).toContain("1,100");
    expect(result.reason).toContain("1,000");
  });

  it("detects cost budget exceeded", () => {
    const state = { totalInputTokens: 100, totalOutputTokens: 50, totalCostUsd: 10.5 };
    const result = checkBudget(state, { maxCostUsd: 10.0 });
    expect(result.exceeded).toBe(true);
    expect(result.reason).toContain("Cost budget exceeded");
    expect(result.reason).toContain("$10.50");
    expect(result.reason).toContain("$10.00");
  });

  it("returns not exceeded when no limits configured", () => {
    const state = { totalInputTokens: 999999, totalOutputTokens: 999999, totalCostUsd: 999.99 };
    const result = checkBudget(state, {});
    expect(result.exceeded).toBe(false);
  });

  it("checks tokens before cost", () => {
    const state = { totalInputTokens: 600, totalOutputTokens: 500, totalCostUsd: 20.0 };
    const result = checkBudget(state, { maxTokens: 1000, maxCostUsd: 10.0 });
    expect(result.exceeded).toBe(true);
    expect(result.reason).toContain("Token budget exceeded");
  });

  it("detects exact boundary (>=)", () => {
    const state = { totalInputTokens: 500, totalOutputTokens: 500, totalCostUsd: 0 };
    const result = checkBudget(state, { maxTokens: 1000 });
    expect(result.exceeded).toBe(true);
  });
});
