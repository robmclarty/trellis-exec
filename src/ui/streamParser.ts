/**
 * Parses NDJSON events from `claude --output-format stream-json --verbose`.
 *
 * Each stdout line is a JSON object. We care about:
 * - `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` — model text
 * - `{"type":"result","result":"..."}` — final result
 */

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "result"; text: string }
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
    return {
      type: "result",
      text: typeof result === "string" ? result : "",
    };
  }

  return { type: "other" };
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
