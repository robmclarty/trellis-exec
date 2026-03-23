import { describe, it, expect } from "vitest";
import { extractCode } from "../phaseRunner.js";

describe("extractCode", () => {
  // -------------------------------------------------------------------------
  // Markdown fence extraction
  // -------------------------------------------------------------------------

  describe("fence extraction", () => {
    it("extracts code from ```js fences", () => {
      const input = "```js\nconst x = 1;\n```";
      expect(extractCode(input)).toBe("const x = 1;");
    });

    it("extracts code from ```javascript fences", () => {
      const input = "```javascript\nlet y = 2;\n```";
      expect(extractCode(input)).toBe("let y = 2;");
    });

    it("extracts code from ```typescript fences", () => {
      const input = "```typescript\nconst z: number = 3;\n```";
      expect(extractCode(input)).toBe("const z: number = 3;");
    });

    it("extracts code from ```ts fences", () => {
      const input = "```ts\nconst a = true;\n```";
      expect(extractCode(input)).toBe("const a = true;");
    });

    it("extracts code from plain ``` fences", () => {
      const input = "```\nconst b = false;\n```";
      expect(extractCode(input)).toBe("const b = false;");
    });

    it("joins multiple code blocks with newlines", () => {
      const input =
        "```js\nconst x = 1;\n```\nSome text\n```js\nconst y = 2;\n```";
      expect(extractCode(input)).toBe("const x = 1;\n\nconst y = 2;");
    });

    it("extracts only fenced code when surrounded by prose", () => {
      const input =
        "Here is the solution:\n\n```js\nawait dispatchSubAgent({type: 'implement'});\n```\n\nThis should work.";
      expect(extractCode(input)).toBe(
        "await dispatchSubAgent({type: 'implement'});",
      );
    });
  });

  // -------------------------------------------------------------------------
  // JS detection (no fences)
  // -------------------------------------------------------------------------

  describe("JS detection without fences", () => {
    it("returns code starting with const", () => {
      const input = "const x = 1;";
      expect(extractCode(input)).toBe("const x = 1;");
    });

    it("returns code starting with await", () => {
      const input = "await runCheck()";
      expect(extractCode(input)).toBe("await runCheck()");
    });

    it("returns code starting with function", () => {
      const input = "function doStuff() { return 1; }";
      expect(extractCode(input)).toBe("function doStuff() { return 1; }");
    });

    it("returns code starting with // comment", () => {
      const input = "// do the thing\nconst x = 1;";
      expect(extractCode(input)).toBe("// do the thing\nconst x = 1;");
    });

    it("returns code starting with identifier assignment", () => {
      const input = "result = await dispatchSubAgent(config)";
      expect(extractCode(input)).toBe("result = await dispatchSubAgent(config)");
    });
  });

  // -------------------------------------------------------------------------
  // Natural language rejection
  // -------------------------------------------------------------------------

  describe("natural language rejection", () => {
    it('rejects "The file has been updated..."', () => {
      expect(extractCode("The file has been updated successfully.")).toBe("");
    });

    it('rejects "I have completed the task..."', () => {
      expect(extractCode("I have completed the task. Everything looks good.")).toBe("");
    });

    it('rejects "This is a summary..."', () => {
      expect(extractCode("This is a summary of what was done in this phase.")).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("returns empty string for empty input", () => {
      expect(extractCode("")).toBe("");
    });

    it("returns empty string for whitespace only", () => {
      expect(extractCode("   \n  \n  ")).toBe("");
    });

    it("returns code starting with let", () => {
      const input = "let count = 0;\ncount++;";
      expect(extractCode(input)).toBe("let count = 0;\ncount++;");
    });

    it("returns code starting with var", () => {
      const input = "var old = true;";
      expect(extractCode(input)).toBe("var old = true;");
    });

    it("returns code starting with (", () => {
      const input = "(async () => { await runCheck(); })()";
      expect(extractCode(input)).toBe("(async () => { await runCheck(); })()");
    });

    it("returns code starting with /* block comment", () => {
      const input = "/* setup */\nconst x = 1;";
      expect(extractCode(input)).toBe("/* setup */\nconst x = 1;");
    });
  });
});
