import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AgentLauncher } from "../orchestrator/agentLauncher.js";
import type { DevServerHandle } from "./devServer.js";
import type { BrowserAcceptanceReport } from "../types/state.js";

export type BrowserAcceptanceConfig = {
  specPath: string;
  projectRoot: string;
  devServerHandle: DevServerHandle;
  maxRetries: number;
  saveTests: boolean;
  testOutputDir?: string;
  agentLauncher: AgentLauncher;
};

type TesterResult = {
  results: Array<{ criterion: string; passed: boolean; detail?: string }>;
  testFilePath?: string;
};

/**
 * Runs the end-of-build browser acceptance test cycle.
 *
 * 1. Dispatches the browser-tester agent to generate and run Playwright tests
 * 2. If failures exist, dispatches the browser-fixer agent to fix app code
 * 3. Re-runs the browser-tester to verify fixes
 * 4. Loops up to maxRetries times
 * 5. Optionally saves generated tests to the project
 */
export async function runBrowserAcceptance(
  config: BrowserAcceptanceConfig,
): Promise<BrowserAcceptanceReport> {
  const specContent = readFileSync(config.specPath, "utf-8");
  const devUrl = config.devServerHandle.url;
  const testOutputDir = config.testOutputDir ?? join(config.projectRoot, "tests", "e2e");

  let lastResults: TesterResult = { results: [] };
  let retries = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Generate and run acceptance tests
    const testerInstructions = buildTesterPrompt(
      specContent,
      devUrl,
      testOutputDir,
      attempt > 0 ? lastResults : undefined,
    );

    console.log(
      attempt === 0
        ? "Running browser acceptance tests…"
        : `Re-running browser acceptance tests (retry ${attempt}/${config.maxRetries})…`,
    );

    const testerResult = await config.agentLauncher.dispatchSubAgent({
      type: "browser-tester",
      taskId: "browser-acceptance",
      instructions: testerInstructions,
      filePaths: [config.specPath],
      outputPaths: [testOutputDir],
    });

    lastResults = parseTesterOutput(testerResult.output);

    // If the tester returned no structured results, stop — there's nothing to fix.
    if (lastResults.results.length === 0) {
      console.log(
        attempt === 0
          ? "Browser acceptance: tester returned no structured results. Skipping retries."
          : "Browser acceptance: tester returned no structured results after fix attempt. Stopping.",
      );
      break;
    }

    const allPassed = lastResults.results.every((r) => r.passed);

    if (allPassed) {
      console.log(
        `Browser acceptance: all ${lastResults.results.length} criteria passed.`,
      );
      break;
    }

    const failCount = lastResults.results.filter((r) => !r.passed).length;
    console.log(
      `Browser acceptance: ${failCount} criteria failed.`,
    );

    // If we have retries remaining, dispatch the fixer
    if (attempt < config.maxRetries) {
      const fixerInstructions = buildFixerPrompt(lastResults, devUrl);

      console.log("Dispatching browser-fixer agent…");

      await config.agentLauncher.dispatchSubAgent({
        type: "browser-fixer",
        taskId: "browser-fix",
        instructions: fixerInstructions,
        filePaths: lastResults.testFilePath ? [lastResults.testFilePath] : [],
        outputPaths: [config.projectRoot],
      });

      retries++;
    }
  }

  // Save tests if requested
  let generatedTestPath: string | undefined;
  if (config.saveTests && lastResults.testFilePath) {
    const dest = join(testOutputDir, "acceptance.spec.ts");
    mkdirSync(dirname(dest), { recursive: true });
    try {
      copyFileSync(lastResults.testFilePath, dest);
      generatedTestPath = dest;
      console.log(`Saved acceptance tests to: ${dest}`);
    } catch {
      // Test file may not exist if agent didn't create one
    }
  }

  const passed = lastResults.results.length > 0 && lastResults.results.every((r) => r.passed);

  return {
    passed,
    results: lastResults.results,
    retries,
    ...(generatedTestPath ? { generatedTestPath } : {}),
  };
}

function buildTesterPrompt(
  specContent: string,
  devUrl: string,
  testOutputDir: string,
  previousResults?: TesterResult,
): string {
  const lines: string[] = [];

  lines.push("# Browser Acceptance Testing");
  lines.push("");
  lines.push("## Spec");
  lines.push("");
  lines.push("<spec>");
  lines.push(specContent);
  lines.push("</spec>");
  lines.push("");
  lines.push(`## Dev Server URL: ${devUrl}`);
  lines.push("");
  lines.push(`## Test Output Directory: ${testOutputDir}`);
  lines.push("");

  if (previousResults) {
    lines.push("## Previous Results (after fix attempt)");
    lines.push("");
    lines.push("Focus on re-testing the following failing criteria:");
    for (const r of previousResults.results) {
      if (!r.passed) {
        lines.push(`- ${r.criterion}${r.detail ? `: ${r.detail}` : ""}`);
      }
    }
    lines.push("");
  }

  lines.push("Generate Playwright acceptance tests for the spec's acceptance criteria, run them, and report the results.");
  lines.push("");
  lines.push("You MUST end your response with a JSON block in this exact format:");
  lines.push("```json");
  lines.push('{ "results": [{ "criterion": "...", "passed": true/false, "detail": "..." }], "testFilePath": "..." }');
  lines.push("```");
  lines.push("If no tests could be generated or run, return: `{ \"results\": [], \"testFilePath\": null }`");

  return lines.join("\n");
}

function buildFixerPrompt(results: TesterResult, devUrl: string): string {
  const lines: string[] = [];

  lines.push("# Browser Fix Request");
  lines.push("");
  lines.push(`Dev server URL: ${devUrl}`);
  lines.push("");
  lines.push("## Failing Acceptance Criteria");
  lines.push("");

  for (const r of results.results) {
    if (!r.passed) {
      lines.push(`- **${r.criterion}**${r.detail ? `: ${r.detail}` : ""}`);
    }
  }

  if (results.testFilePath) {
    lines.push("");
    lines.push(`## Test File: ${results.testFilePath}`);
    lines.push("");
    lines.push("Read this test file to understand exactly what the tests expect.");
  }

  lines.push("");
  lines.push("Fix the application code so these criteria pass. Do NOT modify the test files.");

  return lines.join("\n");
}

function parseTesterOutput(output: string): TesterResult {
  // Try to find a JSON block in the output
  const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) ??
    output.match(/\{[\s\S]*"results"[\s\S]*\}/);

  if (jsonMatch) {
    const jsonStr = jsonMatch[1] ?? jsonMatch[0];
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.results)) {
        return {
          results: parsed.results.map((r: Record<string, unknown>) => ({
            criterion: String(r.criterion ?? ""),
            passed: Boolean(r.passed),
            ...(r.detail ? { detail: String(r.detail) } : {}),
          })),
          testFilePath: typeof parsed.testFilePath === "string" ? parsed.testFilePath : undefined,
        };
      }
    } catch {
      // Fall through to empty results
    }
  }

  // If we can't parse structured output, warn and return empty results
  if (output.length > 0) {
    console.warn("Warning: browser-tester output did not contain parseable JSON results.");
  }
  return { results: [] };
}
