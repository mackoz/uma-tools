# ADR-0018: Adopt Vitest as the test runner; bump CI Node 20 → 22

**Status:** Accepted
**Date:** 2026-09-04 (PIPE-41)

## Context

The six `umalator/*.test.ts` files (`statisticalAnalysis.ts`, `chartLadder.ts`,
`shopSkillFilter.ts`, `spOptimizer.ts`, `racePresets.ts`, `histogramData.ts`) were runner-less
`node:assert/strict` scripts, each executed directly via `node --experimental-strip-types` and
chained with `&&` in `npm run test`. That got real TypeScript-source unit tests running with zero
added dependencies, but came with real limits: no per-test granularity (a failure only reports
"this file's script threw somewhere"), no watch mode, no snapshot testing, and no path to a
`components/`-level test that needs a DOM (jsdom or similar) without hand-rolling one.

A pre-refactor research pass (`tmp/test-tooling/`, the "Test Paddock" artifact) evaluated the
runner options against those gaps and settled on Vitest: it gives `toMatchFileSnapshot` for
future golden-master-style tests, a one-line `environment: 'jsdom'` switch when a `components/`
test eventually needs one, and an official `@stryker-mutator/vitest-runner` if mutation testing
is ever adopted. `vitest@5.0.0` requires Node `^22.12.0 || ^24.0.0 || >=26.0.0` — this repo's CI
(`.github/workflows/deploy.yml`) was still on Node 20, so the runner choice forces a CI Node bump
as a direct dependency, not an incidental one.

## Decision

**Adopt Vitest 5** as the test runner, keeping every existing `node:assert/strict` assertion call
unchanged (no migration to `expect()` — Vitest runs `node:assert` fine, and rewriting ~74 assertions
for no behavioral gain wasn't worth the diff). `package.json`'s `"test"` script becomes
`vitest run`; `test:stats` stays as a kept alias. The six test files are restructured into
`describe`/`test` blocks (grouped by the function under test, following each file's existing
`// --- Heading ---` comment structure) so a failure now reports which specific case broke, not
just which file.

**Bump CI's `actions/setup-node` from `node-version: 20` to `22`**, the direct consequence of
Vitest 5's engine requirement. This also incidentally silences a pre-existing `lint-staged`
`EBADENGINE` warning (lint-staged wants Node ≥22.22.1; `setup-node`'s `node-version: 22` resolves
to the latest 22.x, which satisfies it).

**`vite` is an explicit `devDependency`**, not left implicit as vitest's peer. This repo's
committed `.npmrc` sets `legacy-peer-deps=true` (needed for `accessible-autocomplete`'s Preact 8
peer, see `docs/apps.md` — not removable for this change), which makes `npm install` skip peer
installs entirely. Vitest 5 has a required (non-optional) peer dependency on `vite`; without it
declared explicitly, `vitest run` cannot start at all under this repo's npm config.

**No coverage tooling** (`@vitest/coverage-v8` deferred) — out of scope for this ticket; the goal
here is runner adoption and the CI bump it forces, not a coverage-tracking initiative.

**A blocking post-merge test step** was added to `deploy.yml`'s `build` job, right after
"Install dependencies," before any of the seven app builds: a red test on `master` now
intentionally holds the Pages deploy (the last-good deployed build stays live). This is a
new gate — `npm run test` was defined in `package.json` well before this change but was never
wired into CI at all, so a broken test could previously merge and deploy silently. Deliberately
*not* a PR-gating workflow (no `pull_request` trigger added) — this ticket's scope is the deploy
job's own safety net, not a new required-check story for `uma-tools`' PR review process.

## Options considered

- **`node:test`** (Node's built-in runner, zero added dependencies). Rejected: no
  `toMatchFileSnapshot`-equivalent, no built-in DOM environment for a future `components/` test,
  and no maintained mutation-testing runner comparable to `@stryker-mutator/vitest-runner`. It
  would have avoided the CI Node bump entirely, but at the cost of the exact gaps this decision
  exists to close.
- **Leave `vite` as an implicit peer dependency**, relying on npm's normal peer-install behavior.
  Rejected once confirmed empirically against this repo's own `.npmrc`: `legacy-peer-deps=true`
  makes npm skip peer installs unconditionally, so `vitest run` fails to start without `vite`
  installed explicitly — this isn't a "might as well be safe" precaution, it's a hard requirement
  given the existing npm config.
- **Migrate every `assert.equal`/`assert.deepEqual` call to `expect()`.** Rejected: no test
  actually needs a Vitest-only assertion feature yet (all ~74 cases are equality/truthiness
  checks `node:assert/strict` already expresses cleanly), and rewriting every call site would be
  a large diff for a purely cosmetic change. Revisit only if/when a specific test needs something
  `node:assert` can't express.
- **Skip the CI Node bump, pin `vitest` below 5.0.0 instead.** Rejected: the whole point of this
  adoption was Vitest 5's current feature set (and the JP/Global research already settled on it);
  downgrading to dodge the engine requirement would trade away the reason for the migration.

## Consequences

- **A guard-rail retires.** Under `node --experimental-strip-types`, importing a runtime `enum`
  (plain or `const`) from any test-reachable module raised `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` —
  which mechanically enforced that `umalator/racePresets.ts`, `presets.ts`, and
  `umalator-global/presets.ts` stayed free of a runtime import from
  `uma-skill-tools/RaceParameters.ts` (only `import type` was tolerated). Vitest has no such
  restriction — it tolerates a runtime `enum` import fine. The no-runtime-`enum`-import rule for
  those three files still holds, but it's now a build-time convention (documented in
  `racePresets.ts`'s own file header) rather than something the test suite itself will catch if
  violated. See `umalator/racePresets.ts`'s header comment for the current framing.
- CI's `setup-node` step now resolves Node 22.x instead of 20.x for every workflow run — no other
  workflow step in `deploy.yml` depended on the Node 20 pin specifically.
- `npm ci` on `ubuntu-latest` now installs `vite`'s per-platform optional native dependencies
  (rolldown, lightningcss) from a `package-lock.json` generated on darwin-arm64; modern npm
  records the full optional-dependency matrix, so this is expected to resolve cleanly, but is
  exactly the kind of thing that only proves out on the first real CI run.
- Test file line count grew modestly (more `describe`/`test` boilerplate, most other content
  unchanged) in exchange for per-test failure reporting; no test's actual assertions or fixture
  data changed.
