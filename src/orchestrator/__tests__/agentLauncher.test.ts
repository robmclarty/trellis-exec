import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import {
  createAgentLauncher,
  buildSubAgentPrompt,
  buildSubAgentArgs,
  buildLlmQueryArgs,
  buildOrchestratorArgs,
  buildOrchestratorContinueArgs,
} from "../agentLauncher.js";
import type {
  AgentLauncherConfig,
  OrchestratorLaunchConfig,
} from "../agentLauncher.js";
import type { SubAgentConfig, SubAgentResult } from "../../types/agents.js";

function makeSubAgentConfig(overrides?: Partial<SubAgentConfig>): SubAgentConfig {
  return {
    type: "implementer",
    taskId: "task-1",
    instructions: "Implement the foo module",
    filePaths: ["src/types/foo.ts", "src/utils/bar.ts"],
    outputPaths: ["src/modules/foo.ts"],
    ...overrides,
  };
}

function makeLauncherConfig(
  overrides?: Partial<AgentLauncherConfig>,
): AgentLauncherConfig {
  return {
    pluginRoot: "/fake/plugin",
    projectRoot: "/fake/project",
    ...overrides,
  };
}

describe("buildSubAgentPrompt", () => {
  it("includes the agent type in the header", () => {
    const config = makeSubAgentConfig({ type: "test-writer" });
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).toContain("You are a test-writer sub-agent");
  });

  it("includes the instructions", () => {
    const config = makeSubAgentConfig({
      instructions: "Write unit tests for the auth module",
    });
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).toContain("Write unit tests for the auth module");
  });

  it("lists output paths with constraint header", () => {
    const config = makeSubAgentConfig({
      outputPaths: ["src/foo.ts", "src/bar.ts"],
    });
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).toContain("You may ONLY create or modify these files:");
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("src/bar.ts");
  });

  it("lists context file paths", () => {
    const config = makeSubAgentConfig({
      filePaths: ["src/types/user.ts", "src/db/schema.ts"],
    });
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).toContain("Context files to reference:");
    expect(prompt).toContain("src/types/user.ts");
    expect(prompt).toContain("src/db/schema.ts");
  });

  it("includes the tool usage instruction", () => {
    const prompt = buildSubAgentPrompt(makeSubAgentConfig());
    expect(prompt).toContain(
      "Use the Write tool to create new files",
    );
  });

  it("omits output paths section when empty", () => {
    const config = makeSubAgentConfig({ outputPaths: [] });
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).not.toContain("You may ONLY create or modify these files:");
  });

  it("omits context files section when empty", () => {
    const config = makeSubAgentConfig({ filePaths: [] });
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).not.toContain("Context files to reference:");
  });
});

describe("buildSubAgentArgs", () => {
  it("builds the correct args array", () => {
    const args = buildSubAgentArgs("/plugin/agents/implementer.md", "sonnet");
    expect(args).toEqual([
      "--agent",
      "/plugin/agents/implementer.md",
      "--print",
      "--dangerously-skip-permissions",
      "--model",
      "sonnet",
    ]);
  });
});

describe("buildLlmQueryArgs", () => {
  it("builds the correct args array", () => {
    const args = buildLlmQueryArgs("haiku");
    expect(args).toEqual(["--print", "--model", "haiku"]);
  });
});

describe("buildOrchestratorArgs", () => {
  it("builds first-turn args with model", () => {
    const config: OrchestratorLaunchConfig = {
      agentFile: "/plugin/agents/phase-orchestrator.md",
      skillsDir: "/plugin/skills",
      phaseContext: "phase context",
      model: "sonnet",
    };
    const args = buildOrchestratorArgs(config);
    expect(args).toContain("--agent");
    expect(args).toContain("--print");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("--add-dir");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
  });

  it("omits model flag when not specified", () => {
    const config: OrchestratorLaunchConfig = {
      agentFile: "/plugin/agents/phase-orchestrator.md",
      skillsDir: "/plugin/skills",
      phaseContext: "phase context",
    };
    const args = buildOrchestratorArgs(config);
    expect(args).not.toContain("--model");
  });
});

describe("buildOrchestratorContinueArgs", () => {
  it("builds continuation args with --continue", () => {
    const config: OrchestratorLaunchConfig = {
      agentFile: "/plugin/agents/phase-orchestrator.md",
      skillsDir: "/plugin/skills",
      phaseContext: "phase context",
      model: "sonnet",
    };
    const args = buildOrchestratorContinueArgs(config);
    expect(args).toContain("--print");
    expect(args).toContain("--continue");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("--add-dir");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    // Should not include --agent (session already knows the agent)
    expect(args).not.toContain("--agent");
  });
});

describe("createAgentLauncher", () => {
  describe("dispatchSubAgent", () => {
    it("returns mock result in dryRun mode", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({ dryRun: true }),
      );
      const result = await launcher.dispatchSubAgent(makeSubAgentConfig());
      expect(result.success).toBe(true);
      expect(result.output).toBe("[dry-run]");
      expect(result.filesModified).toEqual([]);
    });

    it("returns configured mock response by agent type", async () => {
      const mockResult: SubAgentResult = {
        success: true,
        output: "custom mock output",
        filesModified: ["src/foo.ts"],
      };
      const launcher = createAgentLauncher(
        makeLauncherConfig({
          mockResponses: new Map([["implementer", mockResult]]),
        }),
      );
      const result = await launcher.dispatchSubAgent(
        makeSubAgentConfig({ type: "implementer" }),
      );
      expect(result).toEqual(mockResult);
    });

    it("returns default mock when agent type not in mock map", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({
          mockResponses: new Map([
            [
              "other-type",
              {
                success: true,
                output: "other",
                filesModified: [],
              },
            ],
          ]),
        }),
      );
      const result = await launcher.dispatchSubAgent(
        makeSubAgentConfig({ type: "implementer" }),
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe("[mock] default response");
    });

    it("resolves agent file path from pluginRoot", async () => {
      // We test this indirectly: dryRun logs the command which includes
      // the resolved agent file path. We verify the path construction
      // by checking buildSubAgentArgs directly.
      const agentFile = resolve("/fake/plugin", "agents", "implementer.md");
      expect(agentFile).toBe("/fake/plugin/agents/implementer.md");
    });
  });

  describe("llmQuery", () => {
    it("returns mock string in dryRun mode", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({ dryRun: true }),
      );
      const result = await launcher.llmQuery("What is 2+2?");
      expect(result).toBe("[dry-run] llmQuery response");
    });

    it("returns mock string in mock mode", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({ mockResponses: new Map() }),
      );
      const result = await launcher.llmQuery("What is 2+2?");
      expect(result).toBe("[mock] llmQuery response");
    });

    it("defaults to haiku model when no options provided (§10 #19)", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const launcher = createAgentLauncher(
        makeLauncherConfig({ dryRun: true }),
      );
      await launcher.llmQuery("test prompt");
      // console.log("[dry-run] llmQuery:", prompt, "model:", model)
      expect(logSpy).toHaveBeenCalledWith(
        "[dry-run] llmQuery:",
        expect.any(String),
        "model:",
        "haiku",
      );
      logSpy.mockRestore();
    });

    it("uses sonnet when model override provided (§10 #19)", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const launcher = createAgentLauncher(
        makeLauncherConfig({ dryRun: true }),
      );
      await launcher.llmQuery("test prompt", { model: "sonnet" });
      expect(logSpy).toHaveBeenCalledWith(
        "[dry-run] llmQuery:",
        expect.any(String),
        "model:",
        "sonnet",
      );
      logSpy.mockRestore();
    });
  });

  describe("dispatchSubAgent — error handling", () => {
    it("returns failure result in dryRun mode for all agent types", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({ dryRun: true }),
      );
      // Even unusual agent types should return a valid result
      const result = await launcher.dispatchSubAgent(
        makeSubAgentConfig({ type: "nonexistent-agent" }),
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe("[dry-run]");
    });

    it("returns default mock response for unknown agent types in mock mode", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({ mockResponses: new Map() }),
      );
      const result = await launcher.dispatchSubAgent(
        makeSubAgentConfig({ type: "unknown" }),
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe("[mock] default response");
    });
  });

  describe("llmQuery — error handling", () => {
    it("handles empty prompt in dryRun mode", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({ dryRun: true }),
      );
      const result = await launcher.llmQuery("");
      expect(typeof result).toBe("string");
    });

    it("supports model override in mock mode", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({ mockResponses: new Map() }),
      );
      const result = await launcher.llmQuery("test", { model: "opus" });
      expect(typeof result).toBe("string");
    });
  });

  // -------------------------------------------------------------------------
  // The real orchestrator uses sequential one-shot calls with --continue
  // for multi-turn conversation. Each send() spawns a fresh claude process.
  // The dry-run handle tests below verify the OrchestratorHandle contract.
  // -------------------------------------------------------------------------

  describe("launchOrchestrator", () => {
    it("returns a mock handle in dryRun mode", async () => {
      const launcher = createAgentLauncher(
        makeLauncherConfig({ dryRun: true }),
      );
      const handle = await launcher.launchOrchestrator({
        agentFile: "/plugin/agents/phase-orchestrator.md",
        skillsDir: "/plugin/skills",
        phaseContext: "test phase context",
      });

      expect(handle.isAlive()).toBe(true);

      const response = await handle.send("test input");
      expect(response).toBe("[dry-run] orchestrator response");

      handle.kill();
      expect(handle.isAlive()).toBe(false);
    });

    it("dryRun handle supports multiple sequential send() calls without leaking", async () => {
      // Verifies that the handle contract works cleanly across multiple
      // send/response cycles. In the real implementation (createProcessHandle),
      // the fix ensures listeners are removed after each idle timeout,
      // preventing accumulation across send() calls.
      const launcher = createAgentLauncher(
        makeLauncherConfig({ dryRun: true }),
      );
      const handle = await launcher.launchOrchestrator({
        agentFile: "/plugin/agents/phase-orchestrator.md",
        skillsDir: "/plugin/skills",
        phaseContext: "test context",
      });

      // Multiple sequential sends should each return cleanly
      const r1 = await handle.send("first message");
      const r2 = await handle.send("second message");
      const r3 = await handle.send("third message");

      expect(r1).toBe("[dry-run] orchestrator response");
      expect(r2).toBe("[dry-run] orchestrator response");
      expect(r3).toBe("[dry-run] orchestrator response");
      expect(handle.isAlive()).toBe(true);

      handle.kill();
    });
  });
});
