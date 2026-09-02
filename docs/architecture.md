# Architecture

This page explains how a race simulation actually runs, file by file, and lists the known rough edges in the engine.

> Line references verified against `uma-skill-tools@261d3b7` (submodule) and `uma-tools@a95bcc6`, 2026-08-24. Re-check `file:line` citations after either advances — see `docs/adr/README.md` for how ADRs track decisions separately from this line-level detail.

## The engine lives in `uma-skill-tools/`

It is a **git submodule**, pointing at [`mackoz/uma-skill-tools`](https://github.com/mackoz/uma-skill-tools) — a real fork of [`alpha123/uma-skill-tools`](https://github.com/alpha123/uma-skill-tools), the same relationship `alpha123/uma-tools` has with its engine. It wasn't always: it spent time vendored in-tree (flattened out of a submodule in commit `7a4949a`), which is also why this repo's own history didn't track which engine commit the code came from — that's fixed now that it's a submodule again. `git submodule update --init` after a fresh clone; `uma-skill-tools/`'s own `package.json`/`tsconfig.json` are for its CLI tools, not consumed by this repo's build — the parent repo's esbuild config compiles the `.ts` files directly as part of each app's bundle.

`mackoz/uma-skill-tools` is a **heavily modified fork**, not a snapshot — it adds multi-uma field simulation, a 5-state position-keep machine, lane movement, and compete/lead competition on top of `alpha123/uma-skill-tools`.

### Dependency graph (leaves → root)

```
Region.ts, HorseTypes.ts, RaceParameters.ts, Random.ts   (no internal deps)
        |
CourseData.ts  (+ data/course_data.json)
        |
ApproximateConditions.ts --> SpecialConditions.ts
        |                            |
ActivationSamplePolicy.ts            |
        |                            |
ActivationConditions.ts <------------+---- (type-only) RaceSolver.ts
        |                            |
ConditionParser.ts                   v
        |                    HpPolicy.ts --> RaceSolver.ts
        +----------------------------------------+
                                                  v
                                    RaceSolverBuilder.ts   <- ENTRY POINT
                                                  |
                          tools/*, test/*, umalator/*, build-planner/*, skill-visualizer/*
```

### Entry point: `RaceSolverBuilder`

`RaceSolverBuilder` (`uma-skill-tools/RaceSolverBuilder.ts:394`) is a fluent builder. Callers chain `.course()`, `.horse()`, `.mood()`, `.ground()`, `.addSkill()`, `.pacer()`, etc., then call `.build()` — a **generator** (`RaceSolverBuilder.ts:844`) that `yield`s one configured `RaceSolver` per Monte Carlo sample. Passing `true` back into `.next()` re-rolls that sample.

End-to-end data flow for one `.build()` call:

1. **Stat pipeline.** `buildBaseStats()` (`RaceSolverBuilder.ts:182`) applies overcap halving (any stat above 1200 is halved past that point) and the mood coefficient.
2. **Skill resolution**, per skill, per `alternatives[]` entry in `skill_data.json`:
   - `ConditionParser.getParser().tokenize()/.parse()` (`ConditionParser.ts:44`) — a Pratt parser turns the condition string into an operator tree (`And`/`Or`/`Eq`/`Gte`/...). Grammar (no parentheses, all left-associative):
     ```
     Or  ::= And '@' Or | And        (@ = or,  lbp 10)
     And ::= Cmp '&' And | Cmp       (& = and, lbp 20)
     Cmp ::= condition Op integer    (         lbp 30)
     ```
   - `op.apply(wholeCourse, course, horse, extra)` (`ActivationConditions.ts`) narrows a `RegionList` of *potential* activation spans and produces a `DynamicCondition` closure for anything that can only be checked at runtime (e.g. `accumulatetime >= 5s`). A condition name absent from the `Conditions` table throws a named `ParseError: unknown condition: <name>` at this step (`ConditionParser.ts`'s `Identifier.nud`) — a handful of shipped skills (see "Known issues" below) still hit this.
   - `op.samplePolicy` is reconciled bottom-up through `&` and `@` (`ActivationSamplePolicy.ts`) — this is the precedence lattice that decides, e.g., whether a skill's trigger point should be picked immediately, uniformly at random, or via a log-normal/Erlang distribution.
3. **Sampling.** `samplePolicy.sample(regions, nsamples, skillRng)` (`RaceSolverBuilder.ts:861`) turns each skill's region list into one concrete ~10m trigger `Region` per sample — this is *why* `nsamples` exists: skill trigger points are randomized per the game's own activation model, so you run many samples and look at the distribution.
4. **Adjusted stats**, deliberately computed *after* sampling (comment at `RaceSolverBuilder.ts:864`) — course speed modifier, ground modifiers, strategy proficiency on wisdom. Some conditions (e.g. `base_power`) intentionally read pre-adjustment stats.
5. **Per-sample solver construction.** `PendingSkill[]` are built by zipping each skill's `SkillData` with its sampled trigger. HP tracking is `GameHpPolicy` when `mode === 'compare'`, otherwise `NoopHpPolicy` (`RaceSolverBuilder.ts:881`) — the skill/uma chart intentionally ignores stamina.
6. **Integration.** The caller steps the yielded `RaceSolver` at `dt = 1/15s` until `pos >= course.distance`. `RaceSolver.step()` (`RaceSolver.ts:661`) runs, in order: `updateHills` → `updatePhase` → `updateRushedState` → `processSkillActivations` → `applyPositionKeepStates` → `updatePositionKeepCoefficient` → `updateCompeteFight`/`updateLeadCompetition` → `updateLastSpurtState` → `updateTargetSpeed` → `applyForces` → (if lane movement enabled) `applyLaneMovement` → integrate velocity/position → `hp.tick()`.
7. **Output.** Final `accumulatetime.t` at `pos == distance`, plus `onSkillActivate`/`onSkillDeactivate` callbacks and various activation logs. Comparing two solvers' `pos` at the same `t`, divided by 2.5m, gives the バ身 (basinn/length) gain — the number Umalator's whole UI exists to compute.

**Canonical caller**: `umalator/compare.ts:200` — `const a = standard.build(),\n\t\tb = compare.build();` then both are stepped together and diffed. Other callers: `umalator/BasinnChart.tsx`, `build-planner/app.tsx`, `skill-visualizer/app.tsx`, `skill-visualizer-global/app.tsx`, `uma-skill-tools/tools/{gain,speedguts,basinnhyou}.ts`, `uma-skill-tools/test/arb/Race.ts`.

### File reference

| File | Role |
|---|---|
| `RaceSolver.ts` (1536 lines) | The physics loop. `RaceState`, `SkillType`, `SkillEffect`, `PendingSkill`. Owns ~10 independently-seeded sub-RNGs (`syncRng`, `gorosiRng`, `rushedRng`, `downhillRng[]`, `sectionSpeedRng`, `posKeepRng`, `laneMovementRng`, `specialConditionRng`, `competeFightRng`) so toggling one subsystem doesn't desync the others across a paired comparison run. Wisdom-check rolls don't use a persistent named RNG — each check constructs a fresh `Rule30CARng` seeded from a `skillWisdomSeed` field instead. |
| `RaceSolverBuilder.ts` | Entry point — see above. |
| `ConditionParser.ts` | The Pratt parser for the skill-condition DSL. Generic over condition/operator tables (`getParser<ConditionT, OperatorT>`), reused by `tools/skillgrep.ts` and `tools/ToolCLI.ts`. |
| `ActivationConditions.ts` | The `Conditions` table (117 named conditions: `phase`, `corner`, `accumulatetime`, `hp_per`, `is_lastspurt`, order/blocked/overtake conditions modelled as Erlang randoms, etc.) plus the `And`/`Or`/comparison operator classes. |
| `ActivationSamplePolicy.ts` | Turns potential-activation region lists into concrete per-sample trigger regions: `ImmediatePolicy`, `RandomPolicy`, `UniformRandomPolicy`, `LogNormalRandomPolicy`, `ErlangRandomPolicy`, `StraightRandomPolicy`, `AllCornerRandomPolicy`. |
| `HpPolicy.ts` | `GameHpPolicy` (real stamina model, `maxHp = 0.8 * strategyCoef * stamina + distance`, standard `20*(v - baseSpeed + 12)^2/144` HP-per-second formula) vs `NoopHpPolicy` (always full HP). `getLastSpurtPair()` is the key last-spurt/survival-rate routine. |
| `ApproximateConditions.ts` / `SpecialConditions.ts` | Fork additions. Model *ongoing* race situations (blocked side, overtake) as tick-by-tick Markov chains, distinct from the static, pre-race condition reduction in `ActivationConditions.ts`. |
| `CourseData.ts` | Track geometry types + `getCourse(courseId)`, which loads and deep-freezes `data/course_data.json`. |
| `Region.ts` | The `[start, end)` interval abstraction everything else builds on. |
| `HorseTypes.ts`, `RaceParameters.ts`, `Random.ts` | Leaf type/enum modules. Note: `Rule30CARng` (`Random.ts:44`) is just an alias for the prando-backed `SeededRng` — the name is a leftover from a since-replaced rule-30-cellular-automaton RNG, kept because every call site uses it. |

## How the UI layers on top

- `components/` holds the shared Preact pieces: `HorseDef.tsx`/`HorseDefTypes.ts` (uma stat editor + the `HorseState` Immutable `Record`), `SkillList.tsx`/`SkillPicker.tsx` (skill search/pick UI, including the condition pretty-printer built on `ConditionParser`), `RaceTrack.tsx` (SVG course renderer + skill trigger-region overlay), `Language.tsx` (i18n context), `Tooltip.tsx`.
- The Umalator apps run simulations off the main thread, both in Compare mode and in the statistical chart modes (`Mode.Chart`/`Mode.UniquesChart`/`Mode.CourseChart`) — the latter through a small pool module, `umalator/workerPool.ts`, wrapping `Worker('./simulator.worker.js')` instances. All three chart modes share this same pool and ladder machinery unmodified; Course Chart (UI-23) differs only in what `HorseState`/candidate list/`analysisOptions` it hands to `doBasinnChart()`, not in how the pool or ladder run. See [statistical-analysis.md](statistical-analysis.md) for the chart's full data flow: paired scenario blocks (`umalator/compare.ts`'s `runComparisonBlock`), an adaptive round ladder that eliminates non-competitive candidates early (`umalator/chartLadder.ts`), and detail-on-demand re-simulation for an expanded row rather than retaining full per-tick traces for every candidate up front.
- `vendor/table-core` and `vendor/preact-table` are a vendored copy of TanStack table-core plus a Preact adapter, used only by `umalator/BasinnChart.tsx`'s results table. Wired in via each `build.mjs`'s `redirectTable` esbuild plugin, which rewrites `@tanstack/*` imports to `vendor/<name>/index.ts`.

See [apps.md](apps.md) for how each sub-app assembles these pieces, and [deployment.md](deployment.md) for how the whole thing gets served.

## Known issues

Worth knowing before touching this code — none of these are fixed in this docs pass, they're recorded so they don't get rediscovered from scratch:

- ~~Dead `EnhancedHpPolicy` import~~ **Fix pending** (HP-5, submodule PR `mackoz/uma-skill-tools#13` — open, not yet merged as of this writing): `uma-skill-tools/RaceSolverBuilder.ts:11` still imports `EnhancedHpPolicy` from a file deleted upstream in `Werseter/uma-skill-tools@kachi`'s `604cc3dd` ("Cleanup + add sync RNG checkbox") — the symbol was never used. `umalator/compare.ts:5` never carried the import in this repo's own history (that half of the original claim was stale before this fix). This diverges from `Werseter@kachi`, which still has the dead line upstream today.
- ~~`SpurtCalculator.ts` is orphaned~~ **Fix pending** (HP-5, same PR — open, not yet merged): the file is deleted on that branch, not yet on `uma-skill-tools`' `master`. It was **not** collateral from the `EnhancedHpPolicy` removal as previously stated here — both files were added together in the same upstream commit (`b5e2bf95`, "Port VF skill-tools logic") and `SpurtCalculator.ts` never imported or was imported by `EnhancedHpPolicy.ts`; it had zero importers from the moment it was created. Its logic duplicated `HpPolicy.ts`'s `GameHpPolicy` (`calculateBaseSpeed`, the ground-consumption table, and the HP-per-second formula were all character-for-character matches).
- **`Rule30CARng` is a misnomer** (`Random.ts:44`) for a prando-backed PRNG.
- **`OrOperator` (`ActivationConditions.ts:140-151`) has a documented FIXME**: the `@` (or) operator doesn't correctly propagate dynamic conditions per-region when both static *and* dynamic conditions differ between its two branches. Currently safe only because no shipped skill hits that combination — the same underlying limitation is why Restless doesn't activate correctly on Kyoto 3000m: its immediate trigger region is the 1st uphill, but the dynamic condition (`accumulatetime >= 5s`) doesn't resolve true until the uma is already on the 2nd uphill, outside the pre-calculated region.
- ~~Index misalignment~~ **Fixed** (submodule commit `78420b1`, included as of the `261d3b7` pin above): `RaceSolverBuilder.ts`'s `build()` used to read `originWisdom` back via `this._skills[sdi].originWisdom`, misattributing it once a skill produced more than one trigger, and throwing `TypeError: Cannot read properties of undefined (reading 'originWisdom')` once `sdi` ran past `this._skills.length` — the two arrays didn't line up once the `asiwotameru`/`staminasyoubu` extra-skill hooks appended entries. Fixed by threading `originWisdom` onto each per-trigger `SkillData` entry in `buildSkillData`, so `build()` now reads it via `sd.originWisdom` (`RaceSolverBuilder.ts:877`) instead of cross-referencing the pre-flatten array.
- **`components/autocomplete.jsx`** is a vendored fork of `accessible-autocomplete/preact` that nothing currently imports (`umadle/app.tsx` uses the npm package directly instead) — dead code.
- **`components/icon_types.json`** is unreferenced; the icon-prefix table now lives once in `components/SkillIcons.ts` (`ICON_ID_PREFIXES`), shared by `SkillList.tsx`, `SkillPicker.tsx`, `umalator/app.tsx`'s Skill Chart filter, and `umalator/BasinnChart.tsx` — previously `SkillList.tsx` and `SkillPicker.tsx` each hardcoded their own copy (and `umalator/app.tsx` a third), which is exactly the kind of duplication `icon_types.json` looks like it was meant to replace but doesn't.
- **A handful of shipped skill conditions aren't registered** in `ActivationConditions.ts`'s `Conditions` table: `temptation_opponent_count_behind`/`temptation_opponent_count_infront` and `is_other_character_activate_advantage_skill` in Global data (5 skill IDs: *Trick (Front)*, *Trick (Rear)*, *Tantalizing Trick*, *Catch 'Em Off Guard*, *Oppression*), plus 11 more JP-only names (`furlong`, `is_abroad`, `run_at_full_speed_random`, etc.) — 14 unregistered names total. Referencing one throws `ConditionParser`'s `ParseError: unknown condition: <name>` at skill-build time — deliberately not implemented as part of the SKL-6 fix (`is_activate_any_skill`, `order_rate_in50_continue`, `last_straight_random`, `activate_count_later_half`, which *were* fixed).
