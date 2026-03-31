# Container Mode

Container mode runs the entire trellis-exec pipeline inside a Docker container, providing OS-level isolation as the security boundary instead of CLI permission flags.

## Overview

When you pass `--container`, the host trellis-exec process does not run the phase loop itself. Instead, it:

1. Resolves all paths and validates tasks.json
2. Checks Docker availability (`docker info`)
3. Launches `docker run` with the project mounted at `/workspace`
4. The inner trellis-exec process runs with `--container-inner`, enabling `containerMode`
5. Propagates the container's exit code back to the host

This is useful for untrusted codebases, CI/CD pipelines, and overnight runs where even safe mode's allow-list may be too broad. The container is the boundary -- agents inside have full tool access.

## How It Works

```text
Host: trellis-exec run tasks.json --container
  |
  +-- buildRunContext() -> resolves all paths
  +-- detects --container -> short-circuits to container dispatch
  +-- launchInContainer(config) -> spawn("docker", ["run", ...])
  |     |
  |     +-- docker run --rm --network none ...
  |           +-- trellis-exec run /tasks/tasks.json --container-inner --headless
  |                 |
  |                 +-- containerMode: true, unsafeMode: true
  |                 +-- workers: --dangerously-skip-permissions --bare
  |                 +-- judge/reporter: read-only (always)
  |                 +-- normal phase execution inside container
  |
  +-- propagates exit code
```

Two trellis-exec processes are involved: the **outer** (host) process that launches Docker, and the **inner** (container) process that runs the actual phase loop.

## Permission Model

Worker agents inside the container receive `--dangerously-skip-permissions --bare` (full tool access, minimal startup). The container itself is the security boundary: network isolation, CPU/memory limits, and bind-mounted workspace.

The `--bare` flag skips hooks, LSP, plugin sync, and CLAUDE.md auto-discovery for faster startup inside the container.

Role-constrained agents (judge, reporter) remain **read-only in all modes**. This is role enforcement, not safety -- the judge should never write files because it breaks the pipeline's separation of responsibilities.

Contrast with safe mode's granular allow/deny: in container mode, there's no need for fine-grained tool restrictions because the OS enforces the boundary.

## Mount Strategy

| Host Path | Container Path | Mode | Purpose |
|-----------|---------------|------|---------|
| `projectRoot` | `/workspace` | rw | Source code modifications |
| `tasksJsonDir` | `/tasks` | rw | tasks.json + state.json + trajectory.jsonl |
| `specPath` | `/refs/spec.md` | ro | Spec file |
| `planPath` | `/refs/plan.md` | ro | Plan file |
| `guidelinesPath` | `/refs/guidelines.md` | ro | Guidelines (if exists) |

The tasks directory must be rw because `state.json` and `trajectory.jsonl` are written alongside `tasks.json` during execution.

Spec, plan, and guidelines are always mounted at stable `/refs/` paths regardless of where they live on the host. This avoids path-overlap complexity when host paths share a common ancestor directory.

Git checkpoints work identically inside the container since the same `.git` directory is part of the `/workspace` mount.

## Network Isolation

By default, `--network none` blocks all outbound traffic from the container. This prevents agents from making unauthorized network requests, downloading packages, or leaking data.

For projects that need network access (e.g., fetching dependencies during build, running tests against external APIs):

```bash
trellis-exec run tasks.json --container --container-network host
```

## Resource Limits

| Flag | Default | Description |
|------|---------|-------------|
| `--container-cpus <n>` | `4` | CPU core limit |
| `--container-memory <size>` | `8g` | Memory limit |
| `--pids-limit` | `512` | Process limit (hardcoded) |

For large projects with many sub-agents or resource-intensive builds:

```bash
trellis-exec run tasks.json --container --container-cpus 8 --container-memory 16g
```

## Docker Image Variants

Two image targets are provided:

| Target | Size | Includes | Use When |
|--------|------|----------|----------|
| `slim` | ~200MB | Node.js, git, Claude CLI, trellis-exec | Most projects (default) |
| `browser` | ~1.5GB | Everything in slim + Playwright + Chromium | Projects with browser testing |

Use `--container-image` to specify a custom image:

```bash
trellis-exec run tasks.json --container --container-image my-org/trellis:custom
```

## Building the Image

From the trellis-exec project root:

```bash
# Slim variant (default)
docker build --target slim -t trellis-exec:slim -f docker/Dockerfile .

# Browser variant (includes Playwright)
docker build --target browser -t trellis-exec:browser -f docker/Dockerfile .
```

The build copies `dist/` and `agents/` into the image and runs `npm link` to make the `trellis-exec` CLI globally available inside the container.

## Usage Examples

```bash
# Basic container mode (default: slim image, no network, 4 CPUs, 8GB RAM)
trellis-exec run tasks.json --container

# With network access for dependency installation
trellis-exec run tasks.json --container --container-network host

# With increased resources for large projects
trellis-exec run tasks.json --container --container-cpus 8 --container-memory 16g

# With a custom image
trellis-exec run tasks.json --container --container-image my-org/trellis:latest

# With budget enforcement (works the same inside the container)
trellis-exec run tasks.json --container --max-phase-budget 5.00 --max-run-budget 25.00

# Combined with other flags (forwarded to the inner process)
trellis-exec run tasks.json --container --model opus --verbose --long-run
```

## Environment Variables

The following environment variables are forwarded from the host to the container:

- `ANTHROPIC_API_KEY` -- required for Claude API access inside the container
- All `TRELLIS_EXEC_*` variables -- configuration overrides

Other environment variables are not forwarded. To pass custom variables, set them as `TRELLIS_EXEC_*` prefixed vars on the host.

## Limitations

- **Headless only**: `--headless` is always forced inside the container (no TTY interaction)
- **State files**: `state.json` and `trajectory.jsonl` are written to the tasks directory mount, not the workspace
- **Git operations**: Work inside the container because `/workspace` includes the `.git` directory
- **Claude CLI required**: The container image must have `claude` CLI installed (the provided Dockerfile handles this)
- **No incremental builds**: Each `docker run` starts fresh; `--resume` works because state files persist on the host via the `/tasks` mount

## Troubleshooting

**Docker not found**: Ensure Docker is installed and `docker info` succeeds. The host process checks this before launching.

**Image not built**: Run the `docker build` command above before using `--container`. The default image name is `trellis-exec:slim`.

**Permission denied on bind mounts**: On Linux, ensure the Docker daemon has access to the mounted host directories. On macOS/Windows with Docker Desktop, the directories must be within shared paths.

**Slow first run**: The first `docker build` pulls base images (~200MB for slim, ~1.5GB for browser). Subsequent builds use Docker layer caching.

**ANTHROPIC_API_KEY not found**: The key must be set in the host environment. It is forwarded via `-e ANTHROPIC_API_KEY` to the container.
