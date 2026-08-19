# Sub-apps

Every sub-app is a separate esbuild entry point sharing `components/`, `strings/`, and `uma-skill-tools/`. All of them ship their built `bundle.js`/`bundle.css` (and `simulator.worker.js` where relevant) committed to git — see [deployment.md](deployment.md) for why and what that means for you.

## `umalator-global/` — the primary app (Global/EN data)

The one in the README screenshot. **Has no `.tsx` source of its own** — `build.mjs` compiles `../umalator/app.tsx` with `define: {CC_GLOBAL: 'true'}` and an esbuild `redirectData` plugin that rewrites data imports (`.../data/*.json`, `skill_meta.json`, `umas.json`) to the copies sitting in `umalator-global/` instead of `uma-skill-tools/data/` / repo root. `icons.json` is **not** redirected — both JP and Global builds read the same repo-root `icons.json`.

- **Build:** `cd umalator-global && node build.mjs` (production, minified) or `node build.mjs --debug` (unminified, `CC_DEBUG=true`, PostHog telemetry disabled) or `node build.mjs --serve [port]` (dev server, implies `--debug`; default port 8000).
- **Data:** `umalator-global/{course_data.json,skill_data.json,skill_meta.json,skillnames.json,umas.json,tracknames.json}` — the Global dataset. See [data-pipeline.md](data-pipeline.md).
- **Telemetry:** PostHog, enabled only when `CC_GLOBAL && !CC_DEBUG` (i.e. never in `--debug`/`--serve` mode).
- **Gotcha:** the dev server's static-file root is **two directories up from `umalator-global/`**, i.e. the parent of this whole repo checkout. See [deployment.md](deployment.md#local-dev-gotcha) — this only works cleanly if your checkout directory is literally named `uma-tools`.

## `umalator/` — JP version (and the shared source)

Same UI as Global, built with `CC_GLOBAL: 'false'` against the JP dataset (`uma-skill-tools/data/*.json` + repo-root `umas.json`/`skill_meta.json`). Has a language selector (JA/EN) and no telemetry. This is the file you edit for UI/logic changes that should apply to **both** umalator and umalator-global — always rebuild both after changing it.

- **Build:** `cd umalator && node build.mjs` / `--debug`. No `--serve` mode in this one.
- There is also a legacy `umalator/build.bat` (esbuild → unassert → esbuild minify) that predates `build.mjs` — it does **not** emit `simulator.worker.js`, so it's not sufficient on its own. Treat `build.mjs` as authoritative.
- **Data:** JP dataset (`uma-skill-tools/data/`, repo-root `umas.json`/`skill_meta.json`/`icons.json`).

## `skill-visualizer/` (JP) and `skill-visualizer-global/` (Global)

Standalone tool: pick skills, see color-coded regions on a `RaceTrack` showing where each activates for a chosen course (no compare, no HP/spurt modelling).

- `skill-visualizer/` — JP data, has a language switch, build via `build.bat` only (no `.mjs`).
- `skill-visualizer-global/` — hard-locked to English, has both `build.bat` and `build.mjs` (`node build.mjs [--debug|--serve [port]]`). Its `redirectData` plugin points `datadir` at `../umalator-global`, so **it has no JSON data of its own** — it reuses umalator-global's dataset.

## `build-planner/`

Renders `SkillList` + a `RaceTrack` region overlay for a fixed hardcoded horse (all stats 2000, Nige, S distance aptitude). Build via `build.bat`.

- **Gotcha:** `build-planner/index.html` loads `bundle.2.js`, not `bundle.js` — its `build.bat` has the minify-and-delete step commented out, so the intermediate `unassert` output (`bundle.2.js`) is the one actually served. Both files are committed; if you rebuild this app, make sure `bundle.2.js` stays in sync.

## `courseimages/`

Utility app, not linked from the main UI. Renders a `RaceTrack` for a selected course, inlines computed styles onto the SVG, rasterizes it via canvas, and offers a PNG download (e.g. `tokyo-2400-out-dirt.png`). Build via `build.bat`.

## `umadle/`

An Uma Musume Wordle clone — guess the character in 10 tries with per-stat high/low/correct feedback. Self-contained data (`umadle/icons.json`, `umadle/numbers.json`, `umadle/icons/`), daily puzzle seeded via `Rule30CARng` from `uma-skill-tools/Random`.

- **Build:** `build.bat` only.
- **⚠️ Cannot rebuild from a clean `npm install`.** `umadle/app.tsx` imports `accessible-autocomplete/preact`, which is **not listed in the root `package.json`**. Only the committed `bundle.js`/`bundle.css` work until this dependency is either added to `package.json` or the import is replaced with `components/autocomplete.jsx` (a vendored copy that currently sits unused — see [architecture.md](architecture.md#known-issues)).

## `rougelike/`

Not Uma-related — a hex-color-guessing Wordle clone (`colorconversion.js` does OKHSV↔sRGB conversion). Included here only because it lives in this repo and shares the build pattern. Build via `build.bat`.
