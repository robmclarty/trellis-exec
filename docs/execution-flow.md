# Execution Flow

All work happens directly in the project root — there is no worktree isolation or branch creation.

## The execution flow

1. **Phase runner starts** — loads `tasks.json`, validates dependencies, and loads or initializes `state.json`
2. **Each phase** runs in the project root: the orchestrator is spawned as a single `claude --agent --print` subprocess that executes all tasks, creating per-task git commits along the way
3. **After each phase**, the judge evaluates the work against the spec and acceptance criteria. If issues are found, a fix agent is dispatched (up to 2 correction attempts)
4. **Phase-level commit** — any remaining uncommitted changes are committed with a conventional commit message:

   ```text
   feat(auth,api): [trellis phase-2] Implemented user authentication

   - Created LoginForm component
   - Added JWT token validation
   - Integrated with AuthContext
   ```

5. **When all phases complete**, state is saved and the runner exits. All changes remain on the current branch as a series of conventional commits.

## To see what's been built

Check the git log for trellis commits:

```bash
git log --oneline | grep trellis
```

Or check the execution state:

```bash
trellis-exec status tasks.json
```

## Interactive vs headless mode

By default, the runner pauses after each phase and prompts the user for a decision:

- **Enter** — accept the recommendation (advance, retry, etc.)
- **r** — retry the current phase
- **s** — skip to the next phase
- **q** — save state and quit

Use `--headless` to run all phases without pausing. In headless mode, the runner follows the orchestrator's recommendation (as adjusted by the judge assessment).

## Resume support

State is persisted to `state.json` after every phase boundary. If a run is interrupted or fails, re-running `trellis-exec run tasks.json` will automatically skip completed phases and resume from where it left off.
