import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { extractResultText } from "../ui/streamParser.js";
const DEFAULT_TIMEOUT = 300_000; // 5 minutes for sub-agent execution
const ORCHESTRATOR_TIMEOUT = 1_800_000; // 30 minutes for phase orchestration
export const COMPILE_TIMEOUT = 600_000; // 10 minutes for plan decomposition
export const LONG_RUN_TIMEOUT = 7_200_000; // 2 hours for long-running phases
export function execClaude(args, cwd, options = {}) {
    const { stdin, timeout = DEFAULT_TIMEOUT, onStderr, onStdout, } = options;
    return new Promise((resolvePromise, reject) => {
        const child = spawn("claude", args, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        child.stdout.on("data", (chunk) => {
            stdoutChunks.push(chunk);
            if (onStdout)
                onStdout(chunk.toString("utf-8"));
        });
        child.stderr.on("data", (chunk) => {
            stderrChunks.push(chunk);
            if (onStderr)
                onStderr(chunk.toString("utf-8"));
        });
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
            child.stdin.on("error", (err) => reject(err));
            child.stdin.write(stdin);
            child.stdin.end();
        }
    });
}
/**
 * Creates an AgentLauncher that manages claude CLI subprocesses for sub-agent
 * dispatch and phase orchestration.
 *
 * Supports two modes:
 * - **real**: spawns actual `claude` CLI processes
 * - **dryRun**: logs commands without executing, returns mock results
 */
export function createAgentLauncher(config) {
    const { pluginRoot, projectRoot, dryRun } = config;
    async function dispatchSubAgent(subAgentConfig) {
        const agentFile = resolve(pluginRoot, "agents", subAgentConfig.type + ".md");
        const model = subAgentConfig.model ?? "opus";
        const args = [
            "--agent",
            agentFile,
            "--output-format", "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
            "--model",
            model,
        ];
        const promptLines = [];
        promptLines.push(`You are a ${subAgentConfig.type} sub-agent. Your task:`);
        promptLines.push("");
        promptLines.push(subAgentConfig.instructions);
        promptLines.push("");
        if (subAgentConfig.outputPaths.length > 0) {
            promptLines.push("You may ONLY create or modify these files:");
            for (const p of subAgentConfig.outputPaths) {
                promptLines.push(p);
            }
            promptLines.push("");
        }
        if (subAgentConfig.filePaths.length > 0) {
            promptLines.push("Context files to reference:");
            for (const p of subAgentConfig.filePaths) {
                promptLines.push(p);
            }
            promptLines.push("");
        }
        promptLines.push("Use the Write tool to create new files and the Edit tool to modify existing files. Do not just output code as text.");
        const prompt = promptLines.join("\n");
        if (dryRun) {
            console.log("[dry-run] dispatchSubAgent:", "claude", args.join(" "));
            console.log("[dry-run] prompt:", prompt.slice(0, 200));
            return { success: true, output: "[dry-run]", filesModified: [] };
        }
        let result;
        try {
            result = await execClaude(args, projectRoot, { stdin: prompt });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                output: `${message} Task "${subAgentConfig.taskId}" was NOT completed. ` +
                    `Retry with simpler/smaller instructions, or mark this task as failed.`,
                filesModified: [],
                error: message,
            };
        }
        const output = extractResultText(result.stdout) || result.stdout;
        if (result.exitCode !== 0) {
            return {
                success: false,
                output,
                filesModified: [],
                error: result.stderr || `claude exited with code ${result.exitCode}`,
            };
        }
        return {
            success: true,
            output,
            filesModified: [],
        };
    }
    async function runPhaseOrchestrator(prompt, agentFile, model, options) {
        const args = [
            "--agent",
            agentFile,
            "--output-format", "stream-json",
            "--dangerously-skip-permissions",
            ...(model ? ["--model", model] : []),
            ...(options?.verbose ? ["--verbose"] : []),
        ];
        if (dryRun) {
            console.log("[dry-run] runPhaseOrchestrator:", "claude", args.join(" "));
            console.log("[dry-run] prompt:", prompt.slice(0, 200));
            return { stdout: "[dry-run]", stderr: "", exitCode: 0 };
        }
        return execClaude(args, projectRoot, {
            stdin: prompt,
            timeout: options?.timeout ?? ORCHESTRATOR_TIMEOUT,
            onStdout: options?.onStdout,
            onStderr: options?.onStderr,
        });
    }
    return { dispatchSubAgent, runPhaseOrchestrator };
}
//# sourceMappingURL=agentLauncher.js.map