# ADR-0010: Umalator styles resolve through a single token file; dark mode is token redefinition

**Status:** Accepted
**Date:** 2026-08-23 (UI redesign phase 1; tracked as UI-9 in the work queue)

## Context

Umalator's styling accreted three incompatible conventions: a legacy game palette of raw literals (`SkillList.css`, `RaceTrack.css`), semi-tokenized files that still hand-write a `.dark` override per rule (`HorseDef.css`, `UmasTab.css`, and most of `app.css` — 113 `.dark` rules, a third of the file), and two properly tokenized outliers (`SkillPicker.css`'s `--sp-*` alias layer needing one `.dark` rule in 463 lines; `ResultsPane.css`'s scale tokens needing zero). The old token block sat at `app.css:1503` — two-thirds down the file — defined only 12 color properties, and left ~280 color literals unnamed. Breakpoints varied per file (480/700/768), and z-index values were ad-hoc (documented workaround comments existed just to keep the sidebar clickable over modals).

The 2026-08 UI redesign needed a place to stand before any restyling.

## Decision

- **`umalator/tokens.css` is the single source for design tokens** — color, typography (`--font-sans`, `--font-xs`…`--font-2xl`), spacing (`--space-xs`…`--space-xl`), radii, shadows, motion, and a five-step z-index scale. It contains *only* `:root`/`.dark` custom properties and the `@font-face` declarations (whose URLs keep the `/uma-tools/` prefix, ADR-0002), and it **must stay the first import in `app.tsx`** so it leads `bundle.css` — a properties-only file has no specificity interaction with anything after it.
- **Dark mode is token redefinition, not rule duplication.** `.dark` (on `<html>`) redefines color tokens; a rule that consumes tokens needs no `.dark` twin. The existing 113 `.dark` overrides are retired *incrementally*: whenever a rule is rewritten to consume tokens, its paired `.dark` override is deleted in the same change — never before the base rule stops hardcoding light colors, and never as a standalone big-bang pass.
- **768px is the canonical breakpoint** (custom properties are illegal in `@media`, so this is convention: the JS `MOBILE_BREAKPOINT` const plus literal `768px` in CSS). Stray 700px/480px queries in umalator-owned CSS migrate as those files are touched.
- **Component alias layers stay.** The `--sp-*`/`--rp-*` pattern (component-scoped names aliased onto global tokens, with literal fallbacks in shared files) is the sanctioned way for component CSS to consume the system.

## Options considered

- **Tokens at the top of `app.css`.** Rejected: leaves `app.css` load-bearing for every stylesheet that imports before it and blocks ever splitting the file; a dedicated properties-only file is order-safe by construction.
- **Big-bang dark-mode rewrite.** Rejected: a one-shot conversion of 113 override rules is exactly the unreviewable mega-diff ADR-0005 exists to prevent; incremental retirement keeps each diff attributable.
- **A build-time theming step (Sass/PostCSS variables).** Rejected: the repo deliberately has no CSS tooling beyond esbuild concatenation; native custom properties already do the job at runtime.

## Consequences

- Restyling work is mechanical: name the literal in tokens.css if it recurs, consume it, delete the `.dark` twin. Progress is measurable (`grep -c '^\.dark' umalator/app.css`).
- Shared CSS (`SkillList.css`, `RaceTrack.css`, `Tooltip.css`) is consumed by apps that never set `.dark` and never load tokens.css, so any token use added there must keep literal fallbacks (`var(--x, <literal>)`) — and courseimages rasterizes RaceTrack's styles into PNGs, so those files change only deliberately.
- Import order in `app.tsx` is now load-bearing for correctness of the cascade; the comment above the tokens.css import records this.
