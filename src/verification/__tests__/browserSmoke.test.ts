import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBrowserSmoke, isPlaywrightAvailable } from "../browserSmoke.js";

const FIXTURES_DIR = join(import.meta.dirname, "../../../test/fixtures/browser");

const playwrightAvailable = await isPlaywrightAvailable();

// --- Fixture HTTP server ------------------------------------------------

let server: Server;
let baseUrl: string;

function serveFixtures(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const s = createServer((req: IncomingMessage, res: ServerResponse) => {
      const urlPath = req.url === "/" ? "/healthy.html" : req.url!;
      const filePath = join(FIXTURES_DIR, urlPath);
      try {
        const content = readFileSync(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    s.listen(0, () => {
      const addr = s.address() as { port: number };
      resolve({ server: s, port: addr.port });
    });
  });
}

// --- Tests --------------------------------------------------------------

describe.skipIf(!playwrightAvailable)("runBrowserSmoke (integration)", () => {
  beforeAll(async () => {
    const result = await serveFixtures();
    server = result.server;
    baseUrl = `http://localhost:${result.port}`;
  });

  afterAll(() => {
    server?.close();
  });

  it("passes on a healthy page", async () => {
    const report = await runBrowserSmoke({
      url: `${baseUrl}/healthy.html`,
      phaseId: "healthy",
    });

    expect(report.skipped).toBe(false);
    expect(report.passed).toBe(true);
    expect(report.consoleErrors).toHaveLength(0);
    expect(report.interactionFailures).toHaveLength(0);
  });

  it("detects a blank page", async () => {
    const report = await runBrowserSmoke({
      url: `${baseUrl}/blank.html`,
      phaseId: "blank",
    });

    expect(report.skipped).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.interactionFailures).toEqual(
      expect.arrayContaining([expect.stringContaining("blank")]),
    );
  });

  it("collects console errors and uncaught exceptions", async () => {
    const report = await runBrowserSmoke({
      url: `${baseUrl}/console-errors.html`,
      phaseId: "console-err",
    });

    expect(report.skipped).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.consoleErrors.length).toBeGreaterThan(0);

    const allErrors = report.consoleErrors.join("\n");
    expect(allErrors).toContain("Deliberate test error");
    expect(allErrors).toContain("Uncaught");
  });

  it("passes when page has app root but no text", async () => {
    const report = await runBrowserSmoke({
      url: `${baseUrl}/with-app-root.html`,
      phaseId: "app-root",
    });

    expect(report.skipped).toBe(false);
    // Should pass because #app element satisfies the content check
    expect(report.interactionFailures).not.toEqual(
      expect.arrayContaining([expect.stringContaining("blank")]),
    );
  });

  it("takes a screenshot when screenshotDir is provided", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "trellis-smoke-"));
    try {
      const report = await runBrowserSmoke({
        url: `${baseUrl}/healthy.html`,
        phaseId: "screenshot",
        screenshotDir: tmpDir,
      });

      expect(report.screenshot).toBeDefined();
      expect(existsSync(report.screenshot!)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns navigation failure for an unreachable URL", async () => {
    const report = await runBrowserSmoke({
      url: "http://localhost:1",
      phaseId: "unreachable",
      timeout: 5_000,
    });

    expect(report.skipped).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.consoleErrors).toEqual(
      expect.arrayContaining([expect.stringContaining("Navigation failed")]),
    );
  });
});
