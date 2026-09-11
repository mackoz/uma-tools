# ADR-0020: Pin `strict: false` in `tsconfig.json`, re-enable per flag later

**Status:** Accepted
**Date:** 2026-09-11 (PIPE-58)

## Context

TypeScript 7 (`typescript-go`) defaults `compilerOptions.strict` to `true`, where TS 4.x and
earlier defaulted it to `false`. `tsconfig.json` never set the `strict` key either way, so
`uma-tools` had been typechecking under strict mode by an unchosen compiler default since the
`"typescript": "^7.0.2"` bump. Measured on this branch before any change here:

```
$ npx tsc --noEmit                | grep -c "error TS"
1030
$ npx tsc --noEmit --strict false | grep -c "error TS"
150
```

~85% of the reported backlog is strict-mode diagnostics nobody opted into.

**The consequence that makes this a bug, not a preference.** `tsc` 7.x hard-caps reported
diagnostics at 1000. `scripts/verify-baseline.json` recorded `"tsc": 1015` — itself above the
cap — and `scripts/verify.mjs`'s regression guard was:

```js
const tscRegressed = base != null && base.tsc < TSC_CAP && tsc > base.tsc; // verify.mjs:509
```

With `base.tsc` (1015) already `>= TSC_CAP` (1000), `base.tsc < TSC_CAP` was permanently `false`,
so `tscRegressed` could never be `true` — `npm run verify`'s tsc stage was structurally incapable
of reporting a regression, while still printing a plausible-looking `tsc >=1000 (capped)` line
every run. The count was also unstable above the cap (this ticket measured 1030 where the
baseline recorded 1015; tsc 7 checks concurrently, so which diagnostics get reported once
saturated varies run to run) — further evidence the recorded baseline was never a meaningful
comparison point.

This is one half of the same question the engine submodule faces independently: PIPE-53 pinned
`"strict": false` in `uma-skill-tools/tsconfig.json` to keep that repo's own TS 7.0.2 bump a pure
compiler sync, and filed PIPE-59 to adopt strict there deliberately. `uma-tools`' `tsconfig.json`
declares no `include`/`exclude`, so its own `tsc --noEmit` also walks `uma-skill-tools/` sources
under the parent's config — 285 of the parent's 1030 diagnostics are engine-file-prefixed — so
the two tickets are coupled (adopting strict in the engine, PIPE-59, will shrink the parent's
count too) without either one being a substitute for the other's own decision.

Before deciding, the 150 strict-off diagnostics were triaged by hand rather than assumed to be
"just strictness noise": ~45 were mechanical config/declaration gaps (undeclared `CC_GLOBAL`/
`CC_DEBUG` esbuild globals, an unresolved `@tanstack/*` import path, a `SkillSet()` return type
whose ~2100-member skill-id literal union made TS 7 give up comparing it against Immutable's
`Map` overloads, and five `vendor/table-core` diagnostics that only appear under one of the two
strict settings), ~95 are real pre-existing looseness in app code (`umalator/compare.ts`,
`umalator/app.tsx`, `components/SkillList.tsx`, the small apps), and 7 are the engine's own
`tools/` backlog (out of scope for this repo).

## Decision

**Pin `"strict": false` explicitly in `tsconfig.json`** (removing the unchosen-default ambiguity,
not changing runtime behavior — esbuild's own transpilation was never strict-mode-aware), fix the
~45 mechanical config/declaration gaps identified in the Step-0 triage so the count drops to real
looseness only, and re-record `scripts/verify-baseline.json`'s `tsc` field from 1015 to a number
under the cap (104, measured on this branch after the mechanical fixes). The remaining ~104 is
tracked by PIPE-64 (the burn-down), and re-enabling strict *per
flag* — `noImplicitAny` first, then nullability, then `strictPropertyInitialization` — with its
own live baseline at each step (PIPE-65) is the tracked path back to strict, not an assumed one.

## Options considered

1. **Pin `strict: false` and re-baseline (chosen, as the first of two steps).** Cheapest, and the
   only option that fixes the dead regression guard immediately. Cost: ~850 real type problems
   become formally invisible to `tsc`, and adopting strict later gets harder the longer code is
   written without it — mitigated here by not stopping at the pin: the mechanical bucket is fixed
   in the same change, and the per-flag re-enable path is committed to via PIPE-64 (burn-down) and
   PIPE-65 (re-enable) rather than left as a someday.
2. **Adopt strict deliberately, keep it on, and work the ~1030 down over time.** Correct
   long-term, but the diagnostic cap means the baseline cannot be a meaningful regression signal
   until the count falls below 1000 — so the dead check stays dead through most of that work
   unless option 1 is done first and reverted afterward. Rejected as the sole approach for that
   reason, though it's effectively where the per-flag re-enable path arrives once every flag is
   back on.
3. **Split the difference: pin `strict: false`, then re-enable individual strict flags one at a
   time, each with its own live baseline (chosen, as the actual decision).** Slower than option 1
   alone, but every step after the initial pin keeps `verify`'s tsc signal live instead of
   reverting to a capped, dead one. This ticket implements only the pin plus the mechanical
   cleanup; the per-flag sequence is the parent-repo counterpart of PIPE-59 and is tracked as PIPE-65
   so each flag lands as its own reviewed PR with its own before/after count.

## Consequences

- ~850 diagnostics that would report under `strict: true` are formally unchecked by `tsc
  --noEmit` and by `npm run verify`'s tsc stage until each strict flag is re-enabled one at a
  time. This is a real, acknowledged loss of a compile-time signal, not a cosmetic one — the
  PIPE-64 and PIPE-65 exist specifically so this isn't the end state.
- `vendor/table-core/utils.ts` and
  `vendor/table-core/features/column-sizing/columnSizingFeature.utils.ts` now carry small local
  patches (documented in each file's own header comment) so they typecheck under both
  `strict: true` and `strict: false` — upstream TanStack table-core only targets the former. A
  future `vendor/table-core` sync from upstream needs to re-check these two spots.
- `uma-skill-tools`' own `tsconfig.json` strict pin (PIPE-53) and its future strict adoption
  (PIPE-59) are decided independently in that repo; this ADR governs only `uma-tools`' own
  config. Because `uma-tools`' `tsc --noEmit` has no `include`/`exclude` and therefore still
  walks `uma-skill-tools/` sources, the coupling recorded in PIPE-58/PIPE-59 still holds — but
  with both repos now pinned off, only the engine's 7 `tools/` errors (PIPE-66) and one
  `RaceSolver.ts` diagnostic show up in this repo's 104; it matters again when PIPE-65
  re-enables each flag, at which point engine files get checked under that flag from this side
  whether or not PIPE-59 has adopted it.
- `scripts/verify.mjs`'s `TSC_CAP` / capped-diagnostics guard logic (the code, not the baseline)
  is unchanged — it was always the right check; what was wrong was a baseline already past the
  cap it was supposed to detect crossing.

## Amendments

None yet.
