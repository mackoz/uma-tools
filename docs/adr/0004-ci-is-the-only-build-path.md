# ADR-0004: Bundles are not committed; CI is the only build path

**Status:** Accepted
**Date:** 2026-08-20 (PR #5, "Stop committing CI-built bundles; fix Pages deploy race")

## Context

Built bundles (`bundle.js`/`bundle.css`/`simulator.worker.js`) were committed to git, with GitHub Pages configured as `build_type: legacy` (branch-source). PR #5 found that this wasn't just hygiene: **GitHub's built-in branch deploy and `deploy.yml` both fired on every push, seconds apart — last one wins, nondeterministically.** What was live depended on a race.

## Decision

All seven maintained apps' bundles are gitignored; `deploy.yml` rebuilds them from source on every push to `master`, and Pages is configured `build_type: workflow` so it serves exactly that CI-built artifact — the workflow is the *only* deploy path. Four apps that previously had only Windows `.bat` scripts got a `build.mjs` each so CI could build them (PR #5).

**Recorded exception:** `build-planner`'s bundles stay committed because its source does not currently compile — its committed bundle was already found broken at the time (stale, pre-dating the submodule rename), and fixing its build is a separate task (`docs/apps.md`). Don't add it to CI without fixing the source first (`CLAUDE.md` hard rule 2).

## Options considered

- **Keep committing bundles.** Rejected: the deploy race above, plus generated-diff noise burying real changes, drift between source and committed output, and manual cache-busting.
- **Branch-source deploy without CI.** Rejected: it's the racing path, and it deploys whatever was last committed rather than what the source builds to.

## Consequences

- Nobody needs to rebuild-and-commit before pushing; a push to `master` is sufficient and what's live always corresponds to the source at that commit.
- A broken build now fails in CI instead of shipping a stale bundle — build locally before pushing to catch it earlier (`CLAUDE.md`'s build commands).
- The one committed-bundle exception (`build-planner`) is quarantined and documented rather than silently precedent-setting.
