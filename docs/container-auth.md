# Container Authentication

How trellis-exec authenticates the Claude CLI inside Docker containers.

## Why container auth is needed

When running in container mode (`--container`), trellis-exec spawns `claude` CLI subprocesses inside a Docker container. The Claude CLI needs valid credentials to call the Anthropic API.

On the host machine, Claude Code stores subscription/OAuth credentials in the system keychain (macOS Keychain, Linux secret service). These credentials are **not accessible from inside a Docker container** because:

1. The container runs Linux regardless of the host OS
2. The container has no access to the host's keychain or secret service
3. The host's `~/.claude.json` token file may reference keychain-backed secrets that can't be read outside the host

Without auth support, every `claude` invocation inside the container fails immediately with exit code 1.

## Auth methods

trellis-exec supports two authentication methods for container mode:

### API key (`ANTHROPIC_API_KEY`)

If the `ANTHROPIC_API_KEY` environment variable is set on the host, it is automatically forwarded into the container via Docker's `-e` flag. No additional setup is needed.

- **Pros**: Zero setup, works immediately
- **Cons**: Requires an API account (pay-per-token), not available to subscription users

### Subscription/OAuth (Docker volume)

For users with a Claude subscription (Pro, Max, Team), credentials are obtained by running `claude login` inside a Docker container and persisting the OAuth token in a named Docker volume.

- **Pros**: Uses existing subscription, no API key needed
- **Cons**: Requires one-time `trellis-exec login` setup

## Setup: one-time login

Run the login command once to authenticate inside Docker:

```bash
trellis-exec login
```

This will:

1. Build the Docker image if it doesn't exist
2. Create a named Docker volume (`trellis-exec-auth`) for credential storage
3. Open an interactive `claude login` session inside the container
4. Persist the OAuth token to the volume

After login completes, run container mode as normal:

```bash
trellis-exec run tasks.json --container
```

The credentials persist across container runs until the token expires or the volume is deleted.

## How it works

### Architecture

```text
Host                                    Container
────                                    ─────────
~/.claude/                              /home/claude/.claude/  (named volume)
  plugins/  ──── bind mount (ro) ────►    plugins/
  settings.json ─ bind mount (ro) ───►    settings.json
                                          _claude.json  (OAuth token, persisted)

~/.claude.json ◄── extracted from ────   _claude.json
  (temp file)      volume, mounted       (copied during login)
                   as .claude.json ───►  /home/claude/.claude.json
```

### Token lifecycle

1. **Login**: `trellis-exec login` runs `claude login` inside Docker. Claude Code writes the OAuth token to `~/.claude.json` inside the container. The login script copies this to `~/.claude/_claude.json` (inside the named volume) so it survives container exit.

2. **Before each run**: trellis-exec extracts `_claude.json` from the volume to a host temp file, then bind-mounts it into the container as `/home/claude/.claude.json`. This gives the `claude` CLI access to the stored credentials.

3. **Cleanup**: After the run completes, the temp files are removed from the host. The volume retains the original token.

### Stale config cleanup

Before each run, trellis-exec removes stale files from the auth volume that would compete with host bind mounts:

- `plugins/` — replaced by fresh host plugin bind mount
- `settings.json` — replaced by generated container-safe settings
- `projects/` — stale project metadata
- `shell-snapshots/`, `backups/`, `mcp-needs-auth-cache.json`

OAuth tokens and credential files are preserved.

### Plugin resolution

Claude Code's `installed_plugins.json` contains absolute host paths (e.g., `/Users/alice/.claude/plugins/cache/...`). To ensure resolution works inside the container, the host plugins directory is mounted at **two** locations:

1. `/home/claude/.claude/plugins` — the container's expected path
2. The original host-absolute path — for plugins that resolve by absolute path

### Container settings

The host's `~/.claude/settings.json` is modified before mounting:

- `extraKnownMarketplaces` is removed
- `autoUpdates` is set to `false`

This prevents Claude Code inside the container from attempting plugin updates against the read-only bind mount.

### Docker user

The container runs as a non-root `claude` user (UID assigned by `useradd`). The auth volume is owned by this user. The `cleanAuthVolume` function runs as `--user root` to fix permissions before each run.

## Implementation

Key files:

| File | Purpose |
|------|---------|
| `src/container/containerAuth.ts` | Auth volume operations, mount builder, login flow |
| `src/container/containerLauncher.ts` | Docker command construction (accepts `authMounts`) |
| `src/cli.ts` | `login` subcommand, auth prep in `handleRun` |
| `docker/Dockerfile` | Container image with `claude` user |

### `containerAuth.ts` functions

| Function | Description |
|----------|-------------|
| `ensureAuthVolume` | Create named volume if missing |
| `cleanAuthVolume` | Remove stale config, fix permissions |
| `extractAuthToken` | Copy OAuth token from volume to temp file |
| `generateContainerSettings` | Create container-safe settings.json |
| `buildAuthMounts` | Build `-v` args for all auth-related mounts |
| `runContainerLogin` | Interactive `claude login` inside Docker |
| `cleanupTempFile` | Remove temp files after run |

## Troubleshooting

### Token expired

Re-run login:

```bash
trellis-exec login
```

### Permission errors

If the auth volume has wrong ownership:

```bash
docker run --rm --user root \
  -v trellis-exec-auth:/data \
  --entrypoint sh trellis-exec:slim \
  -c 'chown -R claude:claude /data'
```

Then re-run `trellis-exec login`.

### Verify auth is working

Check if the volume has credentials:

```bash
docker run --rm \
  -v trellis-exec-auth:/home/claude/.claude \
  --entrypoint sh trellis-exec:slim \
  -c 'test -s /home/claude/.claude/_claude.json && echo "OK" || echo "No credentials"'
```

### Reset auth

Delete the volume and start fresh:

```bash
docker volume rm trellis-exec-auth
trellis-exec login
```
