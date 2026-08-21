# ADR-0007: The Skill Chart ranks by paired comparisons with adaptive, CI-based elimination

**Status:** Accepted
**Date:** 2026-08-21 (the `skill-chart-perf-rewrite` branch / PR #11; full reference: `docs/statistical-analysis.md`)

## Context

The Skill Chart answers "which of ~200+ candidate skills gains this uma the most bashin on this course?" — a Monte-Carlo ranking problem where per-skill effects are often fractions of a bashin, well inside race-to-race noise. The pre-rewrite chart ran a fixed, unpruned sample count per candidate and filtered with ad hoc rules; an earlier attempt at proper statistics (a never-pushed reference branch) "got the statistics right but regressed performance 15–30x and shipped a UI with controls unreachable until after a run had already finished" (PR #11).

## Decision

The chart's method, as a set of interlocking decisions:

- **Paired comparisons on common random numbers**: each candidate is evaluated as (with-skill − without-skill) on the *same* simulated races, leaning on the engine's per-skill RNG streams (engine ADR-0005, `deriveSeed`) so the pair differs only by the candidate. The difference's variance collapses versus comparing independent runs.
- **Disjoint, reproducible scenario blocks**: a round's scenarios are identified by `(blockSeed, blockSize)`, not an offset into a shared stream — blocks compose without overlap, and any single sample can be re-simulated later from its block identity.
- **Adaptive ladder with CI elimination** (`umalator/chartLadder.ts`): a cheap first pass over every candidate, then progressively larger passes only on skills still statistically competitive, eliminated by a confidence-interval rule. Worst-case "Thorough" cost drops from ~832,000 scenarios to ~119,300 (PR #11).
- **Honest intervals**: BCa bootstrap for surviving skills' effect estimates, Wilson intervals for proc rates — each confined to where its assumptions hold (`docs/statistical-analysis.md`, "Two interval constructions, deliberately confined").
- **Streaming + detail on demand**: results chunk back progressively (32 rows / 200 ms) instead of one ~1.45 GB terminal message, and an expanded row's traces are *re-simulated* from their block identity rather than retained for every candidate up front.

## Options considered

- **Flat fixed N per candidate.** Rejected: spends the same budget on obviously-dead skills as on close calls — the 7× cost gap above.
- **Elimination on a single order statistic over a small batch** (a sibling fork's approach: cut if `max > threshold` over ~25 samples). Rejected: near-random at the margin; a CI rule makes the error rate explicit and controllable.
- **Retaining full per-tick traces for every candidate.** Rejected: the 1.45 GB message; determinism makes recomputation strictly cheaper than retention.

## Consequences

- Rankings are reproducible for a given seed, robust run-to-run, and come with meaningful uncertainty ranges; the elimination rule's error rate is a stated parameter rather than folklore.
- The block/identity scheme is load-bearing: detail-on-demand, cancellation-restart behavior, and cross-round composition all assume scenario `i` of a block is always the same race. Changing block identity semantics is a numeric-output change.
- Statistics live in `umalator/statisticalAnalysis.ts`/`chartLadder.ts` with unit tests (`npm run test:stats`) — the only part of the app with tests; keep them green.
