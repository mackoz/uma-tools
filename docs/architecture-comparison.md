# Architecture: fork vs. upstream

A side-by-side comparison of *how this fork and upstream are built*, not what game data or features each has. Every section ends with an **ELI5** — skip straight to those if the file:line detail isn't what you're after.

**Related docs, and how this one is different:**
- [architecture.md](architecture.md) — this fork's engine, on its own, in depth.
- [upstream-architecture.md](upstream-architecture.md) — upstream's engine and app layer, on its own, in depth.
- [upstream-comparison.md](upstream-comparison.md) — *lineage, features, and game data*: who added what, when, commit counts, uma/skill/course numbers. Read that one if the question is "what's new."
- **This doc** — *structure and design only*: where code lives, how a physics tick is ordered, how state is managed, how builds are wired. Read this one if the question is "why does this code look different."

"Upstream" here means the app repo at `cdb7ead` plus its engine at two points — the commit its `.gitmodules` pins (**A**, `6ba5ca0`) and the engine repo's own newest public commit (**B**, `origin/master`, `8b3f5e2`) — because a few differences below exist at A and vanish at B. Anything not labeled applies to both. No game-data counts appear anywhere in this doc; see `upstream-comparison.md` for those.

## Where the engine lives

Both sides keep `uma-skill-tools` as a real **git submodule** now — `.gitmodules` points at a specific fork, pinned to a specific commit, `git submodule update --init` fetches it as its own repo-within-a-repo. Upstream points at `alpha123/uma-skill-tools`; this fork points at [`mackoz/uma-skill-tools`](https://github.com/mackoz/uma-skill-tools) (itself a fork of `alpha123/uma-skill-tools`, carrying the modifications described throughout this doc). The real remaining difference is *which engine fork* each side pins, not *whether* one is vendored.

This wasn't always true: this fork vendored the engine in-tree for a while (flattened out of a submodule in commit `7a4949a`, re-submodule'd later) — while it was vendored, it couldn't pull in a newer engine with `git submodule update`, which is the whole reason `scripts/sync-upstream-data.mjs` and [upstream-data-sync.md](upstream-data-sync.md) exist as a manual workaround for *game data* specifically. That workaround is still needed for data (this fork's own pipeline can't run against the encrypted live client — see `data-pipeline.md`), even though the engine *code* itself can now be pulled in the normal way.

**ELI5:** Upstream's simulator code is a separate project that gets *linked in*, like a library you install. This fork's copy of that same code was cut loose from its original project and pasted directly into the repo — it works fine, but it can no longer be updated with a simple "pull the latest library," someone has to manually copy changes over.

## What the solver actually simulates

Upstream's `RaceSolver` simulates **one uma**, plus an optional second `RaceSolver` acting as a "pacer" — a dumb reference clock with no HP tracking that's never blocked and never overtaken. This is explicit, stated design: the README says *"Does not fully simulate a race, only simulates one uma… This is by design."*

This fork's `RaceSolver` simulates **the whole field**: `umas: RaceSolver[]` (`RaceSolver.ts:274`), wired up by `initUmas()` (`:544`), with `getPacer()` (`:782`) re-electing whichever uma is actually in front as the pacemaker *every single frame* rather than fixing one in advance.

This one change is the root of almost every other engine difference below — lane movement, position-keep states, compete/lead-competition, and rushed state all only make sense once there's more than one uma to interact with.

**ELI5:** Upstream runs one racehorse against a stopwatch. This fork runs the whole field at once, so horses can actually bump into, chase, and react to each other — which is also why the fork's simulator has so much more code.

## The physics tick — order and integration method

Two real behavioral differences, not just extra features:

**Integrator.** Upstream uses velocity-Verlet: half a velocity step, move, then finish the velocity step with the result (`RaceSolver.ts:413–425` at the pin). The fork uses forward Euler — clamp current speed toward a target speed each tick, then move (`:683–698`).

**Order.** Upstream advances `pos` **before** updating hills, phase, and skills (`:415`), so a skill that triggers this tick only affects movement starting *next* tick. The fork advances `pos` **last** (`:707`), after every other update, so a skill that triggers this tick affects this tick's movement immediately.

| Upstream `step()` (16 calls, pin) | Fork `step()` (21 calls) |
|---|---|
| pacer sub-step | — |
| half-step velocity | — |
| `pos +=` | *(moved to the end — see below)* |
| `hp.tick()` | — |
| tick timers | tick timers |
| — | `tickConditions()` (gated) |
| — | start-delay accumulator / early return |
| `updateHills()` | `updateHills()` |
| `updatePhase()` | `updatePhase()` |
| — | **`updateRushedState()`** |
| `processSkillActivations()` | `processSkillActivations()` |
| — | **`applyPositionKeepStates()`** |
| `updatePositionKeep()` | **`updatePositionKeepCoefficient()`** |
| — | **`updateCompeteFight()`** |
| — | **`updateLeadCompetition()`** |
| `updateLastSpurtState()` | `updateLastSpurtState()` |
| `updateTargetSpeed()` | `updateTargetSpeed()` |
| `applyForces()` | `applyForces()` |
| — | **`applyLaneMovement()`** (gated) |
| second half-step velocity | speed clamp toward target, start-dash cap, min-speed floor |
| min-speed clamp / start-dash exit | `pos +=` *(here, not at the top)* |
| — | `hp.tick()` *(here, not near the top)* |
| — | HP-death bookkeeping |
| start-dash exit | start-dash exit |

Bold rows have no upstream-A equivalent (some, like a rushed-state update, exist at B under a different name — see [Where they converged independently](#where-they-converged-independently)).

**ELI5:** Both simulators move a horse forward once per tick, but they disagree on *when* during that tick to actually update its position, and by how big a "step" they trust their own physics math. In practice this means the fork's tick does noticeably more bookkeeping per frame — checking for lane changes, duels, and pacing states that upstream's single-horse tick has no need to check.

## Randomness

Same class name, genuinely different implementation. Upstream's `Rule30CARng` (`Random.ts:21`, at the pin) is a real **rule-30 cellular automaton**: 64 bits of state across two words, updated by bit-parallel `left XOR (center OR right)`, with the author's own PractRand test notes in the comments. This fork's `Rule30CARng` (`Random.ts:29`) is one line — `export const Rule30CARng = SeededRng`, an alias for a `prando`-backed PRNG. No CA state, no bit evolution. The name survives only because every engine call site still says `new Rule30CARng(...)`.

RNG *count* also differs sharply. Upstream's `RaceSolver` owns 3 sub-RNGs (`rng`, `gorosiRng`, `paceEffectRng`) plus one on `GameHpPolicy`. This fork's owns 10 declared fields (`:237–246`) — `syncRng`, `gorosiRng`, `rushedRng`, `downhillRng[]`, `wisdomRollRng`, `posKeepRng`, `laneMovementRng`, `specialConditionRng`, `competeFightRng`, plus the base `rng` — with `downhillRng` actually being one instance *per course slope*, so total instances are `9 + slopes.length`. The point of splitting them this finely: toggling one subsystem on or off in a paired comparison run can't perturb any other subsystem's random stream.

One more wrinkle specific to the fork's Global build: `umalator-global/build.mjs:60` injects a *third*, independent PRNG implementation (a hand-rolled xorshift `seedrandom` shim) for anything that imports the `seedrandom` package. Upstream has no equivalent because nothing in its tree imports `seedrandom`.

**ELI5:** Both simulators have a class called `Rule30CARng`, but upstream's is an actual, carefully-tuned custom random-number generator, while the fork's is just a different, off-the-shelf one wearing upstream's name tag. Separately, the fork hands out *far* more independent "dice" than upstream does — one set per subsystem — specifically so that turning one feature on or off in a test run doesn't accidentally change the outcome of an unrelated feature.

## Engine file inventory

Upstream: 11 top-level `.ts` files, 3246 lines. This fork: 14 — the same 11, plus:

- **`ApproximateConditions.ts`** and **`SpecialConditions.ts`** — a tick-by-tick Markov-chain layer modeling *ongoing* race situations (blocked side, overtake opportunities) as runtime state that evolves each frame. Upstream has no equivalent runtime layer for this — it models the same game conditions as static, pre-race probability stubs (`noopErlangRandom` and similar) that never look at what's actually happening mid-race.
- **`SpurtCalculator.ts`** — present but orphaned; nothing imports it. Ported from an external project (`umasim`) for a since-deleted HP policy variant.

Line counts tell the same story as the field-simulation difference above: `RaceSolver.ts` is 670 lines at the pin (A), 762 at engine `origin/master` (B), **1508** in this fork. `RaceSolverBuilder.ts` is 708 at A, **888** in this fork.

**ELI5:** The fork's simulator has three extra files upstream doesn't need, because the fork tracks things — like "is this horse currently boxed in by another horse right now" — that only make sense once you're simulating more than one horse at a time.

## App state management

Upstream's entire app-state architecture is one home-grown file, `optics.ts` — a Proxy-based lens library (`O.uma1.skills` builds a path, calling it reads, `new`-ing it with a function writes an immutable update) paired with a state layer that lives *outside* preact's own state, in a `useRef` with a manually-managed listener `Set`, re-rendering only when `!Object.is(prev, next)`. `HorseState` there is a plain TypeScript interface — `immutable` isn't even a dependency.

This fork has **no `optics.ts`** at all. `HorseState` is an Immutable.js `Record` (`components/HorseDefTypes.ts:28`, `immutable ^5.0.3` in `package.json:24`), and state flows through ordinary preact hooks (`useState`/`useMemo`/`useRef`). Records get converted with `.toJS()` at the web-worker boundary (`umalator/app.tsx:2215`) since structured-clone can't serialize an Immutable `Record` directly.

**ELI5:** Both apps need a way to track "what does this uma's stat sheet look like right now, and how do I update one field of it without breaking everything else." Upstream built its own custom tool for that from scratch. This fork instead reaches for a well-known off-the-shelf library (Immutable.js) that does the same job.

## Build system

Upstream factors its build logic into one shared file, `buildtools.mjs` (126 lines) — every app's `build.mjs` is a ~20-line stub that imports and calls it. Exactly two esbuild plugins total: a generic `redirect` map (which does *both* the `@tanstack/*` vendor alias *and* the JP→Global data-file swap with one mechanism) and `mockAssert`.

This fork has **no shared build helper** — three separate, self-contained `build.mjs` files (`umalator/`, `umalator-global/`, `skill-visualizer-global/`), with the two "global" builds each duplicating roughly 130 lines of dev-server code verbatim rather than sharing it. Four separately-named plugins do the same job split apart (`redirectData`, `mockAssert`, `redirectTable`, `seedrandomPlugin`). One asymmetry worth knowing if you're debugging locally: `umalator/build.mjs` has no `--serve` mode at all, only `umalator-global/build.mjs` and `skill-visualizer-global/build.mjs` do.

Both sides share the same "some apps are `.bat`-only, Windows-oriented, and not wired into CI" situation — see [apps.md](apps.md) and [deployment.md](deployment.md).

**ELI5:** Upstream wrote its build script once and every app reuses it. This fork copy-pasted the build script into each app instead, so the same logic exists in three places that all have to be kept in sync by hand.

## Shared components and apps

| | Upstream | Fork |
|---|---|---|
| Skill picker | inlined twice (`HorseDef.tsx:705`, `HorseOcr.tsx:75`) | a real shared component, `components/SkillPicker.tsx` |
| Skill proc/activation dialog | — | `components/SkillProcDataDialog.tsx` |
| Saved umas | `components/HorseSaveMngr.tsx` (IndexedDB + TanStack table) | app-local `umalator/storage.ts` |
| Screenshot import | `components/HorseOcr.tsx` + `components/ocr.ts`: local pipeline, opencv.js (10.9 MB) + 2 self-hosted tesseract.js workers | `umalator/GeminiOCR.ts` + `umalator/components/OCRModal.tsx`: calls out to a remote model over the network |
| Uma "score" calculator | `components/scorecalc.ts` (transliterated from a J program, source pasted in as a comment) | — |
| `sorter/` app (rank your favorite umas) | present | **absent** |

The screenshot-import row is the most architecturally interesting: both apps let you import an uma from a game screenshot, but upstream does 100% of that work in the browser (image preprocessing + two bundled OCR models, no network call), while the fork sends the screenshot to an external model and waits for a response. Same feature, opposite trust/latency/offline tradeoffs.

**ELI5:** Most of the shared UI pieces exist on both sides, just organized a little differently — upstream inlines the skill picker in two places instead of sharing it, and the fork skips upstream's "rank your umas" mini-game entirely. The one difference that actually matters: reading stats off a screenshot happens entirely on your own computer in upstream's version, but sends your screenshot to an outside service in this fork's version.

## Simulation dispatch / workers

Both apps spawn exactly 4 web workers, and both use the same lopsided split: only worker 1 handles the head-to-head compare mode, while all 4 are used only to shard the per-skill bashin chart by skill ID.

Where they differ: upstream's worker does **progressive refinement** — it posts partial results at increasing sample counts (3→17→30→50→100 for the chart; a geometric ramp for compare) so the UI visibly sharpens instead of waiting for one final number, merged on the main thread via `mergeResults`. This fork's worker instead handles three flat message types (`chart`/`compare`/`additional-samples`) with a manual fan-in counter (`chartWorkersCompletedRef`) that waits for all 4 workers to hit `chart-complete` before declaring the run finished. Also worth flagging while in this code: the fork calls `useMemo` inside a `.map()` callback when spawning the 4 workers (`app.tsx:2005`) — a React/preact hooks-rules violation that happens to be harmless only because the array being mapped is a fixed length of 4.

**ELI5:** Both apps split simulation work across 4 background threads the same way. Upstream's version shows you a rough answer immediately and keeps refining it live; this fork's version waits and shows one number once every thread reports back done.

## CI, deployment, docs

Upstream has **no `.github/` directory at all** — no CI, no Actions. Deploying means: build locally, commit the resulting bundles, push to `master`, and GitHub Pages serves that directly.

This fork has `.github/workflows/deploy.yml` — triggered on push to `master`, runs on node 20, rebuilds exactly 3 of the 8 apps (`umalator`, `umalator-global`, `skill-visualizer-global` — the ones with a working `build.mjs`), then publishes the *entire repo* (including the committed bundles for the other 5 apps, which CI never touches) to GitHub Pages.

Both sides still commit their build output either way — CI existing doesn't remove the "bundles are committed to git" rule (see `CLAUDE.md`). Neither side runs `tsc` anywhere in its build. Upstream has no `docs/` tree; this fork has the one you're reading now.

Both sides carry an `uma-skill-tools/test/` directory (`tape` + `fast-check` property tests + regression checkpoints) that's **unwired on both sides**: no test runner in the root `package.json`, the engine's own `package.json` still has the npm placeholder `"test": "echo \"Error: no test specified\" && exit 1"`, and neither CI pipeline (upstream has none; the fork's `deploy.yml` doesn't call it either) ever runs it. In the fork specifically, the newest committed regression checkpoint predates every subsystem the fork added — lane movement, position-keep states, compete/lead competition, downhill mode were all built with no regression baseline covering them.

**ELI5:** Neither project auto-tests its own simulator before shipping, though both keep the test code around. The fork additionally has an automated "build and publish the website" step that upstream does entirely by hand — but that automation only covers 3 of the 8 little apps in this repo; the rest still rely on someone remembering to rebuild and commit them manually.

## Where they converged independently

A few things that look fork-exclusive if you compare against upstream's *pinned* engine (A) turn out to exist upstream too, once you look at the engine repo's own newest commit (B) instead: rushed/kakari state and downhill mode were both added independently on **both** sides after the fork point — absent at A, present at B, present in the fork, each with its own separate implementation. If you diff the fork against what `git submodule update --init` actually gives you, these will misleadingly show up as fork inventions. See [upstream-comparison.md#where-both-converged-independently](upstream-comparison.md#where-both-converged-independently) for the fuller story, including which mechanics really are fork-only even after accounting for B.

**ELI5:** A couple of features that look like they were invented only by this fork were actually also added by upstream, just in a newer version of their engine than the one this fork usually gets compared against. Both teams happened to solve the same problem around the same time, independently.

## Cheat sheet

| | Upstream | This fork |
|---|---|---|
| Engine vendoring | git submodule, pinned at `alpha123/uma-skill-tools` | git submodule, pinned at `mackoz/uma-skill-tools` (a fork) |
| What's simulated | 1 uma + reference-clock pacer | whole field, N umas |
| Integrator | velocity-Verlet | forward Euler w/ clamping |
| Position update timing | before hills/phase/skills | after everything, last |
| `RaceSolver.ts` size | 670 (pin) / 762 (engine HEAD) | 1508 |
| `Rule30CARng` | real rule-30 cellular automaton | alias for prando |
| Sub-RNGs on `RaceSolver` | 3 | 10 (+1 per course slope) |
| Extra engine files | — | `ApproximateConditions.ts`, `SpecialConditions.ts`, `SpurtCalculator.ts` (orphaned) |
| App state | `optics.ts` (custom Proxy lenses) | Immutable.js `Record` |
| Build helper | shared `buildtools.mjs` | 3 duplicated standalone `build.mjs` |
| Skill picker | inlined twice | shared `SkillPicker.tsx` component |
| Saved umas | `HorseSaveMngr.tsx` (IndexedDB) | app-local `storage.ts` |
| Screenshot import | local opencv.js + tesseract.js | remote model call (`GeminiOCR.ts`) |
| `sorter/` app | present | absent |
| Worker result delivery | progressive refinement | wait-for-all, single result |
| CI | none | GitHub Actions → Pages (3/8 apps rebuilt) |
| `uma-skill-tools/test/` | present, unwired | present, unwired, stale checkpoints |
| Kakari / downhill mode | present at engine HEAD, absent at pin | present (independent implementation) |

## Snapshot

This page reflects:

- **Upstream `uma-tools`:** `cdb7ead`, 2026-08-18
- **Upstream `uma-skill-tools`, reference A (as pinned):** `6ba5ca0`, 2025-07-31
- **Upstream `uma-skill-tools`, reference B (engine repo's `origin/master`):** `8b3f5e2`, 2026-03-17
- **This fork:** current `my-updates` branch

To refresh:

```sh
git -C ../uma-tools-og pull
git -C ../uma-tools-og/uma-skill-tools fetch origin
```

Then re-check any claim above against the new commits — see [upstream-architecture.md#snapshot](upstream-architecture.md#snapshot) for the equivalent refresh path on the upstream-only doc.
