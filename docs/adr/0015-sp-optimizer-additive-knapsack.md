# ADR-0015: the SP optimizer estimates purchase sets via an additive knapsack over per-skill chart gains, not full-set re-simulation

**Status:** Accepted
**Date:** 2026-09-01 (UI-16, `umalator/spOptimizer.ts`, `umalator/components/SpOptimizerCard.tsx`,
`umalator/components/ShopSkillPanel.tsx`)

## Context

UI-16 logged a heavier design for the Skill Chart's SP-budget optimizer: a beam search over the
full candidate pool, each finalist purchase set re-simulated through the worker pool for a real
measurement, and a tied-with-#1 paired comparison to settle close calls — mirroring how the Skill
Chart itself ranks individual skills (ADR-0007). Given the effort budget for this pass, the user
chose to ship a lightweight MVP instead of the full design: sum each shortlisted skill's
already-measured chart gain and solve the resulting knapsack exactly, rather than re-simulating
any combination. The heavier design was deferred, not abandoned — see
`docs/statistical-analysis.md`'s "Deferred to a follow-up branch".

## Decision

- **Restrict the optimizer to the user's Shop Skills shortlist**, not the chart's full candidate
  pool. The shortlist is already narrowed by the picker to skills that can activate on this course
  for this run style, and is expected to stay well under ~40 skills — small enough for exact
  enumeration rather than a heuristic search.
- **Group shortlisted candidates by their `SKILL_LADDER` group** (ADR-0013's `rarity <= 2`-gated
  upgrade ladder). Each group becomes a set of mutually exclusive "tiers": buying a given rung also
  buys every lower-rate rung of the same group not already owned, at a total SP cost discounted via
  `discountedCost`/`HINT_DISCOUNT` (`[0, 0.1, 0.2, 0.3, 0.35, 0.4]` for hint levels 0–5; ported
  from the `c000712` prototype and matching community-documented shop discounts — these
  percentages are **not** derivable from `master.mdb` itself, whose hint tables were checked on
  both clients and encode hint *targets*, not the discount curve) — **the
  discount level is shared across a family's same-rarity rungs, not stored per rung**: one hint per
  skill, with a ○/◎ pair (same `SKILL_LADDER` group, same rarity) sharing a single hint and a gold
  rung (a different rarity) always getting its own. This follow-up (`umalator/spOptimizer.ts`'s
  `buildHintClusters`/`expandHints`/`remapHintKeys`) is justified by `master.mdb`'s
  `single_mode_hint_gain` table: `hint_gain_type` 0 (partner-hint) rows target rate-1 rarity-1 base
  skills exclusively, on both clients (Global 177/177, JP 371/371) — a hint is never attached
  directly to a ◎/gold/evolved rung, so a ◎'s discount necessarily derives from its base skill's
  hint. A tier's gain is just its terminal (highest bought) rung's own chart-measured mean — gains
  are never summed within a single group, since only the rung you'd actually end up equipped with
  contributes to the build.
- **Solve by exhaustive DFS** over "buy one tier, or nothing, per group," bounded only by the SP
  budget and a defensive `NODE_CEILING` (20,000,000 node visits) — not by any gain-based bound.
  "Exact" holds only below the ceiling: a large shortlist of mostly-singleton groups with a budget
  that affords most combinations can genuinely reach it (~25 affordable singleton groups is 2^25
  leaves), at which point the search stops early, returns a best-effort selection, and reports
  `truncated: true` — surfaced as a note on the Buy list card rather than presented as optimal.
- **No cross-tier dominance pruning**, even though it's a standard knapsack optimization. This is
  deliberate: dominance pruning (dropping a group's tier whenever another tier in the same group
  has both lower cost and higher gain) is sound for finding the single best set, but not for
  finding the best top-K diverse sets once K > 1. Counterexample: group A has tiers (cost 5, gain
  3) and (cost 5, gain 4); group B has one tier (cost 5, gain 10); budget 10. Pruning group A down
  to just its (cost 5, gain 4) tier — dominating the (cost 5, gain 3) tier on both cost and gain —
  is fine for the #1 answer (gain-4 tier + B = 14), but the diversity rule below means the true #2
  set is the gain-3 tier + B, not some other combination — and the pruned search never sees it,
  because it was discarded as "dominated" before the diversity constraint had a chance to want it
  back.
- **Post-select up to `topK` (default 3) results** ordered by (total gain desc, total cost asc),
  accepting a candidate only if its symmetric difference from every already-accepted result is at
  least 2 skill ids — so the returned options read as genuinely different purchases rather than
  near-duplicates of each other.
- **Freeze recomputation while a chart run is streaming.** `umalator/app.tsx` recomputes purchase
  options via a `useMemo` keyed on the candidate list, hints, budget, and owned skills, but holds
  the last-computed result (via a ref) while `isSimulationRunning` is true, since `tableData`
  updates many times per second mid-run and would otherwise re-run the DFS on every batch.
- **Selecting an option only highlights rows** (`BasinnChart`'s new `highlighted` prop) — it never
  triggers a re-simulation. Every gain shown is explicitly labeled an estimate, both in code
  comments (`SpOptimizerCard.tsx`'s header) and in the card's own footnote text.

## Options considered

- **The original heavier design** (beam search over the full pool, worker-pool re-simulation of
  finalists, tied-with-#1 paired comparison). Rejected for this pass on effort, not on merit — it
  remains the documented upgrade path. The MVP's additive-sum estimate is a known-weaker
  approximation whenever shortlisted skills interact (positively or negatively) when equipped
  together; the full design exists specifically to close that gap later.
- **Cross-tier dominance pruning to shrink the DFS.** Rejected — unsound once `topK > 1` with a
  diversity constraint, per the counterexample above. Left un-pruned instead and bounded only by
  `NODE_CEILING` as a cap, with truncation surfaced to the user when it hits (see the Decision
  bullet above) — typical shortlists stay well under the ceiling, but "typical" is not "always",
  so the cap is disclosed rather than assumed unreachable.
- **Recompute on every streaming chart batch.** Rejected — `tableData` mutates many times per
  second while a run streams in; freezing on `isSimulationRunning` and recomputing once on the
  final batch avoids re-running the DFS dozens of times per second for a result the user won't see
  until the run finishes anyway.

## Consequences

- Purchase-set gains can misstate the true combined effect whenever shortlisted skills interact —
  the MVP's core tradeoff, surfaced in both the code and the UI so it isn't mistaken for a real
  simulated number.
- The optimizer only ever sees the shop shortlist, not the chart's full candidate pool — a user who
  wants an optimized set over every general skill has no path to that today; that's the deferred
  beam-search item's job.
- Optimizer state (budget, hint levels, selected option) is `localStorage`-only
  (`chartSpBudget`, `chartShopSkillHints`), not part of shared URLs — consistent with how
  `chartShopSkills` and the chart's other work-scoping knobs already behave (see
  `docs/statistical-analysis.md`'s Reproducibility section), but a shared umalator link never
  reproduces someone else's buy list.
- UI-16 stays open, tracking the re-simulation, tied-with-#1 paired comparison, beam search,
  add/drop/swap refinement, and shared-URL items as future work.
