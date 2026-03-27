# Long-Running Harness Comparison

A critical comparison of Trellis against Anthropic's published research on long-running agent harnesses, identifying architectural alignment, gaps, and opportunities.

**Sources:**

- [Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Prithvi Rajasekaran, Anthropic Labs
- [Long-Running Claude for Scientific Computing](https://www.anthropic.com/research/long-running-Claude) — Siddharth Mishra-Sharma, Anthropic Research
- [Anthropic Just Dropped the New Blueprint for Long-Running AI Agents](https://www.youtube.com/watch?v=9d5bzxVsocw) — The AI Automators

**Date:** 2026-03-25

## Summary

Trellis independently converged on several patterns Anthropic identifies as essential for long-running agent work: phased context resets, generator-evaluator separation, structured handoff, git-based coordination, and test oracle verification. However, gaps exist in runtime evaluation, harness simplification, anti-laziness mechanisms, and support for truly long (multi-hour/multi-day) autonomous execution.

## Where Trellis Aligns

### Generator-evaluator separation

Anthropic's core finding: self-evaluation bias kills quality. Agents inflate their own scores, especially on subjective tasks. Separating generation from evaluation creates a stronger feedback mechanism.

Trellis implements this cleanly. The phase orchestrator generates, a separate judge agent evaluates, and a fix agent corrects. The judge is model-adaptive (Sonnet for small diffs, Opus for large ones). This is load-bearing architecture that Anthropic confirms matters.

### Phased context resets

Anthropic identifies "context anxiety" — agents wrapping up prematurely as context windows fill. Compaction (summarizing earlier conversation) preserves continuity but doesn't provide the clean slate needed. Context resets — clearing the window entirely and starting fresh agents with structured handoffs — proved essential.

Trellis's per-phase fresh context windows directly address this. Each phase gets a clean subprocess with structured handoff (learnings, decisions log, handoff briefing). This is arguably Trellis's strongest architectural decision.

### Structured handoff and lab notes

The scientific computing article emphasizes CHANGELOG.md as "portable long-term memory, acting as a sort of lab notes." It tracks completed tasks, failed approaches with reasoning, accuracy benchmarks, and known limitations.

Trellis has `decisionsLog` (capped at 20 entries), `handoff` briefings between phases, and `state.json` for persistent execution state. The mechanism is more structured than Anthropic's markdown-file approach — decisions are typed, bounded, and programmatically managed.

### Test oracle and check commands

Anthropic stresses that agents require mechanisms to assess progress objectively. For scientific code this means reference implementations, quantifiable success metrics, expanding test coverage, and regression prevention.

Trellis has configurable check commands (`--check`), auto-detection of test frameworks (`vitest.config.ts`, `jest.config.js`, `package.json` scripts), and check gates after each phase and fix cycle.

### Git-based coordination

Both systems use git as the coordination backbone. The scientific computing article describes commit-after-every-meaningful-unit, test-before-commit, never-commit-breaking-changes, and progress-visible-without-active-intervention.

Trellis implements per-task commits, per-phase commits, SHA tracking for judge diffs, and git-based checkpointing for resume support.

## Where Trellis Falls Short

### ~~No interactive evaluation (Playwright MCP)~~ — Addressed

Both articles emphasize that Anthropic's evaluator interacts with running applications — clicking through UIs, testing APIs, checking database states via Playwright MCP. Their game-maker example demonstrates why: the solo-agent version *looked* functional but had completely broken runtime behavior — entities wouldn't respond to input, with broken wiring between definitions and runtime.

**Status:** Trellis now has a two-tier browser testing system that addresses this gap:

1. **Per-phase smoke tests** — A deterministic Playwright script runs after each UI phase, checking for console errors, blank pages, and crash-on-click. This catches broken rendering and wiring without LLM cost.
2. **End-of-build acceptance tests** — An LLM-powered loop where a `browser-tester` agent (Opus) generates Playwright tests from the spec's acceptance criteria, and a `browser-fixer` agent (Sonnet) fixes failures iteratively.

The system auto-detects web app projects (via package.json dependencies, build-tool configs, and HTML entry points) and propagates `requiresBrowserTest` flags with sticky semantics. Dev server detection is language-agnostic (Node, Python/Django, Ruby/Rails, Go, Docker Compose). See [browser-testing.md](browser-testing.md) for details.

### Harness simplification and assumption stress-testing

Article 1's most important meta-point: *"Every harness component encodes assumptions about model limitations. These assumptions require regular stress-testing, as they quickly become outdated as models improve."*

Anthropic found that with Opus 4.6, sprint constructs could be removed entirely — the model handles decomposition internally. The evaluator's necessity became task-dependent: valuable when work exceeds baseline capability, unnecessary overhead otherwise.

Trellis has five specialized sub-agents (implement, scaffold, test-writer, judge, fix) with tool restrictions. The scaffold agent lacks Bash, Glob, and Grep access. The implement agent has Glob and Grep but not Bash — it can search the codebase but cannot run builds. These artificial constraints may now cost more than they save.

**Impact:** Medium-high. Sub-agent dispatch overhead (subprocess launch, context serialization, tool restrictions) may exceed the benefit of specialization, especially as models improve at handling diverse tasks within a single context.

**Opportunity:** Benchmark the current multi-agent dispatch against a simplified orchestrator-does-everything approach. If the orchestrator can implement, test, and scaffold directly (as Anthropic found with sprint removal), the sub-agent layer becomes optional overhead. The implement agent already has search capabilities (Glob, Grep) but still lacks Bash — the remaining tool restriction worth questioning.

### No sprint contract negotiation

Anthropic's three-agent harness has the generator and evaluator *negotiate a sprint contract* before work begins — defining completion criteria collaboratively. This catches ambiguous or untestable criteria before wasting a full execution cycle.

Trellis's judge receives acceptance criteria written at compile time, with no negotiation step. The judge is purely reactive — it only sees work after execution.

**Impact:** Medium. Ambiguous acceptance criteria waste entire phase cycles when the judge rejects work that technically meets a reasonable interpretation of the criteria.

**Opportunity:** Add an optional pre-phase "contract" step where the judge reviews the phase plan and acceptance criteria before execution, flagging ambiguous or untestable criteria. Low cost, high signal.

### ~~No anti-laziness loop~~ — Partially Addressed

The scientific computing article identifies "agentic laziness" — agents claiming completion prematurely on multi-part tasks. Their solution is a "Ralph loop" that kicks agents back with "are you really done?" and iterates until the task truly meets specifications.

**Status:** Trellis now has a **completion verifier** that runs after each phase:

- Checks that all completed tasks have their `targetPath` files on disk
- Scans new files for `TODO`/`FIXME`/`HACK` markers

This catches common lazy-completion patterns (claiming files were created when they weren't, leaving stub implementations). Combined with the judge → fix correction loop and browser smoke tests, there are now three independent verification layers beyond the orchestrator's self-report.

**Remaining gap:** The completion verifier doesn't check whether acceptance criteria have corresponding test coverage. The judge may still agree with the orchestrator's optimistic assessment on subjective criteria.

### No multi-day execution infrastructure

The scientific computing article runs Claude for days on HPC clusters with SLURM + tmux. Researchers detach from sessions and check progress via git commits — "while waiting in line for a coffee."

Trellis has a 30-minute default timeout per phase (configurable via `--timeout`) and a `--long-run` flag that extends it to 2 hours. The `--headless` flag enables auto-advance. There's no daemon mode, no detach-and-check-later pattern, no infrastructure for truly long-running (multi-day) autonomous execution.

**Impact:** Low-medium. The 30-minute default and 2-hour `--long-run` mode cover most implementation phases and complex refactors. Multi-day autonomous execution remains out of scope.

**Opportunity:** A daemon mode with progress reporting via git commits or webhooks, and graceful handling of machine sleep/restart. The `--headless` mode combined with `--resume`, `state.json`, and `--long-run` covers most practical use cases already.

### Bounded learnings may be too aggressive

Trellis caps `decisionsLog` at 20 entries. The scientific computing article's CHANGELOG.md grows unbounded — it's the agent's full lab notebook, including failed approaches and their reasoning.

For a 10-phase project, 20 entries may suffice. For a 30+ phase project, early architectural decisions get evicted and may be repeated or contradicted.

**Impact:** Low-medium. Only surfaces on large projects with many phases.

**Opportunity:** Instead of a flat cap, use a tiered approach: keep all "architectural" decisions permanently and only evict "tactical" ones. Or summarize/compact old decisions rather than dropping them entirely.

## Structural Comparison

| Dimension | Anthropic Harness | Trellis | Assessment |
|-----------|------------------|---------|------------|
| Context reset | Per-sprint fresh agents | Per-phase fresh subprocess | Parity |
| Generator-evaluator split | Separate agents | Judge + fix agents | Parity |
| Evaluation criteria | Rubric-based, tunable | Acceptance criteria from spec | Trellis less adaptive |
| Interactive evaluation | Playwright MCP | Two-tier browser testing (smoke + acceptance) | Addressed |
| Sprint contracts | Negotiated pre-sprint | Fixed at compile time | **Gap** |
| Planner agent | Autonomous spec expansion | Human-guided pipeline | By design |
| Harness simplification | Actively stress-tested | Fixed architecture | **Gap** |
| Anti-laziness loops | Ralph loop pattern | Completion verifier + judge + browser smoke | Partially addressed |
| Multi-day execution | SLURM + tmux, days | 30min default, 2hr `--long-run` | Reduced gap |
| Lab notes / memory | Unbounded CHANGELOG | 20-entry decisionsLog | Minor gap |
| Sub-agent dispatch | Removed as model improved | 5 specialized sub-agents | May be over-engineered |
| Dependency resolution | Not discussed | Kahn's algorithm + implicit deps | Trellis ahead |
| State persistence | Git commits + files | state.json + trajectory.jsonl | Trellis ahead |
| Error recovery | Not detailed | Reporter fallback, retry context | Trellis ahead |

## Recommendations (Ranked by Impact)

### ~~1. Add runtime evaluation capability~~ — Done

Trellis now includes two-tier browser testing: per-phase Playwright smoke checks (deterministic, no LLM) and end-of-build acceptance tests (LLM-driven generate-and-fix loop). Web app projects are auto-detected. See [browser-testing.md](browser-testing.md).

### 2. Stress-test sub-agent necessity

Benchmark orchestrator-only execution against the current multi-agent dispatch. Anthropic explicitly found that Opus 4.6 made separate agent dispatch unnecessary for many tasks. The scaffold agent's tool restrictions (no Bash, no Glob, no Grep) and the implement agent's lack of Bash access are worth questioning — subprocess dispatch overhead may exceed the benefit of specialization. Remove constraints that no longer match model capabilities.

### 3. Support longer autonomous execution — Partially Done

The default orchestrator timeout was increased from 10 to 30 minutes, and `--long-run` provides a 2-hour ceiling. The remaining work is adding optional progress hooks (webhook, file, or git-based) for truly detached sessions and a daemon mode for multi-day execution.

### 4. Add pre-phase contract review

Before executing a phase, have the judge review the acceptance criteria for ambiguity and testability. This is a lightweight addition that prevents wasted execution cycles on poorly specified phases.

### ~~5. Add completion verification pass~~ — Done

The completion verifier now runs after each phase, checking that target paths exist on disk and scanning new files for `TODO`/`FIXME`/`HACK` markers. This catches common lazy-completion patterns without the cost of a full judge invocation.
