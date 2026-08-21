# Comparison with TheCing/uma-tools

This page compares this repository with [`TheCing/uma-tools`](https://github.com/TheCing/uma-tools). It is aimed at one practical question: **should future development continue here, or use TheCing's fork as its base?**

This is a point-in-time source comparison, not a live scorecard. Exact commits, commands, and caveats are in [Snapshot and reproduction](#snapshot-and-reproduction).

## Recommendation

**For a balanced public product, use TheCing's fork as the new development base—but do not use it unchanged.** Its Global V2 simulator, tested roster flows, richer skill-data schema, and collection of standalone tools represent far more product work than would be sensible to reproduce here feature by feature. Both forks already carry the same broad kachi-derived field-simulation architecture, so this is not a choice between TheCing's UI and this fork's entire simulation model.

Before relying on TheCing's fork, forward-port this repository's newer correctness and maintenance work:

1. The low-speed last-spurt guard, post-1.5-anniversary Pace Down fixes, real Rushed-condition wiring, and the stronger `is_activate_any_skill` behavior.
2. Visible simulation-error reporting rather than silently dropping an unsupported skill activation.
3. The engine-submodule boundary, build-from-source CI, linting, and dependency updates—or equivalent safeguards appropriate to the new repository.
4. A deliberate data merge: retain this fork's newer JP data while keeping TheCing's richer Global skill schema and unreleased-content filtering.

That recommendation changes if the operational goal is different:

| Priority | Better starting point | Why |
|---|---|---|
| Balanced public simulator | **TheCing, with the fixes above** | Rebuilding V2 and the surrounding product ecosystem here is the larger and riskier job. |
| Minimum hosting/maintenance surface | **This fork** | Fully static GitHub Pages deployment; no Functions, Worker, Turnstile, server Gemini key, webhook, or Global `master.mdb` workflow. |
| Preserve the currently investigated engine behavior exactly | **This fork** | The August 19–20 fixes and their supporting documentation already live here and in its engine submodule. |
| Best current end-user experience | **TheCing** | V2 is the default product and is substantially more polished on desktop and mobile. |

## At a glance

| | This fork (`mackoz`) | TheCing |
|---|---|---|
| Snapshot | `cf9f080`, 2026-08-20 | `6de3740`, 2026-08-17 |
| Shared ancestor | `1a6431a`, 2026-01-08 | same |
| Unique commits after that ancestor | 113 | **450** |
| Primary product | Classic JP/Global Umalator | **Modern Global V2**, plus classic JP/Global |
| Engine packaging | [`mackoz/uma-skill-tools`](https://github.com/mackoz/uma-skill-tools) submodule at `6d5e66a` | Vendored under `uma-skill-tools/` |
| `RaceSolver.ts` | 1,532 lines | 1,588 lines |
| Broad race model | Multi-uma field, position-keep states, lane movement, Rushed, downhill, dueling/lead competition | The same broad kachi-derived model, with later local changes |
| Skill scaling | No generic value/duration/level scaling | **Skill levels; partial value and duration scaling** |
| Global data strategy | Primarily Global-live data | **JP superset with unreleased filters** |
| Maintained deployment | GitHub Actions builds seven static apps and deploys Pages | Cloudflare Pages build plus optional Functions/Worker infrastructure |
| Generated bundles | Ignored and rebuilt by CI, except broken legacy `build-planner` | **Many bundles committed**, while Cloudflare also rebuilds selected targets |
| Tracked source footprint | Parent repo: 1,755 entries / about 77 MB; initialized engine adds 64 files / about 69 MB | 1,890 entries / about **196 MB** in one repository |
| Point-in-time `npm audit` | 1 moderate advisory | **13 advisories: 9 high, 2 moderate, 2 low** |

The commit count measures activity, not quality. TheCing's number includes product features, data updates, generated output, documentation, and repeated `dev`→`master` merge commits. This fork's 113 includes a concentrated documentation, data, build, and correctness pass on August 19–20.

## Lineage and attribution

The repositories are siblings after January 8, 2026, not independent reimplementations:

```text
alpha123/uma-tools
        │
        └─ kachi-dev lineage (including imported VFalator work)
                    │
                    └─ 1a6431a  "Fixi skill stuffs and xoguri"
                       ├─ mackoz/uma-tools       113 unique commits
                       └─ TheCing/uma-tools     450 unique commits
```

TheCing's first unique commit, `3c8f84f`, added Uma Card/OCR/deployment work. This fork continued the kachi line and, much later, moved the engine into `mackoz/uma-skill-tools` as a submodule. TheCing kept the engine vendored and continued changing it in the application repository.

This matters because a two-tree diff can easily misattribute shared work. The following are **not differentiators between these two forks**:

- Multi-uma field simulation and virtual pacemakers.
- The five-state position-keep model.
- Lane movement and lane-related skill effects.
- Rushed/kakari and downhill mode.
- Dueling/compete fight and Front Runner lead competition/spot struggle.
- Independent RNG streams for major mechanics.

Their implementations have since drifted, but the product-level capabilities came from their shared/kachi-derived lineage. See [upstream-comparison.md](upstream-comparison.md) for the separate comparison with `alpha123` and the older public upstream engine.

## Simulator and engine differences

### Mechanics and skill support

| Area | This fork | TheCing | Assessment |
|---|---|---|---|
| Skill level scaling | Modifiers are already normalized in generated data; no level argument in the builder. | `levelScalingCoef()` and per-skill `level` flow through `addSkill()`/`buildSkillData()`; V2 supplies unique level. | **TheCing lead.** Important for unique skills and future skill-level-aware tools. |
| Ability-value scaling | Not generic. The three affected IDs (two present in Global) were patched to a flat worst-case 4% drain as a stopgap. | Preserves `scaling` in Global data and implements usage 8/9's 60/30/10 random multiplier. Other non-direct usages still fall through at full value. | **TheCing lead, but incomplete.** Its own docs identify 14+ affected skills outside 8/9. |
| Ability-duration scaling | Not implemented. | Implements remaining-HP types 1/2; distance-from-leader uses a fixed mid-pack assumption, blocked-time type 1 falls back to 1.0, and overtake-extension/type 2 remain unimplemented. | **Partial TheCing lead.** Do not present its whole duration table as exact. |
| Condition coverage | Recently added four crashing conditions and a named parser error; about three Global and eleven JP-only names remain. | Added more live condition tokens in July, including phase-half/straight/slope and opponent-temptation families. | **TheCing has broader coverage.** |
| Unsupported conditions | Throws a named error; the worker returns it to the UI instead of hanging. | Catches `UnknownConditionError`, warns in the console, and skips that activation. | Design tradeoff. This fork is safer for correctness; TheCing is more resilient but can silently under-value a build. |
| `is_activate_any_skill` | Uses the previous frame's activation count and includes re-entrant Adventure of 564 activations. | Tests `usedSkills.size > 0`, meaning “has ever used a skill” for the rest of the race. | **This fork is closer to the condition's event-like meaning.** Both are still one-frame/ordering approximations. |
| Distribution sample normalization | Uses observed sample extrema. | Uses analytic tail estimates and clamps samples, including the `N=1` case that otherwise degenerates. | **TheCing lead; strong port candidate.** |
| Skill/uma chart stamina | Deliberately uses `NoopHpPolicy` outside compare mode to discourage treating length gain as stamina advice. | Uses real HP in compare and chart modes and adds dedicated stamina tooling. | Product/design choice. TheCing is more capable; this fork is intentionally conservative. |
| Cross-engine validation | Engine parser test is wired; substantial analysis lives in `plans/`, but no cross-engine executable harness. | `tools/sim-compare/` statistically compares its engine with `alpha123`, accounting for different PRNGs and data drift. | **TheCing lead**, although the harness is not wired into CI. |

### Confirmed correctness differences

These are source-verified differences, not inferences from commit messages:

| Case | This fork | TheCing |
|---|---|---|
| Very-low-speed last-spurt candidate list | Returns `[distance, maxSpeed]` when no candidate clears base phase-2 speed. | Indexes `candidates[-1]` through `candidates[candidates.length - 1]`; the guard is absent. |
| Post-1.5-anniversary Pace Down coefficient | Applies `0.945` in mid-race and `0.915` later. | Always assigns `0.915`; its inline comment still says `0.945x` in mid-race. |
| Pace Down exit-distance roll | Uses the reduced mid-race maximum `lerp(min,max,0.5)`. | Still rolls through the full min→max range. |
| Rushed skill conditions | `is_temptation` and `temptation_count` read the solver's actual Rushed state. | Registered as no-op/assumed conditions rather than reading `isRushed`. |
| Random 0–4% HP drain | Data carries a documented flat −4%-of-max worst-case approximation. | Preserves −100% raw data plus scaling 8 and samples the real 0%/2%/4% distribution. |
| Unknown condition failure | Simulation stops with the condition name, and the UI surfaces the worker error. | The activation is skipped and the race continues after a console warning. |

The last two rows show why neither engine can simply be called “more accurate.” TheCing models the random-drain mechanic substantially better, while this fork is more reliable at revealing unsupported mechanics instead of returning a plausible but incomplete number.

### Shared known limitations

- `OrOperator` still uses the same sample-policy reconciliation as `AndOperator` in both forks. The mixed static/dynamic alternative bug documented for Restless on Kyoto 3000m remains.
- Several opponent/order/blocking conditions are probabilistic approximations, even though both solvers now carry multiple umas.
- `Random.ts` is byte-identical between the snapshots: both call a Prando wrapper `Rule30CARng`, not alpha123's actual Rule-30 cellular automaton. Same nominal seeds are not numerically comparable with upstream alpha123.
- Large engine files remain lightly type-checked and lightly regression-tested on both sides. A successful esbuild/Vite bundle does not prove TypeScript or simulation correctness.

## Product and application differences

### Main simulator and user workflows

| Feature | This fork | TheCing |
|---|---|---|
| Classic JP/Global simulator | Yes; shared `umalator/` source compiled against two datasets. | Yes; retained as V1. |
| Modern Global simulator | No separate successor UI. | **V2 is the default landing product**, with a component library and Vite build. |
| Mobile experience | Responsive classic UI/bottom-sheet work from the shared lineage. | **Dedicated V2 bottom navigation**, mobile interaction fixes, and tour-aware layout. |
| Theme | Classic theming/dark styling. | V2 light/dark design system plus classic styling. |
| Guided onboarding | No. | **Seven-step tour.** |
| Uma configuration | Classic editor, save/load, OCR, roster tab. | V2 modal/drawer editor, saved trainees, roster tab, filters, and card previews. |
| Roster formats | Decodes v1, v2, v4, and **v5** share codes; v5 includes per-uma creation time. | V2 decoder covers v1, v2, v4 plus direct UmaExtractor `data.json`; 165 roster tests pass. |
| Screenshot OCR | Browser calls Gemini with the user's API key. | Proxy-backed Gemini flow with user-key fallback, structured output, and a review UI. |
| Uma Card PNG | No embedded-build PNG feature. | **Export/import with JSON in PNG metadata.** |
| Multi-file import | No equivalent V2 picker. | **Selects one trainee from multiple imported game-export files.** |
| Shareable state | Copy-link state exists in the classic app. | V2 compressed URL state includes course, conditions, samples, both umas, and hint levels. |
| Results | Classic table, activation/basinn charts, HP/spurt chart, draggable skill-table splitter. | V2 result pane, skill detail/compare views, velocity/HP overlays, progressive worker results, and dedicated stamina mode. |
| Unreleased Global content | Not a first-class filter. | `not-in-game.json` badges and filters JP-forwarded skills/outfits. |

TheCing's V2 is not a skin over this fork's app. It is thousands of lines of additional state, components, responsive CSS, import/storage code, chart code, and product-specific behavior. Porting it piecemeal would create two partially overlapping UI architectures; adopting it as a unit is the more realistic path.

### Standalone applications

| Application | This fork | TheCing |
|---|---|---|
| JP skill visualizer | Classic `skill-visualizer/` | Classic `skill-visualizer-jp/` |
| Global skill visualizer | Classic | Classic plus **V2 condition/skill comparison UI** |
| Course image exporter | Yes | Yes |
| Build planner | Present but broken | Present but broken; see [Confirmed repository problems](#confirmed-repository-problems) |
| HP calculator | No standalone app | **Yes** |
| Mechanics Explorer | No | **Interactive stat/formula readout and sweep charts** |
| Team Trials planner | No | **Yes** |
| Events/banner tracker | No | **Yes** |
| JP release timeline | No | **Yes** |
| Player-facing mechanics/guides site | Repository docs only | **Static documentation site and Canva-guide registry** |
| Umadle | **Yes** | Removed/absent |
| `rougelike` color game | **Yes** | Removed/absent |

If this repository remains the base, product ports should focus on the simulator and Uma-related tools rather than restoring every directory difference in either direction.

## Game data

Direct key counts at the snapshot:

| Dataset | This fork | TheCing | Interpretation |
|---|---:|---:|---|
| Root JP characters / outfits | 141 / **263** | 141 / 244 | This fork has more outfit records for the same character keys. |
| Root `skill_meta.json` | **2,097** | 1,963 | This fork is 134 skill IDs ahead. |
| Engine JP skills / names / courses | **1,963 / 2,608 / 139** | 1,861 / 2,474 / 121 | This fork's JP engine dataset is newer. |
| Global characters / outfits | 65 / 100 | **75 / 119** | TheCing deliberately fast-forwards unreleased JP content. |
| Global skill data / names | 692 / 1,431 | **1,530 / 2,139** | Not a live-release comparison: TheCing's file is a JP superset. |
| Global courses | 119 | 119 | All 119 parsed course records are equal at these snapshots. |

Schema matters as much as counts:

- This fork's Global skill generator normalizes modifiers and drops fields such as `scaling`, `wisdomCheck`, and `tags`. Its random-drain correction therefore patches generated values to a flat approximation.
- TheCing preserves raw modifier values and richer metadata, enabling its level and scaling paths. Its `not-in-game.json` separates the subset actually available on Global from content fast-forwarded from JP.
- TheCing's documented Global `master.mdb` merge process is more operationally capable for Global-live refreshes, but it commits a roughly 15 MB database and depends on an external MEGA sync workflow.
- This fork's live-client asset extraction is still broken against encrypted assets. TheCing's workflow improves Global data maintenance but does not make every old Perl generator authoritative; its own documentation warns that wholesale regeneration can drop scaling fields and the JP superset.

**Do not copy either JSON tree wholesale into the other repository.** A migration should merge generator/schema behavior first, then regenerate or intentionally synchronize data. Otherwise it will either discard TheCing's scaling metadata or overwrite this fork's newer JP keys.

## Testing and engineering quality

### Verified commands

| Check | This fork | TheCing |
|---|---|---|
| Clean dependency install | Existing lock installs in CI; not repeated for this doc-only change. | `npm ci --ignore-scripts` passed. |
| Maintained app build | `npm run build` passed all seven CI-built targets. | `npm run build:v2` passed: 2,364 modules; about 1.61 MB minified JS and 769 KB worker, with Vite chunk-size warnings. The whole mutating `build-all.sh` was not run in the source checkout. |
| Feature tests | No comparable suites. | `test:mechanics`: **24/24**; `test:roster`: **165/165**; roster type-check passed. |
| Engine `npm test` | Passes the single wired parser property test. | **Fails.** Normal mode stops on TypeScript enum `hasOwnProperty` errors; transpile-only reaches the race property test and then fails because FastCheck 4 removed `.noBias()`. |
| Full type-check | About 1,084 known pre-existing errors. | No full-repository type-check script. |
| Lint/format | Biome plus staged-file Husky hook. | No repository-wide linter/formatter configuration. |
| Dependency audit | 1 moderate advisory (`esbuild` dev-server issue). | 13 advisories, including direct high advisories on the locked Preact/Immutable versions and high transitive Vite/Rollup advisories. |

`npm audit` is a lockfile/advisory snapshot, not proof that every advisory is exploitable in the deployed static app. It is still a meaningful maintenance signal: TheCing's lock had not absorbed fixes already resolved by this fork's newer lock.

TheCing has more useful focused tests than this repository, especially around V2 roster imports. Neither repository makes simulation regression tests a deployment gate. TheCing's only GitHub workflow promotes `dev` directly to `master` weekly; it does not build or run the feature/engine tests first. This fork's deployment workflow builds seven targets, but it also does not run the engine tests before publishing.

## Deployment, privacy, and operational cost

| Area | This fork | TheCing |
|---|---|---|
| Hosting | Static GitHub Pages artifact produced by Actions. | Cloudflare Pages, with root rewrites and optional Pages Functions/Worker services. |
| Runtime services | PostHog in production Global; user-initiated direct Gemini call using the user's key. | Retains the classic app behavior and adds proxy-backed OCR, Turnstile, Discord feedback proxy, and Canva routing. |
| Secrets | None needed to serve the simulator; OCR users provide their own Gemini key. | Full hosted feature set needs Gemini/Turnstile/Discord and Cloudflare configuration. |
| Build artifacts | Maintained bundles ignored; CI is authoritative. | Many V1/V2 bundles are tracked even though Cloudflare's build also regenerates outputs. |
| Engine updates | Separate engine commit/push, then explicit gitlink bump. | Engine changes commit directly with the app. |
| Data source | Generated JSON plus manual upstream-data sync; no committed live DB. | Commits Global `master.mdb`, builds `not-in-game.json`, and documents an external MEGA pull. |

TheCing's OCR proxy is an end-user improvement: most users do not need their own Gemini key, and Turnstile/origin checks protect the server key. It is also a real service with cost, availability, secret rotation, abuse, and privacy responsibilities. Its feedback Worker documentation says submissions may include browser and Cloudflare geolocation metadata. Those features should be adopted deliberately, with user-facing disclosure, rather than treated as free static-app functionality.

The engine packaging choice is a tradeoff too. A submodule makes engine history and reuse explicit but complicates cloning and coordinated PRs. Vendoring makes one-repository changes easier but mixes app, engine, generated data, and product history. The recommended migration should preserve an engine boundary, but it does not have to preserve Git submodules specifically if a workspace package provides the same guarantees.

Both snapshots are GPL-3.0-or-later. Moving development to TheCing is license-compatible, but it does not erase source-distribution, license-notice, or attribution obligations. Preserve the existing alpha123, kachi/VFalator, and later contributor history rather than presenting a migrated tree as a new implementation.

## Confirmed repository problems

### This fork

- `build-planner` is broken in production: its source uses stale imports/signatures, its browser bundle expects `require`, and it is excluded from the otherwise authoritative CI build.
- The type-check backlog is very large, and only the parser test is wired to the engine's `npm test` command.
- Some shipped skill conditions remain unregistered. They now fail with a useful error instead of a worker hang, but the mechanic remains unsupported.
- The current direct-Gemini OCR path places API-key setup and API availability on each user.

### TheCing

- Engine `npm test` is broken in two independent ways: current TypeScript errors in normal mode and obsolete FastCheck `.noBias()` calls in transpile-only mode.
- `build-all.sh` generates `build-planner/bundle.2.js` and immediately deletes it, while `build-planner/index.html` loads exactly `bundle.2.js`. The build planner is therefore broken in a freshly built deployment even though an old copy is committed.
- `build-planner/app.tsx` also calls an obsolete five-argument `buildSkillData` signature; fixing the output deletion alone is insufficient.
- Unsupported skill conditions are skipped. The console warning is useful for developers, but a normal user can receive a numerically incomplete result with no UI warning.
- The weekly `dev`→`master` workflow deploys by direct merge without first running a build or tests.
- The locked dependency tree had 13 audit advisories at the snapshot, including nine high-severity entries.
- The tracked `.DS_Store`, generated bundles, root build output, and `master.mdb` increase repository churn and size. The tracked `.env` contains only documented non-secret defaults, so its presence is hygiene—not a leaked-secret finding.

## Important design choices, not bugs

- **Global superset versus Global-live-only data:** TheCing's larger counts are a feature when planning ahead, but they demand correct unreleased filtering and must not be reported as released Global coverage.
- **Fail loudly versus continue:** This fork protects result integrity; TheCing protects availability. A better merged design would continue only after putting a visible “unsupported skill excluded” warning into the result.
- **Real HP in skill charts:** TheCing enables more analysis; this fork intentionally prevents a workflow its previous maintainers considered misleading. A dedicated stamina mode is preferable to silently changing the meaning of the skill-gain chart.
- **Cloudflare services:** They enable proxy OCR and feedback without exposing secrets, but they give up the simplicity of a static application.
- **Submodule versus vendored engine:** Either can be maintained well. The problem is losing review boundaries and reproducible versioning, not vendoring by itself.

## If this fork remains the base: prioritized ports

### P0 — simulation correctness and data semantics

1. Port the richer skill-data schema and builder seam for skill level, value scaling, and duration scaling. Bring over tests and generator behavior, not just the runtime switch statements.
2. Port the exact usage 8/9 random multiplier, then implement or explicitly reject every other non-direct scaling value present in data. Preserve TheCing's own documented limitations rather than labeling partial support complete.
3. Port the additional live condition tokens and analytic distribution normalization. Keep this fork's named error/UI reporting; do not copy silent activation skipping.
4. Adapt TheCing's cross-engine comparison corpus to compare both sibling engines after normalizing their different skill-data schemas.

### P1 — primary product experience

1. Port V2 as one coherent application target: component primitives, responsive navigation, results/velocity views, tour, URL state, and storage. Avoid incrementally embedding V2 components into the classic 3,249-line `app.tsx`.
2. Port the tested roster/import modules, adding v5 support from this fork and retaining direct `data.json` parsing, filter/sort tests, and privacy-field whitelisting.
3. Port the dedicated stamina workflow, V2 skill visualizer, richer skill detail views, hint levels, and unreleased-content filters.
4. Decide separately whether proxy OCR and feedback justify their service/privacy cost; keep user-key OCR as a fallback either way.

### P2 — additional tools

1. Mechanics Explorer, because it makes opaque formulas inspectable and already has focused tests.
2. Team Trials planner and release timeline, which are self-contained and user-facing.
3. Events/banner tracker and static guide registry, if maintaining their editorial data is part of the product scope.

Do **not** port TheCing's generated bundles, vendored engine layout, weekly untested promotion workflow, stale dependency lock, or Cloudflare stack merely because they sit next to the desired features.

## If TheCing becomes the base: minimum preservation list

This is not a migration procedure, but it is the minimum bar implied by the recommendation:

- Apply and test this fork's HP-2 low-speed guard and both DYN-1 Pace Down corrections.
- Replace TheCing's no-op Rushed condition handling with the real state-backed implementation.
- Reconcile the two `is_activate_any_skill` implementations and cover re-entrant random-gold activations.
- Surface skipped/unsupported conditions in the UI, even if the run is allowed to continue.
- Update dependencies before deployment and add build, feature-test, and engine-test gates.
- Restore a reproducible engine boundary and stop committing regenerated browser bundles.
- Merge current JP data with TheCing's richer Global schema through generators or a documented synchronization script.
- Retain v5 roster compatibility while keeping TheCing's tested v1/v2/v4 and direct-JSON imports.

## Snapshot and reproduction

This comparison reflects:

- **This fork:** `cf9f0800a4fa55d7dce1badb0c025fff16f63fa8`, 2026-08-20.
- **This fork's engine submodule:** `6d5e66ad627cef497c70abcdc13c720df43299b4`.
- **TheCing:** `6de3740b5ed4f2abdad5e3830265b104b0a8f677`, 2026-08-17, `master`.
- **Newest shared ancestor:** `1a6431a17ec6485fdbbb58666589a59a2a993bde`, 2026-01-08.

TheCing's `dev` was fully merged into `master` at the snapshot. Its old `dark-mode` branch is not part of this comparison.

### Reproduce ancestry and source differences

```sh
git clone --recurse-submodules https://github.com/TheCing/uma-tools.git /tmp/thecing-uma-tools
git -C /tmp/thecing-uma-tools fetch /path/to/mackoz/uma-tools \
  master:refs/remotes/mackoz/master

git -C /tmp/thecing-uma-tools merge-base \
  origin/master refs/remotes/mackoz/master
git -C /tmp/thecing-uma-tools rev-list --left-right --count \
  origin/master...refs/remotes/mackoz/master
git -C /tmp/thecing-uma-tools diff --stat \
  refs/remotes/mackoz/master..origin/master
```

The left/right count above prints `450 113`: TheCing-only first, this-fork-only second.

For engine source, compare individual hand-written files rather than the parent repo's gitlink:

```sh
diff -u /path/to/mackoz/uma-tools/uma-skill-tools/RaceSolver.ts \
  /tmp/thecing-uma-tools/uma-skill-tools/RaceSolver.ts
diff -u /path/to/mackoz/uma-tools/uma-skill-tools/ActivationConditions.ts \
  /tmp/thecing-uma-tools/uma-skill-tools/ActivationConditions.ts
```

Exclude icons, bundles, worker bundles, databases, and generated JSON from feature attribution. Compare them separately for repository cost and data keys.

### Reproduce data counts

```sh
node - /path/to/mackoz/uma-tools /tmp/thecing-uma-tools <<'NODE'
const fs = require('node:fs');
for (const root of process.argv.slice(2)) {
  const read = p => JSON.parse(fs.readFileSync(`${root}/${p}`, 'utf8'));
  const umas = read('umas.json');
  const globalUmas = read('umalator-global/umas.json');
  const outfits = data => Object.values(data)
    .reduce((n, uma) => n + Object.keys(uma.outfits || {}).length, 0);
  console.log(root, {
    jpUmas: Object.keys(umas).length,
    jpOutfits: outfits(umas),
    jpSkillMeta: Object.keys(read('skill_meta.json')).length,
    jpEngineSkills: Object.keys(read('uma-skill-tools/data/skill_data.json')).length,
    jpCourses: Object.keys(read('uma-skill-tools/data/course_data.json')).length,
    globalUmas: Object.keys(globalUmas).length,
    globalOutfits: outfits(globalUmas),
    globalSkills: Object.keys(read('umalator-global/skill_data.json')).length,
    globalCourses: Object.keys(read('umalator-global/course_data.json')).length
  });
}
NODE
```

### Reproduce build/test/audit observations

Run TheCing checks in its isolated checkout because several build scripts overwrite committed bundle files:

```sh
cd /tmp/thecing-uma-tools
npm ci --ignore-scripts
npm run build:v2
npm run test:mechanics
npm run test:roster
npm run typecheck:roster
npm audit

cd uma-skill-tools
npm test
```

For this fork:

```sh
cd /path/to/mackoz/uma-tools
git submodule update --init
npm ci
npm run build
npm audit

cd uma-skill-tools
npm test
```

Exact counts, package advisories, line numbers, and branch state will drift. Refresh the snapshot before using this document to make a later migration decision.
