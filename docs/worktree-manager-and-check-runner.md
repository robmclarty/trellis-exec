# Worktree Manager & Check Runner

Two modules that provide git isolation and deterministic verification for execution runs.

## Worktree Manager

`src/isolation/worktreeManager.ts`

Manages the git worktree lifecycle so that each execution run operates on an isolated branch without touching the user's working tree. All functions are synchronous and use `child_process.execSync`.

### Functions

#### `createWorktree(config: WorktreeConfig): WorktreeResult`

Creates a new git worktree branched off the current HEAD.

1. Verifies the project root is a git repository.
2. Generates a deterministic branch name: `trellis-exec/{specName}/{timestamp}` (e.g., `trellis-exec/auth/20260319T1423`).
3. Places the worktree at `{projectRoot}/.trellis-worktrees/{branch-slug}`.
4. Returns the absolute worktree path and branch name on success, or an error message on failure.

Never force-deletes branches or stashes changes. If the branch already exists or the directory is not a git repo, it returns `success: false` with a descriptive error.

```typescript
const result = createWorktree({
  projectRoot: "/path/to/repo",
  specName: "auth",
});
// result.worktreePath → "/path/to/repo/.trellis-worktrees/trellis-exec-auth-20260319T1423"
// result.branchName   → "trellis-exec/auth/20260319T1423"
```

#### `commitPhase(worktreePath, phaseId, message?): boolean`

Stages all changes in the worktree and commits them. Returns `true` if a commit was created, `false` if there was nothing to commit. Default commit message: `"trellis-exec: complete {phaseId}"`.

```typescript
commitPhase(result.worktreePath, "phase-1");
// creates commit: "trellis-exec: complete phase-1"
```

#### `mergeWorktree(config: MergeConfig): MergeResult`

Merges the worktree branch back into the current branch of the project root. Returns `{ success: true }` or `{ success: false, error }` if there are merge conflicts.

```typescript
mergeWorktree({
  projectRoot: "/path/to/repo",
  worktreePath: result.worktreePath,
  branchName: result.branchName,
});
```

#### `cleanupWorktree(worktreePath): void`

Removes the worktree via `git worktree remove --force`. Silently ignores errors (the worktree may already be gone).

### Types

| Type | Fields |
|------|--------|
| `WorktreeConfig` | `projectRoot`, `branchName?`, `specName?` |
| `WorktreeResult` | `success`, `worktreePath`, `branchName`, `error?` |
| `MergeConfig` | `projectRoot`, `worktreePath`, `branchName` |
| `MergeResult` | `success`, `error?` |

### Typical lifecycle

```
createWorktree  →  [sub-agents work in worktree]  →  commitPhase
                         ↓ (repeat per phase)
                   mergeWorktree  →  cleanupWorktree
```

### Failure handling

Per the spec (section 9), worktree conflicts are detected **before** launching the orchestrator. The phase runner checks the result of `createWorktree` and exits with a clear error if it fails. The developer fixes the conflict manually and resumes with `--resume`.

---

## Check Runner

`src/verification/checkRunner.ts`

Runs a user-defined shell command as a deterministic verification gate. This is the "check" tier from the spec (section 5) -- a hard gate that must pass after every task.

### Function

#### `createCheckRunner(config: CheckConfig): CheckRunner`

Returns an object with a single `run()` method. The runner:

1. Executes the configured command via `child_process.exec` (async).
2. Captures stdout and stderr into a single `output` string.
3. Returns a `CheckResult` (`{ passed, output, exitCode }`).
4. On timeout, returns `passed: false` with the message `"Check timed out after {timeout}ms"`.

```typescript
const runner = createCheckRunner({
  command: "npm run lint && npm test",
  cwd: worktreeResult.worktreePath,
  timeout: 120_000,  // default
});

const result = await runner.run();
// result.passed   → true/false
// result.output   → combined stdout+stderr
// result.exitCode → 0 on success
```

### Types

| Type | Fields |
|------|--------|
| `CheckConfig` | `command`, `cwd`, `timeout?` (default: 120000ms) |
| `CheckRunner` | `{ run(): Promise<CheckResult> }` |
| `CheckResult` | `passed`, `output?`, `exitCode?` (from `types/state.ts`) |

### Configuration

The check command is configured per project via:
- `--check` CLI flag
- `trellis-exec.config.json`
- `check` field in `tasks.json`

Examples: `"npm run lint && npm run build && npm test"`, `"make check"`, `"./scripts/verify.sh"`.

### Defaults

| Setting | Value |
|---------|-------|
| Timeout | 120,000ms (2 minutes) |
| Max buffer | 10 MB |
