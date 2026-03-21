---
name: status
description: Use when checking progress — shows current execution state for a Trellis run
---

# Status

Shows the current state of a Trellis execution run.

## Usage

```bash
npx trellis-exec status <tasks.json>
```

## What It Shows

- Which phases are complete, in progress, or pending
- Task statuses within each phase (passed, failed, skipped)
- Phase reports and retry counts
- Modified files manifest
