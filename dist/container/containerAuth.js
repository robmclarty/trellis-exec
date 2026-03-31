import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
// ---
// Constants
// ---
export const AUTH_VOLUME_NAME = "trellis-exec-auth";
// Stale files to remove from the auth volume before each run.
// These are bind-mounted fresh from the host; leftover copies in the volume
// can cause plugin resolution failures or stale config.
const STALE_PATHS = [
    "plugins",
    "settings.json",
    "projects",
    "shell-snapshots",
    "backups",
    "mcp-needs-auth-cache.json",
];
// ---
// Volume lifecycle
// ---
/** Create the named auth volume if it does not already exist. */
export function ensureAuthVolume(volumeName) {
    try {
        execSync(`docker volume inspect ${volumeName}`, { stdio: "pipe" });
    }
    catch {
        execSync(`docker volume create ${volumeName}`, { stdio: "pipe" });
    }
}
/**
 * Remove stale config from the auth volume that would compete with host
 * bind mounts. Preserves OAuth tokens and credential files.
 * Runs as root to fix ownership regardless of who created the files.
 */
export function cleanAuthVolume(volumeName, image) {
    const rmCommands = STALE_PATHS
        .map((p) => `rm -rf /home/claude/.claude/${p}`)
        .join(" && ");
    const script = `${rmCommands} && chown claude:claude /home/claude/.claude`;
    try {
        execSync(`docker run --rm --user root -v ${volumeName}:/home/claude/.claude --entrypoint sh ${image} -c '${script}'`, { stdio: "pipe" });
    }
    catch {
        // Best-effort cleanup — volume may be empty on first run
    }
}
// ---
// Token extraction
// ---
/**
 * Extract the Docker-persisted `.claude.json` from the auth volume to a
 * temporary file on the host. Returns the temp file path, or `undefined`
 * if no credentials were found in the volume.
 *
 * The `--login` command stores credentials as `_claude.json` inside the
 * volume because `~/.claude.json` lives at the HOME level (outside the
 * `~/.claude/` directory that the volume backs).
 */
export function extractAuthToken(volumeName, image) {
    const tmpDir = mkdtempSync(join(tmpdir(), "trellis-auth-"));
    const tmpFile = join(tmpDir, ".claude.json");
    try {
        const result = execSync(`docker run --rm -v ${volumeName}:/home/claude/.claude --entrypoint sh ${image} -c 'cat /home/claude/.claude/_claude.json 2>/dev/null'`, { stdio: ["pipe", "pipe", "pipe"] });
        const content = result.toString("utf-8").trim();
        if (content.length === 0)
            return undefined;
        writeFileSync(tmpFile, content, "utf-8");
        return tmpFile;
    }
    catch {
        return undefined;
    }
}
// ---
// Settings generation
// ---
/**
 * Generate a container-safe `settings.json` from the host's copy.
 * Strips `extraKnownMarketplaces` and disables `autoUpdates` to prevent
 * Claude Code from trying to update plugins against read-only bind mounts.
 * Returns the temp file path, or `undefined` if the host file is missing.
 */
export function generateContainerSettings(hostSettingsPath) {
    if (!existsSync(hostSettingsPath))
        return undefined;
    try {
        const raw = readFileSync(hostSettingsPath, "utf-8");
        const settings = JSON.parse(raw);
        delete settings["extraKnownMarketplaces"];
        settings["autoUpdates"] = false;
        const tmpDir = mkdtempSync(join(tmpdir(), "trellis-settings-"));
        const tmpFile = join(tmpDir, "settings.json");
        writeFileSync(tmpFile, JSON.stringify(settings, null, 2) + "\n", "utf-8");
        return tmpFile;
    }
    catch {
        return undefined;
    }
}
/**
 * Build the `-v` mount arguments for auth-related volumes and bind mounts.
 * Pure function — all paths are pre-resolved by the caller.
 *
 * Mounts:
 * 1. Named volume → `/home/claude/.claude` (OAuth state)
 * 2. `.claude.json` → `/home/claude/.claude.json` (account/token data)
 * 3. Host plugins → `/home/claude/.claude/plugins` + original host path (dual mount)
 * 4. Container settings → `/home/claude/.claude/settings.json`
 */
export function buildAuthMounts(opts) {
    const args = [];
    // Auth volume
    args.push("-v", `${opts.authVolumeName}:/home/claude/.claude`);
    // OAuth token file
    if (opts.dockerClaudeJsonPath !== undefined) {
        args.push("-v", `${opts.dockerClaudeJsonPath}:/home/claude/.claude.json:ro`);
    }
    // Host plugins (dual mount for absolute-path resolution)
    if (opts.hostClaudeDir !== undefined) {
        const pluginsDir = join(opts.hostClaudeDir, "plugins");
        if (existsSync(pluginsDir)) {
            args.push("-v", `${pluginsDir}:/home/claude/.claude/plugins:ro`);
            args.push("-v", `${pluginsDir}:${pluginsDir}:ro`);
        }
    }
    // Container-safe settings
    if (opts.containerSettingsPath !== undefined) {
        args.push("-v", `${opts.containerSettingsPath}:/home/claude/.claude/settings.json:ro`);
    }
    return args;
}
// ---
// Interactive login
// ---
/**
 * Run `claude login` interactively inside a Docker container.
 * The OAuth token is persisted to the named volume as `_claude.json`
 * so it survives container exit.
 *
 * Returns true if credentials were successfully persisted.
 */
export function runContainerLogin(image, volumeName) {
    // Run interactive login, then copy token into the volume
    const login = spawnSync("docker", [
        "run", "--rm", "-it",
        "-v", `${volumeName}:/home/claude/.claude`,
        "--network", "bridge",
        "--entrypoint", "sh",
        image,
        "-c", "claude login && cp ~/.claude.json ~/.claude/_claude.json",
    ], { stdio: "inherit" });
    if (login.status !== 0)
        return false;
    // Verify credentials were persisted
    try {
        execSync(`docker run --rm -v ${volumeName}:/home/claude/.claude --entrypoint sh ${image} -c 'test -s /home/claude/.claude/_claude.json'`, { stdio: "pipe" });
        return true;
    }
    catch {
        return false;
    }
}
// ---
// Temp file cleanup
// ---
/** Remove a temp file and its parent directory (created by mkdtempSync). */
export function cleanupTempFile(filePath) {
    if (filePath === undefined)
        return;
    try {
        rmSync(dirname(filePath), { recursive: true, force: true });
    }
    catch {
        // Best-effort cleanup
    }
}
//# sourceMappingURL=containerAuth.js.map