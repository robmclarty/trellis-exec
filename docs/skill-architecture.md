# Skill Architecture

The phase orchestrator's tool knowledge is distributed across five skills instead of living in a monolithic system prompt. This document explains the structure, the reasoning behind each skill, and how they interact with the orchestrator and the plugin.

## Why skills instead of a single prompt

Early versions of the orchestrator used a single large system prompt (`prompts/orchestrator-system.md`) that documented every helper function, every sub-agent type, every verification tier, and every phase lifecycle detail in one file. This had three problems:

1. **Context cost.** The orchestrator received the entire prompt on every phase launch, even though most tasks only use a subset of the capabilities. A phase that only explores and dispatches doesn't need the full verification retry protocol or the phase report format.

2. **Maintenance coupling.** Changing how `runCheck()` works meant editing a 400-line file that also documented `readFile()`, `dispatchSubAgent()`, and compaction. Unrelated concerns lived in the same document.

3. **No reference depth.** A single prompt can't have "see also" links. Complex topics (context bundling strategies, failure analysis patterns, report format examples) either bloated the main prompt or were omitted entirely.

Skills solve all three: Claude Code's `--add-dir skills/` loads each skill's `SKILL.md` as a separate context chunk, reference files provide depth without bloating the core prompt, and each skill is independently editable.

## Skill directory layout

```text
skills/
├── explore-codebase/           # Orchestrator: codebase exploration helpers
│   ├── SKILL.md
│   └── references/
│       └── exploration-patterns.md
├── dispatch-agent/             # Orchestrator: sub-agent dispatch
│   ├── SKILL.md
│   └── references/
│       ├── agent-types.md
│       └── context-bundling.md
├── verify-work/                # Orchestrator: verification and retry
│   ├── SKILL.md
│   └── references/
│       └── failure-analysis.md
├── manage-phase/               # Orchestrator: phase lifecycle
│   ├── SKILL.md
│   └── references/
│       └── report-format.md
├── quick-query/                # Orchestrator: llmQuery() usage
│   └── SKILL.md
├── run/                        # Plugin: launch phase runner
│   └── SKILL.md
├── compile/                    # Plugin: launch plan compiler
│   └── SKILL.md
└── status/                     # Plugin: show execution progress
    └── SKILL.md
```

There are two categories: **orchestrator skills** (loaded by the phase orchestrator agent via `--add-dir`) and **plugin skills** (invoked by the developer through `/trellis:run`, `/trellis:compile`, `/trellis:status`). They serve different audiences and have different design goals.

## Orchestrator skills

These five skills are the orchestrator's instruction manual. The orchestrator agent prompt (`agents/phase-orchestrator.md`) is intentionally thin — it covers role, protocol, and execution flow. All helper function documentation, usage patterns, and reference material lives in skills.

### explore-codebase

**Documents:** Codebase exploration using native Claude tools (Read, Glob, Grep)

This skill teaches the exploration pattern that every task should follow: start broad with Glob/Grep, narrow with targeted searches, then read specific files with Read. It documents effective patterns for navigating unfamiliar code and understanding module structure.

The reference file (`exploration-patterns.md`) provides three worked examples showing complete exploration sequences for common scenarios: understanding a module before modifying it, finding all usages of a type, and locating test files.

**Why a separate skill:** Exploration is the most frequently used capability and the one where bad habits (reading entire large files, printing full directories) cause the most wasted tokens. Dedicating a skill to it reinforces the right patterns.

### dispatch-agent

**Documents:** Sub-agent dispatch via `claude --agent`

This skill covers the full dispatch workflow: agent types, context bundling, and when to delegate to sub-agents vs handle directly with native tools. It includes concrete examples of good and bad dispatch calls.

Two reference files provide depth:

- **agent-types.md** describes each sub-agent (implement, test-writer, scaffold, judge) with its model, permissions, when to use it, and example dispatch calls.
- **context-bundling.md** teaches how to assemble focused context bundles — what to include, what to exclude, sizing guidelines, and examples of well-bundled vs over-bundled dispatches.

**Why a separate skill:** Context bundling quality is the single biggest lever on sub-agent output quality. Poor bundles (too many files, vague instructions) produce poor code. This topic needs enough space for examples and anti-patterns that it would overwhelm a general-purpose prompt.

### verify-work

**Documents:** Check commands and the verification tiers

This skill defines the three-tier verification model:

1. **Check** (per task, required) — the user's lint/build/test command
2. **Verify** (per task, optional) — dynamic assertions the orchestrator generates
3. **Judge** (per phase, required) — independent spec compliance review

It also documents the retry protocol (max 3 per task, always analyze before retrying) and links to the failure analysis reference.

The reference file (`failure-analysis.md`) catalogs common failure categories (type errors, missing imports, test failures, lint violations) with diagnostic strategies and effective `llmQuery()` prompts for each.

**Why a separate skill:** Verification and retry logic is where the orchestrator is most likely to waste cycles. Without explicit guidance, LLM agents tend to retry blindly (same instructions, same failure) or give up too early. The skill enforces the "diagnose first, then retry with adjusted instructions" discipline.

### manage-phase

**Documents:** Phase report writing and state management

This skill covers phase lifecycle: reading shared state, synthesizing the judge assessment with execution context, writing the `.trellis-phase-report.json` file, and composing handoff briefings.

The reference file (`report-format.md`) provides the complete report structure with three worked examples: a clean advance, a retry with corrective tasks, and a halt requiring human intervention. Each example shows realistic field values.

**Why a separate skill:** The phase report is the orchestrator's only output that matters to the phase runner. Getting the report format, recommended action logic, and handoff briefing right is critical for the outer loop to make correct advance/retry/halt decisions. The examples need enough space to be realistic.

### quick-query

**Documents:** Quick LLM queries via `claude --print`

This skill teaches the orchestrator when to use quick LLM queries (for interpretive and analytical work) vs sub-agent dispatch (for file changes). It covers common use cases: analyzing check failures, deciding task strategy, evaluating output, and interpreting file structure.

**Why a separate skill:** Without explicit guidance, the orchestrator either under-uses quick queries (dispatching expensive sub-agents for pure analysis) or misuses them (trying to generate code that should be handled directly). The skill establishes the boundary clearly with examples of both correct and incorrect usage.

## Plugin skills

These three skills are thin launchers invoked by the developer through Claude Code's `/trellis:` command namespace. They are intentionally concise — just enough to explain what the command does, what flags are available, and how to monitor progress.

### run

Launches `npx trellis-exec run` with the user's tasks.json. Documents all CLI flags (phase selection, dry-run, resume, concurrency, model override, max retries, headless mode, judge mode, browser testing, verbose output) and explains the interactive prompt that appears between phases.

### compile

Launches `npx trellis-exec compile` to convert a plan.md into tasks.json. Documents the `--spec` and `--output` flags and briefly explains the two-stage compilation process (deterministic parse, then optional Haiku enrichment).

### status

Launches `npx trellis-exec status` to display execution progress. The simplest skill — just the command and a summary of what it shows.

## How skills are loaded

The phase runner launches the orchestrator with:

```bash
claude --agent-file agents/phase-orchestrator.md --add-dir skills/
```

Claude Code's `--add-dir` flag auto-discovers all `SKILL.md` files in the directory tree. Each skill's YAML frontmatter (`name` and `description`) tells Claude Code what the skill is for. Reference files inside `references/` subdirectories are available to the orchestrator as additional context when it needs deeper detail.

Plugin skills are discovered by Claude Code's plugin system via the `.claude-plugin/plugin.json` manifest. When a developer installs the trellis-exec plugin, the three command skills appear as `/trellis:run`, `/trellis:compile`, and `/trellis:status`.

## Relationship to the orchestrator prompt

The orchestrator prompt (`agents/phase-orchestrator.md`) and the skills are designed to be complementary with zero overlap:

| Concern | Where it lives |
|---------|---------------|
| Role and identity | Orchestrator prompt |
| Phase execution protocol | Orchestrator prompt |
| Task execution flow (dependency order, parallel scheduling) | Orchestrator prompt |
| Phase completion sequence | Orchestrator prompt |
| Error handling philosophy | Orchestrator prompt |
| Tool usage patterns and best practices | Skills |
| Agent types and capabilities | Skills |
| Context bundling strategies | Skills |
| Verification tiers and retry logic | Skills |
| Phase report format and examples | Skills |
| Quick query vs sub-agent dispatch distinction | Skills |

The orchestrator prompt tells the agent *what to do* and *in what order*. The skills tell it *how to use each tool* and *when to choose one tool over another*.

## Design principles

**Each skill owns one concern.** Exploration, dispatch, verification, phase management, and quick queries are five distinct activities. Mixing them would recreate the monolithic prompt problem.

**SKILL.md is the entry point, references go deep.** The main skill file should be scannable — function signatures, when-to-use guidance, key examples. Complex topics (agent type details, bundling strategies, failure patterns, report format examples) go in reference files so the main file stays focused.

**Examples over rules.** The orchestrator is an LLM. Concrete examples are more effective than abstract rules. Every skill includes practical examples showing actual tool usage patterns.

**Orchestrator skills are detailed; plugin skills are brief.** The orchestrator's effectiveness depends directly on how well it understands its tools. Extra detail and examples are worth the context cost. Plugin skills are for humans who just need to know the command and its flags.
