import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectWebApp } from "../detectWebApp.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "detect-web-app-"));
}

describe("detectWebApp", () => {
  const dirs: string[] = [];

  function tmp(): string {
    const d = makeTmpDir();
    dirs.push(d);
    return d;
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("returns false for an empty directory", () => {
    expect(detectWebApp(tmp())).toBe(false);
  });

  it("returns false when projectRoot does not exist", () => {
    expect(detectWebApp("/tmp/does-not-exist-xyz-123")).toBe(false);
  });

  it("returns true when vite.config.ts exists", () => {
    const d = tmp();
    writeFileSync(join(d, "vite.config.ts"), "export default {}");
    expect(detectWebApp(d)).toBe(true);
  });

  it("returns true when webpack.config.js exists", () => {
    const d = tmp();
    writeFileSync(join(d, "webpack.config.js"), "module.exports = {}");
    expect(detectWebApp(d)).toBe(true);
  });

  it("returns true when next.config.mjs exists", () => {
    const d = tmp();
    writeFileSync(join(d, "next.config.mjs"), "export default {}");
    expect(detectWebApp(d)).toBe(true);
  });

  it("returns true when index.html exists at root", () => {
    const d = tmp();
    writeFileSync(join(d, "index.html"), "<html></html>");
    expect(detectWebApp(d)).toBe(true);
  });

  it("returns true when public/index.html exists", () => {
    const d = tmp();
    mkdirSync(join(d, "public"));
    writeFileSync(join(d, "public", "index.html"), "<html></html>");
    expect(detectWebApp(d)).toBe(true);
  });

  it("returns true when src/index.html exists", () => {
    const d = tmp();
    mkdirSync(join(d, "src"));
    writeFileSync(join(d, "src", "index.html"), "<html></html>");
    expect(detectWebApp(d)).toBe(true);
  });

  it("returns true when package.json has react dependency", () => {
    const d = tmp();
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }),
    );
    expect(detectWebApp(d)).toBe(true);
  });

  it("returns true when package.json has vue devDependency", () => {
    const d = tmp();
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({ devDependencies: { vue: "^3.0.0" } }),
    );
    expect(detectWebApp(d)).toBe(true);
  });

  it("returns false for backend-only project", () => {
    const d = tmp();
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0", pg: "^8.0.0" } }),
    );
    expect(detectWebApp(d)).toBe(false);
  });

  it("returns false for CLI tool project", () => {
    const d = tmp();
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({ dependencies: { commander: "^10.0.0" } }),
    );
    expect(detectWebApp(d)).toBe(false);
  });
});
