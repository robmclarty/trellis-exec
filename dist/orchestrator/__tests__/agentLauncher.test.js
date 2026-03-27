import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
vi.mock("node:child_process", () => ({
    spawn: vi.fn(),
}));
import { execClaude, createAgentLauncher, } from "../agentLauncher.js";
import { spawn } from "node:child_process";
const mockedSpawn = vi.mocked(spawn);
function makeSubAgentConfig(overrides) {
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
describe("execClaude", () => {
    it("resolves with stdout, stderr, and exitCode on success", async () => {
        const proc = createMockProcess();
        mockedSpawn.mockReturnValueOnce(proc);
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
        mockedSpawn.mockReturnValueOnce(proc);
        const promise = execClaude(["--print"], "/tmp");
        proc.emit("close", 1);
        const result = await promise;
        expect(result.exitCode).toBe(1);
    });
    it("rejects on timeout and kills the process", async () => {
        vi.useFakeTimers();
        const proc = createMockProcess();
        mockedSpawn.mockReturnValueOnce(proc);
        const promise = execClaude(["--print"], "/tmp", { timeout: 100 });
        vi.advanceTimersByTime(100);
        await expect(promise).rejects.toThrow("timed out");
        expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
        vi.useRealTimers();
    });
    it("invokes onStdout and onStderr callbacks per chunk", async () => {
        const proc = createMockProcess();
        mockedSpawn.mockReturnValueOnce(proc);
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
        mockedSpawn.mockReturnValueOnce(proc);
        const promise = execClaude(["--print"], "/tmp", { stdin: "input data" });
        proc.emit("close", 0);
        await promise;
        expect(proc.stdin.write).toHaveBeenCalledWith("input data");
        expect(proc.stdin.end).toHaveBeenCalled();
    });
    it("rejects on process error", async () => {
        const proc = createMockProcess();
        mockedSpawn.mockReturnValueOnce(proc);
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
        const result = await launcher.runPhaseOrchestrator("prompt", "/path/to/agent.md");
        expect(result.stdout).toBe("[dry-run]");
        expect(result.exitCode).toBe(0);
        expect(mockedSpawn).not.toHaveBeenCalled();
    });
    it("dispatchSubAgent returns success:false with stderr when CLI exits non-zero", async () => {
        const proc = createMockProcess();
        mockedSpawn.mockReturnValueOnce(proc);
        const launcher = createAgentLauncher({
            pluginRoot: "/plugin",
            projectRoot: "/project",
        });
        const promise = launcher.dispatchSubAgent(makeSubAgentConfig());
        // Simulate CLI failing with empty stdout and an error on stderr
        // (e.g. missing --verbose for stream-json)
        proc.stderr.emit("data", Buffer.from("Error: --output-format=stream-json requires --verbose"));
        proc.emit("close", 1);
        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.error).toContain("stream-json requires --verbose");
        expect(result.output).toBe(""); // no useful output captured
    });
    it("runPhaseOrchestrator with verbose includes stream-json args", async () => {
        const proc = createMockProcess();
        mockedSpawn.mockReturnValueOnce(proc);
        const launcher = createAgentLauncher({
            pluginRoot: "/plugin",
            projectRoot: "/project",
        });
        const promise = launcher.runPhaseOrchestrator("prompt", "/path/to/agent.md", "opus", { verbose: true });
        proc.emit("close", 0);
        await promise;
        const spawnArgs = mockedSpawn.mock.calls[0][1];
        expect(spawnArgs).toContain("--output-format");
        expect(spawnArgs).toContain("stream-json");
        expect(spawnArgs).toContain("--verbose");
    });
});
//# sourceMappingURL=agentLauncher.test.js.map