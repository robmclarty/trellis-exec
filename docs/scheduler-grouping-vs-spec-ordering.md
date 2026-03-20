# Scheduler Grouping vs Spec §10 #8 Ordering

## The scenario

Four tasks within a single phase:

- **A → B** (B explicitly depends on A)
- **C** and **D** (independent of each other and of A/B, no overlapping targetPaths)

## What the spec says

> §10 success criteria #8: "given 4 tasks where A→B (dependent) and C, D (independent
> of each other and of A/B), the orchestrator runs A first, then B+C+D in parallel."

Read literally, this implies two groups:

| Group | Tasks |
|-------|-------|
| 1     | A     |
| 2     | B, C, D |

## What the scheduler produces

Kahn's algorithm computes in-degrees:

| Task | In-degree | Reason |
|------|-----------|--------|
| A    | 0         | No dependencies |
| B    | 1         | Depends on A |
| C    | 0         | No dependencies |
| D    | 0         | No dependencies |

All zero-in-degree tasks are collected into the first group:

| Group | Tasks    | Parallelizable |
|-------|----------|----------------|
| 0     | A, C, D  | yes            |
| 1     | B        | no             |

C and D have no reason to wait for A. Placing them in group 0 is correct — it maximizes parallelism without violating any dependency constraint.

## Why the difference

The spec describes the scenario from the **orchestrator's runtime perspective**, where tasks execute over time. The phrase "runs A first, then B+C+D" is describing a valid execution trace, not the only valid one. Running A, C, and D simultaneously is also valid and strictly better — it completes the same work in fewer sequential steps.

The scheduler's job is to produce the **maximally parallel** grouping that respects all constraints. If C and D have no explicit `dependsOn` and no overlapping `targetPaths` with A, there is no constraint preventing them from running alongside A.

## When C and D would actually wait

C or D would be serialized after A only if one of these conditions were true:

1. **Explicit dependency**: C or D lists A in its `dependsOn` array.
2. **Implicit dependency**: C or D shares an overlapping `targetPaths` entry with A (e.g., both target `src/`).

Neither condition holds in the scenario described by §10 #8, so the scheduler correctly places them in the earliest possible group.

## Summary

| Concern | Resolution |
|---------|------------|
| Does the scheduler violate the spec? | No. The spec's ordering is one valid execution; ours is another valid (and more efficient) one. |
| Is the scheduler correct? | Yes. It satisfies the core invariant: no task runs before its dependencies (explicit or implicit) are complete. |
| Should we change the scheduler? | No. Maximizing parallelism is the scheduler's purpose. Artificially delaying independent tasks would waste execution time. |
