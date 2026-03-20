import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { createReplSession } from "../replManager.js";
import { createReplHelpers } from "../replHelpers.js";
import type { ReplHelpers } from "../replHelpers.js";
import type { ReplSessionConfig } from "../replManager.js";

const FIXTURES_DIR = join(import.meta.dirname, "../../../test/fixtures/repl-test");
const SPEC_PATH = join(FIXTURES_DIR, "sample-spec.md");

function makeHelpers(overrides?: Partial<ReplHelpers>): ReplHelpers {
  return {
    readFile: () => "",
    listDir: () => [],
    searchFiles: () => [],
    readSpecSections: () => "",
    getState: () => ({
      currentPhase: "phase-1",
      completedPhases: [],
      modifiedFiles: [],
      schemaChanges: [],
      phaseReports: [],
      phaseRetries: {},
    }),
    writePhaseReport: () => {},
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

function makeConfig(overrides?: Partial<ReplSessionConfig>): ReplSessionConfig {
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
    expect(result.output).toContain(
      "[TRUNCATED — showing first 50 chars of 200 total]",
    );
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
      specPath: SPEC_PATH,
      statePath: "",
      agentLauncher: null,
    });
    const session = createReplSession(
      makeConfig({ helpers: realHelpers }),
    );

    await session.eval('readFile = "oops"');
    session.restoreScaffold();
    const result = await session.eval("typeof readFile");
    expect(result.success).toBe(true);
    expect(result.output).toBe("function");
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
      specPath: SPEC_PATH,
      statePath: "",
      agentLauncher: null,
    });
    const content = helpers.readFile("hello.txt");
    expect(content).toBe("Hello from fixture\n");
  });

  it("listDir lists a fixture directory correctly", () => {
    const helpers = createReplHelpers({
      projectRoot: FIXTURES_DIR,
      specPath: SPEC_PATH,
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
      specPath: SPEC_PATH,
      statePath: "",
      agentLauncher: null,
    });
    const results = helpers.searchFiles("searchable");
    expect(results.length).toBeGreaterThanOrEqual(1);

    const match = results.find((r) => r.path.includes("nested.txt"));
    expect(match).toBeDefined();
    expect(match!.line).toBe(3);
    expect(match!.content).toContain("searchable pattern here");
  });

  it("readSpecSections extracts the correct section from a spec", () => {
    const helpers = createReplHelpers({
      projectRoot: FIXTURES_DIR,
      specPath: SPEC_PATH,
      statePath: "",
      agentLauncher: null,
    });
    const section = helpers.readSpecSections(["§2"]);
    expect(section).toContain("Architecture");
    expect(section).toContain("multiple paragraphs");
    expect(section).not.toContain("Introduction");
    expect(section).not.toContain("API section");
  });
});
