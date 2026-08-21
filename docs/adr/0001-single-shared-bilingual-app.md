# ADR-0001: One shared source builds both the JP and Global apps

**Status:** Inherited (rationale reconstructed)
**Date recorded:** 2026-08-21 (design predates this fork)

## Context

The game runs two client versions — JP and Global — with different rosters, courses, skill availability, and localization. A simulator that serves both audiences needs two deployed apps whose behavior differs in known, bounded ways (data files, label language, a few feature gates), while everything else — the simulation wiring, the UI, the charts — is identical by intent.

## Decision

There is **one app source**: `umalator/app.tsx` and its imports. `umalator-global/` contains **no source of its own** — its `build.mjs` compiles `../umalator/app.tsx` with the compile-time define `CC_GLOBAL: 'true'` against the Global JSON data living in `umalator-global/`. Divergence between the two apps is expressed only as branches on `CC_GLOBAL` (stat defaults, label text, feature availability) and as which dataset the build pulls in.

## Options considered

- **A separate Global app (fork or parallel codebase).** Rejected: every fix would need to land twice, and the two apps would drift — the failure mode is observable in a sibling fork that split its app into a legacy version and a rewritten one and now maintains parity tests between them while the legacy one visibly rots.
- **Runtime language/dataset switching in one deployed app.** Not taken (inherited): the datasets differ in shape (JP skill names are `[ja, en]` tuples, Global's are `[en]`), the bundles would carry both datasets, and the compile-time define lets dead branches be stripped.

## Consequences

- Any edit to `umalator/app.tsx` or its imports **affects both apps** — always rebuild both, and grep `CC_GLOBAL` before assuming a change applies uniformly (`CLAUDE.md` hard rule 3).
- The JP app stays first-class for free; there is no "main app" and "port".
- Cross-wiring JP data into a Global build (or vice versa) is a real hazard, because the code branches on `CC_GLOBAL`, not on which JSON happens to be loaded (`CLAUDE.md`'s JP/Global split section).
