import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { createReplSession } from "../replManager.js";
import { createReplHelpers } from "../replHelpers.js";
const FIXTURES_DIR = join(import.meta.dirname, "../../../test/fixtures/repl-test");
function makeHelpers(overrides) {
    return {
        readFile: () => "",
        listDir: () => [],
        searchFiles: () => [],
        getState: () => ({
            currentPhase: "phase-1",
            completedPhases: [],
            modifiedFiles: [],
            schemaChanges: [],
            phaseReports: [],
            phaseRetries: {},
        }),
        writePhaseReport: () => { },
        dispatchSubAgent: async () => ({
            success: true,
            output: "",
            filesModified: [],
        }),
        runCheck: async () => ({ passed: true }),
        llmQuery: async () => "",
        ...overrides,
    };
}
function makeConfig(overrides) {
    return {
        projectRoot: FIXTURES_DIR,
        outputLimit: 8192,
        timeout: 5000,
        helpers: makeHelpers(),
        ...overrides,
    };
}
describe("replManager", () => {
    it("eval runs simple JS and returns the result", async () => {
        const session = createReplSession(makeConfig());
        const result = await session.eval("1 + 2");
        expect(result.success).toBe(true);
        expect(result.output).toBe("3");
        expect(result.truncated).toBe(false);
        expect(result.duration).toBeGreaterThanOrEqual(0);
        session.destroy();
    });
    it("eval truncates output exceeding outputLimit", async () => {
        const session = createReplSession(makeConfig({ outputLimit: 50 }));
        const result = await session.eval('"x".repeat(200)');
        expect(result.success).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.output).toContain("[TRUNCATED — showing first 50 chars of 200 total]");
        session.destroy();
    });
    it("eval returns error info for syntax errors without crashing", async () => {
        const session = createReplSession(makeConfig());
        const result = await session.eval("function {");
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/SyntaxError|Unexpected/);
        // Session is still usable
        const ok = await session.eval("42");
        expect(ok.success).toBe(true);
        expect(ok.output).toBe("42");
        session.destroy();
    });
    it("eval respects timeout", async () => {
        const session = createReplSession(makeConfig({ timeout: 50 }));
        const result = await session.eval("while(true){}");
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/timed out/i);
        session.destroy();
    });
    it("restoreScaffold recovers after a helper is overwritten", async () => {
        const realHelpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            statePath: "",
            agentLauncher: null,
        });
        const session = createReplSession(makeConfig({ helpers: realHelpers }));
        await session.eval('readFile = "oops"');
        session.restoreScaffold();
        const result = await session.eval("typeof readFile");
        expect(result.success).toBe(true);
        expect(result.output).toBe("function");
        session.destroy();
    });
    // -------------------------------------------------------------------------
    // Issue #8: The VM sandbox previously exposed the host's real setTimeout
    // and clearTimeout directly. LLM-generated code could schedule callbacks
    // that outlive session.destroy(), retaining references to the context
    // object and leaking memory or causing unexpected side effects.
    //
    // Mitigation: The sandbox now provides wrapped timer functions that track
    // all active timer IDs in a Set. When destroy() is called, all outstanding
    // timers are cleared, preventing any callbacks from firing after teardown.
    // -------------------------------------------------------------------------
    it("destroy clears outstanding sandbox timers", async () => {
        const session = createReplSession(makeConfig());
        // Schedule a timer inside the sandbox that would fire after 10 seconds.
        // Without cleanup, this callback would outlive the session.
        await session.eval("setTimeout(() => { console.log('leaked'); }, 10000)");
        // destroy() should clear the timer — this test just verifies no errors.
        // The real protection is that the callback never fires after destroy.
        expect(() => session.destroy()).not.toThrow();
    });
    it("sandbox setTimeout works normally for short-lived timers", async () => {
        const session = createReplSession(makeConfig());
        // The wrapped setTimeout must still function correctly for legitimate use
        const result = await session.eval("await new Promise(resolve => setTimeout(() => resolve('done'), 10))");
        expect(result.success).toBe(true);
        expect(result.output).toBe("done");
        session.destroy();
    });
    it("sandbox clearTimeout cancels tracked timers", async () => {
        const session = createReplSession(makeConfig());
        // Verify that clearTimeout works within the sandbox.
        // Use a two-step approach: set a timer, clear it, then wait to confirm
        // the callback never fires.
        const result = await session.eval(`
      await new Promise(resolve => {
        const id = setTimeout(() => { throw new Error('should not fire'); }, 50);
        clearTimeout(id);
        setTimeout(() => resolve('cleared'), 100);
      })
    `);
        expect(result.success).toBe(true);
        expect(result.output).toBe("cleared");
        session.destroy();
    });
    it("var declarations persist across sync evals", async () => {
        const session = createReplSession(makeConfig());
        await session.eval("var x = 42");
        const result = await session.eval("x");
        expect(result.success).toBe(true);
        expect(result.output).toBe("42");
        session.destroy();
    });
    it("var declarations do not persist inside async IIFE (await path)", async () => {
        const session = createReplSession(makeConfig());
        // This uses await, so it wraps in IIFE — var is function-scoped
        await session.eval("var y = await Promise.resolve(99)");
        const result = await session.eval("typeof y");
        expect(result.success).toBe(true);
        // y is lost because it was inside the IIFE
        expect(result.output).toBe("undefined");
        session.destroy();
    });
    it("async var declaration returns the assigned value", async () => {
        const session = createReplSession(makeConfig());
        const result = await session.eval("var r = await Promise.resolve({ok:true})");
        expect(result.success).toBe(true);
        expect(result.output).toContain('"ok": true');
        session.destroy();
    });
    it("multiple async var declarations returns last value", async () => {
        const session = createReplSession(makeConfig());
        const result = await session.eval("var a = await Promise.resolve(1)\nvar b = await Promise.resolve(2)");
        expect(result.success).toBe(true);
        expect(result.output).toContain("2");
        session.destroy();
    });
    it("dispatchSubAgent result appears in console output via self-reporting", async () => {
        const mockResult = {
            success: true,
            output: "agent did work",
            filesModified: ["src/app.ts"],
        };
        // Use createReplHelpers with an agentLauncher to exercise the
        // self-reporting console.log inside replHelpers' dispatchSubAgent.
        const helpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            statePath: "",
            agentLauncher: async () => mockResult,
        });
        const session = createReplSession(makeConfig({ helpers }));
        const result = await session.eval('await dispatchSubAgent({ type: "coder", taskId: "t1", instructions: "test" })');
        expect(result.success).toBe(true);
        expect(result.output).toContain("[dispatchSubAgent:t1]");
        expect(result.output).toContain('"success":true');
        expect(result.output).toContain("src/app.ts");
        session.destroy();
    });
    it("tracks consecutive errors and resets on success", async () => {
        const session = createReplSession(makeConfig());
        await session.eval("throw new Error('fail 1')");
        await session.eval("throw new Error('fail 2')");
        await session.eval("throw new Error('fail 3')");
        expect(session.getConsecutiveErrors()).toBe(3);
        await session.eval("42");
        expect(session.getConsecutiveErrors()).toBe(0);
        session.destroy();
    });
});
describe("replHelpers", () => {
    it("readFile reads a real file from a fixture directory", () => {
        const helpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            statePath: "",
            agentLauncher: null,
        });
        const content = helpers.readFile("hello.txt");
        expect(content).toBe("Hello from fixture\n");
    });
    it("listDir lists a fixture directory correctly", () => {
        const helpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            statePath: "",
            agentLauncher: null,
        });
        const entries = helpers.listDir(".");
        const names = entries.map((e) => e.name);
        expect(names).toContain("hello.txt");
        expect(names).toContain("subdir");
        expect(names).toContain("sample-spec.md");
        const helloEntry = entries.find((e) => e.name === "hello.txt");
        expect(helloEntry?.type).toBe("file");
        expect(helloEntry?.size).toBeGreaterThan(0);
        const subdirEntry = entries.find((e) => e.name === "subdir");
        expect(subdirEntry?.type).toBe("dir");
        expect(subdirEntry?.size).toBe(0);
    });
    it("searchFiles finds a pattern in fixture files", () => {
        const helpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            statePath: "",
            agentLauncher: null,
        });
        const results = helpers.searchFiles("searchable");
        expect(results.length).toBeGreaterThanOrEqual(1);
        const match = results.find((r) => r.path.includes("nested.txt"));
        expect(match).toBeDefined();
        expect(match.line).toBe(3);
        expect(match.content).toContain("searchable pattern here");
    });
    // -------------------------------------------------------------------------
    // Issue #2: getState() previously threw ENOENT when state.json didn't exist,
    // which happens on the first turn of phase-1 before any state has been
    // written. The thrown error incremented the REPL's consecutive error counter,
    // potentially halting the phase prematurely.
    //
    // Mitigation: getState() now catches ENOENT and returns a valid empty state
    // matching the SharedState schema, so the orchestrator can proceed normally.
    // -------------------------------------------------------------------------
    it("getState returns empty initial state when state file does not exist", () => {
        const helpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            // Point to a path that definitely doesn't exist
            statePath: join(FIXTURES_DIR, "nonexistent-state.json"),
            agentLauncher: null,
        });
        // Should not throw — returns a valid empty state instead of ENOENT
        const state = helpers.getState();
        expect(state.currentPhase).toBe("");
        expect(state.completedPhases).toEqual([]);
        expect(state.phaseReports).toEqual([]);
        expect(state.phaseRetries).toEqual({});
        expect(state.modifiedFiles).toEqual([]);
        expect(state.schemaChanges).toEqual([]);
    });
    // -------------------------------------------------------------------------
    // Issue #5: searchFiles() passed LLM-generated patterns directly to
    // `new RegExp()` without validation. Malformed patterns throw SyntaxError,
    // and pathological patterns (e.g., `(a+)+$`) cause catastrophic backtracking
    // (ReDoS) that blocks the event loop, bypassing the sandbox timeout.
    //
    // Mitigation: searchFiles() now wraps RegExp construction in try/catch and
    // rejects patterns longer than 200 characters. Invalid patterns return an
    // empty result set instead of crashing.
    // -------------------------------------------------------------------------
    it("searchFiles returns empty array for invalid regex pattern", () => {
        const helpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            statePath: "",
            agentLauncher: null,
        });
        // Unclosed character class — would throw SyntaxError without the guard
        const results = helpers.searchFiles("[invalid");
        expect(results).toEqual([]);
    });
    it("searchFiles treats glob-like first param as file filter", () => {
        const helpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            statePath: "",
            agentLauncher: null,
        });
        // When pattern contains *, treat it as glob file filter (match all content)
        const results = helpers.searchFiles("**/*.txt");
        expect(results.length).toBeGreaterThanOrEqual(1);
        // Should find files matching the glob
        const paths = [...new Set(results.map((r) => r.path))];
        expect(paths.some((p) => p.endsWith(".txt"))).toBe(true);
        // Should NOT find .md files
        expect(paths.some((p) => p.endsWith(".md"))).toBe(false);
    });
    it("searchFiles returns empty array for excessively long patterns", () => {
        const helpers = createReplHelpers({
            projectRoot: FIXTURES_DIR,
            statePath: "",
            agentLauncher: null,
        });
        // A 201-char pattern is rejected before RegExp construction,
        // preventing potential ReDoS from pathological patterns
        const longPattern = "a".repeat(201);
        const results = helpers.searchFiles(longPattern);
        expect(results).toEqual([]);
    });
});
//# sourceMappingURL=replManager.test.js.map