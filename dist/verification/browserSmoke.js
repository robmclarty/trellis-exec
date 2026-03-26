import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
const DEFAULT_TIMEOUT = 10_000;
const MAX_INTERACTIONS = 20;
let _playwrightAvailable = null;
let _browsersInstalled = null;
// Dynamic import wrapper — Playwright is an optional peer dependency.
// The module name is constructed at runtime to prevent TypeScript from
// attempting compile-time resolution of the module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPlaywright() {
    const moduleName = "play" + "wright";
    return import(moduleName);
}
/**
 * Checks if Playwright is importable. Caches the result.
 */
export async function isPlaywrightAvailable() {
    if (_playwrightAvailable !== null)
        return _playwrightAvailable;
    try {
        await loadPlaywright();
        _playwrightAvailable = true;
    }
    catch {
        _playwrightAvailable = false;
    }
    return _playwrightAvailable;
}
/**
 * Checks if Playwright browser binaries are installed.
 * Only meaningful if Playwright itself is available.
 */
async function areBrowsersInstalled() {
    if (_browsersInstalled !== null)
        return _browsersInstalled;
    try {
        const pw = await loadPlaywright();
        const browser = await pw.chromium.launch({ headless: true });
        await browser.close();
        _browsersInstalled = true;
    }
    catch {
        _browsersInstalled = false;
    }
    return _browsersInstalled;
}
function makeSkippedReport(reason) {
    return {
        passed: true,
        skipped: true,
        reason,
        consoleErrors: [],
        interactionFailures: [],
    };
}
/**
 * Runs a deterministic browser smoke test against a URL.
 * No LLM involved — fixed Playwright script that:
 * 1. Loads the page
 * 2. Collects console errors
 * 3. Checks the page isn't blank
 * 4. Clicks interactive elements and checks nothing crashes
 * 5. Takes a screenshot
 */
export async function runBrowserSmoke(config) {
    if (!(await isPlaywrightAvailable())) {
        return makeSkippedReport("Playwright not available");
    }
    if (!(await areBrowsersInstalled())) {
        console.log("Playwright installed but browsers not found. " +
            "Run 'npx playwright install chromium' to enable browser testing.");
        return makeSkippedReport("Playwright browsers not installed");
    }
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    const consoleErrors = [];
    const interactionFailures = [];
    let screenshotPath;
    const pw = await loadPlaywright();
    const browser = await pw.chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(timeout);
        // Collect console errors
        page.on("console", (msg) => {
            if (msg.type() === "error") {
                consoleErrors.push(msg.text());
            }
        });
        // Collect page errors (uncaught exceptions)
        page.on("pageerror", (err) => {
            consoleErrors.push(`Uncaught: ${err.message}`);
        });
        // Navigate to the app
        try {
            await page.goto(config.url, { waitUntil: "networkidle" });
        }
        catch (err) {
            return {
                passed: false,
                skipped: false,
                consoleErrors: [`Navigation failed: ${err instanceof Error ? err.message : String(err)}`],
                interactionFailures: [],
            };
        }
        // Blank page check
        const hasContent = await page.evaluate(() => {
            const text = document.body?.innerText?.trim() ?? "";
            if (text.length > 0)
                return true;
            const selectors = ["main", "[role='main']", "#app", "#root", ".app"];
            return selectors.some((s) => document.querySelector(s) !== null);
        });
        if (!hasContent) {
            interactionFailures.push("Page appears blank — no text content or app root element found");
        }
        // Find interactive elements (filter external links to avoid navigation away)
        const interactiveElements = await page.$$("button, a[href]:not([href^='http']):not([href^='//']), input, select, textarea, [role='button']");
        // Click test: try clicking each element (up to MAX_INTERACTIONS)
        const toTest = interactiveElements.slice(0, MAX_INTERACTIONS);
        const startUrl = page.url();
        for (let i = 0; i < toTest.length; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const el = toTest[i];
            try {
                const isVisible = await el.isVisible();
                if (!isVisible)
                    continue;
                const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
                const label = await el.evaluate((e) => e.textContent?.trim().slice(0, 50) ??
                    e.getAttribute("aria-label") ??
                    e.getAttribute("name") ??
                    `<${e.tagName.toLowerCase()}>`);
                // Skip input/select/textarea — just verify they're focusable
                if (["input", "select", "textarea"].includes(tagName)) {
                    try {
                        await el.focus();
                    }
                    catch (err) {
                        interactionFailures.push(`Failed to focus ${tagName}[${label}]: ${err instanceof Error ? err.message : String(err)}`);
                    }
                    continue;
                }
                // Click buttons and links
                await el.click({ timeout: 3_000 });
                // Check if we navigated away — if so, go back
                if (page.url() !== startUrl) {
                    await page.goto(startUrl, { waitUntil: "networkidle" });
                }
            }
            catch (err) {
                const desc = await el.evaluate((e) => e.textContent?.trim().slice(0, 50) ?? e.tagName).catch(() => `element[${i}]`);
                interactionFailures.push(`Click failed on "${desc}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        // Screenshot
        if (config.screenshotDir) {
            screenshotPath = `${config.screenshotDir}/${config.phaseId}-${Date.now()}.png`;
            mkdirSync(dirname(screenshotPath), { recursive: true });
            await page.screenshot({ path: screenshotPath, fullPage: true });
        }
        const passed = consoleErrors.length === 0 && interactionFailures.length === 0;
        return {
            passed,
            skipped: false,
            consoleErrors,
            interactionFailures,
            ...(screenshotPath ? { screenshot: screenshotPath } : {}),
        };
    }
    finally {
        await browser.close();
    }
}
//# sourceMappingURL=browserSmoke.js.map