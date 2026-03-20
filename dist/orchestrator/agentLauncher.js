import { spawn } from "node:child_process";
import { resolve } from "node:path";
const DEFAULT_TIMEOUT = 300_000; // 5 minutes for sub-agent execution
/**
 * Assembles the sub-agent prompt following the §5 input contract.
 * Lists file paths (rather than inlining contents) since the claude agent
 * can read files directly from the filesystem.
 */
export function buildSubAgentPrompt(config) {
    const lines = [];
    lines.push(`You are a ${config.type} sub-agent. Your task:`);
    lines.push("");
    lines.push(config.instructions);
    lines.push("");
    if (config.outputPaths.length > 0) {
        lines.push("You may ONLY create or modify these files:");
        for (const p of config.outputPaths) {
            lines.push(p);
        }
        lines.push("");
    }
    if (config.filePaths.length > 0) {
        lines.push("Context files to reference:");
        for (const p of config.filePaths) {
            lines.push(p);
        }
        lines.push("");
    }
    lines.push("Respond with the complete contents of each file you create or modify.");
    return lines.join("\n");
}
/**
 * Builds the CLI args array for a dispatchSubAgent call.
 */
export function buildSubAgentArgs(agentFile, model) {
    return ["--agent-file", agentFile, "--print", "--model", model];
}
/**
 * Builds the CLI args array for an llmQuery call.
 */
export function buildLlmQueryArgs(model) {
    return ["--print", "--model", model];
}
/**
 * Builds the CLI args array for launching an interactive orchestrator.
 */
export function buildOrchestratorArgs(config) {
    const args = [
        "--agent-file",
        config.agentFile,
        "--add-dir",
        config.skillsDir,
    ];
    if (config.model) {
        args.push("--model", config.model);
    }
    return args;
}
/**
 * Spawns a `claude` CLI subprocess, optionally pipes stdin, and collects
 * stdout/stderr. Rejects on timeout.
 */
function execClaude(args, cwd, stdin, timeout = DEFAULT_TIMEOUT) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn("claude", args, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
        child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error(`claude subprocess timed out after ${timeout}ms`));
        }, timeout);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolvePromise({
                stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
                stderr: Buffer.concat(stderrChunks).toString("utf-8"),
                exitCode: code ?? 1,
            });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        if (stdin !== undefined) {
            child.stdin.write(stdin);
            child.stdin.end();
        }
    });
}
/**
 * Creates an AgentLauncher that manages claude CLI subprocesses for sub-agent
 * dispatch, LLM queries, and long-running orchestrator sessions.
 *
 * Supports three modes:
 * - **real**: spawns actual `claude` CLI processes
 * - **dryRun**: logs commands without executing, returns mock results
 * - **mock**: returns pre-configured responses from `mockResponses` map
 */
export function createAgentLauncher(config) {
    const { pluginRoot, projectRoot, dryRun, mockResponses } = config;
    async function dispatchSubAgent(subAgentConfig) {
        const agentFile = resolve(pluginRoot, "agents", subAgentConfig.type + ".md");
        const model = subAgentConfig.model ?? "sonnet";
        const args = buildSubAgentArgs(agentFile, model);
        const prompt = buildSubAgentPrompt(subAgentConfig);
        if (dryRun) {
            console.log("[dry-run] dispatchSubAgent:", "claude", args.join(" "));
            console.log("[dry-run] prompt:", prompt.slice(0, 200));
            return { success: true, output: "[dry-run]", filesModified: [] };
        }
        if (mockResponses) {
            const mock = mockResponses.get(subAgentConfig.type);
            if (mock)
                return mock;
            return {
                success: true,
                output: "[mock] default response",
                filesModified: [],
            };
        }
        const result = await execClaude(args, projectRoot, prompt);
        if (result.exitCode !== 0) {
            return {
                success: false,
                output: result.stdout,
                filesModified: [],
                error: result.stderr || `claude exited with code ${result.exitCode}`,
            };
        }
        return {
            success: true,
            output: result.stdout,
            filesModified: [],
        };
    }
    async function llmQuery(prompt, options) {
        const model = options?.model ?? "haiku";
        const args = buildLlmQueryArgs(model);
        if (dryRun) {
            console.log("[dry-run] llmQuery:", prompt.slice(0, 80), "model:", model);
            return "[dry-run] llmQuery response";
        }
        if (mockResponses) {
            return "[mock] llmQuery response";
        }
        const result = await execClaude(args, projectRoot, prompt);
        return result.stdout;
    }
    async function launchOrchestrator(orchestratorConfig) {
        const args = buildOrchestratorArgs(orchestratorConfig);
        if (dryRun) {
            console.log("[dry-run] launchOrchestrator:", "claude", args.join(" "));
            return createDryRunHandle();
        }
        // Spawn as a long-running interactive process (no --print).
        // Assumption: the claude CLI accepts input on stdin and produces
        // responses on stdout. The exact framing protocol (line-delimited,
        // JSON, etc.) will be validated during integration testing (phase 14).
        const child = spawn("claude", args, {
            cwd: projectRoot,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return createProcessHandle(child, orchestratorConfig.phaseContext);
    }
    return { dispatchSubAgent, llmQuery, launchOrchestrator };
}
/**
 * Creates a mock OrchestratorHandle for dryRun mode.
 */
function createDryRunHandle() {
    let alive = true;
    return {
        async send(input) {
            console.log("[dry-run] orchestrator.send:", input.slice(0, 80));
            return "[dry-run] orchestrator response";
        },
        isAlive() {
            return alive;
        },
        kill() {
            alive = false;
        },
    };
}
/**
 * Creates an OrchestratorHandle wrapping a long-running claude subprocess.
 *
 * Assumptions (to be validated in integration testing):
 * - The initial phaseContext is sent to stdin on launch.
 * - Subsequent send() calls write to stdin and collect the response
 *   from stdout until a delimiter or silence indicates completion.
 * - Currently uses a simple approach: write input, collect all stdout
 *   data until a configurable idle timeout, then return accumulated output.
 *   This may need refinement once the real interactive protocol is known.
 */
function createProcessHandle(child, phaseContext) {
    // Send the initial phase context to the orchestrator
    child.stdin.write(phaseContext + "\n");
    return {
        send(input) {
            return new Promise((resolvePromise, reject) => {
                if (child.exitCode !== null) {
                    reject(new Error("Orchestrator process has exited"));
                    return;
                }
                const chunks = [];
                const onData = (chunk) => {
                    chunks.push(chunk);
                };
                child.stdout.on("data", onData);
                // Use an idle timeout to detect end of response.
                // This is a simplistic approach; the real protocol may use
                // explicit delimiters or structured framing.
                const IDLE_TIMEOUT = 5_000;
                let idleTimer;
                const resetIdle = () => {
                    clearTimeout(idleTimer);
                    idleTimer = setTimeout(() => {
                        child.stdout.removeListener("data", onData);
                        resolvePromise(Buffer.concat(chunks).toString("utf-8"));
                    }, IDLE_TIMEOUT);
                };
                child.stdout.on("data", resetIdle);
                child.stdin.write(input + "\n");
                resetIdle();
            });
        },
        isAlive() {
            return child.exitCode === null;
        },
        kill() {
            child.kill("SIGTERM");
        },
    };
}
//# sourceMappingURL=agentLauncher.js.map