import { createContext, runInContext, Script } from "node:vm";
const HELPER_NAMES = [
    "readFile",
    "listDir",
    "searchFiles",
    "getState",
    "writePhaseReport",
    "dispatchSubAgent",
    "runCheck",
    "llmQuery",
];
/**
 * Serialize a value to a string for REPL output. Handles circular references
 * and non-JSON-serializable values gracefully.
 */
function serialize(value) {
    if (value === undefined)
        return "";
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
/**
 * Creates a sandboxed REPL session using node:vm. The session injects helper
 * functions into the vm context and provides eval, scaffold restoration, and
 * consecutive error tracking.
 */
export function createReplSession(config) {
    const { outputLimit, timeout, helpers } = config;
    const longTimeout = config.longTimeout ?? timeout;
    /**
     * Patterns that indicate the code invokes a long-running async helper
     * (sub-agent dispatch, check command, LLM query). These need a longer
     * timeout than simple sync expressions.
     */
    const LONG_RUNNING_PATTERN = /\b(?:dispatchSubAgent|runCheck|llmQuery)\s*\(/;
    // Store original references for scaffold restoration
    const originals = {};
    for (const name of HELPER_NAMES) {
        originals[name] = helpers[name];
    }
    // Console capture buffer
    let consoleBuffer = [];
    const capturedConsole = {
        log: (...args) => {
            consoleBuffer.push(args.map(String).join(" "));
        },
        warn: (...args) => {
            consoleBuffer.push("[warn] " + args.map(String).join(" "));
        },
        error: (...args) => {
            consoleBuffer.push("[error] " + args.map(String).join(" "));
        },
    };
    // Tracked timers — cleared on destroy to prevent leaks from LLM-generated code
    const activeTimers = new Set();
    const sandboxSetTimeout = (fn, ms) => {
        const id = setTimeout((...args) => {
            activeTimers.delete(id);
            fn(...args);
        }, ms);
        activeTimers.add(id);
        return id;
    };
    const sandboxClearTimeout = (id) => {
        activeTimers.delete(id);
        clearTimeout(id);
    };
    // Build sandbox with helpers, console, and safe globals
    const sandbox = {
        console: capturedConsole,
        setTimeout: sandboxSetTimeout,
        clearTimeout: sandboxClearTimeout,
        JSON,
        Math,
        Date,
        Array,
        Object,
        Map,
        Set,
        RegExp,
        Error,
        Promise,
        URL,
        TextEncoder,
        TextDecoder,
    };
    for (const name of HELPER_NAMES) {
        sandbox[name] = helpers[name];
    }
    // Wrap async helpers with self-reporting so the orchestrator always sees
    // results in console output, even when the IIFE wrapper drops return values.
    const rawDispatch = helpers.dispatchSubAgent;
    sandbox["dispatchSubAgent"] = async (...args) => {
        const result = await rawDispatch(...args);
        const summary = {
            success: result.success,
            filesModified: result.filesModified,
            ...(result.error ? { error: result.error } : {}),
            outputLength: result.output.length,
            outputPreview: result.output.slice(0, 500),
        };
        const taskId = args[0]?.taskId ?? "unknown";
        capturedConsole.log(`[dispatchSubAgent:${taskId}] ${JSON.stringify(summary)}`);
        return result;
    };
    const rawCheck = helpers.runCheck;
    sandbox["runCheck"] = async () => {
        const result = await rawCheck();
        capturedConsole.log(`[runCheck] ${JSON.stringify(result)}`);
        return result;
    };
    // Update originals for wrapped helpers so restoreScaffold preserves them
    originals["dispatchSubAgent"] = sandbox["dispatchSubAgent"];
    originals["runCheck"] = sandbox["runCheck"];
    const context = createContext(sandbox);
    let consecutiveErrors = 0;
    let destroyed = false;
    /**
     * Evaluates JavaScript code in the sandboxed vm context. Tries expression
     * form first (returning the value) via a compile-only Script check, then
     * falls back to statement form. Code is wrapped in an async IIFE so `await`
     * works. Output is truncated to outputLimit. Consecutive errors are tracked
     * (incremented on failure, reset on success).
     * @param code - JavaScript source code to evaluate
     * @returns Eval result with success flag, output, truncation info, and duration
     */
    async function evalCode(code) {
        if (destroyed) {
            throw new Error("Session is destroyed");
        }
        const start = performance.now();
        consoleBuffer = [];
        try {
            // Wrap code for evaluation. If the code uses `await`, wrap in an async
            // IIFE (variables are function-scoped and lost after return). Otherwise,
            // run directly so `var` declarations persist in the vm context across
            // eval calls — this lets the orchestrator store values between turns.
            let wrappedCode;
            const needsAsync = /\bawait\b/.test(code);
            if (needsAsync) {
                const exprForm = `(async () => { return (\n${code}\n) })()`;
                try {
                    new Script(exprForm);
                    wrappedCode = exprForm;
                }
                catch {
                    // Statement form: if the code contains `var` declarations, return
                    // the last one's value so the orchestrator can see the result.
                    const varMatches = code.match(/\bvar\s+(\w+)\s*=/g);
                    if (varMatches) {
                        const lastMatch = varMatches[varMatches.length - 1];
                        const lastVar = lastMatch.match(/var\s+(\w+)/)[1];
                        wrappedCode = `(async () => {\n${code}\nreturn ${lastVar};\n})()`;
                    }
                    else {
                        wrappedCode = `(async () => {\n${code}\n})()`;
                    }
                }
            }
            else {
                // Direct execution — var declarations go into the vm context
                const exprForm = `(\n${code}\n)`;
                try {
                    new Script(exprForm);
                    wrappedCode = exprForm;
                }
                catch {
                    wrappedCode = code;
                }
            }
            // Use the longer timeout when code calls long-running helpers
            const effectiveTimeout = LONG_RUNNING_PATTERN.test(code)
                ? longTimeout
                : timeout;
            const promise = runInContext(wrappedCode, context, {
                filename: "repl",
                timeout: effectiveTimeout,
            });
            // Race the promise against a timeout for async operations
            const timeoutPromise = new Promise((_, reject) => {
                const id = setTimeout(() => {
                    reject(new Error(`TIMEOUT: Code execution exceeded ${effectiveTimeout}ms. ` +
                        `The sub-agent was killed and produced NO output — zero files were written or modified. ` +
                        `This task is NOT complete. You MUST either:\n` +
                        `1. Retry dispatchSubAgent() with simpler/smaller instructions, OR\n` +
                        `2. Mark this task as failed in writePhaseReport().\n` +
                        `Do NOT claim the task was completed. Do NOT write prose — output JavaScript code only.`));
                }, effectiveTimeout);
                // If the promise resolves first, clear the timeout
                promise.then(() => clearTimeout(id), () => clearTimeout(id));
            });
            const result = await Promise.race([promise, timeoutPromise]);
            const duration = performance.now() - start;
            const consolePart = consoleBuffer.join("\n");
            const resultPart = serialize(result);
            let output = consolePart && resultPart
                ? consolePart + "\n" + resultPart
                : consolePart || resultPart || "";
            let truncated = false;
            if (output.length > outputLimit) {
                const total = output.length;
                output =
                    output.slice(0, outputLimit) +
                        `\n[TRUNCATED — showing first ${outputLimit} chars of ${total} total]`;
                truncated = true;
            }
            consecutiveErrors = 0;
            return { success: true, output, truncated, duration };
        }
        catch (err) {
            const duration = performance.now() - start;
            consecutiveErrors++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            const consolePart = consoleBuffer.join("\n");
            const output = consolePart
                ? consolePart + "\n" + errorMessage
                : errorMessage;
            return {
                success: false,
                output,
                truncated: false,
                error: errorMessage,
                duration,
            };
        }
    }
    /**
     * Re-injects all helper function references into the vm context from the
     * stored originals. Call after each eval to prevent LLM-generated code from
     * accidentally overwriting helpers.
     */
    function restoreScaffold() {
        for (const name of HELPER_NAMES) {
            context[name] = originals[name];
        }
    }
    /**
     * Returns the number of sequential eval failures since the last success.
     * The phase runner uses this to detect stuck error loops.
     */
    function getConsecutiveErrors() {
        return consecutiveErrors;
    }
    /** Resets the consecutive error counter to zero. */
    function resetConsecutiveErrors() {
        consecutiveErrors = 0;
    }
    /** Marks the session as destroyed. Clears outstanding timers and rejects subsequent eval calls. */
    function destroy() {
        destroyed = true;
        for (const id of activeTimers) {
            clearTimeout(id);
        }
        activeTimers.clear();
    }
    return {
        eval: evalCode,
        restoreScaffold,
        getConsecutiveErrors,
        resetConsecutiveErrors,
        destroy,
    };
}
//# sourceMappingURL=replManager.js.map