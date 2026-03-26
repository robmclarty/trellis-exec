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
export type StreamEvent = {
    type: "text";
    text: string;
} | {
    type: "result";
    text: string;
    usage?: UsageStats;
} | {
    type: "other";
};
/**
 * Parse a single NDJSON line into a StreamEvent.
 */
export declare function parseStreamLine(line: string): StreamEvent;
/**
 * Extract the final result text from raw NDJSON stdout.
 * Scans for the last `{"type":"result",...}` line and returns its `result` field.
 */
export declare function extractResultText(ndjsonStdout: string): string;
/**
 * Extract usage stats from raw NDJSON stdout.
 * Scans for the last `{"type":"result",...}` line and returns its usage data.
 */
export declare function extractUsage(ndjsonStdout: string): UsageStats | undefined;
/**
 * Creates a line-buffered stream handler that calls `onEvent` for each
 * complete NDJSON line received. Handles partial lines across chunks.
 */
export declare function createStreamHandler(onEvent: (event: StreamEvent) => void): (chunk: string) => void;
//# sourceMappingURL=streamParser.d.ts.map