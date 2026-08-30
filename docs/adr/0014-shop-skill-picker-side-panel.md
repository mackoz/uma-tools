# ADR-0014: the shop skill shortlist lives in a picker side panel, not an always-visible chip strip

**Status:** Accepted
**Date:** 2026-08-30 (UI-28, `components/SkillPicker.tsx`'s `sidePanel` prop,
`umalator/components/ShopSkillPanel.tsx`)

## Context

UI-27 shipped the Skill Chart's "Shop skills" shortlist as four separate controls in the filter
row: a checkbox toggle (enabled/parked), an "Edit…" button, a conditional "Clear" button, and an
always-visible chip strip listing every shortlisted skill below them. Direct user feedback after
shipping: this read as too cluttered for what is, functionally, one feature.

Two redesign directions were logged in the ticket (`uma-tools-plans/work-queue/ui/ui-28.md`):
**A**, keep two controls (a renamed button + a clickable count that opens a removal view) but lose
the toggle; **B**, one combined button that opens the existing skill picker with an added panel
showing the shortlist. The user's stated preference was B.

## Decision

- **Drop the enabled/disabled toggle entirely.** `isShopFilterActive` no longer takes an `enabled`
  parameter — a non-empty shortlist is always active. The "parked" concept (a shortlist kept but
  not applied) is gone; there was no user-visible use case that survived scrutiny once "just add
  what you want" was on the table.
- **Combine "Edit…" and the selection count into one button**, reading `Shop Skills` (empty) or
  `Shop Skills — N Selected`. `Clear` stays as its own button next to it — the one piece of
  Direction A the user explicitly confirmed was fine as-is.
- **Move the shortlist itself into a new panel inside the picker modal** (`sidePanel`, an optional
  prop on `SkillPickerModal` following the same backwards-compatible pattern as UI-27's
  `onDeselect`/`searchPlaceholder`/`notice`), rather than a popover or a reduced picker view.
  Widen the modal (1080px → 1340px `max-width`) rather than shrink the results grid, so the
  existing search/filter/select behavior is visually unaffected.
- **Shortlisted skills stay visible in the results grid** (today's red-× removable treatment),
  mirrored in the panel — rather than disappearing from the grid once picked. The grid stays "the
  whole picker," the panel is "what you've decided so far."
- **The panel is a two-section ledger** (`In the pool` / `Won't activate here`, from the existing
  `partitionShopSkills`), not a flat list — the diagnostic UI-27's dimmed chip treatment carried is
  relocated, not dropped, and rendered as a structural split rather than an in-place dim so it
  reads as a set rather than requiring a scan for greyed-out entries. A skill pulled in
  automatically as a prerequisite (ADR-0013) renders indented beneath the skill that added it.
- **The filter row keeps a summary-only `⚠ N won't activate here`** span so that diagnostic isn't
  entirely invisible while the picker is closed — one span, not per-skill detail, which stays in
  the panel. This is one control beyond the ticket's literal text, added because moving the
  chip strip into the picker would otherwise silently regress a UI-27 feature whenever the picker
  isn't open.

## Options considered

- **Direction A** (rename the button, make the count itself a clickable removal view). Rejected
  per the user's stated preference; also left a genuinely open design question in the ticket
  (popover vs. reduced picker) that Direction B doesn't have.
- **Shrink the grid instead of widening the modal.** Considered and rejected — at the grid's
  existing `minmax(250px, 1fr)` column sizing, giving up ~280px measurably changes how many
  columns fit at common widths; widening leaves the primary picker experience untouched and only
  asks more of very narrow windows, which already get a dedicated `<900px` stacked layout.
- **Remove a shortlisted skill from the results grid once picked** (so the grid only shows
  "not yet added"). Rejected — a skill's rarity/searchability context in the grid is often exactly
  what a user needs to decide whether to add its neighbor; hiding it would make the grid state
  discontinuous with the panel state for no real declutter benefit, since the panel is already the
  dedicated "what's added" view.

## Consequences

- `ShopSkillFilter.tsx`'s props shrink from six to five, three of which (`enabled`,
  `onToggleEnabled`, `onRemove`) are gone entirely; `ShopSkillFilter.css` loses its toggle and chip
  rules. `.shopSkillChip*` base styling moves to the new `ShopSkillPanel.css`.
- `chartShopSkillsEnabled` stops being read or written to `localStorage`; the key is left orphaned
  rather than migrated, since it's inert and `chartShopSkills` (the shortlist itself) is
  unaffected.
- `components/SkillPicker.tsx` gains a fourth optional extension point (`sidePanel`) on top of
  UI-27's three, all following the same shape: HorseDef's own call site passes none of them and is
  provably unaffected (see `SkillPicker.tsx`'s own comments at each prop).
- `scripts/smoke.mjs`'s shop-filter checks were rewritten for the new controls and gained new
  cases for the prerequisite auto-add/cascade (ADR-0013) that didn't exist before this shipped.
