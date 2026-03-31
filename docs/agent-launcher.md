# Agent Launcher

`src/orchestrator/agentLauncher.ts`

Manages `claude` CLI subprocesses for two purposes: dispatching sub-agents to execute discrete tasks, and running phase orchestrator sessions. This is the bridge between the phase runner (which manages the execution lifecycle) and the actual `claude` processes that do the work.

## Why a separate module

The phase runner (`phaseRunner.ts`) manages the execution lifecycle — phase sequencing, retry logic, judge evaluation, state management. But it doesn't know how to spawn `claude` processes. This module handles subprocess lifecycle and CLI argument assembly, keeping process management separate from orchestration logic.

This also makes testing straightforward — the launcher supports a dryRun mode so tests never spawn real `claude` processes.

## Operating modes

The launcher runs in one of two modes, selected by config:

| Mode | When | Behavior |
|------|------|----------|
| **real** | Production | Spawns actual `claude` CLI processes |
| **dryRun** | `--dry-run` flag | Logs commands to console, returns placeholder results |

## Factory function

### `createAgentLauncher(config: AgentLauncherConfig): AgentLauncher`

```typescript
const launcher = createAgentLauncher({
  pluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? resolve(__dirname, "../.."),
  projectRoot: "/path/to/user/project",
  dryRun: false,
  unsafeMode: false,       // --unsafe flag
  containerMode: false,    // --container flag (inner process)
  maxPhaseBudgetUsd: 5.0,  // per-phase budget cap (optional)
});
```

Returns an object with two methods: `dispatchSubAgent` and `runPhaseOrchestrator`.

### Permission handling

The launcher delegates permission flag assembly to `buildPermissionArgs()` from `src/safety/permissionArgs.ts`. The permission strategy depends on the execution mode and agent role:

| Mode | Worker agents | Read-only agents (judge, reporter) |
|------|---------------|-----------------------------------|
| **Safe (default)** | `--permission-mode dontAsk` + granular allow/deny | `--permission-mode dontAsk` + read-only tools only |
| **Container** | `--dangerously-skip-permissions --bare` | Read-only tools only |
| **Unsafe** | `--dangerously-skip-permissions` | Read-only tools only |

Role detection is automatic: agents with type `"judge"` or `"reporter"` are treated as read-only. All other agent types are workers.

## Methods

### `dispatchSubAgent(config: SubAgentConfig): Promise<SubAgentResult>`

Dispatches a sub-agent to execute a discrete task (implement a module, write tests, run a judge review).

1. Resolves the agent file: `{pluginRoot}/agents/{config.type}.md`
2. Assembles the prompt following the sub-agent input contract.
3. Builds permission args via `buildPermissionArgs()` based on execution mode and agent role.
4. Spawns: `claude --agent {agentFile} --print {permissionArgs} --model {model}`
5. Pipes the prompt to stdin, collects stdout as the result.
6. Returns `SubAgentResult` with `success`, `output`, `filesModified`, and optional `error`.

```typescript
const result = await launcher.dispatchSubAgent({
  type: "implement",
  taskId: "phase-1-task-3",
  instructions: "Implement the user authentication module",
  filePaths: ["src/types/user.ts", "src/db/schema.ts"],
  outputPaths: ["src/auth/authenticate.ts"],
  model: "sonnet",  // optional, defaults to "opus"
});
```

The default model is Opus. The orchestrator can override per-task based on complexity.

### `runPhaseOrchestrator(prompt, agentFile, model?, options?): Promise<ExecClaudeResult>`

Launches a single fire-and-forget `claude` session for phase orchestration. The orchestrator receives the full phase context via stdin and uses native Claude tools (Read, Write, Edit, Bash, Glob, Grep) to complete all tasks.

1. Builds permission args via `buildPermissionArgs()` (always `readOnly: false` — orchestrator is a worker).
2. Spawns: `claude --agent {agentFile} --print {permissionArgs} [--model {model}]`
3. Optionally adds `--output-format stream-json --verbose` for verbose mode.
4. Pipes the phase context prompt to stdin.
5. Returns `ExecClaudeResult` with `stdout`, `stderr`, and `exitCode`.

```typescript
const result = await launcher.runPhaseOrchestrator(
  phaseContext,
  resolve(pluginRoot, "agents/phase-orchestrator.md"),
  "opus",
  { verbose: true, onStdout: (chunk) => process.stdout.write(chunk) },
);
```

This is a one-shot call — the orchestrator runs to completion and writes a `.trellis-phase-report.json` file to disk. The phase runner reads this file after the subprocess exits.

## Prompt assembly

`buildSubAgentPrompt(config)` assembles the sub-agent prompt:

```text
You are a {type} sub-agent. Your task:

{instructions}

You may ONLY create or modify these files:
{outputPaths}

Context files to reference:
{filePaths}

Use the Write tool to create new files and the Edit tool to modify existing files. Do not just output code as text.
```

File paths are listed by reference rather than inlining file contents. The `claude` agent can read files from the filesystem directly, which keeps prompts small. Sections with empty arrays (no outputPaths, no filePaths) are omitted entirely.

## Process management

All subprocess spawning goes through a shared `execClaude` helper that uses `child_process.spawn` with piped stdio:

| Concern | Approach |
|---------|----------|
| Timeout | Sub-agents: 5 minutes; orchestrator: 30 minutes (configurable via `--timeout`, or 2 hours with `--long-run`). SIGTERM on expiry. |
| stdout/stderr | Collected as buffers, decoded to UTF-8 on completion |
| Exit codes | Non-zero exit → `SubAgentResult.success = false` with error |
| Streaming | Optional `onStdout`/`onStderr` callbacks for real-time output |

## Path resolution

```typescript
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
```

- **Plugin context**: `CLAUDE_PLUGIN_ROOT` is set automatically by Claude Code. Agent files resolve to `{pluginRoot}/agents/{type}.md`.
- **CLI context**: Falls back to `process.cwd()`.

## Types

| Type | Fields |
|------|--------|
| `AgentLauncherConfig` | `pluginRoot`, `projectRoot`, `dryRun?` |
| `AgentLauncher` | `{ dispatchSubAgent, runPhaseOrchestrator }` |
| `ExecClaudeResult` | `{ stdout, stderr, exitCode }` |
| `OrchestratorOptions` | `{ verbose?, onStdout?, onStderr? }` |
| `SubAgentConfig` | `type`, `taskId`, `instructions`, `filePaths`, `outputPaths`, `model?` (from `types/agents.ts`) |
| `SubAgentResult` | `success`, `output`, `filesModified`, `error?` (from `types/agents.ts`) |

## Defaults

| Setting | Value |
|---------|-------|
| Sub-agent model | Opus |
| Sub-agent timeout | 300,000ms (5 minutes) |
| Orchestrator timeout | 1,800,000ms (30 minutes) |
| Long-run timeout | 7,200,000ms (2 hours, via `--long-run`) |
| Compile timeout | 600,000ms (10 minutes) |
