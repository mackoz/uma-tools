# ADR-0019: Cooldown re-arm draws spares up front, restricted to two sample-policy families

**Status:** Accepted
**Date:** 2026-09-11 (SKL-21)

## Context

Before SKL-21, a skill with an in-game cooldown could only ever activate once per race in the
simulator — the engine placed one candidate trigger point per skill and dropped it permanently
once it fired or its window passed. The game allows a cooldown-bearing skill to fire again once
its cooldown expires, provided a later candidate point exists. SKL-21 implements that, but the
design space had several points that could reasonably have gone another way, and one of them
(extra RNG draws per skill) is exactly the blocker `plans/fork-comparison/umasim/port-plan.md:19`
names for why this repo hadn't implemented cooldowns yet: "re-fires consume extra RNG draws, which
perturbs the per-skill stream design that the statistical chart depends on — needs a design pass,
not just the formula." This record is that design pass, and a direct extension of
`uma-skill-tools/docs/adr/0005-per-skill-rng-streams.md` (per-skill derived RNG streams), the
engine-side ADR the port plan's blocker refers to.

Two mechanics facts, sourced from `plans/game-mechanics/skills.md:49-54` and
`plans/condition-reference/conditions.md`, shaped every decision below:

- Cooldown scales with course distance, the same way skill duration does:
  `Cooldown = BaseCooldown * CourseDistance[m] / 1000` (`skills.md:49-54`).
- Not every condition family that *could* re-trigger actually does, per the game's own behavior:
  `all_corner_random` places four points total and can re-fire into a later one
  (`conditions.md:125`); the distribution/erlang family's conditions are continuously re-evaluated
  in-game and real replays show genuine re-triggers; `straight_random` resolves to exactly one
  point for the whole race (`conditions.md:1493`) and `is_finalcorner_random` likewise resolves to
  one point on the single final corner (`conditions.md:675`) — neither family re-arms, no matter
  how long the cooldown or how many eligible segments the course has.

## Decision

**Spares are drawn up front, from each skill's own derived RNG stream, not re-sampled at cooldown
expiry.** When a cooldown-bearing skill's sample policy is built, the engine draws one primary
trigger point plus `SPARES` additional candidate points ("spares") in the same batch, from the same
per-skill stream `ADR-0005` already isolates. When the skill's cooldown allows it to re-arm, the
solver (`RaceSolver.ts`'s `rearmSkill()`) shifts the next spare into the active trigger slot — no
new RNG draw happens at re-arm time.

**`SPARES = 3`.** A cooldown-bearing skill gets at most 1 (primary) + 3 (spares) = 4 candidate
points, matching `all_corner_random`'s own four-point roll (`conditions.md:125`) exactly.

**Re-arming is restricted to two sample-policy families, not applied uniformly.** Only
`AllCornerRandomPolicy` and the `DistributionRandomPolicy` family (Uniform/LogNormal/Erlang) ever
receive usable spares; `StraightRandomPolicy` and the final-corner `RandomPolicy` always receive
zero, so a cooldown on one of those conditions can never cause a second activation. This is encoded
in `RaceSolverBuilder.ts`'s `samplePolicyPlacesMultiplePoints()`.

**The distribution family's undershoot is accepted, not chased further.** With the design above,
the simulator's measured re-trigger rate for the distribution family is 1 in 654 procs (0.15%)
against a real-replay rate of 7 in 398 (1.8%) — an undershoot, not an overshoot. The corner family
matches real data exactly on the one course with replay data available (0 re-triggers in both 462
simulated and 475 real procs) — but that match is structural, not evidential: that course's
geometry makes a second corner proc impossible either way (see "Caveat: the corner family's match
is unvalidated on multi-corner courses" below), so it says nothing about the corner family's
accuracy on courses with more corners, where it is unvalidated. The undershoot's cause, confirmed by direct measurement, is structural to drawing spares
independently from the same distribution as the primary: spares cluster near the primary rather than
spreading across the race, and a spare that has already fallen behind the uma's current position by
the time the cooldown would allow it to fire is discarded as a cooling-skip on the very next frame —
so with only 3 spares, most are consumed within a few frames of the first activation, well before
the cooldown actually expires a second time.

**The regression checkpoint baseline moved twice, each time behind the partition test as a guard.**
The checkpoint (`test/regression/checkpoints/`) legitimately changes output for any case touching a
cooldown-bearing skill, so the ordinary "checkpoint matches bit-for-bit" re-record gate couldn't
apply unmodified. `test/regression/cooldown-partition.test.ts` was added as a standing,
committed test asserting that replaying the checkpoint's own recorded non-cooldown cases still
reproduces their recorded results exactly — the narrower guarantee that survives a checkpoint
re-record. The checkpoint was re-recorded once when cooldown re-arm first landed (partition
confirmed 233 non-cooldown cases / 0 diverged against the pre-SKL-21 baseline, reproducible via
`git show c3954ab:test/regression/checkpoints/20260909.5ecc3aa.2432198835.json`), and again when the
distance-scaling correction landed (same test, same non-cooldown-untouched guarantee, re-verified).

**Caveat: the corner family's match is unvalidated on multi-corner courses.** The only course with
real replay data for this family, course `10903` (1600m, 2 corners), necessarily shows 0 re-triggers
in both the simulator and real replays: `tools/replay/cooldownReport.ts`'s own header explains that
its 48s scaled cooldown outlasts its ~31s corner traverse, so a second corner proc is geometrically
impossible there regardless of which model is right. Away from that course the simulated rate is
substantial and has no replay data to validate against. Measured (300 seeded samples, skill `200331`):

| Course | Distance | Corners | Races with a re-trigger |
|---|---|---|---|
| `10903` | 1600m | 2 | 0 / 271 |
| `10606` | 2400m | 4 | 9 / 263 |
| `10105` | 2600m | 6 | 65 / 271 (24%) |

So the corner family's "Exact" match claim above holds only for the single course where the
mechanic can't actually be exercised; treat the 24% rate on a 6-corner course as unvalidated, not
as confirmed-accurate by extension.

## Options considered

- **Re-sample a skill's trigger distribution fresh at the moment its cooldown expires**, instead of
  pre-drawing spares. Rejected: this is exactly the design the port-plan blocker warned about — an
  unbounded, data-dependent number of extra draws per skill, consumed at a point in the race that
  depends on *other* randomness (how fast the cooldown clock actually runs out), which reintroduces
  the stream-coupling problem ADR-0005 eliminated. Pre-drawing a fixed number of spares up front, in
  the same batch as the primary, keeps draw count and stream position a pure function of the skill's
  identity and the policy's own parameters — unaffected by whether, or how many times, the skill
  actually re-arms in a given race.
- **Apply re-arming uniformly to every sample policy**, regardless of family. Rejected by the
  mechanics docs themselves: `straight_random` and `is_finalcorner_random` place exactly one
  candidate point for the whole race, so "spares" for them would be candidates that can never exist
  in the first place, not a modeling simplification. Early experiments (scaling cooldown alone,
  without this restriction) produced corner/straight re-trigger rates that didn't match real replay
  data; restricting by family, per the documented mechanics, is what made the corner family match
  on the one course with available replay data (see the caveat above on how far that match actually
  generalizes).
- **A larger `SPARES` to close the distribution undershoot.** Considered and rejected, but not
  because more spares wouldn't help — they would. Spares aren't competitors for one slot: they're
  drawn i.i.d. from the primary's own distribution, filtered to those after the primary, and burned
  one per frame by `RaceSolver.rearmSkill()` until an eligible one arms, so each additional spare is
  an independent additional chance to land beyond the primary at scaled-cooldown distance. Measured
  directly (skill `201651`, course `10101`, 3000 samples): P(at least one spare lands beyond that
  distance) is 2.27% at `SPARES=3`, 6.9% at 10, and 18.3% at 30 — roughly proportional to the count,
  nowhere near saturating. Raising `SPARES` would therefore measurably raise the distribution
  family's re-trigger rate. The decision to keep it at 3 was made on consistency grounds instead:
  `SPARES=3` already matches `all_corner_random`'s real four-point mechanic exactly, and raising it
  for the distribution family alone would decouple the two families' spare counts from that shared
  constant. A structural fix (spacing spares out, or drawing them conditioned on surviving the
  cooldown) remains a larger, separate design change.
- **Have a still-cooling candidate wait in its window instead of burning a spare.** Shipped
  behavior has `pendingSkillAction()` return `Rearm` (consuming a spare and moving on) for a
  candidate whose cooldown hasn't expired yet; the alternative would have it return `Wait` instead,
  leaving that candidate in place to be re-checked on a later frame once the cooldown clears,
  rather than discarding it as a cooling-skip. The final review built and measured this alternative
  directly (300 seeded samples per cell):

  | Skill | Course | Shipped (`Rearm`) | Alternative (`Wait`) |
  |---|---|---|---|
  | `200331` (corner) | `10903` | 0 | 0 |
  | `200331` (corner) | `10105` | 65 | 66 |
  | `201651` (Slipstream) | `10903` | 2 | 136 |
  | `201662` (distribution) | `10105` | 6 | 182 |

  The corner family is unaffected either way, but the alternative takes the distribution/Slipstream
  family to roughly 50–60% of races re-triggering — a ~30x *overshoot* against the real 1.8% rate,
  versus the shipped design's 12x undershoot. Rejected: an overshoot this large is a worse match to
  the documented real-replay rate than the shipped undershoot, which is what makes "accepted, not
  chased further" (above) a defensible conclusion rather than a shrug — the alternative was measured
  and is worse, not merely unexplored.
- **Leave the regression checkpoint untouched and treat the new behavior as exempt from it.**
  Rejected: cooldown skills make up roughly a quarter of the checkpoint's cases, so "untouched"
  would have meant the checkpoint silently stopped exercising this behavior at all, not that the
  behavior change was compatible with it. Moving the baseline — with the partition test as a
  permanent, narrower replacement guarantee — keeps the checkpoint honest instead.

## Consequences

- Draw count and RNG stream position for a cooldown-bearing skill are fixed at build time, not
  race-outcome-dependent — ADR-0005's common-random-numbers property is preserved for every skill,
  cooldown-bearing or not (confirmed: `cooldown-partition.test.ts`'s 300-case sample of non-cooldown
  cases replays bit-identical against the current checkpoint; 7694 is the non-cooldown partition's
  *size* in the old pre-SKL-21 checkpoint — 10000 cases total, 2306 of them cooldown-involving — not
  itself a replay result).
- A cooldown skill on `straight_random` or `is_finalcorner_random` will never show the benefit of a
  short in-game cooldown in this simulator — same limitation the engine had before SKL-21, now
  scoped explicitly to those two families instead of all cooldown skills.
- The distribution family under-models real re-trigger frequency by roughly 12x (0.15% vs 1.8%).
  `umalator/components/simNotes.tsx`'s LIMITATIONS panel documents this for users; it is not hidden
  behind an aggregate "cooldowns now work" claim.
- `SPARES=3` is a shared constant (`RaceSolverBuilder.ts` and its `prepPacerTriggers()` duplicate),
  not derived from the cooldown/course-distance formula. These are two different claims: for
  achieved *activation count*, it's genuine headroom — per-family activation counts measured across
  both the regression corpus and a real-replay corpus top out at 2 actual activations (of the 4
  candidate points available) on every course tested, and distance-scaling cooldown alongside
  distance-scaling race duration makes that ceiling distance-invariant. For the distribution
  family's *re-trigger probability*, though, it is load-bearing, not headroom — as the Options
  section above measures, raising `SPARES` would measurably raise how often a second activation
  actually lands.
- The checkpoint file at `test/regression/checkpoints/` now has two re-records in this branch's
  history instead of the zero a non-behavior-changing branch would have; recovering the original
  pre-SKL-21 baseline requires `git show` against the merge-base commit, not a file in the working
  tree (see `cooldown-partition.test.ts`'s own header comment for the exact recipe).
