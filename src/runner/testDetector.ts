import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getChangedFiles } from "../git.js";

// ---------------------------------------------------------------------------
// Test auto-detection
// ---------------------------------------------------------------------------

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /\.test\.\w+$/,
];

/**
 * Returns true if any newly added files look like test files.
 */
export function hasNewTestFiles(projectRoot: string, startSha?: string): boolean {
  const changed = getChangedFiles(projectRoot, startSha);
  return changed.some(
    (f) =>
      (f.status === "A" || f.status === "?" || f.status === "M") &&
      TEST_FILE_PATTERNS.some((re) => re.test(f.path)),
  );
}

/**
 * Attempts to detect a test command from the project.
 * Returns null if no test runner can be identified.
 */
export function detectTestCommand(projectRoot: string): string | null {
  // Check package.json test script
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const testScript = pkg?.scripts?.test;
      if (
        typeof testScript === "string" &&
        testScript.length > 0 &&
        !testScript.includes("no test specified")
      ) {
        return "npm test";
      }
    } catch {
      // ignore parse errors
    }
  }

  // Check for common test runner configs
  const configs: Array<{ file: string; command: string }> = [
    { file: "vitest.config.ts", command: "npx vitest run" },
    { file: "vitest.config.js", command: "npx vitest run" },
    { file: "vitest.config.mts", command: "npx vitest run" },
    { file: "jest.config.ts", command: "npx jest" },
    { file: "jest.config.js", command: "npx jest" },
    { file: "jest.config.cjs", command: "npx jest" },
    { file: "jest.config.mjs", command: "npx jest" },
  ];

  for (const { file, command } of configs) {
    if (existsSync(join(projectRoot, file))) {
      return command;
    }
  }

  return null;
}
