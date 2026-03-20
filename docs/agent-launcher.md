# Agent Launcher

`src/orchestrator/agentLauncher.ts`

Manages `claude` CLI subprocesses for three purposes: dispatching sub-agents to execute discrete tasks, running quick LLM queries for analysis, and launching long-running orchestrator sessions. This is the bridge between the REPL helpers (which the orchestrator calls inside its sandbox) and the actual `claude` processes that do the work.

## Why a separate module

The REPL helpers (`replHelpers.ts`) define the API surface that the phase orchestrator sees — `dispatchSubAgent()`, `llmQuery()`, etc. But those helpers don't know how to spawn processes. They accept an `agentLauncher` callback and delegate to it. This module provides that callback plus additional capabilities (orchestrator launching) that the phase runner needs directly.

Separating process management from the REPL sandbox keeps each module focused: replHelpers handles sandboxing and file access, agentLauncher handles subprocess lifecycle and CLI argument assembly. This also makes testing straightforward — the launcher supports dryRun and mock modes so tests never spawn real `claude` processes.

## Operating modes

The launcher runs in one of three modes, selected by config:

| Mode | When | Behavior |
|------|------|----------|
| **real** | Production | Spawns actual `claude` CLI processes |
| **dryRun** | `--dry-run` flag | Logs commands to console, returns placeholder results |
| **mock** | Unit tests | Returns pre-configured responses from a `Map<string, SubAgentResult>` |

Mode precedence: dryRun is checked first, then mock, then real. This means `dryRun: true` always wins, even if `mockResponses` is also provided.

## Factory function

### `createAgentLauncher(config: AgentLauncherConfig): AgentLauncher`

```typescript
const launcher = createAgentLauncher({
  pluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? resolve(__dirname, "../.."),
  projectRoot: "/path/to/user/project",
  dryRun: false,
  mockResponses: undefined,
});
```

Returns an object with three methods: `dispatchSubAgent`, `llmQuery`, and `launchOrchestrator`.

## Methods

### `dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>`

Dispatches a sub-agent to execute a discrete task (implement a module, write tests, run a judge review).

1. Resolves the agent file: `{pluginRoot}/agents/{config.type}.md`
2. Assembles the prompt following the §5 sub-agent input contract.
3. Spawns: `claude --agent-file {agentFile} --print --model {model}`
4. Pipes the prompt to stdin, collects stdout as the result.
5. Returns `SubAgentResult` with `success`, `output`, `filesModified`, and optional `error`.

```typescript
const result = await launcher.dispatchSubAgent({
  type: "implementer",
  taskId: "phase-1-task-3",
  instructions: "Implement the user authentication module",
  filePaths: ["src/types/user.ts", "src/db/schema.ts"],
  outputPaths: ["src/auth/authenticate.ts"],
  model: "sonnet",  // optional, defaults to "sonnet"
});
```

The default model is Sonnet. The orchestrator can override per-task based on complexity — simpler tasks might use Haiku for cost savings.

### `llmQuery(prompt: string, options?): Promise<string>`

Runs a quick LLM query for interpretive work: analyzing check failures, summarizing spec sections, evaluating whether output meets acceptance criteria.

1. Spawns: `claude --print --model {model}`
2. Pipes the prompt to stdin, returns stdout as a plain string.

```typescript
const analysis = await launcher.llmQuery(
  "Does this implementation satisfy the requirement: ...",
  { model: "haiku" }  // optional, defaults to "haiku"
);
```

The default model is Haiku (cheapest/fastest). Use `llmQuery` for thinking, `dispatchSubAgent` for doing.

### `launchOrchestrator(config: OrchestratorLaunchConfig): Promise<OrchestratorHandle>`

Launches a long-running interactive `claude` session for phase orchestration.

1. Spawns: `claude --agent-file {agentFile} --add-dir {skillsDir} --model {model}`
2. Sends the initial `phaseContext` to stdin on launch.
3. Returns an `OrchestratorHandle` for ongoing stdin/stdout communication.

```typescript
const handle = await launcher.launchOrchestrator({
  agentFile: resolve(pluginRoot, "agents/phase-orchestrator.md"),
  skillsDir: resolve(pluginRoot, "skills"),
  phaseContext: "Phase 1 tasks: ...\nShared state: ...",
  model: "sonnet",
});

const response = await handle.send("REPL output from last eval...");
// response contains the orchestrator's next code to evaluate

handle.isAlive(); // true while process is running
handle.kill();    // sends SIGTERM
```

## Prompt assembly

`buildSubAgentPrompt(config)` assembles the prompt per the spec's §5 sub-agent input contract:

```text
You are a {type} sub-agent. Your task:

{instructions}

You may ONLY create or modify these files:
{outputPaths}

Context files to reference:
{filePaths}

Respond with the complete contents of each file you create or modify.
```

File paths are listed by reference rather than inlining file contents. The `claude` agent can read files from the filesystem directly, which keeps prompts small and avoids the launcher needing file system access. If the orchestrator wants to inline specific content, it can include it in the `instructions` field after reading via REPL helpers.

Sections with empty arrays (no outputPaths, no filePaths) are omitted entirely.

## Process management

All subprocess spawning goes through a shared `execClaude` helper that uses `child_process.spawn` with piped stdio. This gives streaming control for the orchestrator handle while also working for one-shot sub-agent and query calls.

| Concern | Approach |
|---------|----------|
| Timeout | 5 minutes default for sub-agents; SIGTERM on expiry |
| stdout/stderr | Collected as buffers, decoded to UTF-8 on completion |
| Exit codes | Non-zero exit → `SubAgentResult.success = false` with error |
| Orchestrator idle | 5-second idle timeout detects end of response (see assumptions below) |

## Path resolution

Following the spec's §14 path resolution:

```typescript
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? resolve(__dirname, "../..");
```

- **Plugin context**: `CLAUDE_PLUGIN_ROOT` is set automatically by Claude Code. Agent files resolve to `{pluginRoot}/agents/{type}.md`.
- **CLI context**: The fallback walks up from `dist/cli.js` to the repo root where `agents/` and `skills/` live.

## Types

| Type | Fields |
|------|--------|
| `AgentLauncherConfig` | `pluginRoot`, `projectRoot`, `dryRun?`, `mockResponses?` |
| `AgentLauncher` | `{ dispatchSubAgent, llmQuery, launchOrchestrator }` |
| `OrchestratorLaunchConfig` | `agentFile`, `skillsDir`, `phaseContext`, `model?` |
| `OrchestratorHandle` | `{ send, isAlive, kill }` |
| `SubAgentConfig` | `type`, `taskId`, `instructions`, `filePaths`, `outputPaths`, `model?` (from `types/agents.ts`) |
| `SubAgentResult` | `success`, `output`, `filesModified`, `error?` (from `types/agents.ts`) |

## Assumptions and future work

The `OrchestratorHandle` is the least-proven part of this module. Its current implementation makes assumptions about the `claude` CLI's interactive stdin/stdout protocol:

1. **Input framing**: newline-terminated text written to stdin.
2. **Response detection**: idle timeout (5 seconds of no stdout data) signals end of response.
3. **Initial context**: the `phaseContext` string is sent immediately on process launch.

These assumptions will be validated during integration testing (phase 14 of the implementation plan). The handle's `send()` method may need to switch to delimiter-based framing, structured JSON messages, or a different signaling mechanism depending on what the real `claude` CLI supports.

The `filesModified` field in `SubAgentResult` is returned as an empty array from real mode — populating it requires parsing the sub-agent's output to detect which files were actually written. This parsing logic belongs in the phase runner or orchestrator, not the launcher.

## Defaults

| Setting | Value |
|---------|-------|
| Sub-agent model | Sonnet |
| llmQuery model | Haiku |
| Sub-agent timeout | 300,000ms (5 minutes) |
| Orchestrator idle timeout | 5,000ms |
