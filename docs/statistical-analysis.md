# Statistical Skill Chart

How the Skill Chart (`Mode.Chart` / `Mode.UniquesChart` in `umalator/app.tsx`) evaluates candidate
skills: paired race comparisons, an adaptive sampling ladder, confidence intervals, and detail-on-
demand for an expanded row. The same `umalator/app.tsx` source powers both `umalator` (JP) and
`umalator-global` — see [architecture.md](architecture.md) for how the shared source splits on
`CC_GLOBAL`. This describes the implementation on branch `skill-chart-perf-rewrite`, engine commit
`0861c8f`.

An **SP-budget skill-set optimizer** was prototyped on an earlier branch but is deferred — the six
layers below are chart-only. Results are estimates from the simulator model, not claims about
live-game outcomes.

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

Both models request `mode: 'compare'` from the engine, which is what gates `GameHpPolicy`
(`RaceSolverBuilder.ts`) instead of the no-op HP policy an omitted `mode` produces. Real HP means
recovery (HP-only) skills have an actual budget to act on and are rankable in both models, so
neither model excludes them from the candidate list (`isHpOnlySkill` still exists in
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
2. Use the skill-icon filters above the run settings to narrow the candidate pool before running, if
   only certain categories matter — filtering reduces total work. The **Hide Inherited Uniques**
   toggle next to them excludes the ~250 `9xxxxx` inherited-unique skills (e.g. "Warning Shot!
   (inherited)") from the candidate pool. A character's own (non-inherited) unique skills never
   enter the candidate pool in the first place — the Skill Chart's candidate list only includes
   general skills (`rarity < 3`), and uniques are rarity 4/5 — so this toggle is the only "hide
   uniques" control that does anything. Both filters can be changed after a run without re-running —
   matching rows hide immediately, with the chart marked dirty until you press Run again.
3. Pick **Model** (Controlled or Full race), **Preset** (Quick / Balanced / Thorough), and
   **Pruning** (0-100, default 50 — see the Pruning subsection above) in the run-settings row above
   the table — these are reachable before a run has happened, unlike an earlier implementation
   where they lived inside the results pane and only rendered once `tableData.size > 0`. An
   estimated-runtime hint next to Run reflects the current Pruning-derived preset, using the
   ladder's worst-case scenario count and the last measured ms/scenario rate.
4. If Skill Wit Check matters to the comparison, set it in the left Settings pane before running.
5. Press **Run**. The table populates progressively as each round's batches stream back; sort by any
   column. **Stop** halts within a couple of seconds and keeps whatever partial results exist.
6. Expand a row for detail: total samples, help/tie/hurt mass, the activation-position effect chart,
   and the velocity trace for that skill's min/max/mean/median runs. **Refine** queues one more block
   of samples for just that row.
7. Double-clicking a row adds that skill to Uma 1's build and marks the chart stale — rerun after
   changing the baseline.

Changing Model, Preset, or Pruning does not automatically rerun existing results — press Run again.

## Reproducibility

Same race setup, Uma, Model, Preset, Pruning, seed, and Skill Wit Check setting reproduce an
identical chart — the BCa bootstrap is seeded per skill (deterministic given the skill ID and base
seed), not just the underlying race simulation. `analysisMode`, `analysisPreset`, and `chartPruning`
are stored in `localStorage` only (work-budget knobs, not part of the race definition);
`skillWisdomCheck` is part of the serialized race state and shared URLs, same as it already was for
Compare mode.

## Verification

```sh
npm run test:stats                       # statisticalAnalysis.ts and chartLadder.ts unit tests
npm --prefix uma-skill-tools test        # engine tests, including activation-sampling stability
cd umalator && node build.mjs            # JP app build
cd umalator-global && node build.mjs     # Global app build
npm run build                            # all seven maintained apps
```

## Deferred to a follow-up branch

The SP-budget skill-set optimizer from the earlier implementation, rebuilt on top of the worker
queue and cancellation infrastructure above (spread across all workers, real per-set progress, typed
results, a proper results panel) — plus a legal add/drop/swap refinement pass after validation,
optimizer state in shared URLs, and a histogram/multinomial bootstrap (only worth adding if profiling
says so once bootstrapping is already confined to ~40 skills).
