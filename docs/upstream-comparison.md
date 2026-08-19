# Upstream comparison

This fork descends from [`alpha123/uma-tools`](https://github.com/alpha123/uma-tools), which is still actively maintained. This page documents how the two have diverged since the split: what this fork changed, what upstream has done since, and where the two independently solved the same problem (sometimes identically, sometimes not).

This is a point-in-time comparison, not a live diff — see [Snapshot](#snapshot) for the exact commits it's checked against, and [Reproducing this comparison](#reproducing-this-comparison) if you want to re-run it against newer commits on either side.

## At a glance

| | Upstream (`alpha123/uma-tools`) | This fork |
|---|---|---|
| Fork point | `292309c` ("rebuild"), 2025-10-09 | same |
| Commits since fork point | **351** | 205 |
| HEAD at snapshot time | `cdb7ead`, 2026-08-18 | `4401e25`, 2026-07-07 |
| JP umas / skills / courses | **141 / 2097 / 121*** | 130 / 1861 / 121 |
| Global umas / skills / courses | 64 / **692** / **119** | 64 / 652 / 107 |
| Race solver (`RaceSolver.ts`) | 670–762 lines (see [three reference points](#the-comparison-has-three-reference-points-not-two)) | **1508 lines** |
| Docs / CI | none | this `docs/` tree, GitHub Actions deploy |

*JP course count is from the engine repo's own data, not the pinned submodule — see below.

Upstream is ahead on commit count, game data, and general UI polish. This fork is ahead on race-solver depth (multi-uma simulation, lane movement, position-keep states, compete/lead competition). Several features both changelogs describe as their own turn out to be **independent implementations of the same fix**, not something one side has and the other lacks — see [Where both converged independently](#where-both-converged-independently).

## The comparison has three reference points, not two

This is the single most important thing to get right when reading (or extending) this doc — a plain `diff` between the two checked-out repos gives a misleading answer.

| Reference point | What it is | `RaceSolver.ts` |
|---|---|---|
| **A. Upstream app, as pinned** | Upstream's `uma-tools` repo still treats `uma-skill-tools/` as a **git submodule**, pinned at commit `6ba5ca0`, dated **2025-07-31** — i.e. *before* the fork point. | 670 lines |
| **B. Upstream engine repo, HEAD** | `alpha123/uma-skill-tools`'s own `origin/master`, **51 commits past the pin**, last touched 2026-03-17 (`8b3f5e2`). | 762 lines |
| **C. This fork** | Vendored in-tree (submodule removed in `7a4949a`, 2025-10-12). | **1508 lines** |

Upstream's own `uma-tools` checkout points at a **year-stale** engine pin — corroborated by upstream's own app code calling `buildSkillData` with 9 arguments against the pinned engine's 8-parameter signature (a mismatch that would only make sense if the app had moved past what's pinned).

**Comparing C against A alone — what you get from a naive `diff -r` of the two checkouts — overstates how unique this fork's engine work is.** Several mechanics this fork's changelog claims as improvements (kakari/rushed, downhill mode, wisdom-gated skill activation, the 60m spurt fix) were independently implemented upstream **in the engine repo, after the pin** — invisible unless you diff against B. Every "upstream doesn't have this" claim below has been checked against B, not just A.

## Lineage, accurately

The README used to describe a strictly linear chain: `alpha123 → IHATEJEKUTO/VFalator → kachi-dev → this fork`. The actual git history doesn't support that shape.

- **Fork point:** commit `292309c` ("rebuild"), 2025-10-09 — found by intersecting the two repos' commit-SHA sets (252 commits are shared; `292309c` is the newest one present in both).
- **Kachi forked `alpha123/uma-tools` directly**, first commit 2025-10-10 — one day after the fork point.
- That first commit, `Add vflator changes` (+1195/−174 across 18 files), **imported [`IHATEJEKUTO/VFalator-Umalator-Fork-Yeah`](https://github.com/IHATEJEKUTO/VFalator-Umalator-Fork-Yeah)'s changes as a single squashed diff**, and simultaneously repointed `.gitmodules` from `alpha123/uma-skill-tools` to `kachi-dev/uma-skill-tools`.
- IHATEJEKUTO then began committing **into kachi-dev's own repo** starting 2025-10-13; their later "merge" commits pull *from* kachi-dev, not the other way around.
- The engine submodule was flattened into the tree in `7a4949a` (2025-10-12). At that point it still carried `EnhancedHpPolicy.ts` (397 lines) and `RaceSolverEnhanced.ts` (126 lines) — both later deleted, which is the origin of the dangling `EnhancedHpPolicy` imports noted in [architecture.md](architecture.md#known-issues).

So VFalator is a **source that got merged in**, not a link in a linear ancestry chain. "alpha123 → kachi-dev (absorbing VFalator's diff) → this fork" is the accurate shape.

Commit authorship since the fork point: fork — Kachi 133, IHATEJEKUTO 41, Jecht 26 (same email address as IHATEJEKUTO), plus a handful of drive-by PRs. Upstream — almost entirely alpha123 (588 of 603 total commits).

## What the fork added

### Engine (`uma-skill-tools/`)

The headline number is `RaceSolver.ts` going from 670 (pinned) / 762 (upstream engine HEAD) to **1508 lines**. What that growth actually is, checked against reference point B (not just A):

- **Multi-uma field.** Upstream models one uma plus a single dumb pacer (`pacer: RaceSolver | null`, stepped inline). The fork replaces this with `umas: RaceSolver[]` and `initUmas()`, plus `getPacer()` (`RaceSolver.ts:782-827`), which **re-elects the pacemaker every frame** — furthest-forward Oonige, else Nige, else a flagged override, else a "lucky pace" promotion that mutates another uma's `posKeepStrategy`. Stepping moved out of the solver into `umalator/compare.ts:248-268`. Nearly everything else below is downstream of this change.
- **Position keep: a 5-state machine.** Upstream (both A and B) has pace-down only. The fork adds `PositionKeepState {None,PaceUp,PaceDown,SpeedUp,Overtake}`, `applyPositionKeepStates()` (`RaceSolver.ts:852-999`), wit-gated entry rolls with retry cooldowns, and a `PosKeepMode` selector (`None`/`Approximate`/`Virtual`) surfaced in the UI.
- **Lane movement — entirely new.** `applyLaneMovement()` (`RaceSolver.ts:723-773`), two new skill types (`LaneMovementSpeed=28`, `ChangeLane=35`), and seven new `CourseData` fields (`laneMax`, `courseWidth`, `horseLane`, `laneChangeAcceleration`, ...). Zero occurrences of "lane" in upstream's engine at either reference point. (Note: `laneMax` already existed in upstream's `course_data.json`, byte-identical between trees — upstream simply never typed or used it.)
- **Compete fight and lead competition — entirely new.** `updateCompeteFight()` / `updateLeadCompetition()` (`RaceSolver.ts:1035-1127`), guts-scaled speed/accel bonuses, modelling the late-race duel and early-Nige-pileup mechanics.
- **Two Markov-chain condition files, fork-only:** `ApproximateConditions.ts` (69 lines — generic tick-driven two-state chains) and `SpecialConditions.ts` (59 lines — concrete blocked-side/overtake rate tables). Model *ongoing* race situations probabilistically, distinct from the static pre-race condition reduction in `ActivationConditions.ts`.
- **Integration rewritten.** Upstream uses velocity-Verlet with a half-step, routed through `getMaxSpeed()`. The fork uses forward Euler with a directional clamp and deletes `getMaxSpeed()` entirely. Frame ordering also flipped: upstream displaces the uma then updates state; the fork updates state then displaces.
- **`Random.ts` replaced wholesale.** Upstream implements a genuine Rule-30 cellular-automaton PRNG (113 lines, with PractRand-quality commentary). The fork wraps the `prando` npm package in 29 lines and keeps the name: `export const Rule30CARng = SeededRng` (`Random.ts:29`). This is a real trap for anyone reading call sites — `Rule30CARng` reads like the CA generator but isn't. Concretely: the two-argument form `new Rule30CARng(lo, hi)` silently drops its second argument, `.hi`/`.lo` no longer exist, and **no fork simulation result is numerically comparable to any upstream result**, even with the same nominal seed.

`SpurtCalculator.ts` (331 lines, ported from `umasim`) is also fork-only but has **zero importers** anywhere in the repo — see [architecture.md](architecture.md#known-issues).

### UI / app

- **Extracted skill picker.** `components/SkillPicker.tsx` (557 lines) — a real modal with search, sort (rarity/alpha/game-order), and a filter matrix (rarity/strategy/distance/surface/location). Upstream never extracted this; its skill picker is inline in `HorseDef.tsx:705-707`, a slide-in wrapper directly around `SkillList`.
- **Gemini OCR** (`umalator/GeminiOCR.ts`, 206 lines + `components/OCRModal.tsx`) — reads stats/skills off a screenshot via the Gemini API, using a key the user supplies. This is a genuinely different design choice from upstream's local OCR, not a gap on either side — see [Divergent by design](#divergent-by-design).
- Roster import/decode (`rosterDecoder.ts`, 304 lines), local build save/load (`storage.ts`, 187 lines), a roster browser tab (`components/UmasTab.tsx`, 747 lines), an extracted results panel (`components/ResultsPane.tsx`, 485 lines).
- Theming/dark mode, a mobile layout (`useMobile()` + a bottom-sheet dialog pattern), a duel-configuration panel with five per-strategy sliders, a sync-RNG toggle, and `forcedSkillPositions` (drag a skill's activation marker directly on the track).
- Net effect on the shared app source: `umalator/app.tsx` grew from a 794-line common ancestor to 1224 lines upstream and **3170 lines** in this fork.
- Pipeline: `umalator-global/make_global_course_data.pl` plus 110 `courseeventparams/` JSON files — fork-only, not present upstream.

## Where both converged independently

This is the part worth reading closely if you're relying on this fork's own changelog ([fork-changes.md](fork-changes.md)) to understand what makes it different from stock Umalator. Several of its headline claims describe fixes that **upstream made independently, in the engine repo, after the fork point** — invisible in a checkout diff (reference point A) but present at reference point B.

| Fork changelog claim | Upstream equivalent | Verdict |
|---|---|---|
| "Wit variance: Rushed" | `isKakari` / `kakariStart` / `updateKakari()`, engine commits from 2025-12 onward | **Upstream's is more complete.** It has `ExtendKakari` (skill type 13) and `ModifyKakariChance` (type 29), which the fork lacks, and kakari actually gates speed/accel. The fork's `isRushed` only feeds an HP multiplier — see the "unsure" note below. |
| "Wit variance: Downhill Mode" | "implement downhill speedup mode" (upstream engine, 2025-12-05) — `isDownhillMode`, `downhillTimer`, per-hill RNG | Both sides have it, including the same per-hill-RNG design reasoning. |
| "Wit variance: Skill Proc Chance" | "implement wisdom checks for skill activation" (2025-12-07), refined 2025-12-10 / 2026-02-09 / 2026-02-24 | Both have it; upstream additionally fixed debuff-wisdom attribution to the debuffer rather than the debuffed uma. |
| "Fixed non-full spurts (delayed by 60m)" | "fix delayed spurts starting 60m late" (upstream engine, 2025-12-05) | Same underlying fix, different code shape (`+ 60` on the candidate vs the fork's `- spurtDistance - 60`). |
| "Fixed section modifier applying beyond late-race" | "fix last spurt speed not overriding per-section wisdom variance modifier" (upstream engine, 2026-03-12) | Same fix. |
| "Removed HP consumption from skill/uma chart" | — no upstream equivalent | **Genuinely fork-only.** Mechanism: `RaceSolverBuilder.build()` selects `GameHpPolicy` only when `_mode === 'compare'`, else `NoopHpPolicy` (`RaceSolverBuilder.ts:864`). Upstream always uses `GameHpPolicy`. Worth knowing: this also means any fork simulation run in a non-compare mode has **infinite stamina**, not just the skill chart specifically. |

**Naming trap:** upstream calls this mechanic **kakari**; the fork calls it **rushed**. Grepping the fork's term against upstream's source returns nothing and looks like "upstream doesn't have this" — it does, under the other name.

## What upstream added that this fork doesn't have

### Apps and shared infrastructure

- **`sorter/`** — a whole additional app, absent from the fork. An interactive uma-ranking tool (~593 lines of hand-written source + ~48MB of character stand images). `sort.ts` implements a bitset-DAG merge-insertion sort designed to minimize the number of comparisons a human has to make, tracking a transitive-closure bit matrix as a `Uint32Array`.
- **`optics.ts`** (226 lines) — a lens library plus a Preact fine-grained-subscription state store (`useLens`/`useGetter`/`useSetter`). Upstream migrated its **entire UI** to this (9 importers: `app.tsx`, `HorseDef.tsx`, `SkillList.tsx`, `HorseOcr.tsx`, `HorseSaveMngr.tsx`, `BasinnChart.tsx`, `StaCalc.tsx`, `build-planner/app.tsx`, `skill-visualizer/app.tsx`). This fork never adopted it and stayed on plain `useState`/`useReducer` plus Immutable.js `Record` — this is the deepest architectural split in the UI layer between the two trees.
- **`buildtools.mjs`** (126 lines) — a shared esbuild harness exporting `buildOrServe()`. All six of upstream's `build.mjs` files use it, each reduced to roughly 20 declarative lines, with a shared in-memory `--serve` dev server. This fork still carries three separately copy-pasted `build.mjs` files (up to 176 lines each) and has **no `build.mjs` at all** for `build-planner/` or `skill-visualizer/` — those two apps upstream modernized off the legacy `.bat` scripts; this fork did not.
- **`UmaUI.css`** — shared in-game-styled button/panel primitives, 3 importers upstream, absent here.

### Features

- Stamina calculator mode (`umalator/StaCalc.tsx` + `hpcalc.ts`, a third `Mode.StaCalc`).
- Local, in-browser OCR (`components/ocr.ts` + `HorseOcr.tsx`) via `vendor/tesseract.js` + `vendor/opencv.js` — no external API call, unlike this fork's Gemini approach.
- An uma save manager (`components/HorseSaveMngr.tsx`) and a build-score calculator (`components/scorecalc.ts`).
- Hint levels tracked in URL state with skill-cost columns in the results table; stats uncapped above 2000 with dedicated rank icons; a per-skill sample-policy editor in `SkillList.tsx`; URL routing for `/compare`, `/skills`, `/stamina` sub-pages.

### Data pipeline

The most operationally significant gap:

- **`AssetExtractor.pm`** (upstream-only) defeats the game client's asset encryption — a chacha20-encrypted `meta` manifest DB plus a per-asset XOR keystream applied past byte offset 256, added upstream 2026-02-23. **This fork's `extract_resource.pl` does not decrypt anything and cannot extract assets from the current game client.**
- Upstream's `make_skill_meta.pl`/`make_uma_info.pl` also gained: missing-icon-id synthesis (mapping ability type to a fallback green/heal icon), unique-skill group folding across rarity tiers, a `grade_value`→`score` field, and paired `_01`/`_02` (untrained/trained-border) icon variants. None of these are in the fork's copies.
- **Upstream fixed the shared `use Encoding` typo**; this fork still has it in two files (`make_uma_info.pl`, `uma-skill-tools/tools/make_skillnames.pl`). Provenance matters here: the typo was introduced in a commit both trees share (`bf719a1`) and only removed upstream, in `a1c3562` (2026-02-23) — four months after the fork point. **It's an inherited bug, not something this fork introduced**; see the correction in [data-pipeline.md](data-pipeline.md#known-bugs-in-the-pipeline-scripts).

### Game data

Verified directly against both trees' committed JSON:

| | Upstream | Fork |
|---|---|---|
| JP umas | **141** | 130 |
| JP skills | **2097** | 1861 |
| Global skills | **692** | 652 |
| Global courses | **119** | 107 |
| Global umas | 64 | 64 |

The fork's data is a **strict subset** of upstream's on every key checked — no uma, skill, or course id exists only in the fork's JSON. Upstream's schema is also structurally richer: each outfit record carries `{aptitudes: [10 values], awakenings, epithet, rarity, strategy}`, where this fork stores a bare epithet string and drops the rest.

(One place the fork's *numbers* look higher — `uma-skill-tools/data/{skill_data,skillnames}.json`, ~1861/2474 fork vs ~1716/2284 in upstream's checkout — is an artifact of upstream's stale submodule pin, not better fork data. Upstream's live root `skill_meta.json` above is ahead either way.)

These counts are a snapshot and will drift out of date immediately — see [upstream-data-sync.md](upstream-data-sync.md) for a script that reports (and can close) the current gap, rather than trying to keep exact numbers in sync across two docs.

## Divergent by design

Not gaps on either side — genuinely different choices for the same problem:

- **OCR.** Fork: cloud Gemini API call with a user-supplied key. Upstream: fully local, `tesseract.js` + `opencv.js` WASM in-browser, no network call and no API key needed, at the cost of a much larger asset payload (`vendor/opencv.js` alone is ~11MB).
- **State management.** Fork: `useState`/`useReducer` + Immutable.js `Record` (`HorseDefTypes.ts`). Upstream: the `optics.ts` lens/subscription system, and `HorseState` there is a plain interface with explicit `serializeUma`/`deserializeUma` functions rather than a Record class.
- **Skill picker.** Fork: extracted into `components/SkillPicker.tsx`, a standalone searchable modal. Upstream: kept inline as a slide-in wrapper directly around `SkillList` in `HorseDef.tsx`.
- **`skill-visualizer-global`.** Upstream compiles **one** `skill-visualizer/app.tsx` twice, with `CC_GLOBAL` and a locale-string table doing the branching (`build.mjs`'s `entryPoints: [{in: '../skill-visualizer/app.tsx', ...}]`). This fork instead has **two independently drifting copies** of the file — see the bug this causes, below.

## Known gaps and bugs surfaced by this comparison

Recorded here as findings; none of these are fixed as part of this doc pass.

- **`buildSkillData` call-site arity mismatches**, all fork-only: `skill-visualizer/app.tsx:96` and `skill-visualizer-global/app.tsx:96` pass 7 arguments to an 8-parameter function, so `true` lands in the `perspective` parameter; `build-planner/app.tsx:53` still uses a 5-argument signature from an earlier version of the function.
- **`skill-visualizer/app.tsx` and `skill-visualizer-global/app.tsx` have drifted from each other within this fork** — a direct consequence of the fork duplicating a file upstream keeps as one compiled-twice source (see above). The `-global` copy uses an array-returning `buildSkillData` result; the plain copy still treats it as a single object.
- **`build-planner/`'s source is a 75-line 2023-era stub** (course/skill hardcoded, no language selector), while upstream's is 380 lines with a `glpk.js`-based linear-programming skill optimizer and support-card search. This fork's `build-planner/index.html` loads `bundle.2.js` because there's no `build.mjs` capable of producing a proper minified `bundle.js` — see [apps.md](apps.md#build-planner) for the existing note on this; this doc adds the "why" upstream doesn't have the same issue.
- **Flagged as unverified, not confirmed** — worth checking before relying on them: the `minSpeed` floor at `RaceSolver.ts:694` tests the *previous* frame's `currentSpeed` rather than the newly computed speed; `modifiers.oneFrameAccel` is still written and zeroed each frame but no longer read anywhere in the velocity update; `posKeepCooldown`, `speedUpProbability`, and `forceInSpeed` are all assigned but never read anywhere (`speedUpProbability` in particular is threaded all the way from `RaceSolverBuilder.pacerSpeedUpRate()` through the constructor and then dropped, which suggests an unfinished feature rather than dead cruft).

## Corrections to other docs in this repo

A few claims elsewhere in `docs/` turned out to be about upstream's behavior, not this fork's, once checked against the actual history:

- The `/uma-tools/` absolute asset prefix (see [deployment.md](deployment.md)) is **inherited from upstream** — it appears 77 times in upstream's source too. It isn't a choice this fork made.
- The `use Encoding` typo (see [data-pipeline.md](data-pipeline.md#known-bugs-in-the-pipeline-scripts)) is **inherited from a shared commit**, later fixed upstream — not introduced by this fork.
- Presets are **not** an upstream-only addition — the system predates the fork point (this fork's `app.tsx` has 10 `preset` references, upstream has 12). Upstream has simply kept adding CM/LOH preset entries since; the feature itself is shared.

## Reproducing this comparison

```sh
# Find the fork point (newest commit shared by both repos):
comm -12 <(git -C /path/to/fork log --format='%H' | sort) \
         <(git -C /path/to/upstream log --format='%H' | sort) \
  | xargs -I{} git -C /path/to/upstream log -1 --format='%H %ci %s' {} \
  | sort -k2 | tail -1

# Upstream's engine is a submodule and needs initializing to compare source:
git -C /path/to/upstream submodule update --init uma-skill-tools

# IMPORTANT: don't stop at the pinned commit — check the engine repo's own HEAD too,
# since upstream's uma-tools pin lags its own uma-skill-tools repo by months:
cd /path/to/upstream/uma-skill-tools && git fetch origin && git log --oneline HEAD..origin/master

# The two trees use different line endings (upstream CRLF, fork LF) — always
# normalize or every diff count comes out roughly doubled:
diff --strip-trailing-cr <(git -C /path/to/upstream show origin/master:RaceSolver.ts) \
                          /path/to/fork/uma-skill-tools/RaceSolver.ts
```

## Snapshot

This comparison reflects:

- **Upstream `uma-tools`:** `cdb7ead`, 2026-08-18 ("update game data (global)")
- **Upstream `uma-skill-tools` (engine repo, `origin/master`):** `8b3f5e2`, 2026-03-17
- **Upstream `uma-skill-tools` (as pinned by upstream's `uma-tools`):** `6ba5ca0`, 2025-07-31
- **This fork:** `4401e25`, 2026-07-07

Re-run the commands above against newer commits if you need a current answer.
