# E2E Claude CLI Integration: Problem Analysis

The "full end-to-end with claude CLI" test in `src/__tests__/e2e.test.ts:801`
fails with "Execution failed. Phases completed: none". This document traces the
root causes and outlines what needs to change.

## The failure chain

1. Test calls `node dist/cli.js run tasks.json --headless --isolation none`
2. CLI passes pre-flight (`checkClaudeAvailable` runs `claude --version` -- OK)
3. `runPhases()` enters the phase loop, calls `executePhase()` for phase 1
4. `executePhase()` creates a real agent launcher (`dryRun: false`)
5. `launchOrchestrator()` spawns `claude --agent-file ... --add-dir ...`
6. Claude CLI rejects the unknown flag and exits immediately
7. `createProcessHandle` writes to stdin of a dead process
8. `send()` rejects with "Orchestrator process has exited"
9. `executePhase()` catches the error, returns `{ status: "failed" }`
10. Phase runner halts, CLI prints "Execution failed. Phases completed: none"

## Problem 1: `--agent-file` does not exist

`buildOrchestratorArgs()` at `src/orchestrator/agentLauncher.ts:96-109` produces:

```bash
claude --agent-file {path} --add-dir {skillsDir} --model {model}
```

The Claude CLI (v2.1.80) has no `--agent-file` flag. The correct flag is
`--agent`:

```text
--agent <agent>   Agent for the current session. Overrides the 'agent' setting.
```

Similarly, `buildSubAgentArgs()` at line 79-84 uses `--agent-file`:

```bash
claude --agent-file {path} --print --model {model}
```

Both need to be changed to `--agent`.

**Affected functions:**

- `buildOrchestratorArgs()` (line 96)
- `buildSubAgentArgs()` (line 79)

## Problem 2: interactive stdin/stdout protocol is wrong

`launchOrchestrator()` spawns `claude` without `--print`, expecting a raw
stdin/stdout text protocol:

```typescript
// agentLauncher.ts:253
const child = spawn("claude", args, {
  cwd: projectRoot,
  stdio: ["pipe", "pipe", "pipe"],
});
```

`createProcessHandle()` then:

- Writes `phaseContext + "\n"` to stdin immediately (line 300)
- On each `send()`, writes `input + "\n"` to stdin (line 333)
- Collects stdout chunks with a 5-second idle timeout to detect response end

This does not work. Without `--print`, the Claude CLI starts an interactive TUI
session that renders terminal escape sequences, not plain text. The stdin input
is not treated as a conversation turn -- the TUI has its own input handling.

### What the CLI actually supports

The Claude CLI has two programmatic modes:

**One-shot (`--print`):**

```bash
echo "prompt" | claude --print --model sonnet
```

Reads stdin as a single prompt, writes the response to stdout, exits. This is
what `dispatchSubAgent()` and `llmQuery()` already use via `execClaude()`, and
it works correctly.

**Streaming bidirectional (`--print --input-format stream-json --output-format stream-json`):**

```bash
claude --print --input-format stream-json --output-format stream-json
```

Accepts newline-delimited JSON messages on stdin, emits newline-delimited JSON
events on stdout. This is the correct way to maintain a multi-turn conversation
programmatically.

Input message format:

```json
{"type": "user_message", "content": "your prompt here"}
```

Output events include `assistant_message`, `tool_use`, `result`, etc., all as
JSON objects, one per line.

### What needs to change

`launchOrchestrator()` should use the streaming JSON protocol:

1. Spawn with `--print --input-format stream-json --output-format stream-json`
2. Send messages as `{"type": "user_message", "content": "..."}` JSON lines
3. Parse responses by reading newline-delimited JSON events from stdout
4. Detect turn completion via the `result` event type (not an idle timeout)

The idle-timeout approach in `createProcessHandle()` is unreliable regardless --
a slow LLM response would be mistaken for completion. Structured JSON framing
solves this.

## Problem 3: `hasClaude()` gate is too permissive

`hasClaude()` at `src/__tests__/e2e.test.ts:269` checks `which claude`. This
passes for anyone with Claude Code installed, but the test requires more than
just the binary existing -- it requires the full interactive protocol to work.

### Option A: real API call in guard (rejected)

Calling `claude --print "test"` in `hasClaude()` would confirm auth and API
access, but adds 5-30s of latency before any test runs. Since
`describe.skipIf()` evaluates eagerly at module load time, this cost is paid
every time the e2e test file is loaded -- even if the test ends up skipping. If
auth is expired or the API is down, the timeout blocks for up to 30s before
skipping.

### Option B: env var gate (recommended)

Keep the cheap `which claude` / `claude --version` check, but also require an
explicit opt-in env var:

```typescript
function hasClaude(): boolean {
  if (!process.env["TRELLIS_E2E_CLAUDE"]) return false;
  try {
    execSync("claude --version", { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
```

Usage:

```bash
npm run test:e2e                              # Group 1 only (fast, no API)
TRELLIS_E2E_CLAUDE=1 npm run test:e2e         # Group 1 + Group 2 (real CLI)
```

This is a standard pattern for tests that depend on external services. It keeps
the default fast path instant and makes the expensive path opt-in.

## Problem 4: `executePhase` hardcodes `dryRun: false`

At `src/runner/phaseRunner.ts:369-373`:

```typescript
const launcher = createAgentLauncher({
  pluginRoot: config.pluginRoot,
  projectRoot,
  dryRun: false, // <-- always false, ignores config
});
```

This should read `dryRun: config.dryRun` (or `resolved.dryRun`). Currently,
even if `--dry-run` were passed, the early return at line 502 intercepts it
before `executePhase` is reached, so this bug has no observable effect today. But
it's still wrong and will cause problems if the dry-run logic is ever refactored.

## Summary of required changes

| # | File | Change |
|---|------|--------|
| 1 | `agentLauncher.ts` | Replace `--agent-file` with `--agent` in both `buildSubAgentArgs` and `buildOrchestratorArgs` |
| 2 | `agentLauncher.ts` | Rewrite `launchOrchestrator` to use `--print --input-format stream-json --output-format stream-json` |
| 3 | `agentLauncher.ts` | Rewrite `createProcessHandle` to use JSON-line framing instead of idle timeout |
| 4 | `e2e.test.ts` | Gate real-CLI tests behind `TRELLIS_E2E_CLAUDE` env var + `claude --version` check |
| 5 | `phaseRunner.ts` | Pass `config.dryRun` through to `createAgentLauncher` |
| 6 | `agent-launcher.md` | Update docs to reflect the stream-json protocol |

## Relevant file locations

- `src/orchestrator/agentLauncher.ts` -- all process spawning and handle logic
- `src/runner/phaseRunner.ts:359-457` -- `executePhase`, creates launcher
- `src/runner/phaseRunner.ts:292-353` -- `replTurnLoop`, consumes orchestrator handle
- `src/__tests__/e2e.test.ts:269-276` -- `hasClaude()` guard
- `src/__tests__/e2e.test.ts:801-891` -- the failing test
- `src/cli.ts:186-193` -- `checkClaudeAvailable()` (same issue as `hasClaude`)
- `docs/agent-launcher.md:159-178` -- documents the assumptions that need updating

## Claude CLI reference

```bash
claude --print                         # one-shot mode (stdout = response text)
claude --print --output-format json    # one-shot, structured JSON result
claude --print --input-format stream-json --output-format stream-json
                                       # bidirectional streaming JSON protocol
claude --agent <agent>                 # set agent (NOT --agent-file)
claude --add-dir <dirs>                # additional tool access directories
claude --model <model>                 # model selection
claude --permission-mode <mode>        # permission handling
```
