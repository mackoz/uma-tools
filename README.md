# uma-tools

A browser-based race simulator and toolset for **Uma Musume: Pretty Derby**. The headline app, Umalator, runs Monte Carlo race simulations comparing two umas (stats + skills) on a chosen course and reports the resulting length (バ身/basinn) gain — plus a skill-activation chart, an HP/spurt chart, and course-comparison tooling.

This is a fork of [`alpha123/uma-tools`](https://github.com/alpha123/uma-tools) — see [Lineage](#lineage) — with several simulation-accuracy fixes and features layered on top. See [docs/fork-changes.md](docs/fork-changes.md) for the reasoning behind those changes, and [docs/upstream-comparison.md](docs/upstream-comparison.md) for how this fork and upstream have diverged since (upstream is still active and ahead on several fronts, including game data).

Everything runs client-side: no backend, no build-time API calls, no server-rendered anything. It's a set of static Preact apps bundled with esbuild.

## Quick start

```sh
git submodule update --init
npm install
cd umalator-global
node build.mjs --serve
```

Then open `http://localhost:8000/uma-tools/umalator-global/`.

> **Note:** the dev server serves static assets (icons, fonts) from the *parent* of your checkout directory, so this only resolves cleanly if your local clone is named `uma-tools`. See [docs/deployment.md](docs/deployment.md#local-dev-gotcha-the-server-root-is-your-checkouts-parent-directory) if you hit missing icons.

Bundles for the seven maintained build targets aren't committed to git — GitHub Actions rebuilds them on every push and Pages serves that CI output directly (see [docs/deployment.md](docs/deployment.md)). `build-planner` is the exception: its source does not currently compile, so its stale bundle remains committed and is not rebuilt by CI. To try the maintained apps locally, `npm install && npm run build` builds all seven once (no `--serve`, no live reload — just run it again after editing source).

## What's in here

| Path | What it is |
|---|---|
| `uma-skill-tools/` | The simulation engine — race physics, skill-condition parsing, Monte Carlo sampling. No UI dependencies; also used by CLI tools and tests. A git submodule ([`mackoz/uma-skill-tools`](https://github.com/mackoz/uma-skill-tools)) — `git submodule update --init` after cloning. |
| `umalator-global/` | **Primary app.** Global/EN race comparison simulator. Builds from `umalator/`'s source against Global game data. |
| `umalator/` | JP version of the same app; also the shared source both `umalator/` and `umalator-global/` build from. |
| `skill-visualizer/`, `skill-visualizer-global/` | Standalone tool: visualize where a skill's activation regions fall on a course, without running a full comparison. |
| `build-planner/` | Skill-list + region-overlay viewer for a fixed reference horse. |
| `courseimages/` | Utility to export course-diagram PNGs. |
| `umadle/` | An Uma Musume Wordle clone. |
| `rougelike/` | A hex-color-guessing Wordle clone — not Uma-related, just lives here. |
| `components/`, `strings/` | Shared Preact components (skill list/picker, course track SVG, uma editor) and i18n strings, used across the apps above. |
| `icons/`, `fonts/`, `courseimages*` | Static assets, referenced by an absolute `/uma-tools/...` URL prefix — see [docs/deployment.md](docs/deployment.md). |
| `vendor/` | Vendored copy of TanStack table-core + a Preact adapter, used by Umalator's results table. |
| `*.pl` scripts, `umalator-global/*.pl` | The data pipeline that regenerates uma/skill/course JSON from the game client — see [docs/data-pipeline.md](docs/data-pipeline.md). |

## Docs

- **[docs/architecture.md](docs/architecture.md)** — how a simulation actually runs, file by file, plus known rough edges in the engine.
- **[docs/apps.md](docs/apps.md)** — what each sub-app does, how to build it, and its gotchas.
- **[docs/data-pipeline.md](docs/data-pipeline.md)** — regenerating uma/skill/course data from the game client.
- **[docs/deployment.md](docs/deployment.md)** — GitHub Pages deployment, the `/uma-tools/` base-path constraint, local dev.
- **[docs/fork-changes.md](docs/fork-changes.md)** — this fork's simulation-accuracy changes and known unfixed bugs, preserved from the original fork notes.
- **[docs/upstream-comparison.md](docs/upstream-comparison.md)** — how this fork and upstream `alpha123/uma-tools` have diverged since the split: what each side added, and what turned out to be independent fixes for the same bug.
- **[docs/upstream-architecture.md](docs/upstream-architecture.md)** — how upstream's own engine and app layer work, end to end, on their own terms (not a diff — see [architecture.md](docs/architecture.md) for this fork's equivalent). Plain-language version: [docs/upstream-architecture-simple.md](docs/upstream-architecture-simple.md).
- **[docs/architecture-comparison.md](docs/architecture-comparison.md)** — fork vs. upstream, structure and design only (not features or game data): engine tick order, state management, build system, each with a plain-language ELI5.
- **[docs/upstream-data-sync.md](docs/upstream-data-sync.md)** — catching this fork's committed game data (umas/skills/courses/icons) up to upstream from a local checkout, since this fork's own data pipeline currently can't run against a live game client.
- **[CLAUDE.md](CLAUDE.md)** — repository working conventions (generated-file guardrails, JP/Global split, build commands).

## Lineage

`alpha123/uma-tools` was forked directly by kachi-dev on 2025-10-09, whose first commit squashed in changes from [`IHATEJEKUTO/VFalator-Umalator-Fork-Yeah`](https://github.com/IHATEJEKUTO/VFalator-Umalator-Fork-Yeah) (a separate, earlier fork of alpha123) rather than descending from it — VFalator is a source that got merged in, not an ancestor in a linear chain. IHATEJEKUTO went on to commit directly into kachi-dev's repo from 2025-10-13 onward. `kachi-dev/uma-tools` → this fork. See [docs/upstream-comparison.md](docs/upstream-comparison.md#lineage-accurately) for the commit-level evidence.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
