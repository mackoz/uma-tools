# ADR-0006: Upstream data sync is add-only, format-preserving, and loud

**Status:** Accepted
**Date:** 2026-08-20 (`scripts/sync-upstream-data.mjs`; exercised by PR #12)

## Context

Game data (umas, skills, courses, icons) is normally regenerated from the game client's `master.mdb` by the Perl pipeline (`docs/data-pipeline.md`). But this fork's own asset extraction is currently broken against the encrypted live client, and a `master.mdb` isn't always at hand — while upstream (`alpha123/uma-tools`) keeps publishing already-computed data. Without a working first-hand pipeline, released content goes missing here (stale rosters, skills, courses).

## Decision

`scripts/sync-upstream-data.mjs` ports data from a local upstream checkout under strict rules, stated in the script's own header:

- **Add-only** — "this only ever ADDS keys that don't already exist in the fork's JSON"; it never overwrites a value this fork already has.
- **Format-preserving** — output diffs stay minimal and reviewable against the committed JSON.
- **Explicitly a stopgap** — "a STOPGAP, not a replacement for the real data pipeline"; it can't reproduce upstream's richer per-outfit schema (deliberate DROP sets) and can't extract icons upstream hasn't extracted.
- **Dry-run by default**, with divergence reported rather than silently resolved.

## Options considered

- **Wholesale file copy from upstream.** Rejected: silently adopts upstream's schema and any values this fork has deliberately corrected, with an unreviewable diff.
- **Wait for the first-hand pipeline to be fixed.** Rejected as the only path: it blocks tracking released content on a repair with no timeline; the stopgap keeps live data current without giving up on the pipeline (the fix remains the goal).

## Consequences

- Live-content freshness no longer depends on the broken extraction path; the fork's own corrections can't be clobbered by a sync.
- Fields the script deliberately drops (upstream's extended schema) stay absent until the real pipeline runs — a recorded limitation, not an accident.
- The add-only rule means a value upstream *fixed* won't propagate if this fork already has the key — divergence reporting exists precisely so those cases surface for manual review instead of being silently taken or silently ignored.
