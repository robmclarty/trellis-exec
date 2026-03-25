# CLI Integration Architecture Changes

This document explains what changed during the e2e Claude CLI integration work,
why each change was necessary, and how the resulting architecture differs from
the original design. It is intended as a decision document — read it to decide
whether this direction is right.

## Context

The original `agentLauncher.ts` was written speculatively, before the real
Claude CLI protocol was known. It assumed a persistent bidirectional stdin/stdout
text protocol. The e2e test ("full end-to-end with claude CLI") validated these
assumptions against the real CLI and found every one was wrong.

This document covers the changes made to get that test passing and the
architectural tradeoffs introduced.

---

## Architecture: Before vs After

### Before (original design)

```text
┌─────────────────────────────────────────────────────┐
│  Phase Runner                                       │
│                                                     │
│  ┌───────────────┐    ┌──────────────────────────┐  │
│  │  REPL Sandbox  │◄──│  Orchestrator (persistent │  │
│  │  eval(code)    │──►│  claude process)          │  │
│  └───────────────┘    │                           │  │
│                       │  stdin ──► raw text        │  │
│                       │  stdout ◄── raw text       │  │
│                       │  idle timeout = 5s         │  │
│                       └──────────────────────────┘  │
│                                                     │
│  Sub-agents: claude --agent-file {path} --print     │
│  (one-shot, stdin pipe, stdout collected)            │
└─────────────────────────────────────────────────────┘
```

**Key assumptions (all wrong):**

| Assumption | Reality |
|-----------|---------|
| `--agent-file` flag exists | Correct flag is `--agent` |
| `claude` without `--print` accepts raw text on stdin | Without `--print`, Claude starts an interactive TUI with escape sequences |
| 5-second idle timeout detects end of response | Slow LLM responses would be mistaken for completion |
| Persistent process supports multi-turn conversation | `--print` mode is strictly one-shot; process exits after one response |
| Sub-agents output file contents as text | Sub-agents with tools available use Write/Edit directly |

### After (current design)

```text
┌──────────────────────────────────────────────────────────────────┐
│  Phase Runner                                                    │
│                                                                  │
│  ┌───────────────┐     ┌────────────────────────────────────┐    │
│  │  REPL Sandbox  │◄────│  Orchestrator Handle               │    │
│  │  eval(code)    │────►│  (sequential one-shot calls)       │    │
│  └───────────────┘     │                                    │    │
│         ▲               │  Turn 1: claude --print --agent    │    │
│         │               │  Turn 2: claude --print --continue │    │
│    extractCode()        │  Turn 3: claude --print --continue │    │
│    (filters NL)         │  ...                               │    │
│                         └────────────────────────────────────┘    │
│                                                                  │
│  Sub-agents: claude --agent {path} --print                       │
│              --dangerously-skip-permissions                       │
│  (one-shot, has Write/Edit tools, creates files on disk)         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Change-by-change breakdown

### 1. `--agent-file` → `--agent`

**What:** Renamed the CLI flag in `buildSubAgentArgs` and `buildOrchestratorArgs`.

**Why:** The Claude CLI (v2.1.80) has no `--agent-file` flag. The correct flag is
`--agent <agent>`, which accepts either an agent name or a path to an agent
markdown file.

**Risk:** None. This is a straightforward bug fix.

### 2. Persistent process → sequential one-shot calls

**What:** Replaced `createProcessHandle()` (a long-running `spawn` with
stdin/stdout pipes) with `createSequentialHandle()` (spawns a fresh
`claude --print` process per turn, using `--continue` to maintain session state).

**Why:** Claude CLI's `--print` flag is strictly one-shot. It reads stdin, sends
one API request, writes the response to stdout, and exits. There is no
persistent bidirectional mode.

The CLI does support `--input-format stream-json --output-format stream-json`,
but this is for streaming a single prompt's content incrementally — not for
multi-turn conversations. When tested, the process accepted one message and
exited after responding; it did not accept further messages on the open stdin.

The `--continue` flag resumes the most recent session in the working directory,
preserving full conversation history. Each `send()` call now:

1. Spawns `claude --print --continue ...` with the input as stdin
2. Waits for the process to exit
3. Returns stdout as the response

**Tradeoff:** Each turn is a full process spawn + API call. There is no
connection reuse. Cold start overhead per turn is ~1-3 seconds.

**The `OrchestratorHandle` interface is unchanged** — `send()`, `isAlive()`,
`kill()` still work identically from the caller's perspective.

### 3. Permission bypass (`--dangerously-skip-permissions`)

**What:** Added `--dangerously-skip-permissions` to both orchestrator and
sub-agent args.

**Why:** Without this flag, Claude prompts the user for permission before using
tools like Write, Edit, or Bash. In headless automated execution, there is no
user to approve — the process hangs or the agent outputs text asking for
permission instead of acting.

**Security implications:** See the [Permissions and Security](#permissions-and-security)
section below.

### 4. Tool restrictions on the orchestrator

**What:** Added `--disallowedTools` to the orchestrator args, disabling:
Write, Edit, Bash, Read, Glob, Grep, NotebookEdit, Agent, WebFetch, WebSearch,
TodoWrite.

**Why:** The orchestrator's design is to interact with the project exclusively
through the REPL sandbox. If Claude has file tools available, it uses them
directly (creating files, reading files, running commands) instead of outputting
JavaScript code for the REPL to evaluate. This breaks the REPL protocol.

By disabling all file-manipulation tools, Claude is forced to output JavaScript
code that uses the REPL helpers (`readFile()`, `dispatchSubAgent()`,
`writePhaseReport()`, etc.).

**Architecture consequence:** The orchestrator has zero direct filesystem access.
All filesystem interaction goes through REPL helpers, which the phase runner
controls. This is actually a security improvement — the orchestrator cannot
escape the REPL sandbox.

### 5. System prompt reinforcement

**What:** Added `--append-system-prompt` with a message reinforcing the REPL
protocol rules.

**Why:** With `--continue`, the session history is preserved, but the system
prompt from the agent file may not have full force across turns. The appended
system prompt reminds Claude on every turn:

- Output ONLY JavaScript code
- No natural language, TypeScript syntax, or module systems
- Use REPL helpers by name
- Call `runCheck()` then `writePhaseReport()` after sub-agent success

Without this, Claude consistently reverted to natural language after receiving
sub-agent results, summarizing what happened instead of proceeding with
`runCheck()`.

### 6. Sub-agent prompt: "output text" → "use tools"

**What:** Changed `buildSubAgentPrompt` from "Respond with the complete
contents of each file" to "Use the Write tool to create new files and the Edit
tool to modify existing files."

Also changed `agents/implement.md` Output section similarly.

**Why:** The original prompt instructed sub-agents to output file contents as
text. But with `--dangerously-skip-permissions`, Claude has actual Write and
Edit tools available. The text-output instruction overrode Claude's natural
tool-using behavior, causing the sub-agent to output markdown code blocks
instead of creating files on disk.

With the updated prompt, sub-agents use Write/Edit to create real files, and
their text output is a confirmation message (which the orchestrator receives
via `dispatchSubAgent()` return value).

### 7. `extractCode()` — response parsing

**What:** New function in `phaseRunner.ts` that sits between the orchestrator's
raw response and the REPL eval.

**Why:** Even with tool restrictions and system prompt reinforcement, Claude
occasionally outputs natural language instead of JavaScript. This happens most
often at transition points (after a sub-agent succeeds, before calling
`runCheck()`). The function:

1. Extracts code from markdown fences if present
2. Detects natural language via heuristics (starts with capital letter +
   lowercase, no JS operators, no function calls)
3. Returns empty string for natural language, triggering a corrective nudge

**Heuristics used:**

```text
JS patterns:   const  let  var  await  function  //  /*  (
                identifier followed by ( or =
NL patterns:   Starts with [A-Z][a-z], contains spaces, no [=;{}[\]]
```

**Risk:** Heuristic-based — could misclassify unusual JS or unusual NL. The
cost of a false positive (JS classified as NL) is one wasted turn with a
corrective message. The cost of a false negative (NL classified as JS) is a
SyntaxError in the REPL, which triggers a retry.

### 8. Corrective nudge for natural language responses

**What:** When `extractCode()` returns empty, the turn loop sends back a
structured message telling Claude to output JavaScript, including example code.

**Why:** Without this, Claude would receive a SyntaxError and try to "fix" it
by adjusting the natural language slightly — or by outputting the file contents
as TypeScript (which also fails). The corrective message explicitly names the
REPL functions (`runCheck()`, `writePhaseReport()`) and provides calling
examples.

### 9. REPL context in `buildPhaseContext()`

**What:** Added a "REPL Protocol" section to the phase context message listing
all available helper functions.

**Why:** The agent file (`phase-orchestrator.md`) describes the helpers, but the
phase context — which is the actual prompt sent to Claude — did not list them.
Claude didn't know what functions were available in the REPL sandbox.

### 10. `dryRun` passthrough in `executePhase()`

**What:** Changed `dryRun: false` to `dryRun: config.dryRun`.

**Why:** The hardcoded `false` meant `--dry-run` would never propagate to the
agent launcher. This was a latent bug — the dry-run early return prevented it
from being observable, but it would break if the control flow changed.

### 11. `hasClaude()` env var gate

**What:** Changed the e2e test guard from `which claude` to
`process.env["TRELLIS_E2E_CLAUDE"] + claude --version`.

**Why:** `which claude` passes for anyone with the CLI installed, but the e2e
test makes real API calls that cost money and take minutes. The env var gate
makes this opt-in:

```bash
npm run test:e2e                              # Group 1 only (fast)
TRELLIS_E2E_CLAUDE=1 npm run test:e2e         # Group 1 + Group 2 (real API)
```

---

## Permissions and security

This is the part that needs the most scrutiny.

### Permission boundaries diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Phase Runner                             │
│                     (Node.js process)                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    REPL Sandbox                          │    │
│  │                                                         │    │
│  │  Helpers available:                                     │    │
│  │    readFile()         — reads files (read-only)         │    │
│  │    listDir()          — lists directories (read-only)   │    │
│  │    searchFiles()      — glob search (read-only)         │    │
│  │    readSpecSections() — reads spec (read-only)          │    │
│  │    getState()         — reads state.json (read-only)    │    │
│  │    llmQuery()         — LLM call (no file access)       │    │
│  │    dispatchSubAgent() — spawns sub-agent (see below)    │    │
│  │    runCheck()         — runs check command (read-only)  │    │
│  │    writePhaseReport() — writes report (signals done)    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌──────────────────────────┐  ┌────────────────────────────┐   │
│  │  Orchestrator Process    │  │  Sub-Agent Process          │   │
│  │                          │  │                            │   │
│  │  --dangerously-skip-     │  │  --dangerously-skip-       │   │
│  │    permissions           │  │    permissions             │   │
│  │  --disallowedTools       │  │                            │   │
│  │    Write,Edit,Bash,      │  │  Tools: Write, Edit, Read  │   │
│  │    Read,Glob,Grep,...    │  │  (full filesystem access)  │   │
│  │                          │  │                            │   │
│  │  CAN: output text only   │  │  CAN: read/write files    │   │
│  │  CANNOT: touch files     │  │  CANNOT: escape cwd       │   │
│  │  CANNOT: run commands    │  │  (but no hard boundary)    │   │
│  └──────────────────────────┘  └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### What `--dangerously-skip-permissions` means

This flag bypasses ALL permission checks in the Claude CLI. It is intended for
sandboxed environments with no internet access. In our case, the processes DO
have internet access and full filesystem access.

**Orchestrator:** Mitigated by `--disallowedTools`. Even with permissions
bypassed, the tool denylist prevents the orchestrator from using Write, Edit,
Bash, Read, Glob, Grep, etc. The orchestrator can only output text (which the
REPL evaluates) and use any tools NOT on the denylist (Skill, CronCreate, etc.
— though these are unlikely to be useful).

**Sub-agents:** NOT mitigated. Sub-agents have full Write, Edit, and Read
access with permissions bypassed. A sub-agent could:

- Write to any file the OS user can write to
- Read any file the OS user can read
- Potentially modify files outside the project directory

The `outputPaths` constraint in the prompt is a **soft boundary** — it's an
instruction to the LLM, not an enforced limit.

### Security assessment

| Component | Permission Level | Hard Boundary? | Risk |
|-----------|-----------------|----------------|------|
| Phase Runner | Full Node.js process | Yes (OS-level) | Baseline |
| REPL Sandbox | Controlled helpers only | Partial (eval can break out) | Medium |
| Orchestrator | Text output only (tools disabled) | Yes (CLI-enforced denylist) | Low |
| Sub-agents | Full file read/write | **No** (soft prompt constraint) | **High** |
| llmQuery | No file access | Yes (no tools) | Low |

### What would make this safer

1. **Worktree isolation:** Run sub-agents in a git worktree so file writes are
   contained. A stray write outside the project would be in a throwaway copy.
   (The `--isolation worktree` flag already exists in the CLI but isn't wired
   through to sub-agent spawning.)

2. **Container/sandbox:** Run sub-agent processes in a container or OS-level
   sandbox (Docker, nsjail, etc.) with only the project directory mounted.

3. **`--allowedTools` instead of `--dangerously-skip-permissions`:** Instead
   of bypassing all permissions and then denying specific tools, use
   `--allowedTools "Write Edit Read"` to only grant the tools needed. However,
   this still requires some form of permission bypass for headless operation.

4. **Path validation in sub-agent wrapper:** After the sub-agent completes,
   validate that only `outputPaths` files were modified (via git diff). Reject
   the result if unexpected files were touched.

---

## Data flow diagram

```text
User runs: trellis-exec run tasks.json --headless

  │
  ▼
┌──────────────┐
│  CLI (cli.ts) │
│  parseRunArgs │
│  runPhases()  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  runPhases() — main loop                                     │
│                                                              │
│  for each phase:                                             │
│    1. createAgentLauncher({ pluginRoot, projectRoot })       │
│    2. createReplSession()                                    │
│    3. buildPhaseContext() — tasks, state, handoff, helpers    │
│    4. launcher.launchOrchestrator(launchConfig)               │
│    5. replTurnLoop(orchestrator, repl, ...)                   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  replTurnLoop                                          │  │
│  │                                                        │  │
│  │  loop:                                                 │  │
│  │    response = orchestrator.send(previousOutput)         │  │
│  │         │                                              │  │
│  │         │  Spawns: claude --print [--continue]          │  │
│  │         │  stdin: previousOutput                        │  │
│  │         │  stdout: Claude's response (JS code + NL)    │  │
│  │         ▼                                              │  │
│  │    code = extractCode(response)                         │  │
│  │         │                                              │  │
│  │         ├── empty? → send corrective nudge, continue   │  │
│  │         │                                              │  │
│  │         ▼                                              │  │
│  │    result = repl.eval(code)                             │  │
│  │         │                                              │  │
│  │         │  Code may call REPL helpers:                  │  │
│  │         │    readFile() → reads from disk               │  │
│  │         │    dispatchSubAgent() → spawns sub-agent      │  │
│  │         │         │                                    │  │
│  │         │         │  claude --print --agent impl.md     │  │
│  │         │         │  --dangerously-skip-permissions     │  │
│  │         │         │  stdin: task prompt                  │  │
│  │         │         │  → uses Write tool → creates file   │  │
│  │         │         │  stdout: confirmation text           │  │
│  │         │         ▼                                    │  │
│  │         │    runCheck() → runs check command             │  │
│  │         │    writePhaseReport() → signals completion    │  │
│  │         │                                              │  │
│  │         ▼                                              │  │
│  │    previousOutput = result.output                       │  │
│  │    continue loop                                        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Key differences from original design

| Aspect | Original | Current |
|--------|----------|---------|
| Orchestrator lifecycle | Single persistent process | Fresh process per turn (`--continue`) |
| Communication protocol | Raw text on stdin/stdout | One-shot `--print` with session resume |
| Response detection | 5-second idle timeout | Process exit (one-shot) |
| Orchestrator tools | Not restricted | All file tools disabled via `--disallowedTools` |
| Sub-agent output | Text with file-path headers | Actually creates files using Write tool |
| Permissions | Not considered | `--dangerously-skip-permissions` everywhere |
| Natural language handling | Not considered | `extractCode()` + corrective nudge |
| System prompt | Agent file only | Agent file + `--append-system-prompt` |
| Phase context | Tasks + state + handoff | + REPL protocol docs + helper function list |

---

## Open questions

1. **Is `--dangerously-skip-permissions` acceptable?** It's the simplest path
   for headless operation but removes all Claude CLI permission guardrails. The
   orchestrator is protected by `--disallowedTools`, but sub-agents have
   unrestricted file access.

2. **Should `extractCode()` exist?** Its heuristic nature is fragile. An
   alternative is to use `--output-format json` for the orchestrator turns and
   extract code from the structured JSON response. However, this requires
   `--verbose` and adds parsing complexity.

3. **Is sequential `--print --continue` the right approach?** Each turn spawns
   a new process, which is slow (~1-3s overhead). If Claude CLI adds a true
   bidirectional protocol in the future, the `OrchestratorHandle` interface
   supports swapping the implementation without changing callers.

4. **Should the orchestrator have ANY tools?** Currently it has text output only
   (all tools denied). An alternative is to give it Read/Glob/Grep for faster
   file exploration, while still denying Write/Edit/Bash. This would reduce
   REPL round-trips for exploration-heavy phases.

5. **Should sub-agent file writes be validated?** After a sub-agent completes,
   we could `git diff` to check which files were actually modified and reject
   the result if files outside `outputPaths` were touched.
