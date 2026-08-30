# ADR-0013: shop skill prerequisites are encoded as `skill_data.group_id`/`group_rate`, gated by `rarity <= 2`

**Status:** Accepted
**Date:** 2026-08-30 (UI-28, `umalator/app.tsx`'s `SKILL_LADDER`)

## Context

UI-28 redesigned the Skill Chart's "Shop skills" shortlist so that picking a skill with a shop
prerequisite (e.g. a gold skill built on top of a white one — Professor of Curvature requires
Corner Adept ○) automatically adds that prerequisite too, and removing a prerequisite cascades up
to remove everything shortlisted on top of it. This needed a way to know, for an arbitrary skill
id, what its prerequisite chain is.

Neither JSON file already shipped by this repo's data pipeline carries that information on its
own. `skill_meta.json` (from `master.mdb` via `make_skill_meta.pl`) has `groupId`, `iconId`,
`baseCost`, `order` — no rank within the group. `order` looked like a candidate but isn't: in
group `20097` the evolved-flavor member sorts *before* the base member, so it doesn't track the
upgrade direction. `baseCost` also doesn't work — Professor of Curvature and Corner Adept ○ carry
the identical cost (180), so it can't distinguish rank either.

`skill_data.group_rate` (a raw `master.mdb` column, not previously read by any generator here) is
the real answer: it's a per-skill rank within `group_id`, and it turned out to encode exactly the
shop's own upgrade ladder once queried directly against `master_jp.mdb`/`master.mdb`.

## Decision

- **Emit `group_rate` from `skill_data` as `groupRate` in `skill_meta.json`**, via both
  `make_skill_meta.pl` and `umalator-global/make_global_skill_meta.pl` (see `docs/data-pipeline.md`
  and `docs/master-mdb-schema.md`'s "Shop skill upgrade ladder" section for the query and the
  verification). JP's version is read straight off the skill's own row (`s.group_rate`), *not*
  through the `groupId` COALESCE join those generators already perform — the join answers "which
  family," `group_rate` answers "which rung," and conflating them would attach the wrong skill's
  rank to a remapped id.
- **The prerequisite rule**: adding a skill at rank N also adds every same-`group_id` skill with
  `1 <= rank < N`. `rank = -1` is always the debuff/"×" variant and is excluded (`>= 1`).
- **Gate the whole ladder index at `rarity <= 2`.** This is the part that isn't obvious from the
  rule alone: `make_skill_meta.pl`'s existing `groupId` remap (through
  `skill_upgrade_speciality`/`skill_upgrade_description`, there for a different feature —
  mutual-exclusivity display) places some evolved (rarity-6) skills into the *same* `groupId` as
  an unrelated white/gold family. Verified: every remapped id in the current data is rarity 6, and
  `group_rate >= 2` never occurs above rarity 2 in either database — so a plain `rarity <= 2`
  filter fully neutralizes the remap's side effect on this feature, without needing to special-case
  the remap itself.

## Options considered

- **Derive prerequisites from `order` or `baseCost`.** Rejected — neither is monotonic with the
  upgrade direction (see the group-20097 and cost-tie examples above); would have produced wrong
  answers silently rather than an obvious failure.
- **A separate hand-maintained prerequisite table**, like `scripts/data/global-release-order.json`
  is for release ordering. Rejected — the data already exists in `master.mdb` per-row; hand-
  maintaining a derivable fact invites drift every time the game adds a new ladder.
- **Trust `groupId` alone, no rarity guard.** Rejected once the remap trap was found during
  planning-stage verification (an independent review pass caught it before any code shipped) —
  would have silently attached a false prerequisite (e.g. an unrelated evolved skill) to a
  legitimate white/gold family the first time such a remapped id's `group_rate` happened to be 1.

## Consequences

- `skill_meta.json` (both JP and Global) gains one field per entry; regenerating from a current
  `master.mdb` is a clean, `groupRate`-only diff (verified: 0 adds/removes on JP, and see the
  Consequences note below for Global's added wrinkle).
- Regenerating Global's `skill_meta.json` from `master.mdb` alone drops every skill staged early
  by `scripts/add-staged-global-umas.mjs` (that script's own add-only design can't restore them —
  see its file-header comment and `docs/data-pipeline.md`), so this change also added a narrow
  `--refresh-staged-meta` mode to that script specifically to restore what a `skill_meta.json`-only
  regeneration drops. That mode is a restore-if-missing operation, not a general fix for the
  still-open, unrelated "stale JP-sourced entry never refreshes" gap the same file documents.
- Any future consumer of `groupId`+`group_rate` together must repeat the `rarity <= 2` guard — it's
  a property of the current data (verified, not structural), so a comment at the one call site
  (`umalator/app.tsx`'s `SKILL_LADDER`) and in `docs/master-mdb-schema.md` carries the warning
  forward rather than a type system enforcing it.
