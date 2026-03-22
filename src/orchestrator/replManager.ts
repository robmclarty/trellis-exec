import { createContext, runInContext, Script } from "node:vm";
import type { ReplHelpers } from "./replHelpers.js";

export type ReplSessionConfig = {
  projectRoot: string;
  outputLimit: number;
  timeout: number;
  helpers: ReplHelpers;
};

export type ReplEvalResult = {
  success: boolean;
  output: string;
  truncated: boolean;
  error?: string;
  duration: number;
};

export type ReplSession = {
  eval(code: string): Promise<ReplEvalResult>;
  restoreScaffold(): void;
  getConsecutiveErrors(): number;
  resetConsecutiveErrors(): void;
  destroy(): void;
};

const HELPER_NAMES: ReadonlyArray<keyof ReplHelpers> = [
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
function serialize(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Creates a sandboxed REPL session using node:vm. The session injects helper
 * functions into the vm context and provides eval, scaffold restoration, and
 * consecutive error tracking.
 */
export function createReplSession(config: ReplSessionConfig): ReplSession {
  const { outputLimit, timeout, helpers } = config;

  // Store original references for scaffold restoration
  const originals: Record<string, unknown> = {};
  for (const name of HELPER_NAMES) {
    originals[name] = helpers[name];
  }

  // Console capture buffer
  let consoleBuffer: string[] = [];

  const capturedConsole = {
    log: (...args: unknown[]) => {
      consoleBuffer.push(args.map(String).join(" "));
    },
    warn: (...args: unknown[]) => {
      consoleBuffer.push("[warn] " + args.map(String).join(" "));
    },
    error: (...args: unknown[]) => {
      consoleBuffer.push("[error] " + args.map(String).join(" "));
    },
  };

  // Tracked timers — cleared on destroy to prevent leaks from LLM-generated code
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();

  const sandboxSetTimeout = (fn: (...args: unknown[]) => void, ms: number) => {
    const id = setTimeout((...args: unknown[]) => {
      activeTimers.delete(id);
      fn(...args);
    }, ms);
    activeTimers.add(id);
    return id;
  };

  const sandboxClearTimeout = (id: ReturnType<typeof setTimeout>) => {
    activeTimers.delete(id);
    clearTimeout(id);
  };

  // Build sandbox with helpers, console, and safe globals
  const sandbox: Record<string, unknown> = {
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
  async function evalCode(code: string): Promise<ReplEvalResult> {
    if (destroyed) {
      throw new Error("Session is destroyed");
    }

    const start = performance.now();
    consoleBuffer = [];

    try {
      // Try expression form first (like Node REPL): wrap as return(expr).
      // If that fails to parse, fall back to statement form.
      let wrappedCode: string;
      const exprForm = `(async () => { return (\n${code}\n) })()`;
      try {
        // Compile-only check — does not execute
        new Script(exprForm);
        wrappedCode = exprForm;
      } catch {
        wrappedCode = `(async () => {\n${code}\n})()`;
      }

      const promise = runInContext(wrappedCode, context, {
        filename: "repl",
        timeout,
      });

      // Race the promise against a timeout for async operations
      const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
          reject(new Error("Script execution timed out"));
        }, timeout);
        // If the promise resolves first, clear the timeout
        (promise as Promise<unknown>).then(
          () => clearTimeout(id),
          () => clearTimeout(id),
        );
      });

      const result = await Promise.race([promise, timeoutPromise]);
      const duration = performance.now() - start;

      const consolePart = consoleBuffer.join("\n");
      const resultPart = serialize(result);
      let output =
        consolePart && resultPart
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
    } catch (err: unknown) {
      const duration = performance.now() - start;
      consecutiveErrors++;

      const errorMessage =
        err instanceof Error ? err.message : String(err);
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
  function restoreScaffold(): void {
    for (const name of HELPER_NAMES) {
      context[name] = originals[name];
    }
  }

  /**
   * Returns the number of sequential eval failures since the last success.
   * The phase runner uses this to detect stuck error loops.
   */
  function getConsecutiveErrors(): number {
    return consecutiveErrors;
  }

  /** Resets the consecutive error counter to zero. */
  function resetConsecutiveErrors(): void {
    consecutiveErrors = 0;
  }

  /** Marks the session as destroyed. Clears outstanding timers and rejects subsequent eval calls. */
  function destroy(): void {
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
