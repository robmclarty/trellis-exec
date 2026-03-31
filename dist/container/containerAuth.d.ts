export declare const AUTH_VOLUME_NAME = "trellis-exec-auth";
/** Create the named auth volume if it does not already exist. */
export declare function ensureAuthVolume(volumeName: string): void;
/**
 * Remove stale config from the auth volume that would compete with host
 * bind mounts. Preserves OAuth tokens and credential files.
 * Runs as root to fix ownership regardless of who created the files.
 */
export declare function cleanAuthVolume(volumeName: string, image: string): void;
/**
 * Extract the Docker-persisted `.claude.json` from the auth volume to a
 * temporary file on the host. Returns the temp file path, or `undefined`
 * if no credentials were found in the volume.
 *
 * The `--login` command stores credentials as `_claude.json` inside the
 * volume because `~/.claude.json` lives at the HOME level (outside the
 * `~/.claude/` directory that the volume backs).
 */
export declare function extractAuthToken(volumeName: string, image: string): string | undefined;
/**
 * Generate a container-safe `settings.json` from the host's copy.
 * Strips `extraKnownMarketplaces` and disables `autoUpdates` to prevent
 * Claude Code from trying to update plugins against read-only bind mounts.
 * Returns the temp file path, or `undefined` if the host file is missing.
 */
export declare function generateContainerSettings(hostSettingsPath: string): string | undefined;
export type AuthMountOptions = {
    authVolumeName: string;
    dockerClaudeJsonPath?: string | undefined;
    hostClaudeDir?: string | undefined;
    containerSettingsPath?: string | undefined;
};
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
export declare function buildAuthMounts(opts: AuthMountOptions): string[];
/**
 * Run `claude login` interactively inside a Docker container.
 * The OAuth token is persisted to the named volume as `_claude.json`
 * so it survives container exit.
 *
 * Returns true if credentials were successfully persisted.
 */
export declare function runContainerLogin(image: string, volumeName: string): boolean;
/** Remove a temp file and its parent directory (created by mkdtempSync). */
export declare function cleanupTempFile(filePath: string | undefined): void;
//# sourceMappingURL=containerAuth.d.ts.map