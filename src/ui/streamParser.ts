/**
 * Parses NDJSON events from `claude --output-format stream-json`.
 *
 * Each stdout line is a JSON object. We care about:
 * - `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` — model text
 * - `{"type":"result","result":"...","total_cost_usd":...}` — final result with usage
 */

export type UsageStats = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "result"; text: string; usage?: UsageStats }
  | { type: "other" };

/**
 * Parse a single NDJSON line into a StreamEvent.
 */
export function parseStreamLine(line: string): StreamEvent {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { type: "other" };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { type: "other" };
  }

  if (parsed.type === "assistant") {
    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message) return { type: "other" };

    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return { type: "other" };

    const texts = content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string);

    if (texts.length === 0) return { type: "other" };
    return { type: "text", text: texts.join("") };
  }

  if (parsed.type === "result") {
    const result = parsed.result;
    const usage = extractUsageFromParsed(parsed);
    return {
      type: "result",
      text: typeof result === "string" ? result : "",
      ...(usage ? { usage } : {}),
    };
  }

  return { type: "other" };
}

/**
 * Extract usage stats from a parsed result JSON object.
 * Claude CLI result events include: total_cost_usd at top level,
 * and usage: { input_tokens, output_tokens } nested under a usage object.
 */
function extractUsageFromParsed(parsed: Record<string, unknown>): UsageStats | undefined {
  // Try nested usage object first (current CLI format),
  // then top-level fields (legacy/future-proofing)
  const usage = parsed.usage as Record<string, unknown> | undefined;
  const inputTokens = usage?.input_tokens ?? parsed.num_input_tokens;
  const outputTokens = usage?.output_tokens ?? parsed.num_output_tokens;
  const costUsd = parsed.total_cost_usd;

  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") {
    return undefined;
  }

  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : 0,
    outputTokens: typeof outputTokens === "number" ? outputTokens : 0,
    costUsd: typeof costUsd === "number" ? costUsd : 0,
  };
}

/**
 * Extract the final result text from raw NDJSON stdout.
 * Scans for the last `{"type":"result",...}` line and returns its `result` field.
 */
export function extractResultText(ndjsonStdout: string): string {
  const lines = ndjsonStdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const event = parseStreamLine(lines[i]!);
    if (event.type === "result") return event.text;
  }
  return "";
}

/**
 * Extract usage stats from raw NDJSON stdout.
 * Scans for the last `{"type":"result",...}` line and returns its usage data.
 */
export function extractUsage(ndjsonStdout: string): UsageStats | undefined {
  const lines = ndjsonStdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const event = parseStreamLine(lines[i]!);
    if (event.type === "result") return event.usage;
  }
  return undefined;
}

/**
 * Creates a line-buffered stream handler that calls `onEvent` for each
 * complete NDJSON line received. Handles partial lines across chunks.
 */
export function createStreamHandler(
  onEvent: (event: StreamEvent) => void,
): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        onEvent(parseStreamLine(line));
      }
    }
  };
}
