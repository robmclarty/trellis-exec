import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import {
  buildSubAgentPrompt,
  buildSubAgentArgs,
  execClaude,
  createAgentLauncher,
} from "../agentLauncher.js";
import { spawn } from "node:child_process";
import type { SubAgentConfig } from "../../types/agents.js";

const mockedSpawn = vi.mocked(spawn);

function makeSubAgentConfig(
  overrides?: Partial<SubAgentConfig>,
): SubAgentConfig {
  return {
    taskId: "task-1",
    type: "implement",
    instructions: "Build the thing",
    outputPaths: ["src/out.ts"],
    filePaths: ["src/ref.ts"],
    model: "sonnet",
    ...overrides,
  };
}

function createMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
    kill: vi.fn(),
    pid: 1234,
  });
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSubAgentPrompt", () => {
  it("includes type, instructions, outputPaths, filePaths, and tool reminder", () => {
    const config = makeSubAgentConfig();
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).toContain("implement sub-agent");
    expect(prompt).toContain("Build the thing");
    expect(prompt).toContain("You may ONLY create or modify");
    expect(prompt).toContain("src/out.ts");
    expect(prompt).toContain("Context files to reference");
    expect(prompt).toContain("src/ref.ts");
    expect(prompt).toContain("Write tool");
  });

  it("omits outputPaths section when empty", () => {
    const config = makeSubAgentConfig({ outputPaths: [] });
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).not.toContain("You may ONLY create or modify");
  });

  it("omits filePaths section when empty", () => {
    const config = makeSubAgentConfig({ filePaths: [] });
    const prompt = buildSubAgentPrompt(config);
    expect(prompt).not.toContain("Context files to reference");
  });
});

describe("buildSubAgentArgs", () => {
  it("returns correct flags array", () => {
    const args = buildSubAgentArgs("/path/to/agent.md", "sonnet");
    expect(args).toEqual([
      "--agent",
      "/path/to/agent.md",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--model",
      "sonnet",
    ]);
  });
});

describe("execClaude", () => {
  it("resolves with stdout, stderr, and exitCode on success", async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValueOnce(proc as never);

    const promise = execClaude(["--print"], "/tmp");

    proc.stdout.emit("data", Buffer.from("output"));
    proc.stderr.emit("data", Buffer.from("logs"));
    proc.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "output",
      stderr: "logs",
      exitCode: 0,
    });
  });

  it("resolves with non-zero exit code", async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValueOnce(proc as never);

    const promise = execClaude(["--print"], "/tmp");
    proc.emit("close", 1);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects on timeout and kills the process", async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockedSpawn.mockReturnValueOnce(proc as never);

    const promise = execClaude(["--print"], "/tmp", { timeout: 100 });
    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow("timed out");
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    vi.useRealTimers();
  });

  it("invokes onStdout and onStderr callbacks per chunk", async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValueOnce(proc as never);

    const onStdout = vi.fn();
    const onStderr = vi.fn();
    const promise = execClaude(["--print"], "/tmp", { onStdout, onStderr });

    proc.stdout.emit("data", Buffer.from("hello"));
    proc.stderr.emit("data", Buffer.from("warn"));
    proc.emit("close", 0);

    await promise;
    expect(onStdout).toHaveBeenCalledWith("hello");
    expect(onStderr).toHaveBeenCalledWith("warn");
  });

  it("pipes stdin when provided", async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValueOnce(proc as never);

    const promise = execClaude(["--print"], "/tmp", { stdin: "input data" });
    proc.emit("close", 0);

    await promise;
    expect(proc.stdin.write).toHaveBeenCalledWith("input data");
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it("rejects on process error", async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValueOnce(proc as never);

    const promise = execClaude(["--print"], "/tmp");
    proc.emit("error", new Error("spawn ENOENT"));

    await expect(promise).rejects.toThrow("spawn ENOENT");
  });
});

describe("createAgentLauncher", () => {
  it("dryRun dispatchSubAgent returns mock result without spawning", async () => {
    const launcher = createAgentLauncher({
      pluginRoot: "/plugin",
      projectRoot: "/project",
      dryRun: true,
    });

    const result = await launcher.dispatchSubAgent(makeSubAgentConfig());
    expect(result.success).toBe(true);
    expect(result.output).toBe("[dry-run]");
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("dryRun runPhaseOrchestrator returns mock result without spawning", async () => {
    const launcher = createAgentLauncher({
      pluginRoot: "/plugin",
      projectRoot: "/project",
      dryRun: true,
    });

    const result = await launcher.runPhaseOrchestrator(
      "prompt",
      "/path/to/agent.md",
    );
    expect(result.stdout).toBe("[dry-run]");
    expect(result.exitCode).toBe(0);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("runPhaseOrchestrator with verbose includes stream-json args", async () => {
    const proc = createMockProcess();
    mockedSpawn.mockReturnValueOnce(proc as never);

    const launcher = createAgentLauncher({
      pluginRoot: "/plugin",
      projectRoot: "/project",
    });

    const promise = launcher.runPhaseOrchestrator(
      "prompt",
      "/path/to/agent.md",
      "opus",
      { verbose: true },
    );
    proc.emit("close", 0);
    await promise;

    const spawnArgs = mockedSpawn.mock.calls[0]![1] as string[];
    expect(spawnArgs).toContain("--output-format");
    expect(spawnArgs).toContain("stream-json");
    expect(spawnArgs).toContain("--verbose");
  });
});
