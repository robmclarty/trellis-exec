# Long-Running Harness Comparison

A critical comparison of Trellis against Anthropic's published research on long-running agent harnesses, identifying architectural alignment, gaps, and opportunities.

**Sources:**

- [Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Prithvi Rajasekaran, Anthropic Labs
- [Long-Running Claude for Scientific Computing](https://www.anthropic.com/research/long-running-Claude) — Siddharth Mishra-Sharma, Anthropic Research

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

### No interactive evaluation (Playwright MCP)

Both articles emphasize that Anthropic's evaluator interacts with running applications — clicking through UIs, testing APIs, checking database states via Playwright MCP. Their game-maker example demonstrates why: the solo-agent version *looked* functional but had completely broken runtime behavior — entities wouldn't respond to input, with broken wiring between definitions and runtime.

Trellis's judge only reads code diffs and files. It cannot verify runtime behavior.

**Impact:** High. Static diff review misses entire categories of bugs — broken event wiring, missing UI interactions, non-functional audio, stubbed operations. These are exactly the bugs Anthropic's QA agent catches.

**Opportunity:** The check command could start a server and the judge could receive Playwright MCP access for web/UI projects. This transforms the judge from a static code reviewer into a functional tester without deep architectural changes.

### Harness simplification and assumption stress-testing

Article 1's most important meta-point: *"Every harness component encodes assumptions about model limitations. These assumptions require regular stress-testing, as they quickly become outdated as models improve."*

Anthropic found that with Opus 4.6, sprint constructs could be removed entirely — the model handles decomposition internally. The evaluator's necessity became task-dependent: valuable when work exceeds baseline capability, unnecessary overhead otherwise.

Trellis has five specialized sub-agents (implement, scaffold, test-writer, judge, fix) with tool restrictions. The implement and scaffold agents lack Bash, Glob, and Grep access — they cannot search the codebase or run builds. This artificial constraint may now cost more than it saves.

**Impact:** Medium-high. Sub-agent dispatch overhead (subprocess launch, context serialization, tool restrictions) may exceed the benefit of specialization, especially as models improve at handling diverse tasks within a single context.

**Opportunity:** Benchmark the current multi-agent dispatch against a simplified orchestrator-does-everything approach. If the orchestrator can implement, test, and scaffold directly (as Anthropic found with sprint removal), the sub-agent layer becomes optional overhead.

### No sprint contract negotiation

Anthropic's three-agent harness has the generator and evaluator *negotiate a sprint contract* before work begins — defining completion criteria collaboratively. This catches ambiguous or untestable criteria before wasting a full execution cycle.

Trellis's judge receives acceptance criteria written at compile time, with no negotiation step. The judge is purely reactive — it only sees work after execution.

**Impact:** Medium. Ambiguous acceptance criteria waste entire phase cycles when the judge rejects work that technically meets a reasonable interpretation of the criteria.

**Opportunity:** Add an optional pre-phase "contract" step where the judge reviews the phase plan and acceptance criteria before execution, flagging ambiguous or untestable criteria. Low cost, high signal.

### No anti-laziness loop

The scientific computing article identifies "agentic laziness" — agents claiming completion prematurely on multi-part tasks. Their solution is a "Ralph loop" that kicks agents back with "are you really done?" and iterates until the task truly meets specifications.

Trellis has retry logic, but only triggered by judge rejection or check failure. If the orchestrator claims success and the judge agrees (but both are wrong or both miss something), there's no mechanism to challenge that.

**Impact:** Medium. Particularly relevant for phases with many acceptance criteria where both orchestrator and judge may satisfice rather than verify exhaustively.

**Opportunity:** Add a lightweight completion-challenge pass after the orchestrator reports "complete": do all target paths exist? Do acceptance criteria have corresponding test coverage? Are there TODO/FIXME comments in new code? This is cheaper than a full judge invocation but catches common lazy-completion patterns.

### No multi-day execution infrastructure

The scientific computing article runs Claude for days on HPC clusters with SLURM + tmux. Researchers detach from sessions and check progress via git commits — "while waiting in line for a coffee."

Trellis has a 15-minute default timeout per phase and is designed for interactive terminal sessions. The `--headless` flag enables auto-advance but the timeout ceiling caps ambition. There's no daemon mode, no detach-and-check-later pattern, no infrastructure for truly long-running (hours/days) autonomous execution.

**Impact:** Medium. The 15-minute timeout is appropriate for most implementation phases but insufficient for complex scientific computing, large refactors, or exploratory tasks.

**Opportunity:** A `--daemon` or extended headless mode that supports longer timeouts (1-2 hours per phase), progress reporting via git commits or webhooks, and graceful handling of machine sleep/restart. The `--headless` mode combined with `--resume` and `state.json` is 80% of the way there.

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
| Interactive evaluation | Playwright MCP | Static code review only | **Gap** |
| Sprint contracts | Negotiated pre-sprint | Fixed at compile time | **Gap** |
| Planner agent | Autonomous spec expansion | Human-guided pipeline | By design |
| Harness simplification | Actively stress-tested | Fixed architecture | **Gap** |
| Anti-laziness loops | Ralph loop pattern | Judge-only verification | **Gap** |
| Multi-day execution | SLURM + tmux, days | 15min timeout, interactive | **Gap** |
| Lab notes / memory | Unbounded CHANGELOG | 20-entry decisionsLog | Minor gap |
| Sub-agent dispatch | Removed as model improved | 5 specialized sub-agents | May be over-engineered |
| Dependency resolution | Not discussed | Kahn's algorithm + implicit deps | Trellis ahead |
| State persistence | Git commits + files | state.json + trajectory.jsonl | Trellis ahead |
| Error recovery | Not detailed | Reporter fallback, retry context | Trellis ahead |

## Recommendations (Ranked by Impact)

### 1. Add runtime evaluation capability

Give the judge Playwright MCP or equivalent interactive testing access. Static diff review misses entire categories of bugs. Anthropic's results show that the evaluator interacting with the running application is what separates "looks right" from "works right." This is the single highest-impact gap.

### 2. Stress-test sub-agent necessity

Benchmark orchestrator-only execution against the current multi-agent dispatch. Anthropic explicitly found that Opus 4.6 made separate agent dispatch unnecessary for many tasks. The tool restrictions on implement and scaffold agents (no Bash, no Glob, no Grep) are especially suspect — an implementation agent that can't search the codebase or run builds is artificially handicapped. Remove constraints that no longer match model capabilities.

### 3. Support longer autonomous execution

Increase the timeout ceiling, add progress reporting for detached sessions, and consider a "coffee-check" pattern where progress is visible via git commits without needing an active terminal. The `--headless` mode combined with `--resume` is most of the way there — the remaining work is increasing default timeouts and adding optional progress hooks (webhook, file, or git-based).

### 4. Add pre-phase contract review

Before executing a phase, have the judge review the acceptance criteria for ambiguity and testability. This is a lightweight addition that prevents wasted execution cycles on poorly specified phases.

### 5. Add completion verification pass

After the orchestrator reports "complete," run a lightweight check: target paths exist, no TODO/FIXME in new code, acceptance criteria have corresponding tests. Catches lazy-completion patterns without the cost of a full judge invocation.
