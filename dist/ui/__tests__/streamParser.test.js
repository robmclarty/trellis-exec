import { describe, it, expect, vi } from "vitest";
import { parseStreamLine, extractResultText, extractUsage, createStreamHandler, } from "../streamParser.js";
describe("parseStreamLine", () => {
    it("parses a valid assistant event with text content", () => {
        const line = JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Hello" }] },
        });
        expect(parseStreamLine(line)).toEqual({ type: "text", text: "Hello" });
    });
    it("joins multiple text blocks in an assistant event", () => {
        const line = JSON.stringify({
            type: "assistant",
            message: {
                content: [
                    { type: "text", text: "Hello" },
                    { type: "text", text: " World" },
                ],
            },
        });
        expect(parseStreamLine(line)).toEqual({
            type: "text",
            text: "Hello World",
        });
    });
    it("parses a valid result event", () => {
        const line = JSON.stringify({ type: "result", result: "final answer" });
        const event = parseStreamLine(line);
        expect(event).toMatchObject({ type: "result", text: "final answer" });
    });
    it("extracts usage from result event with nested usage object", () => {
        const line = JSON.stringify({
            type: "result",
            result: "done",
            total_cost_usd: 0.05,
            usage: { input_tokens: 5000, output_tokens: 1200 },
        });
        const event = parseStreamLine(line);
        expect(event).toMatchObject({
            type: "result",
            text: "done",
            usage: { inputTokens: 5000, outputTokens: 1200, costUsd: 0.05 },
        });
    });
    it("extracts usage from result event with legacy top-level token fields", () => {
        const line = JSON.stringify({
            type: "result",
            result: "done",
            num_input_tokens: 5000,
            num_output_tokens: 1200,
            total_cost_usd: 0.05,
        });
        const event = parseStreamLine(line);
        expect(event).toMatchObject({
            type: "result",
            text: "done",
            usage: { inputTokens: 5000, outputTokens: 1200, costUsd: 0.05 },
        });
    });
    it("returns empty text for result event with non-string result", () => {
        const line = JSON.stringify({ type: "result", result: 42 });
        expect(parseStreamLine(line)).toEqual({ type: "result", text: "" });
    });
    it("returns other for malformed JSON", () => {
        expect(parseStreamLine("not json")).toEqual({ type: "other" });
    });
    it("returns other for empty line", () => {
        expect(parseStreamLine("")).toEqual({ type: "other" });
        expect(parseStreamLine("   ")).toEqual({ type: "other" });
    });
    it("returns other for assistant event with missing message", () => {
        const line = JSON.stringify({ type: "assistant" });
        expect(parseStreamLine(line)).toEqual({ type: "other" });
    });
    it("returns other for assistant event with non-array content", () => {
        const line = JSON.stringify({
            type: "assistant",
            message: { content: "not-array" },
        });
        expect(parseStreamLine(line)).toEqual({ type: "other" });
    });
    it("returns other for assistant event with only non-text content blocks", () => {
        const line = JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "tool_use", id: "123" }] },
        });
        expect(parseStreamLine(line)).toEqual({ type: "other" });
    });
    it("returns other for unknown event type", () => {
        const line = JSON.stringify({ type: "ping" });
        expect(parseStreamLine(line)).toEqual({ type: "other" });
    });
});
describe("extractResultText", () => {
    it("extracts result text from normal NDJSON output", () => {
        const lines = [
            JSON.stringify({
                type: "assistant",
                message: { content: [{ type: "text", text: "thinking..." }] },
            }),
            JSON.stringify({ type: "result", result: "done" }),
        ].join("\n");
        expect(extractResultText(lines)).toBe("done");
    });
    it("returns empty string when no result line is present", () => {
        const lines = [
            JSON.stringify({
                type: "assistant",
                message: { content: [{ type: "text", text: "hello" }] },
            }),
        ].join("\n");
        expect(extractResultText(lines)).toBe("");
    });
    it("returns the last result when multiple result lines exist", () => {
        const lines = [
            JSON.stringify({ type: "result", result: "first" }),
            JSON.stringify({ type: "result", result: "second" }),
        ].join("\n");
        expect(extractResultText(lines)).toBe("second");
    });
    it("returns empty string for empty input", () => {
        expect(extractResultText("")).toBe("");
    });
});
describe("extractUsage", () => {
    it("extracts usage from NDJSON with nested usage object", () => {
        const lines = [
            JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
            JSON.stringify({
                type: "result",
                result: "done",
                total_cost_usd: 0.08,
                usage: { input_tokens: 10000, output_tokens: 3000 },
            }),
        ].join("\n");
        expect(extractUsage(lines)).toEqual({
            inputTokens: 10000,
            outputTokens: 3000,
            costUsd: 0.08,
        });
    });
    it("extracts usage from NDJSON with legacy top-level token fields", () => {
        const lines = [
            JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
            JSON.stringify({
                type: "result",
                result: "done",
                num_input_tokens: 10000,
                num_output_tokens: 3000,
                total_cost_usd: 0.08,
            }),
        ].join("\n");
        expect(extractUsage(lines)).toEqual({
            inputTokens: 10000,
            outputTokens: 3000,
            costUsd: 0.08,
        });
    });
    it("returns undefined when no result event exists", () => {
        const lines = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
        expect(extractUsage(lines)).toBeUndefined();
    });
    it("returns undefined when result has no token fields", () => {
        const lines = JSON.stringify({ type: "result", result: "done" });
        expect(extractUsage(lines)).toBeUndefined();
    });
});
describe("createStreamHandler", () => {
    it("calls onEvent for a single complete line", () => {
        const onEvent = vi.fn();
        const handler = createStreamHandler(onEvent);
        handler(JSON.stringify({ type: "result", result: "ok" }) + "\n");
        expect(onEvent).toHaveBeenCalledOnce();
        expect(onEvent).toHaveBeenCalledWith({ type: "result", text: "ok" });
    });
    it("buffers partial lines across chunks", () => {
        const onEvent = vi.fn();
        const handler = createStreamHandler(onEvent);
        const full = JSON.stringify({ type: "result", result: "ok" });
        handler(full.slice(0, 10));
        expect(onEvent).not.toHaveBeenCalled();
        handler(full.slice(10) + "\n");
        expect(onEvent).toHaveBeenCalledOnce();
        expect(onEvent).toHaveBeenCalledWith({ type: "result", text: "ok" });
    });
    it("handles multiple lines in one chunk", () => {
        const onEvent = vi.fn();
        const handler = createStreamHandler(onEvent);
        const line1 = JSON.stringify({ type: "result", result: "a" });
        const line2 = JSON.stringify({ type: "result", result: "b" });
        handler(line1 + "\n" + line2 + "\n");
        expect(onEvent).toHaveBeenCalledTimes(2);
        expect(onEvent).toHaveBeenNthCalledWith(1, { type: "result", text: "a" });
        expect(onEvent).toHaveBeenNthCalledWith(2, { type: "result", text: "b" });
    });
    it("does not call onEvent for empty chunks", () => {
        const onEvent = vi.fn();
        const handler = createStreamHandler(onEvent);
        handler("");
        expect(onEvent).not.toHaveBeenCalled();
    });
    it("skips blank lines between valid lines", () => {
        const onEvent = vi.fn();
        const handler = createStreamHandler(onEvent);
        const line1 = JSON.stringify({ type: "result", result: "a" });
        const line2 = JSON.stringify({ type: "result", result: "b" });
        handler(line1 + "\n\n" + line2 + "\n");
        expect(onEvent).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=streamParser.test.js.map