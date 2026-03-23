**Yes, if you're using worktree isolation, all work happens in a worktree** — that's why you don't see new files in the project root yet.

## The execution flow

1. **Worktree created** at `.trellis-worktrees/<slug>/` — an isolated copy of your repo on a branch like `trellis-exec/<spec>/<timestamp>`
2. **Each phase** runs inside that worktree: Claude sub-agents create/modify files there
3. **After each phase passes**, changes are committed to that branch with a message like `trellis-exec: complete phase-2`
4. **When all phases complete**, the branch is merged back into your original repo and the worktree is cleaned up

## To see what's actually been built

You can check the worktree directly:

```bash
ls ../habit-tracker-trellis-exec-1/.trellis-worktrees/
```

Or check for the working branch:

```bash
cd ../habit-tracker-trellis-exec-1 && git branch | grep trellis-exec
```

The files exist in the worktree copy, accumulating commits as each phase completes. You'll only see them in your main project root after the final merge at the end of the run.

If isolation is set to `"none"` instead of `"worktree"`, it works directly in the project root with no git commits — but worktree mode gives you an audit trail and safe rollback if something goes wrong.
