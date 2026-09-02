# ADR-0017: Course Chart compares every candidate against a fixed, skill-less template — normalized aptitude, no HP policy, wit check forced off

**Status:** Accepted
**Date:** 2026-09-02 (UI-23, `umalator/app.tsx`, `Mode.CourseChart`)

## Context

The existing Uma Chart (`Mode.UniquesChart`) ranks native unique skills by swapping candidates
onto Uma 1's *actual* build — its own stats, aptitude, and other equipped skills. That answers
"which unique would help my current build," not "which uma/outfit is objectively a good fit for
this course" — a genuinely different, and arguably more commonly wanted, question. UI-23 adds a
third mode, Course Chart, that answers the second question by decoupling the comparison from Uma
1 entirely: every candidate outfit's native unique is evaluated on one shared, fixed template.

Three modeling questions had to be settled to make that comparison well-defined, each with a
real alternative that was seriously considered:

**1. What aptitude should the template use?** The ticket that filed this mode
(`plans/work-queue/completed/ui-23.md`) originally called for each candidate to keep its own
outfit-specific distance/surface/strategy aptitude grades, matched against the template's stats.
That data doesn't exist in this fork: `umas.json` here is `{name, outfits: {id: epithet}}` — no
aptitude field at all (upstream `alpha123/uma-tools`'s `umas.json` does carry one; this fork's
`make_uma_info.pl`/`make_global_uma_info.pl` never emit it). Building a data pipeline for it was
one option; the alternative, chosen here, is to **normalize aptitude across every candidate** —
matching this repo's own `HorseState` defaults (`S` distance, `A` surface, `A` strategy,
`components/HorseDefTypes.ts`).

**2. Should the template run a real HP policy?** ADR-0009 settled this for the Skill Chart and
Uma Chart: always request `mode: 'compare'`, so every chart run has a real stamina budget. Course
Chart deliberately does the opposite.

**3. Should Skill Wit Check follow the user's Settings toggle, like the other two chart models
do?** Course Chart hardcodes it off instead.

## Decision

**Normalized aptitude.** Every candidate outfit runs with the *same* template aptitude
(`S`/`A`/`A`) regardless of its own real in-game grades. Rationale, in the filing user's words:
"aptitude can be increased via the inheritance mechanic in the game — it doesn't matter too much,
any uma can be used given enough preparation." Aptitude becomes a preparation variable the mode
deliberately holds constant, not a per-candidate fact it tries to model. This also removes the
data-pipeline dependency the ticket's original design would have needed.

**No HP policy** (`buildCourseChartOptions()` in `umalator/app.tsx` omits `mode` entirely, unlike
`buildChartOptions()`'s `mode: 'compare'`). Two engine-side consequences follow from omitting it,
both real and both intentional here, not just the first:
- `RaceSolverBuilder.ts` selects `NoopHpPolicy` — infinite stamina, guaranteed full spurt from
  phase 2, HP-gated skill conditions (`hp_per`, `is_hp_empty_onetime`) can never fire.
- `RaceSolver.ts`'s `posKeepEnd` drops from 10 sections to 3 — the engine's own comment there
  says this shorter window is deliberately the "skill chart" setting, to stop position keeping
  from skewing chart results. Course Chart inherits this the same way the Skill Chart already
  does under its *own* no-op-by-omission history (ADR-0009's Context section) — this isn't a new
  divergence Course Chart introduces, just one that omitting `mode` here reintroduces.

**Skill Wit Check forced off**, independent of the app's Settings toggle. In the filing user's
words: "it will only be simming when each character's unique can proc on a course and how much it
contributes to them winning the race with the set stats, with no hp or wit checks (wit checks for
skill activation)." Deterministic activation once a trigger condition is met — no proc-chance
randomness layered on top of the trigger itself.

## Options considered

- **Per-outfit aptitude via a new data pipeline.** Rejected for now: no `master.mdb`-derived
  source exists in this fork, `make_uma_info.pl`/`make_global_uma_info.pl` would need a new
  field, and both committed `umas.json` files would need backfilling (JP has upstream data to
  port from; Global's 23 staged-unreleased outfits have no upstream JP counterpart proven
  released, adding a second data problem). Normalizing aptitude sidesteps this and — per the
  reasoning above — is arguably the more correct model anyway, not just the cheaper one.
- **Real HP policy** (`mode: 'compare'`, matching ADR-0009). Rejected for Course Chart
  specifically: with every candidate sharing an identical template, a real HP policy adds
  simulation cost and RNG surface without changing which candidate's unique does more — the
  only thing that varies between rows is the unique itself, not the stamina budget it's spent
  against. Kept as the standing rule for the *other* two chart modes (see the amendment to
  ADR-0009).
- **Skill Wit Check follows the Settings toggle**, matching the other two chart models. Rejected:
  this mode is meant to isolate "does the unique's trigger condition and effect matter here," not
  "how often does it survive a wisdom-check roll" — a second source of run-to-run variance the
  design explicitly wanted to remove.

## Consequences

- **Guaranteed full spurt for every candidate.** Any unique with an `is_lastspurt` trigger
  condition activates unconditionally from phase 2 — a systematic advantage over uniques with
  other trigger conditions, and the mode's most significant known modeling distortion (bigger
  than the inert-candidate count below). Measured against the real candidate pool (263 JP
  outfits, 122 Global / 99 released — not the raw 880 rarity-≥4 skill ids): 11 JP and 3 Global
  native uniques carry an `is_lastspurt` condition.
- **A small number of candidates go genuinely inert** (`allZero && procTotal === 0` in
  `chartLadder.ts`'s screening — the ladder correctly reports these as `inert`, not silently
  drops them). Only Global's `100281` (`hp_per<=70`, always true's negation under
  `NoopHpPolicy.hpRatioRemaining() === 1.0`) is inert this way today. This is *not* the same as
  "every recovery skill goes inert": the pool's other recovery-only uniques (JP `100451`,
  `100521`, `110111`; Global adds `110011`) have non-HP trigger conditions, so they still
  activate — with zero effect — and correctly land in the ladder's `screened` bucket instead.
- **No solo-run engine work was needed.** Because baseline and candidate differ *only* by the
  unique (identical stats, identical normalized aptitude, identical no-skill starting point),
  `umalator/compare.ts`'s existing pairwise `runComparisonBlock` already computes exactly the
  right comparison — the bare template *is* the fixed reference opponent. No new solo-simulation
  path, and no `compare.ts`/`simulator.worker.ts` changes, were required.
- Documented as a Limitations entry (`umalator/components/simNotes.tsx`) rather than left
  implicit, per this repo's own doc-sync convention — a user comparing Course Chart's ranking
  against in-game intuition needs to know full-spurt and wit-check are not modeled here.
