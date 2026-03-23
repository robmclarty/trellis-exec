# Trellis Phase Runner: Task Execution Architecture

## Overview

The Trellis phase runner is a sophisticated orchestration system that:
1. Uses **git worktrees** (optional) to isolate work
2. Spawns a **phase orchestrator** Claude agent as a persistent REPL session
3. The orchestrator dispatches **sub-agents** for file creation/modification
4. Validates output with **check commands** (tests, lint, build)
5. Merges changes back to main repo on success

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase Runner (phaseRunner.ts)                                  │
│                                                                  │
│  Entry: runPhases() or runSinglePhase()                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Worktree Creation (Optional)                                    │
│                                                                  │
│  createWorktree({projectRoot, specName})                        │
│  ├─ Creates: <projectRoot>/.trellis-worktrees/<slug>/          │
│  ├─ Branch:  trellis-exec/<spec-name>/<timestamp>             │
│  └─ Uses:    git worktree add -b <branch> <path> HEAD         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Project Root Determination                                      │
│                                                                  │
│  deriveProjectRoot(baseRoot, worktreeResult, isolation)         │
│  ├─ If worktree: use worktreeResult.worktreePath               │
│  └─ If none:     use baseRoot (current directory)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Copy Spec & Guidelines                                          │
│                                                                  │
│  copySpecToProjectRoot(specPath, projectRoot)                  │
│  copyGuidelinesToProjectRoot(guidelinesPath, projectRoot)      │
│  ├─ Copies files into <projectRoot>/                          │
│  └─ Needed for REPL to read them via readFile()               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  For Each Phase                                                  │
│  executePhase(ctx, phase, state, projectRoot, logger)          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Phase Orchestrator │ ◄──── Claude Agent
                    │  (phase-orchestrator│      (via `claude --agent --print`)
                    │   .md)              │
                    └─────────────────────┘
                              │
                    ┌─────────────────────────────┐
                    │  REPL Session               │
                    │  (replManager.ts)           │
                    │                             │
                    │  Context: node:vm           │
                    │  Timeout: 30s               │
                    │  Output limit: 8192 chars   │
                    │  Helpers: injected          │
                    └─────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
    ┌───────────────┐ ┌──────────────┐ ┌────────────────┐
    │ readFile()    │ │ listDir()    │ │ searchFiles()  │
    │ (filesystem)  │ │ (filesystem) │ │ (filesystem)   │
    └───────────────┘ └──────────────┘ └────────────────┘

            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
    ┌────────────────┐ ┌──────────────┐ ┌────────────────┐
    │ dispatchSubAgent│ │ runCheck()   │ │ llmQuery()     │
    │                │ │              │ │                │
    │ Spawns Claude  │ │ Runs shell   │ │ LLM analysis   │
    │ sub-agent for  │ │ command in   │ │ (cheap)        │
    │ file work      │ │ projectRoot  │ │                │
    └────────────────┘ └──────────────┘ └────────────────┘
                │
                │
                ▼
    ┌────────────────────────────────────────┐
    │ Sub-Agent Dispatch (agentLauncher.ts) │
    │                                        │
    │ dispatchSubAgent(config)               │
    │  ├─ Spawns: claude --agent <type>.md  │
    │  ├─ Args:   --print                    │
    │  ├─         --dangerously-skip-perms  │
    │  └─ Input:  prompt (instructions)     │
    │                                        │
    │ Returns: {success, output, error}     │
    └────────────────────��───────────────────┘
                │
        ┌───────┴───────┬─────────┬───────────────┐
        │               │         │               │
        ▼               ▼         ▼               ▼
    ┌────────┐    ┌───────┐  ┌────────┐  ┌─────────┐
    │implement│   │ test  │  │scaffold│  │  judge  │
    │(Sonnet) │   │-writer│  │(Haiku) │  │(Sonnet) │
    │         │   │(Sonnet)  │        │  │ (RO)    │
    │ Creates/│   │        │  │Creates│  │         │
    │modifies │   │Creates│  │files  │  │Evaluates│
    │files    │   │tests  │  │       │  │for spec │
    └────────┘    └───────┘  └────────┘  └─────────┘
         │            │           │           │
         └────────────┴───────────┴───────────┘
                      │
                      ▼
    ┌────────────────────────────────────────┐
    │ Files Modified in projectRoot           │
    │                                        │
    │ <projectRoot>/src/foo.ts               │
    │ <projectRoot>/src/bar.test.ts          │
    │ etc.                                   │
    └────────────────────────────────────────┘
                      │
                      ▼
    ┌────────────────────────────────────────┐
    │ Check Runner (checkRunner.ts)          │
    │                                        │
    │ runCheck()                             │
    │  ├─ Spawns: shell <command>           │
    │  ├─ cwd:    projectRoot                │
    │  └─ Waits:  up to 120s                 │
    │                                        │
    │ Returns: {passed, output, exitCode}   │
    └────────────────────────────────────────┘
                      │
            ┌─────────┴─────────┐
            │                   │
            ▼                   ▼
        ┌────────┐         ┌────────┐
        │ PASS   │         │ FAILED │
        │        │         │        │
        │ Continue│        │ Retry  │
        │ to next│         │with new│
        │ task   │         │prompts │
        └────────┘         └────────┘
                                │
                        ┌───────┴────────┐
                        │                │
                    ┌─────────┐  ┌───────────┐
                    │Max 3x   │  │Write phase│
                    │retries? │  │report     │
                    └─────────┘  │(fail)     │
                                 └───────────┘
                      │
                      ▼
    ┌────────────────────────────────────────┐
    │ Phase Report Writing                    │
    │                                        │
    │ writePhaseReport({                     │
    │   status,                              │
    │   tasksCompleted,                      │
    │   tasksFailed,                         │
    │   judgeAssessment,                     │
    │   recommendedAction,                   │
    │   correctiveTasks,                     │
    │   handoff                              │
    │ })                                     │
    └────────────────────────────────────────┘
                      │
                      ▼
    ┌────────────────────────────────────────┐
    │ State & Trajectory Update              │
    │                                        │
    │ saveState(state.json)                  │
    │ logger.append(trajectoryLog)           │
    └────────────────────────────────────────┘
                      │
            ┌─────────┴──────────┐
            │                    │
        ┌─────────┐      ┌──────────┐
        │ ADVANCE │      │HALT/RETRY│
        │         │      │          │
        │ commit  │      │Save state│
        │ next    │      │(user/sys │
        │ phase   │      │ decision)│
        └─────────┘      └──────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │ Commit Phase to Worktree (if used)     │
    │                                        │
    │ commitPhase(worktreePath, phaseId)    │
    │  ├─ git add -A                        │
    │  ├─ git commit -m "trellis-exec:..."  │
    │  └─ Creates commit in worktree branch │
    └────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│ Final Merge (on success, all phases completed)                   │
│                                                                  │
│ mergeWorktree({projectRoot, worktreePath, branchName})         │
│  ├─ git merge <branchName> --no-edit                           │
│  └─ Merges into the original branch at projectRoot             │
│                                                                  │
│ cleanupWorktree(worktreePath)                                   │
│  └─ git worktree remove --force                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Files and Locations

### Core Execution
- **phaseRunner.ts** – Main orchestration loop, worktree setup, phase execution
- **scheduler.ts** – Task dependency resolution and execution ordering
- **stateManager.ts** – State persistence (state.json) and updates
- **agentLauncher.ts** – Spawns Claude CLI processes for agents and sub-agents
- **replManager.ts** – Node.js VM-based REPL session management
- **replHelpers.ts** – Helper functions injected into REPL (readFile, listDir, etc.)

### Agents (in /agents/)
- **phase-orchestrator.md** – Main orchestrator agent (persistent REPL session, Sonnet)
- **implement.md** – Sub-agent for file creation/modification (Sonnet)
- **test-writer.md** – Sub-agent for test generation (Sonnet)
- **scaffold.md** – Sub-agent for boilerplate/config (Haiku)
- **judge.md** – Sub-agent for evaluation (read-only, Sonnet)

### Worktree Management
- **worktreeManager.ts** – Create, commit, merge, cleanup worktrees

### Verification
- **checkRunner.ts** – Executes project check commands (build/lint/test)

### State & Types
- **types/state.ts** – PhaseReport, SharedState, CheckResult
- **types/tasks.ts** – Task, Phase, TasksJson structures
- **types/agents.ts** – SubAgentConfig, SubAgentResult

## How Claude Code is Invoked

### 1. Phase Orchestrator Launch
```typescript
// In executePhase()
orchestrator = await launcher.launchOrchestrator({
  agentFile: "<pluginRoot>/agents/phase-orchestrator.md",
  skillsDir: "<pluginRoot>/skills",
  phaseContext: buildPhaseContext(...),
  model: ctx.model || "sonnet",
})
```

**CLI executed:**
```bash
claude --agent agents/phase-orchestrator.md \
       --print \
       --dangerously-skip-permissions \
       --disallowedTools Write,Edit,Bash,Read,Glob,Grep,NotebookEdit,Agent,WebFetch,WebSearch,TodoWrite \
       --append-system-prompt "CRITICAL: You are in a REPL..." \
       --add-dir skills/ \
       --model sonnet \
       < <phase-context>
```

**Key points:**
- Uses `--agent` to specify the orchestrator prompts
- Uses `--print` for stdout output (no interactive paging)
- Uses `--dangerously-skip-permissions` to allow REPL execution
- Disables file modification tools (Write, Edit, Bash) to force sub-agent dispatch
- Appends REPL system prompt to enforce JavaScript-only output
- `--add-dir skills/` makes skill documentation available

### 2. Sub-Agent Dispatch
```typescript
// In REPL execution, orchestrator calls:
await dispatchSubAgent({
  type: "implement",
  taskId: "phase1-task3",
  instructions: "Create file X with spec Y",
  filePaths: ["src/existing.ts", "spec.md"],
  outputPaths: ["src/new.ts"],
  model: "sonnet",
})
```

**CLI executed (via execClaude):**
```bash
claude --agent agents/implement.md \
       --print \
       --dangerously-skip-permissions \
       --model sonnet \
       < <sub-agent-prompt>
```

**Sub-agent prompt structure:**
```
You are an implement sub-agent. Your task:

<instructions>

You may ONLY create or modify these files:
src/new.ts

Context files to reference:
src/existing.ts
spec.md

Use the Write tool to create new files and the Edit tool to modify existing files.
```

## Worktree Strategy

### When Used (ctx.isolation === "worktree")
1. **Creation**: `git worktree add -b trellis-exec/<spec>/<timestamp> <path> HEAD`
   - Creates isolated environment at `.trellis-worktrees/<slug>/`
   - Branch name encodes spec name and timestamp for debugging

2. **Execution**: All file modifications happen in worktree, not main repo
   - Orchestrator runs in worktree directory
   - Sub-agents read/write to worktree

3. **Per-Phase Commits**: After each successful phase
   - `git add -A` in worktree
   - `git commit -m "trellis-exec: complete <phaseId>"`
   - Creates git history of phase progress

4. **Final Merge** (on success):
   - `git merge <branch> --no-edit` from project root
   - Merges all phase commits back to original branch
   - Preserves audit trail in commit history

5. **Cleanup**:
   - `git worktree remove --force`
   - Deletes worktree directory and branch

### When Not Used (ctx.isolation === "none")
- Work directly in `ctx.projectRoot`
- No branch isolation, no audit trail commits
- Changes land directly in the working directory

## Artifacts & File Flow

### Input Artifacts
```
spec.md             → Copied to projectRoot/ at start
guidelines.md       → Copied to projectRoot/ at start (if provided)
plan.json           → Referenced by orchestrator via readFile()
state.json          → Loaded at start, updated after each phase
tasks.json          → Defines phases and tasks
```

### Output Artifacts
```
state.json          → Updated after each phase (atomic write)
trajectory.jsonl    → Event log of all REPL turns and dispatches
<worktree>/.git     → Git history of phase commits (if using worktree)
<projectRoot>/**/*  → All modified source files
```

### Data Persistence
- **State**: `/path/to/state.json` (updated after each successful phase)
- **Trajectory**: `/path/to/trajectory.jsonl` (append-only log)
- **Spec & Guidelines**: Copied into project root temporarily, cleaned up at end

## REPL Helper Functions

Available inside the persistent REPL session:

| Function | Type | Purpose |
|----------|------|---------|
| `readFile(path)` | sync | Read file contents from projectRoot |
| `listDir(path)` | sync | List directory contents with sizes |
| `searchFiles(pattern, glob?)` | sync | Find lines matching regex in all files |
| `getState()` | sync | Read current state.json |
| `writePhaseReport(report)` | sync | Signal phase completion (capture) |
| `dispatchSubAgent(config)` | async | Launch sub-agent for file work |
| `runCheck()` | async | Execute check command (lint/test/build) |
| `llmQuery(prompt, options?)` | async | Quick LLM analysis (cheap, Haiku) |

All paths are resolved relative to `projectRoot` with safety checks to prevent escaping.

## Turn Loop Mechanism

### REPL Turn Loop (replTurnLoop)
```
Turn 1: Phase context + "Begin phase execution"
        → Orchestrator responds with JS code

Turn 2+: Previous output
         → Orchestrator responds with more JS code

Repeat until:
  - writePhaseReport() is called (success)
  - Turn limit reached (20 turns default)
  - Consecutive errors exceed threshold (3 errors)
  - Orchestrator process dies
```

### Code Extraction
Orchestrator responses are parsed for JavaScript:
- Fenced code blocks: ```js ... ```
- Raw code if it starts with `const`, `let`, `await`, etc.
- Skips natural language responses (error feedback)

### Execution
Each eval:
1. Wraps code in `(async () => { ... })()`
2. Runs in VM context with 30s timeout
3. Captures console output and return value
4. Serializes to JSON
5. Truncates at 8KB
6. Sends back to orchestrator as plaintext

## Error Handling

### Per-Task Retries
- Orchestrator retries up to 3x with adjusted instructions
- Uses `llmQuery()` to analyze failure before retrying
- If all retries fail: task marked failed, phase continues

### Phase-Level Retries
- Phase can recommend "retry" action in report
- Phase runner respects retry count limit (configurable)
- Can append corrective tasks to phase

### Worktree Cleanup
- Even on failure, worktree is cleaned up (`--force`)
- Uncommitted changes are discarded
- On abort, changes stay in `.trellis-worktrees/` for manual inspection

## Resume Support

### State Persistence
- `state.json` tracks completedPhases, currentPhase, phaseReports
- On restart, phase runner skips already-completed phases
- Allows resuming after partial failure

### Interactive Prompt (non-headless)
- After each phase: "[Enter] continue [r] retry [s] skip [q] quit"
- User can intervene mid-run
- Choices recorded in state

### Headless Mode
- No prompts; follows orchestrator recommendation
- Used for CI/CD environments
