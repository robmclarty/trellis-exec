import { join } from "node:path";
import { isPlaywrightAvailable, runBrowserSmoke } from "../verification/browserSmoke.js";
import { detectDevServerCommand, startDevServer } from "../verification/devServer.js";
import { runBrowserAcceptance } from "../verification/browserAcceptance.js";
import { createAgentLauncher } from "../orchestrator/agentLauncher.js";
// ---------------------------------------------------------------------------
// Browser smoke check (Tier 1)
// ---------------------------------------------------------------------------
export async function runBrowserSmokeForPhase(ctx, phase, projectRoot) {
    if (!(await isPlaywrightAvailable())) {
        if (ctx.verbose)
            console.log("Browser smoke: Playwright not available, skipping.");
        return { passed: true, skipped: true, reason: "Playwright not available", consoleErrors: [], interactionFailures: [] };
    }
    const devCmd = ctx.devServerCommand ?? detectDevServerCommand(projectRoot);
    if (!devCmd) {
        if (ctx.verbose)
            console.log("Browser smoke: no dev server command found, skipping.");
        return { passed: true, skipped: true, reason: "No dev server command", consoleErrors: [], interactionFailures: [] };
    }
    console.log(`Running browser smoke check for "${phase.id}"…`);
    let handle;
    try {
        handle = await startDevServer({ command: devCmd, cwd: projectRoot });
    }
    catch (err) {
        console.log(`Browser smoke: dev server failed to start: ${err instanceof Error ? err.message : String(err)}`);
        return { passed: true, skipped: true, reason: `Dev server failed: ${err instanceof Error ? err.message : String(err)}`, consoleErrors: [], interactionFailures: [] };
    }
    try {
        const report = await runBrowserSmoke({
            url: handle.url,
            phaseId: phase.id,
            screenshotDir: join(projectRoot, ".trellis", "screenshots"),
        });
        const status = report.passed ? "passed" : "failed";
        console.log(`Browser smoke check ${status} for "${phase.id}".`);
        if (!report.passed) {
            if (report.consoleErrors.length > 0) {
                console.log(`  Console errors: ${report.consoleErrors.length}`);
            }
            if (report.interactionFailures.length > 0) {
                console.log(`  Interaction failures: ${report.interactionFailures.length}`);
            }
        }
        return report;
    }
    finally {
        await handle.stop();
    }
}
// ---------------------------------------------------------------------------
// Browser acceptance tests (Tier 2) — end-of-build
// ---------------------------------------------------------------------------
export async function runEndOfBuildAcceptance(ctx, tasksJson, projectRoot) {
    const hasBrowserPhases = tasksJson.phases.some((p) => p.requiresBrowserTest);
    if (!hasBrowserPhases)
        return null;
    if (!(await isPlaywrightAvailable())) {
        if (ctx.verbose)
            console.log("Browser acceptance: Playwright not available, skipping.");
        return null;
    }
    const devCmd = ctx.devServerCommand ?? detectDevServerCommand(projectRoot);
    if (!devCmd) {
        if (ctx.verbose)
            console.log("Browser acceptance: no dev server command found, skipping.");
        return null;
    }
    console.log("Starting end-of-build browser acceptance tests…");
    let handle;
    try {
        handle = await startDevServer({ command: devCmd, cwd: projectRoot });
    }
    catch (err) {
        console.log(`Browser acceptance: dev server failed to start: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
    try {
        const launcher = createAgentLauncher({
            pluginRoot: ctx.pluginRoot,
            projectRoot,
        });
        const report = await runBrowserAcceptance({
            specPath: ctx.specPath,
            projectRoot,
            devServerHandle: handle,
            maxRetries: ctx.browserTestRetries,
            saveTests: ctx.saveE2eTests,
            agentLauncher: launcher,
        });
        return report;
    }
    finally {
        await handle.stop();
    }
}
//# sourceMappingURL=browserRunner.js.map