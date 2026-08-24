# Working in uma-tools

Guidance for working in this repo. It's a browser-based Uma Musume: Pretty Derby race simulator (Preact + TypeScript + esbuild, no framework, no server). Full docs are in `docs/` — this file only covers what a future edit is likely to get wrong.

## Hard rules

1. **Never hand-edit generated files.** These are all build output or data-pipeline output, not hand-written source:
   - `*/bundle.js`, `*/bundle.css`, `*/bundle.2.js`, `*/simulator.worker.js` — esbuild output. Edit the `.tsx`/`.ts` source and rebuild instead.
   - `umas.json`, `skill_meta.json`, `icons.json`, and the `umalator-global/` equivalents — Perl-generated from the game's `master.mdb`. Edit the generating `.pl` script (see `docs/data-pipeline.md`) and regenerate, don't patch the JSON directly. `uma-skill-tools/data/{skill_data,skillnames,course_data}.json` are the same story but live in the `uma-skill-tools` submodule (see the submodule section below) — the generating `.pl` scripts are there too, and a fix means committing and pushing in that repo, not editing the checked-out copy here. `tracknames.json` is the exception: it is hand-maintained because no generator exists.

2. **Bundles are *not* committed to git — CI is the only build path.** `umalator`, `umalator-global`, `skill-visualizer-global`, `skill-visualizer`, `courseimages`, `rougelike`, and `umadle` all have a `build.mjs` and are gitignored (see `.gitignore`); `deploy.yml` rebuilds all seven on every push to `master`, and GitHub Pages is configured (`build_type: workflow`) to serve exactly that CI-built artifact — there is no separate "legacy" branch-source deploy racing it anymore. This means you do **not** need to rebuild-and-commit before pushing, but you should still build locally (see commands below) to catch a broken build before it reaches CI. `build-planner` is the one exception: its `bundle.js`/`bundle.2.js` stay committed because its source doesn't currently compile (see `docs/apps.md#build-planner`) — don't add it to CI without fixing that first.

3. **`umalator-global/` has no source of its own.** It's a build target: `umalator-global/build.mjs` compiles `../umalator/app.tsx` with `CC_GLOBAL: 'true'` against the JSON data in `umalator-global/`. **Any edit to `umalator/app.tsx` (or its imports) affects both apps.** If you change it, rebuild *both* `umalator/` and `umalator-global/`, and check whether the change needs to branch on the `CC_GLOBAL` define (stat defaults, label text, feature availability all already do this in places — grep `CC_GLOBAL` before assuming a change applies uniformly).

4. **Any new asset reference must use the `/uma-tools/` absolute prefix**, matching the existing pattern in `icons.json`, `umalator/app.css`, `umalator/app.tsx`, `components/SkillList.tsx`, `components/SkillPicker.tsx`. This is required for GitHub Pages deployment to work — see `docs/deployment.md`. Don't switch to relative paths for icons/fonts without reading that doc first.

## Branching & PRs

- **One open PR per repo at a time.** Before creating a branch, check for an existing open PR/branch covering the same area (`gh pr list`) and push to that branch instead of branching off `master` again.
- **Ask before switching branches in a checkout you didn't create, entering or removing a worktree, or killing a running process** — another session may own it. Check `git worktree list` and what a process is serving before touching either.
- **Worktrees live under `.claude/worktrees/` and need setup**: run `scripts/worktree-setup.sh` inside a fresh worktree (submodule init, `node_modules` symlink, git-exclude), and `scripts/stage-for-review.sh <branch>` to tear one down and stage its branch in the main checkout. A dev server started from a worktree derives its static root from the repo path — the app serves at `http://localhost:8000/<worktree-name>/umalator-global/` and `/uma-tools/`-prefixed assets (icons, fonts) 404 there. That's expected inside a worktree; do final visual checks from the main checkout.

## Scope control

Match ceremony to change size. A trivial fix (a two-line CSS tweak, a typo) gets a commit only — no changelog entry, no ADR, no tracker ticket. Reserve those for multi-file or behavior-changing work: a changelog entry when the change visibly affects umalator-global users, an ADR when a decision could have gone another way.

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

npm run verify                               # build both umalator apps + typecheck + CSS metrics + browser smoke + docs, one-line diff vs scripts/verify-baseline.json
npm run verify:baseline                      # re-record that baseline (run on master right after a merge; skips the smoke/docs stages)
npm run smoke                                # browser smoke alone: Playwright chromium drives umalator-global (light+dark), asserts contrast/stacking/clipping
```

`npm run smoke` (also the smoke stage of `verify`) boots the umalator-global dev server on :8123, screenshots + a per-check `smoke-report.json` land in `scripts/smoke-artifacts/` (gitignored). One-time setup: `npx playwright install chromium` — without it the stage reports `smoke SKIPPED` (exit 2) rather than failing. It must run from the main checkout (the dev server serves the parent dir, so `/uma-tools/`-prefixed assets 404 from a worktree — same constraint as visual checks). `node scripts/verify.mjs --skip-smoke` skips the browser stage for a quick run. The smoke encodes two *intentional* facts — don't "fix" either: `.skill-picker-overlay`'s z-index literal 10000 (kept per ADR-0010/D5) and `.infoModalOverlay` stacking *below* `#iconSidebar` so sidebar navigation stays clickable.

`build.mjs` is authoritative for every app that has one. Several apps still carry legacy Windows-oriented `build.bat` scripts, but `build-planner` is now the only app with no `build.mjs`. The old scripts predate the current build setup; in particular, `umalator/build.bat` does not emit `simulator.worker.js`, so it is not a substitute for `umalator/build.mjs`.

There is no `tsc` step in any build — esbuild transpiles directly, so a build succeeding does **not** mean the TypeScript typechecks. Run `npm run typecheck` (`tsc --noEmit`) yourself if you want that guarantee; it isn't wired into any build script. The pre-existing backlog is dominated by implicit-`any` errors concentrated in a handful of large files (`umalator/app.tsx`, `compare.ts`, `SkillList.tsx`, `HorseDef.tsx`) — a known, tracked backlog, not something a normal change is expected to fix incidentally. **Beware: tsc 7.x (typescript-go) hard-caps reported diagnostics at 1000, and this backlog saturates the cap** — so the total count reads as exactly 1000 and which diagnostics get reported varies run to run (concurrent checking); counts above 1000 quoted in older notes came from a counting path that no longer applies. `npm run verify` prints the count as ">=1000 (capped)" and only treats it as a regression signal below the cap. Don't treat introducing a handful of *new* errors in a file you're already touching as fine because "it's already broken" — check `git diff` against a `tsc --noEmit` run before/after your change on files you edited, the way `uma-skill-tools/CLAUDE.md`'s own `test/`/`tools/` section models.

`umadle` now builds from a clean install: `accessible-autocomplete` is a declared dependency, and `.npmrc` supplies the legacy-peer setting required for its optional Preact 8 peer against this repo's Preact 10. See `docs/apps.md` for the details.

If game data looks stale (a released uma/skill/course is missing) and there's no `master.mdb` handy, there's a stopgap script, `scripts/sync-upstream-data.mjs`, that ports already-computed data from a local checkout of `alpha123/uma-tools` instead of assuming a full pipeline run is required (this fork's own asset extraction is currently broken against the encrypted live client — see `docs/data-pipeline.md`). To poke at a `master.mdb` you do have (confirm a table/column exists before writing a throwaway script against it), use `sqlite3 master.mdb` (bundled on macOS, no install needed) — `.tables`, `.schema <table>`, or plain SQL. No decryption needed for `master.mdb` itself; the encryption `docs/data-pipeline.md` describes is specific to the separate `meta` asset-manifest DB (icon/asset extraction), not the skill/course/uma tables these `.pl` scripts read.

## Linting and formatting

[Biome](https://biomejs.dev) (`@biomejs/biome`, config at `biome.json`) — one tool for both lint and format, tabs, single quotes, understands TSX. `npm run lint` checks, `npm run lint:fix` applies safe fixes. A `husky` pre-commit hook runs `lint-staged`, which runs `biome check --write` **only on staged files** — it will not reformat a file you didn't touch.

**The existing codebase has deliberately not been bulk-reformatted.** A full `biome check --write .` run touches ~160 files and produces a 50k+ line diff (verified, then discarded, while setting this up) — running it is almost never what you want; it buries a real change in reformatting noise and touches vendored code (`vendor/table-core`, excluded from `biome.json`'s `files.includes` for this reason, along with the `uma-skill-tools` submodule, which has its own tooling). Files only get formatted as you actually edit them, via the pre-commit hook.

`biome.json` turns off several "recommended" rule categories that would otherwise be pure noise on a codebase with no prior lint history: `a11y` (172 findings on the first run, needs real UX judgment, not a mechanical fix), `noExplicitAny` (367 findings — this is what `npm run typecheck`'s implicit-any backlog above is already tracking, don't duplicate the noise), `noDoubleEquals` (192 findings, many likely-intentional `== null` idioms), `noNonNullAssertion`, `noDescendingSpecificity` (CSS). Revisit any of these as a deliberate, scoped pass later rather than assuming they should just be turned back on.

`type-coverage` was evaluated for tracking the implicit-`any` backlog above and **doesn't work** — it crashes against this repo's TypeScript 7.0.2 (`type-coverage-core` reaches into a `ts.SyntaxKind` value that no longer exists at that API surface); confirmed as a known, open upstream gap ([plantain-00/type-coverage#150](https://github.com/plantain-00/type-coverage/issues/150), TS 6.x/7.x support). Don't re-suggest it without checking whether that's been resolved upstream first.

## JP vs Global data split

Two parallel datasets, both derived from the same generator logic run against different `master.mdb` files (JP client vs Global client) — see `docs/data-pipeline.md` for the full pipeline:

| | JP | Global |
|---|---|---|
| Location | repo root (`umas.json`, `skill_meta.json`, `icons.json`) + `uma-skill-tools/data/` | `umalator-global/` |
| Roster | 141 umas | 76 umas (Global lags JP releases) |
| Skill names | `["ja", "en"]` tuples | `["en"]` single-element |
| Courses | 139 | 119 (Global still lacks some JP courses) |

Icons are **not** duplicated — both datasets reference the same `icons/` tree via the same `icons.json`. When adding data by hand for a quick test, don't cross-wire JP data into a Global-built app or vice versa; the shapes differ (see the skillnames array-length difference above) and code branches on `CC_GLOBAL`, not on which JSON happens to be loaded.

Of that 76, 11 umas (plus 11 alt outfits on already-counted umas) are **not actually released on Global yet** — datamined from the Global client's own staged text and ported from JP mechanics via `scripts/add-staged-global-umas.mjs`, gated behind the "Show Unreleased Umas" toggle in umalator's Settings pane (default off; see `umalator-global/unreleased.json`, and the root `unreleased.json` which is always empty for the JP build). See that script's own comments and `scripts/data/global-release-order.json` for how the JP-implementation-date cutoff works and how to extend it to a later batch.

## Code conventions

- Tabs for indentation, matching the existing files.
- Preact, not React — JSX factory is `h`/`Fragment` (see `tsconfig.json`: `"jsxFactory": "h", "jsxFragmentFactory": "Fragment"`). Don't import from `react`.
- `HorseState` (the uma stat/skill editor state) is an Immutable.js `Record`, defined in `components/HorseDefTypes.ts`. Follow the existing `Record`-update patterns (`.set()`, `.update()`) rather than mutating.
- `uma-skill-tools/` is intentionally engine-only — it must stay independent of Preact/DOM so it can run inside the web worker (`simulator.worker.ts`) and the `ts-node` CLI tools under `uma-skill-tools/tools/`. Don't import Preact components into it.
- See `docs/architecture.md` for the simulation engine's data flow and known rough edges before modifying `uma-skill-tools/`.
- **`uma-skill-tools/` is a git submodule**, pointing at [`mackoz/uma-skill-tools`](https://github.com/mackoz/uma-skill-tools) (itself a fork of [`alpha123/uma-skill-tools`](https://github.com/alpha123/uma-skill-tools); this engine has diverged substantially from alpha123's — don't assume alpha123's semantics, test cases, or numeric output apply here). It used to be vendored in-tree instead; if you're reading history from before that changed back, the file layout is identical either way, only how changes propagate differs now:
  - After a fresh clone, run `git submodule update --init` — an unitialized submodule leaves `uma-skill-tools/` looking present in listings but empty on disk, and every build fails on missing imports.
  - **Engine changes happen in the submodule repo first.** Edit inside `uma-skill-tools/`, commit and push *there* (it's its own git repo, with its own remote), then come back here and commit the resulting gitlink bump (`git add uma-skill-tools && git commit`). Editing the checked-out copy here without doing that leaves the fix on disk but unrecorded — the gitlink still points at the old commit, so a fresh clone or `git submodule update` silently reverts it.
  - One concrete trap carried over from the engine's own `CLAUDE.md`: `Rule30CARng` (`Random.ts:29`) is just an alias for a `prando`-backed PRNG here, even though alpha123's class of the same name is a real Rule-30 cellular-automaton generator.

## Documentation changes

- After a code change, sweep this repo's own `README`/`CLAUDE.md`/`docs/` for claims the change made stale and fix them in the same pass.
- When rewriting a doc, keep its existing format — tables stay tables. Don't convert a table to prose unless explicitly asked.
- Verify factual claims (stats, mechanics, HP/chart numbers) against the source code or a real `master.mdb` query before writing them, and cite the file you checked.

## Where to look next

- **What does this app do / how is it built?** → `docs/apps.md`
- **How does a simulation actually run, file by file?** → `docs/architecture.md`
- **How do I regenerate the game data (new umas, new skills)?** → `docs/data-pipeline.md`
- **How do I deploy or run this locally?** → `docs/deployment.md`
- **How does the statistical Skill Chart evaluate skills (ladder, block sampling, detail-on-demand)?** → `docs/statistical-analysis.md`
- **Why is something designed the way it is (build posture, chart statistics, submodule, format policy)?** → `docs/adr/` — decision records with context, rejected options, and consequences. Engine-level decisions have their own set in `uma-skill-tools/docs/adr/`. When a change settles a question that could have gone another way, add or amend a record (see `docs/adr/README.md`).
