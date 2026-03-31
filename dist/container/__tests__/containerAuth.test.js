import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAuthMounts, generateContainerSettings, cleanupTempFile, } from "../containerAuth.js";
// ---
// buildAuthMounts
// ---
describe("buildAuthMounts", () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "auth-test-"));
    });
    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });
    it("always includes the auth volume mount", () => {
        const args = buildAuthMounts({ authVolumeName: "test-vol" });
        expect(args).toContain("-v");
        expect(args).toContain("test-vol:/home/claude/.claude");
    });
    it("includes .claude.json mount when dockerClaudeJsonPath is provided", () => {
        const args = buildAuthMounts({
            authVolumeName: "test-vol",
            dockerClaudeJsonPath: "/tmp/token/.claude.json",
        });
        expect(args).toContain("/tmp/token/.claude.json:/home/claude/.claude.json:ro");
    });
    it("omits .claude.json mount when dockerClaudeJsonPath is undefined", () => {
        const args = buildAuthMounts({ authVolumeName: "test-vol" });
        const jsonMount = args.find((a) => a.includes(".claude.json"));
        expect(jsonMount).toBeUndefined();
    });
    it("includes dual plugin mounts when plugins dir exists", () => {
        // Create a fake plugins directory
        const pluginsDir = join(tmpDir, "plugins");
        mkdirSync(pluginsDir);
        const args = buildAuthMounts({
            authVolumeName: "test-vol",
            hostClaudeDir: tmpDir,
        });
        expect(args).toContain(`${pluginsDir}:/home/claude/.claude/plugins:ro`);
        expect(args).toContain(`${pluginsDir}:${pluginsDir}:ro`);
    });
    it("omits plugin mounts when plugins dir does not exist", () => {
        const args = buildAuthMounts({
            authVolumeName: "test-vol",
            hostClaudeDir: tmpDir, // exists but has no plugins/ subdirectory
        });
        const pluginMount = args.find((a) => a.includes("plugins"));
        expect(pluginMount).toBeUndefined();
    });
    it("omits plugin mounts when hostClaudeDir is undefined", () => {
        const args = buildAuthMounts({ authVolumeName: "test-vol" });
        const pluginMount = args.find((a) => a.includes("plugins"));
        expect(pluginMount).toBeUndefined();
    });
    it("includes settings mount when containerSettingsPath is provided", () => {
        const args = buildAuthMounts({
            authVolumeName: "test-vol",
            containerSettingsPath: "/tmp/settings/settings.json",
        });
        expect(args).toContain("/tmp/settings/settings.json:/home/claude/.claude/settings.json:ro");
    });
    it("omits settings mount when containerSettingsPath is undefined", () => {
        const args = buildAuthMounts({ authVolumeName: "test-vol" });
        const settingsMount = args.find((a) => a.includes("settings.json"));
        expect(settingsMount).toBeUndefined();
    });
    it("includes all mounts when all options are provided", () => {
        const pluginsDir = join(tmpDir, "plugins");
        mkdirSync(pluginsDir);
        const args = buildAuthMounts({
            authVolumeName: "test-vol",
            dockerClaudeJsonPath: "/tmp/token/.claude.json",
            hostClaudeDir: tmpDir,
            containerSettingsPath: "/tmp/settings/settings.json",
        });
        // Should have: volume, .claude.json, plugins x2, settings = 5 mount pairs (10 args)
        const mountCount = args.filter((a) => a === "-v").length;
        expect(mountCount).toBe(5);
    });
});
// ---
// generateContainerSettings
// ---
describe("generateContainerSettings", () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "settings-test-"));
    });
    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });
    it("returns undefined when host settings file does not exist", () => {
        const result = generateContainerSettings(join(tmpDir, "missing.json"));
        expect(result).toBeUndefined();
    });
    it("strips extraKnownMarketplaces from settings", () => {
        const hostSettings = {
            extraKnownMarketplaces: ["https://example.com"],
            theme: "dark",
        };
        const hostPath = join(tmpDir, "settings.json");
        writeFileSync(hostPath, JSON.stringify(hostSettings));
        const resultPath = generateContainerSettings(hostPath);
        expect(resultPath).toBeDefined();
        const content = JSON.parse(readFileSync(resultPath, "utf-8"));
        expect(content).not.toHaveProperty("extraKnownMarketplaces");
        expect(content.theme).toBe("dark");
    });
    it("sets autoUpdates to false", () => {
        const hostSettings = { autoUpdates: true };
        const hostPath = join(tmpDir, "settings.json");
        writeFileSync(hostPath, JSON.stringify(hostSettings));
        const resultPath = generateContainerSettings(hostPath);
        expect(resultPath).toBeDefined();
        const content = JSON.parse(readFileSync(resultPath, "utf-8"));
        expect(content.autoUpdates).toBe(false);
    });
    it("preserves other settings fields", () => {
        const hostSettings = {
            theme: "dark",
            enabledPlugins: ["foo"],
            extraKnownMarketplaces: ["bar"],
        };
        const hostPath = join(tmpDir, "settings.json");
        writeFileSync(hostPath, JSON.stringify(hostSettings));
        const resultPath = generateContainerSettings(hostPath);
        const content = JSON.parse(readFileSync(resultPath, "utf-8"));
        expect(content.theme).toBe("dark");
        expect(content.enabledPlugins).toEqual(["foo"]);
    });
    it("returns undefined for invalid JSON", () => {
        const hostPath = join(tmpDir, "settings.json");
        writeFileSync(hostPath, "not json {{{");
        const result = generateContainerSettings(hostPath);
        expect(result).toBeUndefined();
    });
});
// ---
// cleanupTempFile
// ---
describe("cleanupTempFile", () => {
    it("does nothing when path is undefined", () => {
        expect(() => cleanupTempFile(undefined)).not.toThrow();
    });
    it("removes the temp file and parent directory", () => {
        const tmpDir = mkdtempSync(join(tmpdir(), "cleanup-test-"));
        const tmpFile = join(tmpDir, "test.json");
        writeFileSync(tmpFile, "{}");
        cleanupTempFile(tmpFile);
        expect(existsSync(tmpDir)).toBe(false);
    });
    it("does not throw when file does not exist", () => {
        expect(() => cleanupTempFile("/nonexistent/path/file.json")).not.toThrow();
    });
});
//# sourceMappingURL=containerAuth.test.js.map