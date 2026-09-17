# Sub-apps

Every sub-app is a separate esbuild entry point sharing `components/`, `strings/`, and `uma-skill-tools/`. All five are rebuilt by CI on every push and their `bundle.js`/`bundle.css`/`simulator.worker.js` are gitignored, not committed. See [deployment.md](deployment.md) for why and what that means for you.

## `umalator-global/` — the primary app (Global/EN data)

The primary user-facing simulator. **Has no `.tsx` source of its own** — `build.mjs` compiles `../umalator/app.tsx` with `define: {CC_GLOBAL: 'true'}` and a `redirectData` plugin that rewrites data imports in two different ways depending on the file. The 4 engine-data files (`course_data.json`, `skill_data.json`, `skillnames.json`, `tracknames.json`) are handled by the shared `scripts/build-plugins/redirectEngineData.mjs` plugin: any import resolving through `uma-skill-tools/data/jp/` gets redirected to the sibling `uma-skill-tools/data/global/` path instead — both live inside the `uma-skill-tools` submodule, this never touches `umalator-global/`. `skill_meta.json`, `umas.json`, `unreleased.json`, and `presets.ts` are handled separately, redirected from repo root to the copies sitting in `umalator-global/`. `icons.json` is **not** redirected — both JP and Global builds read the same repo-root `icons.json`. Four modes live behind one mode switcher in the built app — Compare, Skill Chart, Uma Chart, Course Chart — all four sharing this same source; see [statistical-analysis.md](statistical-analysis.md) for what each mode actually does.

- **Build:** `cd umalator-global && node build.mjs` (production, minified) or `node build.mjs --debug` (unminified, `CC_DEBUG=true`, PostHog telemetry disabled) or `node build.mjs --serve [port]` (dev server, implies `--debug`; default port 8000).
- **Data:** `uma-skill-tools/data/global/{course_data.json,skill_data.json,skillnames.json,tracknames.json}` (engine data, inside the submodule) + `umalator-global/{skill_meta.json,umas.json,unreleased.json,presets.ts}` — the Global dataset. See [data-pipeline.md](data-pipeline.md) and, for `presets.ts` specifically, [cm-presets.md](cm-presets.md).
- **Telemetry:** PostHog, enabled only when `CC_GLOBAL && !CC_DEBUG` (i.e. never in `--debug`/`--serve` mode). The PostHog project is self-owned as of 2026-09-03 — the key had originally been inherited as-is from the upstream fork and was reporting to the upstream author's own PostHog project (UI-35). `person_profiles` is `'always'` as of 2026-09-15: there is no login and `identify()` is never called, so the `'identified_only'` default created no person profiles at all, leaving unique-user counts, retention and cohorts empty. The trade-off is billing — PostHog prices identified events at up to 4x anonymous ones above the 1M-events/month free tier. Ingest goes via the `t.mackoz.net` reverse proxy (`umalator/telemetry.ts`), which is a DNS-only record and so sits outside the Cloudflare proxy path.
- **Gotcha:** the dev server's static-file root is **two directories up from `umalator-global/`**, i.e. the parent of this whole repo checkout. See [deployment.md](deployment.md#local-dev-gotcha-the-server-root-is-your-checkouts-parent-directory) — this only works cleanly if your checkout directory is literally named `uma-tools`.

## `umalator/` — JP version (and the shared source)

Same UI as Global, built with `CC_GLOBAL: 'false'` against the JP dataset (`uma-skill-tools/data/jp/*.json` + repo-root `umas.json`/`skill_meta.json`). Has a language selector (JA/EN) and no telemetry. This is the file you edit for UI/logic changes that should apply to **both** umalator and umalator-global — always rebuild both after changing it.

- **Build:** `cd umalator && node build.mjs` / `--debug`. No `--serve` mode in this one.
- There is also a legacy `umalator/build.bat` (esbuild → unassert → esbuild minify) that predates `build.mjs` — it does **not** emit `simulator.worker.js`, so it's not sufficient on its own. Treat `build.mjs` as authoritative.
- **Data:** JP dataset (`uma-skill-tools/data/jp/`, repo-root `umas.json`/`skill_meta.json`/`icons.json`/`presets.ts`).

## `skill-visualizer/` (JP) and `skill-visualizer-global/` (Global)

Standalone tool: pick skills, see color-coded regions on a `RaceTrack` showing where each activates for a chosen course (no compare, no HP/spurt modelling).

- `skill-visualizer/` — JP data, has a language switch. `build.mjs` (`node build.mjs [--debug]`), CI-built; a legacy `build.bat` also exists but `build.mjs` is authoritative.
- `skill-visualizer-global/` — hard-locked to English, has both `build.bat` and `build.mjs` (`node build.mjs [--debug|--serve [port]]`). Its `redirectData` plugin splits the same way umalator-global's does: the shared `redirectEngineData` plugin sends its 4 engine-data imports from `uma-skill-tools/data/jp/` to `uma-skill-tools/data/global/` (inside the submodule), while a `datadir` pointed at `../umalator-global` covers `skill_meta.json`/`umas.json` only — so **it has no JSON data of its own**, but reuses two different datasets' worth rather than umalator-global's alone.

## `courseimages/`

Utility app, not linked from the main UI. Renders a `RaceTrack` for a selected course, inlines computed styles onto the SVG, rasterizes it via canvas, and offers a PNG download (e.g. `tokyo-2400-out-dirt.png`).

- **Build:** `build.mjs` (`node build.mjs [--debug]`), CI-built. A legacy `build.bat` also exists but `build.mjs` is authoritative — it adds the `mockAssert` plugin so `CourseData.ts`'s `node:assert` import resolves in the browser, which the raw `.bat` pipeline doesn't handle: without it, `node:assert` doesn't resolve in the browser and the app throws at module-eval time before rendering anything. A raw esbuild run over such a source errors outright rather than producing a working bundle, so this is a build-time failure to catch, not a runtime one to debug.

