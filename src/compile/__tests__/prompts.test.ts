import { describe, it, expect } from "vitest";
import { buildDecomposePrompt } from "../prompts.js";

describe("buildDecomposePrompt", () => {
  const planContent = "## S1 — Architecture\nSome architecture details.";
  const specContent = "## §1 — Context\nSome spec content.";
  const specRef = "spec.md";
  const planRef = "plan.md";

  it("includes spec content in the prompt", () => {
    const prompt = buildDecomposePrompt(planContent, specContent, specRef, planRef, ".");
    expect(prompt).toContain(specContent);
    expect(prompt).toContain("<spec>");
  });

  it("includes plan content in the prompt", () => {
    const prompt = buildDecomposePrompt(planContent, specContent, specRef, planRef, ".");
    expect(prompt).toContain(planContent);
    expect(prompt).toContain("<plan>");
  });

  it("includes guidelines content when provided", () => {
    const guidelinesContent = "## Stack\nReact, Vite, CSS Modules";
    const prompt = buildDecomposePrompt(
      planContent,
      specContent,
      specRef,
      planRef,
      ".",
      guidelinesContent,
      "guidelines.md",
    );
    expect(prompt).toContain(guidelinesContent);
    expect(prompt).toContain("<guidelines>");
    expect(prompt).toContain("Guidelines");
  });

  it("omits guidelines section when not provided", () => {
    const prompt = buildDecomposePrompt(planContent, specContent, specRef, planRef, ".");
    expect(prompt).not.toContain("<guidelines>");
    expect(prompt).not.toContain("Guidelines Reference");
  });

  it("includes guidelinesRef in the schema when provided", () => {
    const prompt = buildDecomposePrompt(
      planContent,
      specContent,
      specRef,
      planRef,
      ".",
      "some guidelines",
      "guidelines.md",
    );
    expect(prompt).toContain('"guidelinesRef": "guidelines.md"');
  });

  it("omits guidelinesRef from schema when not provided", () => {
    const prompt = buildDecomposePrompt(planContent, specContent, specRef, planRef, ".");
    expect(prompt).not.toContain("guidelinesRef");
  });

  it("includes specRef and planRef in the schema", () => {
    const prompt = buildDecomposePrompt(planContent, specContent, specRef, planRef, ".");
    expect(prompt).toContain(`"specRef": "${specRef}"`);
    expect(prompt).toContain(`"planRef": "${planRef}"`);
  });

  it("includes decomposition rules for task sizing and phasing", () => {
    const prompt = buildDecomposePrompt(planContent, specContent, specRef, planRef, ".");
    expect(prompt).toContain("subAgentType");
    expect(prompt).toContain("dependsOn");
    expect(prompt).toContain("targetPaths");
    expect(prompt).toContain("acceptanceCriteria");
  });
});
