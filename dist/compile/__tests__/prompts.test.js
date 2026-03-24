import { describe, it, expect } from "vitest";
import { buildDecomposePrompt, buildEnrichmentPrompt } from "../prompts.js";
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
        const prompt = buildDecomposePrompt(planContent, specContent, specRef, planRef, ".", guidelinesContent, "guidelines.md");
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
        const prompt = buildDecomposePrompt(planContent, specContent, specRef, planRef, ".", "some guidelines", "guidelines.md");
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
// ---------------------------------------------------------------------------
// buildEnrichmentPrompt
// ---------------------------------------------------------------------------
function makeTask(overrides) {
    return {
        id: "task-1",
        title: "Build feature",
        description: "Implement the feature",
        dependsOn: [],
        specSections: ["§1"],
        targetPaths: ["src/feature.ts"],
        acceptanceCriteria: ["tests pass"],
        subAgentType: "implement",
        status: "pending",
        ...overrides,
    };
}
function makeFlag(overrides) {
    return {
        taskId: "task-1",
        field: "dependsOn",
        context: "references task-2 which exists",
        reason: "could not resolve dependency",
        ...overrides,
    };
}
describe("buildEnrichmentPrompt", () => {
    it("includes flag details and matching task context", () => {
        const tasks = [makeTask()];
        const flags = [makeFlag()];
        const prompt = buildEnrichmentPrompt(flags, tasks);
        expect(prompt).toContain("task-1");
        expect(prompt).toContain("dependsOn");
        expect(prompt).toContain("could not resolve dependency");
        expect(prompt).toContain("references task-2 which exists");
        expect(prompt).toContain("Build feature");
        expect(prompt).toContain("Implement the feature");
    });
    it("includes multiple flags", () => {
        const tasks = [
            makeTask({ id: "task-1", title: "Feature A" }),
            makeTask({ id: "task-2", title: "Feature B" }),
        ];
        const flags = [
            makeFlag({ taskId: "task-1", field: "dependsOn" }),
            makeFlag({ taskId: "task-2", field: "subAgentType" }),
        ];
        const prompt = buildEnrichmentPrompt(flags, tasks);
        expect(prompt).toContain("Feature A");
        expect(prompt).toContain("Feature B");
        expect(prompt).toContain("subAgentType");
    });
    it("shows (task not found) for flags referencing missing tasks", () => {
        const tasks = [makeTask({ id: "task-1" })];
        const flags = [makeFlag({ taskId: "task-999" })];
        const prompt = buildEnrichmentPrompt(flags, tasks);
        expect(prompt).toContain("task-999");
        expect(prompt).toContain("(task not found)");
    });
    it("lists all available task IDs", () => {
        const tasks = [
            makeTask({ id: "task-1" }),
            makeTask({ id: "task-2" }),
            makeTask({ id: "task-3" }),
        ];
        const flags = [makeFlag()];
        const prompt = buildEnrichmentPrompt(flags, tasks);
        expect(prompt).toContain(JSON.stringify(["task-1", "task-2", "task-3"]));
    });
    it("includes field type guidance", () => {
        const prompt = buildEnrichmentPrompt([makeFlag()], [makeTask()]);
        expect(prompt).toContain('"dependsOn"');
        expect(prompt).toContain('"subAgentType"');
        expect(prompt).toContain('"acceptanceCriteria"');
        expect(prompt).toContain("implement");
        expect(prompt).toContain("test-writer");
        expect(prompt).toContain("scaffold");
        expect(prompt).toContain("judge");
    });
});
//# sourceMappingURL=prompts.test.js.map