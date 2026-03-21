---
name: compile
description: Use when compiling a plan — converts plan.md into a structured tasks.json for execution
---

# Compile

Compiles a Trellis implementation plan into a structured task file.

## Usage

```bash
npx trellis-exec compile <plan.md> [options]
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--spec <path>` | auto-detected | Path to the spec file (for enrichment context) |
| `--output <path>` | alongside plan.md | Output path for tasks.json |

## What It Does

1. **Stage 1 (deterministic):** Parses the plan markdown to extract phase headings, task items, spec section references, file paths, and inferred file-level dependencies. No LLM calls.
2. **Stage 2 (enrichment):** If needed, calls Haiku to fill in fields the parser couldn't resolve: natural-language dependency edges and sub-agent type classification.

The output is a `tasks.json` file ready for `trellis-exec run`.
