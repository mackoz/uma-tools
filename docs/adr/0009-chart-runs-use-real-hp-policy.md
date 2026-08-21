# ADR-0009: Chart runs request `mode: 'compare'` for a real HP policy

**Status:** Accepted
**Date:** 2026-08-21 (`54aa2d1`, PR #11)

## Context

The engine's builder gates its HP model on a mode string: `RaceSolverBuilder.ts` selects `GameHpPolicy` only for `mode === 'compare'` and the no-op policy (infinite stamina, guaranteed full spurt) otherwise — a split inherited from upstream's original HP implementation (upstream commit `e89d819`). Chart runs never passed a mode, so **by omission** every chart simulation ran with no stamina model: every uma full-spurted, and HP-only recovery skills were meaningless as candidates — they had to be excluded from the chart's candidate list outright.

Nothing in the history suggests the no-op chart was a considered modeling stance; it was a default nobody had revisited.

## Decision

Both chart analysis models request `mode: 'compare'` (`umalator/app.tsx`, `buildChartOptions()`). The code comment at the site records the intent: this "gives the chart a real HP policy … instead of the no-op policy a chart run got by omission before this rewrite, and it's why HP-only (recovery) skills no longer need to be excluded from the candidate list: they now have a real HP budget to act on in either model."

Recovery skills are therefore rankable in the chart: run one for an uma below the stamina threshold of a course and the chart recommends recovery accordingly. The results table's default filters still hide recovery skills until toggled on — a display default, not a simulation limitation.

## Options considered

- **Keep the no-op HP chart** (the inherited state). Rejected: rankings that ignore stamina are silently wrong for any build near a stamina threshold, and an entire skill category was unrankable.
- **A separate chart-specific HP toggle.** Not needed: the existing `'compare'` gate already selects the real policy, and the chart is built on the compare machinery anyway (ADR-0007's paired comparisons).

## Consequences

- Chart output changed relative to pre-rewrite runs — deliberately: stamina-limited builds now spurt (and rank skills) realistically, and recovery skills appear with real effect sizes.
- Chart runs pay the HP model's cost per scenario; absorbed within PR #11's overall performance budget.
- The engine-side mode gate itself (`'compare'` as the magic string selecting `GameHpPolicy`) is inherited API shape — if the engine ever grows an explicit HP-policy parameter, the chart's intent recorded here is "real HP, always."
