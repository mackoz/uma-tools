# CLAUDE.md

Guidance for working in this repo. It's a browser-based Uma Musume: Pretty Derby race simulator (Preact + TypeScript + esbuild, no framework, no server). Full docs are in `docs/` — this file only covers what a future edit is likely to get wrong.

## Hard rules

1. **Never hand-edit generated files.** These are all build output or data-pipeline output, not hand-written source:
   - `*/bundle.js`, `*/bundle.css`, `*/bundle.2.js`, `*/simulator.worker.js` — esbuild output. Edit the `.tsx`/`.ts` source and rebuild instead.
   - `umas.json`, `skill_meta.json`, `icons.json`, and the `umalator-global/` equivalents — Perl-generated from the game's `master.mdb`. Edit the generating `.pl` script (see `docs/data-pipeline.md`) and regenerate, don't patch the JSON directly. `uma-skill-tools/data/{skill_data,skillnames,course_data,tracknames}.json` are the same story but live in the `uma-skill-tools` submodule (see the submodule section below) — the generating `.pl` scripts are there too, and a fix means committing and pushing in that repo, not editing the checked-out copy here.

2. **Bundles are *not* committed to git — CI is the only build path.** `umalator`, `umalator-global`, `skill-visualizer-global`, `skill-visualizer`, `courseimages`, `rougelike`, and `umadle` all have a `build.mjs` and are gitignored (see `.gitignore`); `deploy.yml` rebuilds all seven on every push to `master`, and GitHub Pages is configured (`build_type: workflow`) to serve exactly that CI-built artifact — there is no separate "legacy" branch-source deploy racing it anymore. This means you do **not** need to rebuild-and-commit before pushing, but you should still build locally (see commands below) to catch a broken build before it reaches CI. `build-planner` is the one exception: its `bundle.js`/`bundle.2.js` stay committed because its source doesn't currently compile (see `docs/apps.md#build-planner`) — don't add it to CI without fixing that first.

3. **`umalator-global/` has no source of its own.** It's a build target: `umalator-global/build.mjs` compiles `../umalator/app.tsx` with `CC_GLOBAL: 'true'` against the JSON data in `umalator-global/`. **Any edit to `umalator/app.tsx` (or its imports) affects both apps.** If you change it, rebuild *both* `umalator/` and `umalator-global/`, and check whether the change needs to branch on the `CC_GLOBAL` define (stat defaults, label text, feature availability all already do this in places — grep `CC_GLOBAL` before assuming a change applies uniformly).

4. **Any new asset reference must use the `/uma-tools/` absolute prefix**, matching the existing pattern in `icons.json`, `umalator/app.css`, `umalator/app.tsx`, `components/SkillList.tsx`, `components/SkillPicker.tsx`. This is required for GitHub Pages deployment to work — see `docs/deployment.md`. Don't switch to relative paths for icons/fonts without reading that doc first.

## Build / verify commands

```sh
npm install                                  # once; node_modules/ is not checked in

cd umalator-global && node build.mjs         # production build (minified)
cd umalator-global && node build.mjs --debug # unminified, telemetry off
cd umalator-global && node build.mjs --serve # dev server on :8000, implies --debug

cd umalator && node build.mjs [--debug]      # JP app; no --serve mode

cd skill-visualizer-global && node build.mjs [--debug|--serve [port]]

# also CI-built, same [--debug] flag, no --serve mode:
cd skill-visualizer && node build.mjs
cd courseimages && node build.mjs
cd rougelike && node build.mjs
cd umadle && node build.mjs

npm run build                                # all of the above in one shot
```

`build.mjs` is authoritative for every app that has one. The legacy `build.bat` files (all apps have one; some — `build-planner`, `skill-visualizer`, `umadle`, `rougelike`, `courseimages` — have *only* a `.bat`) are Windows-oriented esbuild-then-unassert-then-minify scripts; the ones that also have a `.mjs` predate it and don't emit `simulator.worker.js`, so don't treat them as sufficient for `umalator`/`umalator-global`/`skill-visualizer-global`.

There is no `tsc` step in any build — esbuild transpiles directly, so a build succeeding does **not** mean the TypeScript typechecks. Run `npx tsc --noEmit` yourself if you want that guarantee; it isn't wired into any script.

`umadle` cannot be rebuilt from a clean `npm install` — it imports `accessible-autocomplete`, which isn't in `package.json`. Don't "fix" this by editing its bundle by hand; either add the dependency properly or leave it alone (see `docs/apps.md`).

If game data looks stale (a released uma/skill/course is missing) and there's no `master.mdb` handy, check `docs/upstream-data-sync.md` before assuming a full pipeline run is required — there's a script that ports already-computed data from a local upstream checkout as a stopgap (this fork's own asset extraction is currently broken against the encrypted live client — see `docs/data-pipeline.md`).

## JP vs Global data split

Two parallel datasets, both derived from the same generator logic run against different `master.mdb` files (JP client vs Global client) — see `docs/data-pipeline.md` for the full pipeline:

| | JP | Global |
|---|---|---|
| Location | repo root (`umas.json`, `skill_meta.json`, `icons.json`) + `uma-skill-tools/data/` | `umalator-global/` |
| Roster | ~130 umas | ~64 umas (Global lags JP releases) |
| Skill names | `["ja", "en"]` tuples | `["en"]` single-element |
| Courses | 121 | 107 (missing overseas tracks) |

Icons are **not** duplicated — both datasets reference the same `icons/` tree via the same `icons.json`. When adding data by hand for a quick test, don't cross-wire JP data into a Global-built app or vice versa; the shapes differ (see the skillnames array-length difference above) and code branches on `CC_GLOBAL`, not on which JSON happens to be loaded.

## Code conventions

- Tabs for indentation, matching the existing files.
- Preact, not React — JSX factory is `h`/`Fragment` (see `tsconfig.json`: `"jsxFactory": "h", "jsxFragmentFactory": "Fragment"`). Don't import from `react`.
- `HorseState` (the uma stat/skill editor state) is an Immutable.js `Record`, defined in `components/HorseDefTypes.ts`. Follow the existing `Record`-update patterns (`.set()`, `.update()`) rather than mutating.
- `uma-skill-tools/` is intentionally engine-only — it must stay independent of Preact/DOM so it can run inside the web worker (`simulator.worker.ts`) and the `ts-node` CLI tools under `uma-skill-tools/tools/`. Don't import Preact components into it.
- See `docs/architecture.md` for the simulation engine's data flow and known rough edges before modifying `uma-skill-tools/`.
- **`uma-skill-tools/` is a git submodule**, pointing at [`mackoz/uma-skill-tools`](https://github.com/mackoz/uma-skill-tools) (itself a fork of [`alpha123/uma-skill-tools`](https://github.com/alpha123/uma-skill-tools) — `RaceSolver.ts` alone has roughly doubled in size relative to upstream; don't assume upstream semantics, upstream test cases, or upstream numeric output apply here). It used to be vendored in-tree instead; if you're reading history from before that changed back, the file layout is identical either way, only how changes propagate differs now:
  - After a fresh clone, run `git submodule update --init` — an unitialized submodule leaves `uma-skill-tools/` looking present in listings but empty on disk, and every build fails on missing imports.
  - **Engine changes happen in the submodule repo first.** Edit inside `uma-skill-tools/`, commit and push *there* (it's its own git repo, with its own remote), then come back here and commit the resulting gitlink bump (`git add uma-skill-tools && git commit`). Editing the checked-out copy here without doing that leaves the fix on disk but unrecorded — the gitlink still points at the old commit, so a fresh clone or `git submodule update` silently reverts it.
  - One concrete trap carried over from the engine's own `CLAUDE.md`: `Rule30CARng` (`Random.ts:29`) is just an alias for a `prando`-backed PRNG here, even though upstream's class of the same name is a real Rule-30 cellular-automaton generator — see `docs/upstream-comparison.md`.

## Where to look next

- **What does this app do / how is it built?** → `docs/apps.md`
- **How does a simulation actually run, file by file?** → `docs/architecture.md`
- **How do I regenerate the game data (new umas, new skills)?** → `docs/data-pipeline.md`
- **How do I deploy or run this locally?** → `docs/deployment.md`
- **What did the previous maintainer change and why?** → `docs/fork-changes.md`
- **How does this fork differ from upstream `alpha123/uma-tools`?** → `docs/upstream-comparison.md`
- **How does upstream's own engine/app layer work, on its own terms?** → `docs/upstream-architecture.md`
- **How is the fork's design different from upstream's, structurally (with plain-language explanations)?** → `docs/architecture-comparison.md`
- **Game data (umas/skills/courses/icons) looks stale — how do I catch it up?** → `docs/upstream-data-sync.md`
