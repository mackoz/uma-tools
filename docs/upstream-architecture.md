# Upstream architecture

This mirrors [architecture.md](architecture.md) — same shape, but describing **upstream** (`alpha123/uma-tools`), not this fork. It exists because [upstream-comparison.md](upstream-comparison.md) documents what changed between the two but never lays out upstream's own design end to end, so its claims are hard to check without re-deriving them from scratch.

Prefer plain language over code-literal detail? See [upstream-architecture-simple.md](upstream-architecture-simple.md) — same content, rewritten without file:line citations or code snippets.

It's a point-in-time snapshot of a repo this fork doesn't control — see [Snapshot](#snapshot) for exact commits, and re-run the `git` commands there against newer commits if you need a current answer. For what's *different* between the two repos, see [upstream-comparison.md](upstream-comparison.md) (features/lineage/game data) or [architecture-comparison.md](architecture-comparison.md) (structure and design, with plain-language ELI5s); this page only explains upstream, on its own terms.

## Four reference points, not three

`upstream-comparison.md` already warns that a naive `diff` between the two checkouts is misleading because upstream's `uma-tools` repo pins its `uma-skill-tools` engine submodule at a stale commit — three reference points (pinned engine / engine repo's own `origin/master` / this fork). Writing this doc surfaced a fourth, and it matters for anything below that describes upstream's app-facing engine API:

| Ref | What | `RaceSolver.ts` | Status |
|---|---|---|---|
| **A** | Engine as **pinned** by upstream's `.gitmodules` — `6ba5ca0`, 2025-07-31 | 670 lines | What `git submodule update --init` gives you today |
| **B** | Engine repo's own `origin/master` — `8b3f5e2`, 2026-03-17, 51 commits past the pin | 762 lines | The newest *public* upstream engine |
| **D** | alpha123's own **unpublished, local** engine | unknown | Not public anywhere |

D isn't speculation — it's forced by the fact that upstream's own app code, at the app repo's current HEAD, calls engine APIs that don't exist in either public checkout. Confirmed by `git grep` against both refs:

| API the app calls | Where | Present at A (`6ba5ca0`)? | Present at B (`origin/master`)? |
|---|---|---|---|
| `.otherHorse(...)` | `umalator/compare.ts:86` | No | No |
| `.withItidoriarasoi()` | `umalator/compare.ts:124` | No | No |
| `.addSkill(id, persp, level, policy)` (4-arg) | `umalator/compare.ts:101` | No — `addSkill(id, perspective, samplePolicy)` is 3-arg at both A and B | No |
| `levelScalingCoef` | `components/SkillList.tsx:11` | No | No |
| `.seed(lo, hi)` (2-arg) | `umalator/compare.ts:74` | No — 1-arg at A | **Yes** at B |
| `.withWisdomChecks(seeds)` | `umalator/compare.ts:126` | No | **Yes** at B |

So upstream's committed, working bundles were built against an engine state that is neither the pin nor the engine repo's own published `origin/master` — some app-facing surface (a second-uma comparison mode, lead-competition, per-skill level scaling) exists only in D. Everything below is explicitly labelled **A** or **B**; nothing here describes D, because there's nothing to read.

## The engine at A (the pin)

This is the baseline architecture pass — same structure as [architecture.md](architecture.md)'s engine section, so the two can be diffed by eye.

### Dependency graph (leaves → root)

11 top-level `.ts` files, 3246 lines total, in `uma-skill-tools/` as pinned:

```
Region.ts, Random.ts, RaceParameters.ts, HorseTypes.ts   (no internal deps, or node:assert only)
        |
CourseData.ts  (+ data/course_data.json)
        |
ActivationSamplePolicy.ts
        |
ActivationConditions.ts  ----(type-only)---->  RaceSolver.ts <----(type-only)---- HpPolicy.ts
        |                                            ^                                 |
ConditionParser.ts                                   |                                 |
        |                                             \_______________________________/
        +----------------------------------------+
                                                  v
                                    RaceSolverBuilder.ts   <- ENTRY POINT (unique root)
                                                  |
                          tools/*, test/*, umalator/*, build-planner/*, skill-visualizer/*
```

- **`RaceSolver.ts` ↔ `HpPolicy.ts` is a genuine cycle**, broken only at compile time: `RaceSolver.ts:7` imports `type { HpPolicy }`, `HpPolicy.ts:1` imports `type { RaceState }`. No runtime edge either direction.
- `ActivationConditions.ts:6` → `RaceSolver.ts` is written as a plain (non-type) `import`, so unlike the cycle above it *is* a real runtime edge in the emitted JS.
- Three pure leaves: `Region.ts`, `Random.ts`, `RaceParameters.ts` (zero imports at all).
- Data JSON is loaded in exactly two places: `CourseData.ts:21` and `RaceSolverBuilder.ts:12`.
- `RaceSolverBuilder.ts` is the unique root — nothing in the engine imports it.

### Entry point: `RaceSolverBuilder`

`export class RaceSolverBuilder` at `RaceSolverBuilder.ts:389`, constructor `constructor(readonly nsamples: number)` at `:403`. Fluent methods (`seed`, `course`, `mood`, `ground`, `weather`, `season`, `time`, `grade`, `popularity`, `order`, `numUmas`, `horse`, `pacer`, `useDefaultPacer`, `withActivateCountsAsRandom`, `withAsiwotameru`, `withStaminaSyoubu`, `addSkill`, `onSkillActivate`, `onSkillDeactivate`, `fork`) all `return this`.

`*build()` at `:646` is a **two-way generator**: it `yield`s a configured `RaceSolver` and reads back a `redo: boolean` from the caller's `.next(redo)` (`:690`, `:701`) — passing `true` re-rolls that same sample index with the same RNG state.

End-to-end trace of one `.build()` call:

| # | What | Where |
|---|---|---|
| 1 | **Base stats.** `buildBaseStats()` applies overcap halving — anything over 1200 becomes `1200 + floor((stat-1200)/2)` — then the mood coefficient `1 + 0.02*mood`. `rawStamina` stored un-halved. Result frozen. | `:176–195` |
| 2 | **RNG fan-out.** `solverRng`/`pacerRng` derived from the builder RNG. The pacer RNG is drawn *unconditionally*, even with no pacer set, purely so two forked builders' RNG streams stay in sync. | `:648–650` |
| 3 | **Pacer stats**, if set — gets the *full* adjusted-stats pipeline immediately, unlike the main horse (see step 8). | `:652` |
| 4 | **Whole-course region** — a single frozen `Region(0, course.distance)`, the universe every condition gets intersected against. | `:654–656` |
| 5 | **Skill condition parsing**, `buildSkillData()` (`:256`) per skill. Preconditions clip the region first; the condition string is parsed and `op.apply()`'d; alternatives with empty regions are dropped; **only the first trigger is kept** unless the condition references `is_activate_other_skill_detail`/`is_used_skill_id` (`!!! FIXME` at `:291` — this is bugged for NY Ace's unique, which needs both effects on Oonige); rarity 3–5 normalized to 3; skills with no matching alternative get a never-firing `Region(9999,9999)` stub (Summer Goldship's Adventure of 564, `:310–330`). | `:658–659` |
| 6 | **Extra skill hooks** — `withAsiwotameru`/`withStaminaSyoubu` splice pseudo-skills into `skilldata` here. | `:660` |
| 7 | **Sample-policy reconciliation + sampling.** Reconciliation already happened during parse (`AndOperator`/`OrOperator` constructors call `left.samplePolicy.reconcile(right.samplePolicy)`, double-dispatch lattice `Immediate < DistributionRandom < Random < {StraightRandom, AllCornerRandom}`; Straight×AllCorner throws). Each skill's regions get sampled into concrete triggers via the builder RNG. | `:661–664` |
| 8 | **Adjusted stats — deliberately *after* sampling.** Comment: *"must come after skill activations are decided because conditions like base_power depend on base stats."* Applies course-set-status speed modifier, ground speed/power modifiers, wisdom × strategy proficiency. | `:666–667` |
| 9 | **Per-sample loop**, `nsamples` times — triggers picked via `triggers[sdi][i % triggers[sdi].length]`, letting `ImmediatePolicy` (1 region) coexist with random policies (`nsamples` regions). | `:669–677` |
| 10 | **RNG snapshot** for the redo protocol. | `:679–680` |
| 11 | **Pacer solver**, if any — a full second `RaceSolver` with `NoopHpPolicy`, its own skill list, its own RNG. Has no pacer of its own. | `:682–688` |
| 12 | **HP policy — hardcoded at A**, no builder hook to override it: main solver always `GameHpPolicy`, pacer always the `NoopHpPolicy` singleton. | `:685`, `:695` |
| 13 | **Yield + redo.** `const redo = yield new RaceSolver({...})`; `g.next(true)` rewinds `i` and both RNGs to the step-10 snapshot and regenerates the same sample deterministically. | `:690–705` |

`fork()` (`:625`) clones everything, including cloning the RNG *by state* (`new Rule30CARng(this._rng.lo, this._rng.hi)`) so two builders produce identical random streams — the mechanism umalator's A/B comparison relies on. Documented gotcha at `:638–641`: `withAsiwotameru()` closes over the *original* builder's horse/mood, so it must be re-called per fork.

### `RaceSolver.step()`

`step(dt: number)` at `RaceSolver.ts:385`, file is 670 lines. Exact per-tick order:

| # | Call | Line |
|---|---|---|
| 0 | Start-delay gate — advances timers and returns early if still inside `startDelay` | `397–407` |
| 1 | `pacer.step(dt)`, recursive, only while `pos < posKeepEnd` | `409–411` |
| 2 | `halfv = min(currentSpeed + 0.5*dt*accel, getMaxSpeed())` (velocity-Verlet half step) | `413` |
| 3 | `pos += (halfv + modifiers.currentSpeed) * dt` | `414–415` |
| 4 | `this.hp.tick(this, dt)` | `416` |
| 5 | `timers.forEach(tm => tm.t += dt)` | `417` |
| 6 | `updateHills()` | `418` |
| 7 | `updatePhase()` | `419` |
| 8 | `processSkillActivations()` | `420` |
| 9 | `updatePositionKeep()` | `421` |
| 10 | `updateLastSpurtState()` | `422` |
| 11 | `updateTargetSpeed()` | `423` |
| 12 | `applyForces()` | `424` |
| 13 | second half-step: `currentSpeed = min(halfv + 0.5*dt*accel + oneFrameAccel, getMaxSpeed())` | `425` |
| 14 | min-speed clamp / start-dash exit (`accel -= 24.0` once `currentSpeed >= 0.85*baseSpeed`) | `426–431` |
| 15 | `modifiers.oneFrameAccel = 0.0` | `432` |

**Position integrates before hills/phase/skills are updated** — a skill triggered this tick affects speed starting next tick, not this one.

Only **three** sub-RNGs on `RaceSolver` itself: `rng` (injected, drives gate roll / random lot / start delay / 24 section modifiers), `gorosiRng` (Fisher–Yates shuffle for random-gold activation only), `paceEffectRng` (pace-down exit distance only). A fourth lives on `GameHpPolicy` (last-spurt "accept a subpar spurt" roll). Worth noting: `gateRoll = rng.uniform(12252240)` uses `lcm(1..18)` as the modulus specifically so `gateRoll % numUmas` is exactly uniform for any field size 1–18, avoiding rejection sampling inside a dynamic condition (`:267–275`).

### `ConditionParser.ts` — a Pratt parser

Self-described as a "top-down operator precedence parser (Pratt parser)" (`:203`). Grammar, no parentheses, all left-associative (recursion uses `rbp = this.lbp`, not `lbp - 1`):

```
Or  ::= And '@' Or | And        (@ = or,  lbp 10)
And ::= Cmp '&' And | Cmp       (& = and, lbp 20)
Cmp ::= condition Op integer    (         lbp 30)
```

Comparisons bind tightest, `&` next, `@` loosest. `getParser()` (`:44`) is parameterized over the condition/operator table, reused by `tools/skillgrep.ts` and `tools/ConditionMatcher.ts`.

### `Random.ts` — `Rule30CARng` is a real rule-30 CA here

Unlike this fork (where the same class name is a prando alias — see [architecture.md](architecture.md#file-reference)), upstream's `Rule30CARng` (`Random.ts:21`) genuinely is a rule-30 cellular automaton: 64 bits of state split across two 32-bit words `hi`/`lo`, updated as `hi/lo = ror(hi/lo) ^ (hi/lo | rol(hi/lo))` — rule 30's `left XOR (center OR right)` applied bit-parallel with circular wraparound across the pair. `pair()` runs 16 generations, extracting 4 bits per generation from `hi` to build two output words in parallel. Constructor takes `(seedLo, seedHi=0)` with public `hi`/`lo`, which is what makes state-based cloning (`fork()`, the redo snapshot) possible.

### Per-file roles

| File | Role |
|---|---|
| `RaceSolver.ts` (670) | Physics core for **one** uma: velocity-Verlet integration, phase transitions, hills, start dash, min speed, last spurt, skill activation/expiry, pace-down. Defines `RaceState`, `SkillType`, `SkillRarity`, `PendingSkill`, `Perspective`. |
| `RaceSolverBuilder.ts` (708) | Entry point / wiring — see above. |
| `ConditionParser.ts` (224) | Generic Pratt parser for the skill-condition mini-language. |
| `ActivationConditions.ts` (984) | `Eq`/`Neq`/`Lt`/`Lte`/`Gt`/`Gte`/`And`/`Or` operator nodes plus the ~112-entry `Conditions` table (manifest comment `:370–386`). Splits each condition into a static region filter + optional dynamic `RaceState` predicate. Unimplementable/other-uma conditions are `noop*` stubs. |
| `ActivationSamplePolicy.ts` (227) | Where inside candidate regions a skill fires: `ImmediatePolicy`, `RandomPolicy`, `DistributionRandomPolicy` → `UniformRandomPolicy`/`LogNormalRandomPolicy`/`ErlangRandomPolicy`, `StraightRandomPolicy`, `AllCornerRandomPolicy`. Also the `reconcile*` double-dispatch lattice. |
| `HpPolicy.ts` (127) | `NoopHpPolicy` (infinite stamina) / `GameHpPolicy` (real formula: max HP from strategy×stamina+distance, quadratic-in-velocity drain, `getLastSpurtPair` for spurt-speed selection). |
| `CourseData.ts` (85) | `CourseHelpers` — phase boundaries, course-set-status modifier, `getCourse(id)` (loads + freezes `data/course_data.json`). |
| `Region.ts` (62) | `[start,end)` interval algebra: `Region`, `RegionList` with `rmap`/`union`. |
| `HorseTypes.ts` (27) | `HorseParameters`, `Strategy`/`Aptitude` enums, `strategyMatches` (Nige≈Oonige). |
| `RaceParameters.ts` (19) | Pure leaf: `Mood`, `GroundCondition`/`Weather`/`Season`/`Time`/`Grade`, `RaceParameters`. |
| `Random.ts` (113) | `PRNG` interface + `Rule30CARng` — see above. |

Also present, not top-level: `tools/` (`ToolCLI.ts`, `gain.ts`, `dump.ts`, `compare.ts`, `basinnhyou.ts`, `speedguts.ts`, `skillgrep.ts`, `ConditionMatcher.ts`) and `test/` (property + regression tests, see below).

### What's deliberately *not* modeled at A

- **Single-uma by design** — README: *"Does not fully simulate a race, only simulates one uma… This is by design."* `numUmas` is only a scalar used to turn order conditions into static filters and derive the gate-roll modulus.
- **Position keep: pace-down only**, explicitly truncated: *"in the actual game, position keep continues for 10 sections. however we're really only interested in pace down at the beginning… arbitrarily cap at 5"* (`:291–293`). No pace-up, pace-up-ex, or overtake mode: *"there's a hard cap of 30m/s, but there's no way to actually hit that without implementing the Pace Up Ex position keep mode"* (`RaceSolver.ts:382`).
- **No lane movement** — zero lane state; lane-shaped conditions are no-op Erlang-random stubs. `course_data.json` carries a `laneMax` field the engine never reads.
- **No compete/fight, no lead competition, no rushed/kakari (at A), no downhill mode (at A — `HpPolicy.ts:64` `// TODO downhill mode`; `updateHills` actively discards downhill slopes), no spot struggle, no dueling.**
- **Pacer is a reference clock only** — a second full `RaceSolver`, never blocked, never overtaken, doesn't affect finish order. `useDefaultPacer()` clones your horse as `'Nige'` with two hardcoded accel skills.

## What changed at B (pin → `origin/master`, 51 commits, ~350 lines across 6 files)

Kakari and downhill mode — both features this fork's own `docs/upstream-comparison.md` credits as fork-only relative to A — **exist upstream too, just past the pin**:

- **Kakari (rushed) added.** New `RaceSolver` fields `kakariStart`/`kakariDuration`/`isKakari`/`temptationCount`; `updateKakari()` inserted into `step()` right after `processSkillActivations()`. Both the start-section roll and the duration roll happen up front in the constructor specifically so the RNG stream advances a *fixed* number of times regardless of wisdom (commented rationale: doing it as "roll, then conditionally roll again" would make the stream length data-dependent). New skill effect types `ExtendKakari = 13`, `ModifyKakariChance = 29`. HP drain ×1.6 while kakari; position-keep pace-down is suppressed while kakari.
- **Downhill mode added.** One `hillRng` per slope (`hillRng: PRNG[]`) — deliberately *not* a single shared RNG, so a downhill speed skill proc on one hill can't perturb how many times later hills' RNGs get rolled. `downhillCheck()` gates entry on `roll < wisdom * 0.0004`; a 1-second timer re-rolls exit (`roll > 0.8`) or entry each second. While active: `targetSpeed += 0.3 + slopePer/100000`, HP drain ×0.4.
- **`CC_GLOBAL` removed from the engine entirely.** At A, `lastSpurtSpeed`'s guts term and the on-heal last-spurt recompute were JP-only (`if (!CC_GLOBAL) ...`); at B both are unconditional. Checked directly against this fork's current engine (`mackoz/uma-skill-tools`, the kachi-lineage import): the `CC_GLOBAL` declaration is still present but dead — zero `if (CC_GLOBAL)`/`if (!CC_GLOBAL)` branches anywhere — so both terms are already unconditional here too, matching B, not frozen at a pre-B state as an earlier version of this note claimed. See `plans/engine-comparison/stats-and-speed.md#spd-5` for the full writeup.
- **Wisdom-gated skill activation.** `withWisdomChecks(seeds)`, `otherRawWisdom()`; per-perspective activation chance `max(1 - 90/wisdom, 0.2)` (Self/Other; Any always fires); a dedicated RNG per wisdom-checked skill ID; `wisdomCheck: boolean` threaded through `SkillData`/`buildSkillData`.
- **`hpPolicyFactory()`** — HP policy becomes injectable (`(course, params, rng) => HpPolicy`) instead of hardcoded `GameHpPolicy`.
- **API surface**: `seed(lo, hi=0)` (2-arg, was 1-arg at A); `_samplePolicyOverride` becomes per-`Perspective` (`Map<string,Policy>[]` indexed 1–3, was a single flat `Map`); `SkillType.Noop = 0` added so filtered-out effects keep a stable array index instead of being spliced out.
- **`Rule30CARng.int32()` simplified** — the self-rewriting `int32_first`/`int32_second` alternation (which cached and replayed the second half of each `pair()`) is gone; B's `int32()` just discards the unused half, trading one call in exchange for smaller, more cheaply cloneable RNG instances.
- **`HpPolicy.getLastSpurtPair`** gets a `+60` correction to `spurtDistance` and a guard returning `[distance, maxSpeed]` (never spurt) when no candidate speed clears `baseTargetSpeed2` — a fix for pathologically low-speed horses.
- **Sample-policy distributions rescaled.** `LogNormalRandomPolicy`/`ErlangRandomPolicy` previously normalized generated samples to their own *observed* min/max; at B they normalize to an *estimated* 0.1st/99.9th percentile instead (closed-form inverse-CDF for log-normal; Wilson–Hilferty chi-squared approximation for Erlang, since Erlang has no closed-form inverse CDF) — more stable at low `nsamples`. The author's own comments call both derivations "mathematically suspect" and "pretty awful" while defending them as empirically close enough.
- **New/changed conditions** in `ActivationConditions.ts`: `is_activate_any_skill` (real, was absent), `phase_firsthalf` (new), `run_at_full_speed_random` (new, "implemented incorrectly for now" per the engine's own commit message), `is_temptation` (now real, reads `isKakari`; was `noopImmediate` at A), `popularity` (now a real `valueFilter`, was `noopImmediate` at A). Also a `accumulatetime`-condition static-filter optimization with a hardcoded 80-skill-ID exclusion list, worked example and rationale in a long comment at `ActivationConditions.ts` (search `filterGte`).

## The app layer (at `cdb7ead`, shared by A and B)

### Sub-apps

| App | What | Source | Committed bundle |
|---|---|---|---|
| `umalator/` | Main comparator: bashin-gain compare / skill chart / stamina calc, JP data | own | yes + worker |
| `umalator-global/` | Same UI, Global data | **none — builds `../umalator/app.tsx`** | yes + worker |
| `skill-visualizer/` | Standalone skill-activation-region viewer, JP data | own | yes |
| `skill-visualizer-global/` | Same, Global data | **none — builds `../skill-visualizer/app.tsx`** | yes |
| `build-planner/` | SP-budget skill-build optimizer (`glpk.js` LP solver) | own | yes (+ stray committed `bundle.2.js`) |
| `courseimages/` | Dev tool: render a course, download as PNG | own | yes |
| `umadle/` | Wordle-style uma guesser | own | yes — **unbuildable from a clean install**, imports `accessible-autocomplete/preact`, not in `package.json` |
| `rougelike/` | Wordle-style color guesser, not uma-related | own | yes |
| `sorter/` | "Rank your favorite umas" — comparison-minimizing sort over a DAG. **No fork counterpart.** | own | yes |

`umalator-global` and `skill-visualizer-global` are build targets with no source of their own — same arrangement this fork uses for its own `umalator-global`.

### `buildtools.mjs` — the shared build helper

Upstream factors what this fork duplicates per-app into one 126-line shared module (`/buildtools.mjs`); every app's `build.mjs` is a ~20-line stub calling `buildOrServe({...})` from it. Options: `--debug`, `--serve [port]` (implies `--debug`). esbuild config: `bundle: true`, `minify: !debug`, `define: {CC_DEBUG, CC_GLOBAL}` — **only two defines**, `external: ['*.ttf', '*.png', '../vendor/opencv.js']`.

Exactly two esbuild plugins:

1. **`redirect`** — one generic `{pattern: resolver}` map plugin. A single mechanism implements *everything*: the `@tanstack/*` → `vendor/` alias **and** the JP→Global data swap (`^\.\.?(?:/uma-skill-tools)?/data/` → `umalator-global/*.json`, plus explicit `skill_meta.json`/`umas.json` redirects). This fork's `build.mjs` files split the same idea into three separately-named plugins (`redirectData`, `redirectTable`, plus `seedrandomPlugin` which upstream has no need for).
2. **`mockAssert`** — swaps `node:assert` for `console.assert` (debug) or a no-op (release).

The dev server (`runServer`) rewrites `/(skills|compare|stamina)$` → `/` so umalator's client-side routes resolve, and — like this fork — roots static-asset serving at the *parent* of the checkout, so the local dir must be named `uma-tools`.

### State management: `optics.ts`

A **home-grown lens library fused with a Proxy-based state layer** (`/optics.ts`, 226 lines) — upstream's entire app-state architecture, with no fork equivalent (the fork uses Immutable `Record`s directly). `O` is a `Proxy`; property access (`O.uma1.skills`) builds a path-focused lens; calling it reads, `new`-ing it with a function writes an immutable, structurally-shared update. State itself lives outside preact, in a `useRef` holding `{state, listeners}`, with `useLens`/`useGetter`/`useSetter` hooks subscribing via a manual listener `Set` and `forceUpdate`-ing only on `!Object.is(prev, next)`. The type-level lens machinery is admittedly incomplete (`// this doesn't quite work, but it almost does`, `// I give up`). Used by 9 files spanning every app plus `HorseDef.tsx`/`SkillList.tsx`/`HorseOcr.tsx`/`HorseSaveMngr.tsx`.

Consequence: `HorseState` here is a **plain TypeScript interface** (POJO), not an Immutable `Record` — `immutable` isn't even a dependency. (Contrast this fork's `HorseState`, an Immutable `Record` per `CLAUDE.md`'s own conventions.)

### `components/`

19 files. Notably **no `SkillPicker.tsx`** — the picker overlay is inlined twice, in `HorseDef.tsx` and again in `HorseOcr.tsx`, rather than factored into a shared component.

| File | Role |
|---|---|
| `HorseDefTypes.ts` | `HorseState` interface, `SkillSet`, unique-skill helpers, `serializeUma`/`deserializeUma` with versioned field back-fill. |
| `HorseDef.tsx` | The uma editor panel — stats, aptitudes, skill picker, OCR panel, save manager, all hosted here. |
| `SkillList.tsx` | Largest component (926 lines) — skill search/render with parsed conditions, tooltips, sample-policy pickers, hint costs. |
| `RaceTrack.tsx` | SVG course renderer + activation-region overlay. |
| `Language.tsx` | i18n context — see below. |
| `Tooltip.tsx` | Pure-CSS tooltip, no JS positioning. |
| `HorseOcr.tsx` / `ocr.ts` | **Upstream-only.** Screenshot-import UI + engine: opencv.js for image prep, 2 tesseract.js workers (JP/EN), fuzzy-matches recognized text against `skillnames.json`. |
| `HorseSaveMngr.tsx` | **Upstream-only.** Saved-uma manager, IndexedDB-backed (`idb`), listed in a TanStack table. |
| `scorecalc.ts` | **Upstream-only.** In-game uma "score" calculator — a transliteration of a J (array language) program, with the original J source pasted in as a comment. |
| `icon_types.json` | Flat array of 43 known skill `iconId`s. |
| `autocomplete.jsx` | Orphaned vendored `accessible-autocomplete` port — nothing imports it (`umadle` imports the npm package directly instead, which isn't installed). |

### Simulation worker

`umalator/simulator.worker.ts`, classic (non-module) worker. **4 workers** spawned (`app.tsx:759-776`), but only `workers[0]` is used for compare/hpcalc — all 4 are used solely to shard the bashin chart by skill. Every mode does **progressive refinement**, posting partial results as sample count ramps up (chart: 3→17→30→50→100; compare/hpcalc: geometric ramp toward `nsamples`), merged on the main thread via `mergeResults`/`mergeResultSets`.

### i18n

`preact-i18n` (`IntlProvider`/`Text`/`MarkupText`/`useText`), four language codes: `ja`, `en`, `en-ja`, `en-global`. Default language read from `localStorage`, falling back to `en-global` on Global builds. Skill names are injected into the dictionary at render time — `strings.skillnames[id] = skillnames[id][langid]` with `langid = CC_GLOBAL ? 0 : +(lang == 'en')` — which is exactly why Global's `skillnames.json` entries are 1-element arrays rather than `[ja, en]` tuples: only index 0 is ever read under `CC_GLOBAL`.

### `vendor/`

TanStack `table-core` (full source vendor, ~90 files) + a hand-written preact adapter (no official one exists); `sortable.js` (drag-and-drop, `sorter/`); `opencv.js` (10.9 MB, `external` in esbuild, loaded at runtime via an injected `<script>` tag); `tesseract.js` worker + wasm cores + JP/EN traineddata, self-hosted rather than CDN-loaded.

### Data pipeline

Same shape as this fork's (`.pl` scripts over `master.mdb` via `DBI`/`DBD::SQLite`, `JSON::PP->canonical(1)` for stable diffs) — see [data-pipeline.md](data-pipeline.md) for how this fork's own scripts work. One difference worth flagging: **`umalator-global/update.bat` is the only place upstream's data-refresh chain is written down end to end** (perl scripts → `node build.mjs`); there's no equivalent script for the JP side, which is run by hand.

### Deployment

**No `.github/` directory at all — no CI, no GitHub Actions.** Deployment is: build locally, commit the bundles, push; GitHub Pages serves `master` directly. (This fork added GitHub Actions deploy — see [deployment.md](deployment.md).) Same `/uma-tools/` absolute asset-path convention this fork inherited (53 occurrences across 16 files) — required for GitHub Pages' project-path serving, and the reason the checkout directory must be named `uma-tools` for local dev to resolve assets. Telemetry is PostHog, gated to `CC_GLOBAL && !CC_DEBUG` — JP builds send nothing.

`package.json`: `"scripts": {}` is completely empty — there's no `npm run build`, you invoke `node <app>/build.mjs` directly. No `engines` field. No `tsc` step anywhere in the build, same as this fork — types are never checked in CI because there is no CI.

## Known rough edges in upstream

| Location | Issue |
|---|---|
| `ActivationConditions.ts:140` (`OrOperator.apply`) | **FIXME, unfixed at both A and B, and unfixed in this fork too** (see [architecture.md](architecture.md#known-issues)) — the `@` operator doesn't correctly propagate dynamic conditions per-region when both branches differ; author's own words, "this is rather risky. i don't like it." |
| `ActivationConditions.ts:526` (`corner_random.filterEq`) | Hardcoded list of 26 skill IDs, explicit "TEMPORARY" hack for corner skills, called out as more important for Global than JP. |
| `RaceSolverBuilder.ts:291` (`!!! FIXME`) | The first-trigger-only heuristic is "actually bugged for NY Ace unique since she'll get both effects if she uses oonige." |
| `HpPolicy.ts:75-77` | Author's own uncertainty note: HP drain might structurally be `amount` once per second rather than `amount*dt` per frame — "i think it is actually the latter" (i.e. not fully confident the current implementation is right). |
| `RaceSolverBuilder.ts:333-357` | `conditionsWithActivateCountsAsRandom` hardcodes `n == 7` to identify two specific unique skills ("ideally find a better solution"), and estimates "about 23 skills activate per race" as a magic constant. |
| `ActivationSamplePolicy.ts:86` | `DistributionRandomPolicy.reconcile` is a stated stopgap — real fix would model with a Poisson process, which would also unlock cooldown support. |
| `ActivationSamplePolicy.ts:211` | `AllCornerRandomPolicy` places up to 4 triggers, then discards all but the earliest — no multi-trigger/cooldown support yet. |
| README (Caveats) | Documented known bug: skills combining `accumulatetime` with a probability-distribution condition "activate too early a lot of the time." |

One inherited issue remains true in both trees: `components/autocomplete.jsx` is dead code. Upstream's `umadle` also cannot build from a clean `npm install` because `accessible-autocomplete` is missing there; this fork has since added that dependency and the required legacy-peer configuration, so the build failure is now upstream-only.

## Snapshot

This page reflects:

- **Upstream `uma-tools`:** `cdb7ead`, 2026-08-18 ("update game data (global)")
- **Upstream `uma-skill-tools`, reference A (as pinned by upstream's `uma-tools`):** `6ba5ca0`, 2025-07-31
- **Upstream `uma-skill-tools`, reference B (engine repo's own `origin/master`):** `8b3f5e2`, 2026-03-17

To refresh against newer commits:

```sh
git -C ../uma-tools-og pull
git -C ../uma-tools-og/uma-skill-tools fetch origin
git -C ../uma-tools-og/uma-skill-tools diff 6ba5ca0 origin/master  # or whatever the new pin is
```

See [upstream-comparison.md](upstream-comparison.md#reproducing-this-comparison) for the equivalent setup if you also want to re-run the fork-vs-upstream comparison.
