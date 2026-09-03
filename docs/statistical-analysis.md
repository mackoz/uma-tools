# Statistical Skill Chart

How the Skill Chart (`Mode.Chart` / `Mode.UniquesChart` in `umalator/app.tsx`) evaluates candidate
skills: paired race comparisons, an adaptive sampling ladder, confidence intervals, and detail-on-
demand for an expanded row. The same `umalator/app.tsx` source powers both `umalator` (JP) and
`umalator-global` — see [architecture.md](architecture.md) for how the shared source splits on
`CC_GLOBAL`. This describes the implementation on branch `skill-chart-perf-rewrite`, engine commit
`0861c8f`.

The six layers below are chart-only; the **SP-budget optimizer** built on top of them (the Buy
list card) and the **Best-value badge** (a single-skill, chart-wide cost-efficiency callout) each
have their own section further down. Results are estimates from the simulator model, not claims
about live-game outcomes.

## Why this exists

An earlier implementation replaced the chart's original adaptive round ladder with one flat round
at a large, fixed sample count for every candidate skill, with no early elimination. At its
Thorough preset that was 1,600 samples x ~520 candidate skills — about 25x the total work the
original ladder did, most of it spent proving already-obviously-bad skills are bad — pushing a
Thorough/Full-race run to 15-30 minutes and shipping the whole ~1.45 GB result set to the main
thread in one `postMessage` at the very end, leaving the table blank the entire time. This rewrite
restores the "cheap first pass, spend more only on skills that still look competitive" shape,
replaces the previous ladder's `max > 0.1` survival filter with a defensible confidence-interval
rule, and streams results back progressively.

## Paired scenarios and random-stream isolation

Every candidate skill is evaluated against the configured Uma 1 as a baseline in matched
scenarios: for scenario `i`, the baseline and the candidate build share the same underlying race
seed, so the reported value is their difference rather than the difference between two unrelated
groups of races (a common-random-number design). The chart replaces whatever's already equipped in
the candidate's skill group with the candidate itself; already-owned skills in other groups stay
active in both runs (`umalator/simulator.worker.ts`'s `buildCandidateSkills`).

This depends on the engine's per-skill trigger and wisdom-check RNG streams being derived from
stable keys (skill ID, perspective, occurrence index — `uma-skill-tools/RaceSolverBuilder.ts`'s
`deriveSeed` calls), so that adding or removing an unrelated candidate skill from the pool doesn't
shift another skill's trigger draw. Without that, cross-skill ranking would partly be measuring RNG
shuffle instead of the skill's actual effect. `uma-skill-tools/test/activation-sampling.ts` covers
this at the engine level.

One length is 2.5 meters in the comparison output. Finish time is interpolated between the last two
simulator ticks around the finish line rather than using the whole-tick timestamp.

### The pacer trigger fix

`RaceSolverBuilder.buildPacer` used to call `setupPacerSkillTriggers` unconditionally — regenerating
the pacer's entire skill-trigger table from scratch on every single scenario, an O(n²) cost that was
invisible at the previous ladder's low sample counts but added roughly 13% to per-scenario cost at
n=1600. It's now `prepPacerTriggers(pacerSlots, baseSeed)`, called once per race slot before the
scenario loop starts, with `buildPacer` indexing into the resulting table by `i % length` instead of
resampling. This changes numeric output for any race with a virtual pacemaker (Full-race Skill Chart
runs, and Compare mode at high sample counts): scenario `i` now takes trigger index `i` of one fixed
stream instead of a fresh per-scenario stream, which is also what brings the pacer in line with how
the main horses' own triggers already worked. Landed as its own engine commit (`0861c8f`) so the
numeric change is attributable separately from the sampling-stability fix it builds on (`bd95b39`).

## Scenario blocks

Round *r* of the ladder (see below) draws a fresh, disjoint block of scenarios seeded
`roundBlockSeed(baseSeed, r) = (baseSeed + r * 0x9e3779b1) >>> 0` (`umalator/chartLadder.ts`). A
skill's sample set after round *r* is the union of blocks `1..r` — identical for every skill that
reaches that round, independent of which other skills were eliminated along the way. There's no
fast-forwarding or resuming of a stream; every surviving skill has seen exactly the same scenario
families in the same order.

`umalator/compare.ts`'s `runComparisonBlock(block, course, racedef, uma1, uma2, pacer, options)` is
the block-oriented entry point workers actually call:

```ts
export interface ScenarioBlockSpec {
	seed: number;       // block seed == builder seed
	size: number;        // builder nsamples; defines trigger array length
	only?: Set<number>;  // sorted indices to actually simulate (detail fetch); default = all
}

export interface ComparisonBlockOutput {
	lengths: Float32Array;        // n
	times: Float32Array;          // n
	procCounts: Uint16Array;      // n
	procPositions: Float32Array;  // concatenated proc positions across all n scenarios
	traces?: Map<number, ChartRunTrace>;
}
```

`traceMode: 'none'` (used by every screening round) skips building per-tick traces entirely — the
min/max/mean/median trace selection an earlier implementation did per skill per round is gone, since
nothing in the table needs it. `only` skips the step loop for indices the caller doesn't want while
still advancing both generators, so RNG stays aligned with a full run of the same block. `runComparison`
(the original, non-block API Compare mode uses) is now a thin wrapper over the same code path, so
Compare mode's own numeric output is unaffected by this rewrite except through the pacer fix above.

Wire cost is roughly 14 bytes/sample (4+4+2 length/time/procCount, plus a few bytes of proc
positions), all buffers passed as `Transferable`s in the `postMessage` transfer list — a full
Thorough run ships on the order of a couple of MB total across all four workers, not the ~1.45 GB
the flat-N implementation could produce.

## The adaptive ladder (`umalator/chartLadder.ts`)

```ts
export const CHART_LADDERS: Record<AnalysisPresetName, LadderPreset> = {
	quick:    { rounds: [{n:32,cap:Infinity},{n:128,cap:96},{n:384,cap:24}],
	            targetPool: 16, bootstrapSamples: 1000, precisionTarget: 0.03,
	            screenZ: 3.5, minInterestingGain: 0.05 },
	balanced: { rounds: [{n:48,cap:Infinity},{n:192,cap:128},{n:768,cap:32}],
	            targetPool: 20, bootstrapSamples: 2000, precisionTarget: 0.02,
	            screenZ: 3.5, minInterestingGain: 0.05 },
	thorough: { rounds: [{n:64,cap:Infinity},{n:256,cap:160},{n:1024,cap:40},{n:3072,cap:12}],
	            targetPool: 24, bootstrapSamples: 2000, precisionTarget: 0.015,
	            screenZ: 3.5, minInterestingGain: 0.05 },
};
```

`screenZ` and `minInterestingGain` are per-preset fields (all three start from the same defaults)
rather than module constants, so that the Pruning slider below can scale them independently of the
Preset selector's round-depth knobs.

Only round 1 is O(K) over every candidate; every later round holds `cap x delta-n` roughly constant,
so total work is linear in the number of rounds — logarithmic in the top-end sample count, not
linear in it. Worst-case total scenario counts at K=520 candidates: Quick ~32,000, Balanced ~61,800,
Thorough ~119,300 — versus the flat-N implementation's Thorough at 832,000, and comparable to the
original ladder's own ~33,000 at Quick.

### Elimination rule (`evaluateRound`)

Run at each round boundary, over cumulative samples, in this order:

1. **Inert** — every paired difference is exactly zero and the skill never proc'd across every
   sample so far. Dropped unconditionally. With the engine's stable trigger derivation, a
   never-proccing candidate produces bit-identical runs, so this is exact rather than a threshold.
2. **Gate** = `max(0.05, kthBestLcb)`, where `kthBestLcb` is the `targetPool`-th largest lower
   confidence bound in the pool and 0.05 lengths is a fixed "not worth considering" floor.
3. **Protect** — the current top `targetPool` skills by mean are never eliminated by steps 4-5,
   regardless of how their interval compares to the gate.
4. **CI elimination** — drop if the upper bound is below the gate and the skill has at least 24
   cumulative samples (below that, the variance estimate is considered too noisy to eliminate on).
5. **Converged** — if the interval half-width (at the screening z-score) is already at or under the
   preset's `precisionTarget`, freeze as `final` without spending the ladder's remaining rounds on
   it. Near-deterministic skills stop early.
6. **Budget** — if survivors still exceed the round's cap, keep the top `cap` by upper bound
   (optimistic, so a skill that's merely had an unlucky sample run so far isn't unfairly dropped).

The screening bound uses `z_eff = screenZ * sqrt(1 + 2/n)` (`screenZ` defaults to 3.5 in every
preset), documented in `chartLadder.ts` as a screening bound, not a claim of simultaneous 95%
coverage across the whole candidate pool — a real Bonferroni correction across ~500 arms would
need z ~ 4.2, wide enough that this rule would eliminate almost nothing and the round cap would end
up doing all the actual work. 3.5 is the deliberate, documented compromise.

Eliminated skills still show a number in the table — the one from however many samples they got —
with `status` (`screened`, `inert`, `final`, `refining`, `pending`) rendered as a visual tier (muted
row styling for screened/inert/pending) and an `n` column, with the elimination reason in the row's
tooltip. This is a genuine improvement over both prior implementations: the original ladder showed
25-sample min/max with no confidence signal for eliminated skills, and the flat-N implementation
showed nothing at all for the whole run.

### Pruning: adjusting elimination speed (`derivePreset`)

The Preset selector (Quick/Balanced/Thorough) only controls sample *depth* — the `rounds[i].n`
values. A separate **Pruning** slider (0-100, default 50) controls how quickly a skill stops being
sampled, by deriving a scaled `LadderPreset` from whichever base preset is selected:
`derivePreset(CHART_LADDERS[analysisPreset], pruning)`. Let `t = (pruning-50)/50`, so `t` ranges
-1 (most aggressive) to +1 (most lenient) and is exactly 0 at the default:

| Field | Derivation | @0 (Aggressive) | @50 (Standard) | @100 (Lenient) |
|---|---|---|---|---|
| `screenZ` | `base + t * 1.0` | 2.5 | 3.5 | 4.5 |
| `targetPool` | `max(4, round(base * 2**t))` | ×0.5 | ×1 | ×2 |
| `rounds[i].cap` (finite only) | `round(base * 2.5**t)` | ×0.4 | ×1 | ×2.5 |
| `precisionTarget` | `base * 2**(-t)` | ×2 | ×1 | ×0.5 |
| `minInterestingGain` | `base * 2**(-t)` | ×2 | ×1 | ×0.5 |

`rounds[i].n`, `rounds[0].cap` (always `Infinity`), and `bootstrapSamples` are never touched —
sample depth stays the Preset selector's job, so the two controls stay independently explainable.
The ramps are centered so `t = 0` is an exact identity (not a special-cased shortcut at
`pruning === 50`): `derivePreset(preset, 50)` reproduces `preset` field-for-field, verified by a
dedicated test in `chartLadder.test.ts`. A round's `cap` is deliberately *not* clamped to
`targetPool` — `CHART_LADDERS.thorough`'s own last round already caps below its `targetPool` (12
vs 24) by design, since the budget rule is allowed to narrow past the protected pool on a final
round, and clamping would break the identity at the default for that preset.

Lower Pruning values finish faster and are more likely to cut a skill that would've turned out
fine; higher values keep marginal skills sampling longer at the cost of runtime. The estimated-
runtime hint next to the controls (see below) reflects the derived preset, not just the raw
Preset selection, so the added cost of a more lenient setting is visible before pressing Run.

## Statistical summaries (`umalator/statisticalAnalysis.ts`)

For a paired length sample `d[1..N]`:

- **Mean** — arithmetic mean of the paired length differences.
- **95% CI** (`meanCI`) — see below; `ciMethod: 't' | 'bca'` records which construction produced it.
- **Typical P10-P90** — empirical 10th/90th percentiles, linearly interpolated between order
  statistics.
- **Helps / ties / hurts** — `d > 0.01`, `-0.01 <= d <= 0.01`, `d < -0.01` respectively.
- **Help interval** (`helpCI`) — Wilson 95% binomial interval on the help rate.
- **Proc rate** — fraction of paired scenarios with at least one tracked-skill activation, with its
  own Wilson interval (`procCI`).
- **Conditional gain** (`conditionalMean`) — mean length gain among only the scenarios where the
  tracked skill actually proc'd.
- **Time mean** — mean of interpolated finish-time difference.

### Two interval constructions, deliberately confined

The paired length-gain distribution is generally right-skewed — mostly at or near zero, with a tail
on the scenarios where the tracked skill happened to activate usefully — so a plain symmetric
interval on the mean tends to mislocate the interval for exactly the skills worth evaluating. BCa
(bias-corrected and accelerated) bootstrap corrects for that, but an O(n x bootstrapSamples) resample
is only worth paying for the small number of skills that survive the ladder to a final round:

- **Screening rounds never bootstrap.** Every round before a skill's last uses the O(n) normal-
  approximation interval (`normalApproxInterval`) — bootstrapping every candidate on every round was
  the single largest wasted cost in the flat-N implementation, after the simulation itself.
- **BCa runs once**, only when a skill reaches `final` status — typically 12-40 skills, not 520.
- **B = 2000**, not 5000. Monte Carlo error scales as `1/sqrt(B)`; 5000 buys 1.58x less noise for
  2.5x the cost, and that noise is already an order of magnitude below the interval's own width.
- **Per-skill bootstrap seeding.** Each skill's bootstrap resample uses its own derived seed (keyed
  off the skill ID) rather than one seed shared across every row, so adjacent rows' Monte Carlo
  errors aren't perfectly correlated the way they'd be under a single shared seed.

`ciMethod` is surfaced as a tooltip on the Gain column so a `t`-interval and a `bca`-interval — two
different constructions — are never read as the same kind of number.

### Reading the two ranges

| Display | Question | What more samples do |
|---|---|---|
| P10-P90 | How much do individual race outcomes vary? | Estimate the stable outcome distribution more clearly; the range itself doesn't inherently shrink. |
| 95% CI | How uncertain is the estimated mean? | Narrows the interval around the expected gain. |

A wide P10-P90 range isn't a bad estimate — it can be a precise estimate of a genuinely inconsistent
skill. A narrow P10-P90 range doesn't make a small mean strategically important.

## Detail on demand

The main thread already holds each skill's full `lengths` array via `SkillAccumulator` (which tracks
mean/variance incrementally and lazily concatenates its chunked sample arrays only when a summary is
actually needed), so it knows the exact sample indices for the min, max, mean-closest, and median
runs — and which `(blockSeed, blockSize)` block each came from, via `SkillAccumulator.resolveIndex`.
Expanding a row therefore re-simulates just those specific scenarios rather than retaining or
streaming full per-tick traces for all ~520 candidates up front:

```
// main -> worker
{ msg: 'chart-detail', data: { jobId, requestId, skillId,
    picks: [{ label:'minrun'|'maxrun'|'meanrun'|'medianrun', blockSeed, blockSize, index }, ...],
    course, racedef, uma, pacer, analysisOptions }}
// worker -> main
{ type: 'chart-detail', jobId, requestId, skillId, runs: { minrun, maxrun, meanrun, medianrun } }
```

`runChartDetail` (`umalator/simulator.worker.ts`) groups picks sharing a `(blockSeed, blockSize)`
into one `runComparisonBlock` call — normally one call, not four, since a detail fetch's picks are
usually from the same round's block. Because a low-variance skill can easily have two or more of its
min/max/mean/median picks land on the exact same sample index (the closest-to-mean sample often *is*
the median one), the grouping keys labels as `Map<index, string[]>` rather than `Map<index, string>`
— a single-string map would silently let the later label overwrite the earlier one and drop a trace
like `meanrun` entirely for that skill.

The two bar charts (`LengthDifferenceChart`, `ActivationFrequencyChart`) need no detail fetch at all
— they're pure functions of `(procPositions, lengths)`, which the main thread already has from the
accumulator, so `synthesizeAllRuns` builds the shape those components already expect and they render
instantly on expand. Only the velocity chart, which needs a real per-tick trace, waits on the detail
round trip (typically well under a second: ~20-35 ms of actual simulation for up to 4 scenarios, plus
worker/postMessage overhead).

## Worker pool and cancellation

`umalator/workerPool.ts`'s `createWorkerPool(size, url)` replaces an earlier pattern that called
`useMemo` from inside a `.map()` callback (`[1,2,3,4].map(_ => useMemo(...))`) — a rules-of-hooks
violation that happened to work only because the array length was a hardcoded constant, and whose
message handler closed over `[]` so it could never see fresh component state without a ref escape
hatch. The pool owns worker lifecycle only; its message handler is swapped via `setHandler()` on
every render so it's always the latest closure and never goes stale across a respawn.

Batches stream back in chunks (`chart-batch-chunk`, flushed every >=32 rows or >=200ms) rather than
one message at the end, with `chart-batch-done` reporting `{elapsedMs, scenariosRun}` so the main
thread maintains a running ms/scenario estimate (used both for the run-settings row's estimated-
runtime hint and for adaptively sizing future batches). A per-skill try/catch means one bad skill
posts `chart-error` and gets skipped rather than killing a multi-minute run outright.

**Stop** calls `cancelAll()`: every worker is `terminate()`d and eagerly respawned. This is real
cancellation, not the earlier stale-job-ID approach where a superseded run's workers kept burning
CPU in the background after their results were simply ignored. Cooperative in-loop cancellation
isn't viable here — a worker mid-race is in a synchronous step loop and can't poll for a cancel
message until it yields, and the `SharedArrayBuffer`/`Atomics.wait` alternative needs COOP/COEP
headers GitHub Pages can't set (see [deployment.md](deployment.md)).

## The two analysis models

This section covers the **Skill Chart** and **Uma Chart** — the two modes built on
`buildChartOptions()`. **Course Chart** (UI-23) has its own, deliberately different, `mode`/
`skillWisdomCheck` semantics; see the Course Chart section below and
[ADR-0017](adr/0017-course-chart-neutral-template.md).

Both of these two models request `mode: 'compare'` from the engine, which is what gates
`GameHpPolicy` (`RaceSolverBuilder.ts`) instead of the no-op HP policy an omitted `mode` produces.
Real HP means recovery (HP-only) skills have an actual budget to act on and are rankable in both
models, so neither model excludes them from the candidate list (`isHpOnlySkill` still exists in
`BasinnChart.tsx` for anything that wants to identify a recovery skill, e.g. the icon filter — it's
no longer used to exclude candidates). Skill Wit Check follows the user's own Settings toggle
(`skillWisdomCheck`) in both models rather than being hardcoded, so Expected gain reflects this
uma's real wisdom-check proc chance.

| | Controlled (default) | Full race |
|---|---|---|
| `mode` | `'compare'` — real HP/spurt/recovery | `'compare'` |
| `skillWisdomCheck` | user's Settings toggle (default on) | user's Settings toggle |
| Position keeping | forced Approximate | user's setting |
| `pacemakerCount` | 1 | user's setting (Virtual pacer count) |
| Rushed / dueling / compete fight / lead competition | off | user's settings |
| Lane movement | off | off (not exposed as a user setting anywhere in this app yet) |

So the model switch governs only the multi-uma jostling flags and position keeping; HP and wisdom
are real in both, with wisdom under direct user control via the Settings pane (see below). This is
built by a single `buildChartOptions(analysisMode)` in `app.tsx`, replacing three separately
maintained copies an earlier implementation had (one of which silently dropped
`competeFight`/`leadCompetition`/`duelingRates`/`laneMovement`, so its "Run Additional Samples" path
could merge physically different races into an existing result).

### Course Chart's model — same split, different `mode`/wit-check defaults

Course Chart reuses the same Controlled/Full-race split (and the same `analysisPreset`/pruning
controls), but through its own `buildCourseChartOptions(analysisMode)`, not
`buildChartOptions(analysisMode)`:

| | Course Chart (both models) |
|---|---|
| `mode` | omitted — `NoopHpPolicy`, and (a second consequence of the same omission) `RaceSolver.ts`'s `posKeepEnd` drops from 10 sections to 3 |
| `skillWisdomCheck` | hardcoded `false`, regardless of the Settings toggle |
| Position keeping / `pacemakerCount` / jostling flags | same Controlled/Full-race split as the table above |

The Skill Wit Check Settings card itself (see below) is not shown at all in Course Chart, rather
than shown-but-forced-off, since a visible toggle that does nothing would be misleading.

## Skill Wit Check toggle

The toggle already existed for Compare mode (`skillWisdomCheck`, backed by a `useReducer`, already
serialized into the URL and localStorage) but its whole Settings card was gated on `mode ==
Mode.Compare`. Chart mode now renders its own `Simulation` settings card containing just this one
row, reusing the same state, reducer, and CSS as Compare mode — so it behaves identically (persists
across reloads, round-trips through a shared link) with no new persistence keys. The other Compare-
only toggles (Sync RNG, Rushed/Kakari, Spot Struggle, Dueling) stay Compare-only: Sync RNG is
meaningless for a chart (paired scenarios are always synced), and the other three are exactly what
the Controlled/Full-race model switch above already governs — exposing them separately would create
two controls fighting over the same flags.

## Using the Skill Chart

1. Configure Uma 1 (baseline) and the race in the usual panes, then choose the **Skill Chart** tab.
   For each row, the app replaces whatever's already equipped in that row's skill group with the
   candidate, and compares that build against the unchanged baseline; already-owned skills in other
   groups stay active in both runs.
2. Use the **Rarity** row and the skill-icon **Type** filters above the run settings to narrow the
   candidate pool before running, if only certain categories matter — filtering reduces total work.
   Rarity is single-select — **All** (default), **Normal**, **Rare**, **Unique**, and, on the JP
   build only, **Evolved** (Global has no evolved skills yet, so that option doesn't appear there).
   **Unique** here means the ~250 `9xxxxx` *inherited* unique skills (e.g. "Warning Shot! (inherited)")
   — a character's own (non-inherited) unique skills never enter the candidate pool in the first
   place, since the Skill Chart's candidate list only includes general skills (`rarity < 3`) and
   character uniques are rarity 3/4/5 (see `uma-skill-tools/RaceSolverBuilder.ts:301-302` for why
   1★/2★ uniques, 1★/2★ upgraded to 3★, and naturally-3★ uniques all carry different raw rarity
   values) — so **Unique** is the only rarity option that reaches them. Both the
   Rarity and Type filters can be *narrowed* after a run without re-running — matching rows hide
   immediately — but because Rarity is single-select, switching to a different rarity or widening
   back to **All** does mark the chart dirty until you press Run again (Type's icon filters, being
   multi-select checkboxes, only ever need a re-run when you add a type back in).
3. Alternatively, click the **Shop Skills** button on the **Shop skills** row to open a picker
   pre-narrowed to skills that can actually activate on this course for this uma's run style —
   check "Show all skills" to see every general skill instead — and pick the exact set your career
   run's shop screen is offering; the button itself reads "Shop Skills — N Selected" once you've
   picked any. A running view of the shortlist lives in a panel to the picker's right, split into
   "In the pool" and "Won't activate here" sections — a skill in the latter renders dimmed and
   struck through with an explanatory tooltip rather than silently vanishing from the pool. Any
   non-empty shortlist replaces Rarity/Type entirely (both rows grey out with a note) rather than
   composing with them: the shortlist *is* the filter, and clearing it (the row's own **Clear**
   button, or the panel's **Clear all**) returns Rarity/Type to normal. Picking a skill that has a
   shop prerequisite — e.g. a gold skill built on top of a white one — automatically adds that
   prerequisite too, shown indented beneath it in the panel; removing a prerequisite cascades up
   and removes everything shortlisted on top of it, since the shop itself never lets you hold the
   one without the other. Like Rarity/Type, removing a skill from the shortlist is a free
   client-side narrow — a re-run is only needed for a *new*, viable addition. The shortlist is a
   work-scoping knob (`localStorage` only, like Rarity/Type below), not part of the race
   definition, so it doesn't ride along in a shared link.
4. Pick **Model** (Controlled or Full race), **Preset** (Quick / Balanced / Thorough), and
   **Pruning** (0-100, default 50 — see the Pruning subsection above) in the run-settings row above
   the table — these are reachable before a run has happened, unlike an earlier implementation
   where they lived inside the results pane and only rendered once `tableData.size > 0`. An
   estimated-runtime hint next to Run reflects the current Pruning-derived preset, using the
   ladder's worst-case scenario count and the last measured ms/scenario rate.
5. If Skill Wit Check matters to the comparison, set it in the left Settings pane before running.
6. Press **Run**. The table populates progressively as each round's batches stream back; sort by any
   column. **Stop** halts within a couple of seconds and keeps whatever partial results exist.
7. Expand a row for detail: total samples, help/tie/hurt mass, the activation-position effect chart,
   and the velocity trace for that skill's min/max/mean/median runs. **Refine** queues one more block
   of samples for just that row.
8. Double-clicking a row adds that skill to Uma 1's build and marks the chart stale — rerun after
   changing the baseline.

Changing Model, Preset, or Pruning does not automatically rerun existing results — press Run again.

## Using the Course Chart

Course Chart (UI-23) answers a different question from the other two chart modes: not "what
should *I* add to my build," but "which uma/outfit's own native unique is a good fit for this
course and run style" — see [ADR-0017](adr/0017-course-chart-neutral-template.md) for the full
modeling rationale. It's reached via its own tab next to Skill Chart/Uma Chart and is completely
independent of Uma 1 — editing Uma 1's stats or skills has no effect on it and never marks it
dirty.

1. Configure the race (course, ground, weather, etc.) in the usual panes, then choose the
   **Course Chart** tab. Uma 1/Uma 2 do not need to be configured for this mode.
2. Pick one of the four **run-style tabs** (Nige / Senkou / Sasi / Oikomi) — each is its own
   independent ladder, run separately, using that style's own starting-order range in addition to
   the strategy itself. Switching tabs while idle restores that style's own cached results (if
   it's been run) rather than re-running; an unrun style shows a prompt instead of a table, but
   the tab row itself always stays visible so every style is reachable regardless of which ones
   have been run.
3. Every candidate — one row per released outfit's native unique, gated by the **Show Unreleased
   Umas** Settings toggle the same way the other chart modes' pools are — runs against an
   identical fixed template (`1500/1200/1200/600/1200` speed/stamina/power/guts/wisdom, `S`
   distance / `A` surface / `A` strategy aptitude, no other skills). Each row's label is the
   candidate's own outfit epithet followed by its character's name (e.g. "[Starlight Beat] Oguri
   Cap"), not the unique's own name — since Course Chart's pool is one row per outfit, not per
   character, and the point of the mode is comparing umas, not skills; two outfits of the same
   character with different unique skills both appear, distinguished by epithet. The unique's own
   name and full condition are still available by clicking a row's info icon.
4. Pick **Model**, **Preset**, and **Pruning** the same way as the Skill Chart (see above) — the
   Skill Wit Check Settings card does not appear in this mode, since it's hardcoded off here
   regardless (see ADR-0017); there is nothing to configure for it.
5. Press **Run**. Only the selected style tab is computed — the ladder, streaming, sort, and
   **Refine** behavior are otherwise identical to the Skill Chart. Changing the course, race
   conditions, Model, Preset, Pruning, or the unreleased-uma toggle marks every style's cache
   stale (⟲ appears on whichever style you're viewing) the same way editing Uma 1 marks the Skill
   Chart stale — a re-run is needed per style you want refreshed.
6. Expanding a row shows the same detail view as the other chart modes, minus a **Show HP**
   toggle — Course Chart never tracks HP (ADR-0017), so there's no HP series to plot.

A row whose unique's trigger requires a *different* skill to have already activated (UI-34; the
`ADR-0017` amendment has the full rationale) carries a **Conditional** badge next to the skill
name. Since each candidate carries only its own native unique, that trigger can never be
satisfied literally — the chart models an approximate activation point instead of leaving the
row stuck at a permanent 0%. Hover or focus the badge for what it means; click the row's info
icon for the unique's real, full condition text.

## SP-budget optimizer (Buy list card)

Once the Shop Skills shortlist (step 3 above) is active, a **Buy list** card renders above the
chart table in Mode.Chart; the SP budget field it optimizes against sits in the Shop skills
filter row itself (`ShopSkillFilter.tsx`, next to the Clear button — appearing with it whenever
the shortlist is non-empty). This is UI-16's MVP: a lightweight,
purely-additive optimizer over the chart's own measured means, not the full re-simulating design
originally scoped for the ticket (see "Deferred to a follow-up branch" below, and
`docs/adr/0015-sp-optimizer-additive-knapsack.md` for why).

- **Hint levels are shared per skill, not per shop rung.** In game, a hint is earned for the
  *skill* and discounts every purchase step of it — so a ○/◎ pair (the same skill's two shop
  rungs) shares one 0–5 hint-level field; gold skills are separate cards with their own hints.
  `umalator/spOptimizer.ts`'s `buildHintClusters` derives the sharing rule from the data: two
  rungs share a hint iff they're the same `SKILL_LADDER` group AND the same rarity (cluster key
  `${groupId}:${rarity}`; an id outside the ladder keeps its own id as its key). This is
  corroborated by `master.mdb`'s `single_mode_hint_gain` table: `hint_gain_type` 0 (partner-hint)
  rows exclusively target rate-1 rarity-1 base skills on both clients (Global 177/177, JP
  371/371) — a hint never attaches to a ◎/gold/evolved rung directly, so a ◎'s discount always
  derives from its base skill's hint. Each skill chip in the Shop Skills panel
  (`umalator/components/ShopSkillPanel.tsx`) still gets a 0–5 hint-level field, but only the
  *owner* row of each cluster renders one — the first row in the panel's render order (see
  `ShopSkillPanel.tsx`'s owner rule); every other row of the same cluster shows a tooltip
  pointing at the owner instead. Typing a digit sets the field and moves focus to the next
  `.shopSkillHint` field in DOM order; the arrow keys increment/decrement in place.
  `components/SkillPicker.tsx`'s modal-wide keydown handler early-returns while a hint field is
  focused, so it doesn't hijack the arrow keys (grid navigation) or Escape (close modal)
  mid-entry. Hint levels persist to `localStorage` under `chartShopSkillHints`, keyed by cluster
  (`umalator/spOptimizer.ts`'s `loadShopSkillHints`/`HintLevels`/`remapHintKeys` — the last of
  these migrates old per-id persisted data to cluster keys on load), and are pruned automatically
  whenever the shortlist shrinks. `expandHints` fans a cluster-keyed hint back out to a per-id map
  before it reaches the optimizer below, since `buildGroups` still charges every rung
  independently via `hints[id] ?? 0`.
- **The knapsack (`umalator/spOptimizer.ts`, kept import-free like `chartLadder.ts` and
  `shopSkillFilter.ts` so it's plain-node testable).** Candidates are the shortlist's skills that
  have a real measured gain from the last chart run (`tableData`'s per-row `statistics.mean`) and
  aren't already owned. Candidates are grouped by `SKILL_LADDER` group (ADR-0013's `rarity <= 2`-
  gated upgrade ladder); each group becomes a set of mutually exclusive "tiers" — buying a rung
  also buys every lower-rate rung of the same group not already owned, at a total SP cost
  discounted per-skill by `HINT_DISCOUNT = [0, 0.1, 0.2, 0.3, 0.35, 0.4]` (hint levels 0–5) via
  `discountedCost`. The curve is ported from the earlier prototype and matches
  community-documented shop discounts; it is not stored in `master.mdb` (checked — the hint
  tables there encode hint targets, not the discount percentages). A tier's gain is just its terminal (highest-rate bought) rung's own
  chart-measured mean — gains are never summed within one ladder group, since only the rung
  you'd actually end up equipped with contributes to the build.
- An exhaustive DFS enumerates every budget-feasible combination of "buy one tier (or nothing) per
  group," bounded only by the SP budget and a defensive `NODE_CEILING` (20,000,000 node visits) —
  no gain-based or dominance pruning (see the ADR for why dominance pruning is unsound once more
  than one result is wanted). Hitting the ceiling stops the search early and sets `truncated` on
  the result; the Buy list card then notes the options may be incomplete instead of presenting
  them as optimal. Results are sorted by (total gain desc, total cost asc) and up to
  `topK` (default 3) are accepted greedily, each required to differ from every already-accepted
  result by a symmetric difference of at least 2 skill ids — the diversity rule that keeps the
  three options from being near-duplicates of each other.
- `umalator/app.tsx` recomputes this via a `useMemo` keyed on the candidate list, hints, budget,
  and owned skills, frozen (via a ref) while a chart run is streaming so it doesn't re-run the DFS
  on every incoming batch — it recomputes once when the run's final `tableData` lands.
- Clicking an option (`umalator/components/SpOptimizerCard.tsx`) highlights its rows in the chart
  table: `BasinnChart` gets a new `highlighted` prop (a `Set` of skill ids) rendering a
  `.basinnChartHighlighted` class, declared before `.expanded` in `BasinnChart.css` so an
  expanded+highlighted row keeps the expanded row's `--highlight-green` rather than stacking a
  second background on top of it.
- Selecting an option also pops a **detail overlay** (`.spOptimizerDetail`) anchored to the strip
  and expanding *upward* (`bottom: calc(100% + 6px)`) rather than laid in-flow above or below it —
  either in-flow placement would push the chart table down, and the table's row count is exactly
  what the one-row strip redesign above was protecting. The overlay restores the pre-strip card's
  content (rank badge, big "Est. +X.XX lengths", "N SP · M skills" header, one rarity-bordered
  icon + name row per skill) plus a per-skill **hint-discounted SP cost**, right-aligned on each
  row — the one number nothing else in the UI surfaces (the strip's tooltip has names only; the
  table has gains, not costs) — computed by a `costOf` prop app.tsx supplies from
  `discountedCost(SKILL_BASE_COST[id], expandedShopHints[id])`, the same discount the optimizer
  itself charges, so the rows sum to the header's total SP. It scrolls internally past ~320px/50vh
  (`#mainContent` is the one clipping ancestor in this pane) instead of truncating when the
  splitter is dragged up, and closes on Escape, on selecting the option again, or on any click
  outside `.spOptimizerStrip`.
- **Every gain shown is an estimate**, stated in a code comment and in the strip's ⓘ tooltip
  (demoted from an always-visible footnote when the card became a one-row strip — the strip's
  whole point is giving its former height back to the table): `optimizePurchases` sums each
  shortlisted skill's individually measured chart gain: it does not re-simulate the combination,
  so skills that interact (positively or negatively) when equipped together aren't reflected.
  An option button's tooltip lists its full skill set (the icon strips the old card layout
  carried are gone — selecting the option highlights the same skills as table rows). Rows the
  ladder eliminated early (`isMutedRow`) additionally sort below every surviving row in the
  default Gain-descending view, so the visible rows at the default pane height are the ones
  that matter.
- Budget persists to `localStorage` under `chartSpBudget`, same work-scoping-knob treatment as
  `chartShopSkills` below — not part of the serialized race state or shared URLs.

## Best-value badge

UI-33 answers a different question than the Buy List optimizer above: not "what's the best
combination under my SP budget," but "which single skill, out of everything charted, gives the
most length per SP spent?" A **Best value** badge renders on that one row's skill-name cell in
`BasinnChart.tsx`, with a hover/focus tooltip giving the exact gain, SP cost, and per-100-SP ratio
(no new column, no layout resize).

- **Scope is chart-wide, not shortlist-scoped.** Unlike the optimizer's `optimizerCandidates`
  (only ever the small Shop Skills shortlist), the badge's candidate pool
  (`bestValueCandidates` in `umalator/app.tsx`) scans every row `tableData` currently has, in
  `Mode.Chart` only — Unique skills aren't shop purchases, so the Uniques Chart and Course Chart
  tabs never show a badge. The two tabs get there differently: the Uniques Chart shares the
  Chart-mode `<BasinnChart>` call site (`app.tsx`'s `bestValueId={bestValue?.id ?? null}`) and
  reads as `null` there because `bestValueCandidates` is `[]` outside `Mode.Chart`; Course Chart
  renders through its own separate `<BasinnChart>` call site that omits the `bestValueId`/
  `bestValueTooltip` props entirely.
- **Muted rows are excluded.** Because this scans the *whole* chart rather than a short curated
  list, an early-round noisy mean from a `screened`/`inert`/`pending` row (`BasinnChart.tsx`'s
  `isMutedRow`, exported for this reuse) must not win an unprompted "best in the whole chart"
  claim the way it might slip past on a five-row shortlist.
- **Cost is the full chain cost-to-reach**, exactly like the optimizer's chain-cost semantics: a
  gold (◎) rung's cost includes every unowned cheaper rung in its ladder group. `spOptimizer.ts`'s
  `findBestValue` computes this via `shopSkillFilter.ts`'s `prerequisitesOf` (the *exclusive*
  chain — everything strictly below the candidate on its ladder) rather than reusing
  `optimizePurchases`' internal `buildGroups`, which builds an *inclusive* chain for a different
  purpose (tier selection, not a single best-value ratio) and isn't a drop-in fit here. Hint
  discounts apply per rung the same way (`discountedCost`), and an owned prerequisite contributes
  nothing to the cost.
- **Zero-cost guard.** 13 rarity<3 JP skills (and some Global ones) have `baseCost: 0` in
  `skill_meta.json`; a candidate with non-positive gain or non-positive chain cost is ineligible,
  so this can never divide by zero or crown a free skill "best" by an undefined/infinite ratio. If
  no candidate qualifies at all, no badge renders.
- **Ties** break by (ratio desc, cost asc, id asc) — deterministic across re-renders and reloads.
- **Freezes during a streaming run**, mirroring `purchaseOptionsRef`'s pattern exactly: a
  `bestValueRef` holds the last-computed `BestValue` while `isSimulationRunning` is true, and
  `findBestValue` only re-runs once a fresh run's final `tableData` lands — otherwise the whole-
  chart scan would re-run on every incoming batch.
- No `CC_GLOBAL` branch is needed: `baseCost` is present on every skill in both `skill_meta.json`
  datasets (verified 2119/2119 JP, 737/737 Global), so the zero-cost guard above is the only
  behavior that depends on it, and that guard is data-driven, not build-driven.

## Reproducibility

Same race setup, Uma, Model, Preset, Pruning, seed, and Skill Wit Check setting reproduce an
identical chart — the BCa bootstrap is seeded per skill (deterministic given the skill ID and base
seed), not just the underlying race simulation. `analysisMode`, `analysisPreset`, `chartPruning`,
`chartRarityFilter`, `chartIconFilter`, and `chartShopSkills` are all stored in `localStorage`
only (work-budget/candidate-pool knobs, not part of the race definition) -- `chartShopSkills` is
active whenever it's non-empty (UI-28 dropped the separate `chartShopSkillsEnabled` toggle key);
`skillWisdomCheck` is part of the serialized race state and shared URLs, same as it already was for
Compare mode.

## Verification

```sh
npm run test                             # statisticalAnalysis.ts, chartLadder.ts, shopSkillFilter.ts, spOptimizer.ts, racePresets.ts, and histogramData.ts unit tests (vitest run)
npm --prefix uma-skill-tools test        # engine tests, including activation-sampling stability
cd umalator && node build.mjs            # JP app build
cd umalator-global && node build.mjs     # Global app build
npm run build                            # all seven maintained apps
```

`npm run test:stats` is kept as an alias for `npm run test` for anyone with the older command
memorized.

## Deferred to a follow-up branch

The SP-budget optimizer above is a deliberately lightweight MVP of UI-16's original heavier
design (see `docs/adr/0015-sp-optimizer-additive-knapsack.md`). Still deferred:

- **Finalist full-set re-simulation** — running each top option (and enough runner-ups to know
  they're not actually better) as its own full sample batch through the worker pool, with all of
  the option's skills equipped together, replacing the additive-sum estimate with a measurement
  of the actual combination.
- **Tied-with-#1 paired comparison** — when two re-simulated options come out statistically
  indistinguishable, a paired comparison (matching how the Skill Chart itself ranks single skills,
  see "Paired scenarios..." above) to decide which, if either, actually ranks first, rather than a
  bare mean comparison.
- **Beam search over the unfiltered candidate pool** — the shipped MVP only ever optimizes over
  the user's shop shortlist; running it over the chart's full general-skill candidate pool needs a
  search that doesn't enumerate every combination the way the shortlist-scale DFS does today.
- **Add/drop/swap refinement** — a local-search pass over a finalist set after re-simulation, since
  the additive assumption can leave a strictly better neighboring set unexplored.
- **Optimizer state in shared URLs** — budget, hint levels, and the selected option are
  `localStorage`-only (like `chartShopSkills`, above), not part of the serialized race state.
