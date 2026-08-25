# ADR-0011: Gitlink-drift guard checks commit identity, and exists twice on purpose

**Status:** Accepted
**Date:** 2026-08-25 (`scripts/verify.mjs` `runGitlink()`, PR #29; `plans/scripts/wq.py` `doctor`, PR #14)

## Context

`uma-tools` master's `uma-skill-tools` gitlink repeatedly drifted stale relative to the submodule's own `origin/master` — five separate cleanup commits (`99f220c`, `f086592`, `05d7153`, `f2e10f0`, `5138be7`) before the root cause was fixed in `plans/scripts/wq.py`'s `land` (PIPE-4): it merged the engine PR against a working copy nobody edits in and discarded the resulting merge sha instead of re-recording it. `wq.py` also grew a `doctor` subcommand to check the invariant standalone, and `scripts/verify.mjs` grew a matching `gitlink` stage — this record covers two decisions in that second piece, raised in `uma-tools#29` review: how the check decides whether it's "on master" at all, and why it exists a second time instead of calling into `wq.py doctor`.

## Decision

**Commit identity, not branch name.** `runGitlink()` fetches `origin/master` in both the code repo and the submodule, then only runs the actual gitlink comparison when the code repo's `HEAD` sha equals `origin/master`'s sha. Everywhere else (ahead, behind, unrelated branch, or nothing determinable) it reports `gitlink -` and passes.

**Two independent implementations, not one shared source of truth.** `wq.py doctor` (Python, drives the multi-repo `land` sequence in `uma-tools-plans`) and `verify.mjs`'s `gitlink` stage (Node, a local backstop wired into `npm run verify` in `uma-tools`) both implement the same check and are not unified.

## Options considered

- **Branch-name gate (`git branch --show-current === 'master'`).** The first implementation. Rejected after PR #29 review: `git branch --show-current` returns `''` on detached `HEAD`, so a CI-style checkout (`actions/checkout`, `git worktree add --detach`) that lands exactly on master's tip silently skipped the check — exactly the automated case the guard exists to cover.
- **Commit-identity gate, but comparing against local `master` (no fetch).** Rejected: a stale local `origin/master` tracking ref can produce either a false STALE (blocking a gitlink that's actually current) or a false OK (masking real drift), depending on which side is stale. `wq.py doctor` already fetched first; the first `verify.mjs` version didn't, and that gap is what let finding 1 in the PR #29 review reproduce.
- **Silent skip on any `git` command failure.** Rejected: indistinguishable from the legitimate "not applicable" cases (no submodule, wrong branch), so a shallow/partial submodule clone — or a broken `git` entirely — reads as a clean pass instead of a real inability to verify. `runGitlink()` instead reports `gitlink UNKNOWN (...)` with `ok: false` whenever a `git` call it actually needed fails, and only treats "commit doesn't match origin/master" as the intentional skip case.
- **Unify the two checkers** (have `verify.mjs` shell out to `wq.py doctor`, or extract a shared implementation). Rejected: `wq.py doctor` and `verify.mjs`'s `gitlink` stage run in different repos (`uma-tools-plans` vs `uma-tools`) and different languages, with no existing cross-repo dependency between them — adding one to save ~30 lines of duplicated `git rev-parse` logic would introduce coupling neither repo's `CLAUDE.md` asks for, and would make `npm run verify` in `uma-tools` depend on a checkout of `uma-tools-plans` existing at a known relative path, which isn't otherwise a requirement to build or verify `uma-tools`.

## Consequences

- A `master`-branch commit that's ahead of `origin/master` (committed locally but not yet pushed) is no longer checked *before* push — only once it matches `origin/master`, e.g. after `git pull`, or in CI right after a merge. This trades a small amount of pre-push local feedback for correctly covering detached-HEAD CI checkouts, which is the more common way this guard actually runs.
- The two implementations can drift apart in behavior (as they already did once — `verify.mjs` shipped without the fetch step `wq.py doctor` had). There's no mechanical guard against that; a future change to one invariant check should be checked against the other by hand, the same way this ADR's own fix had to be.
- `gitlink UNKNOWN` failing the run (rather than passing) means a genuinely broken environment (no `git` on `PATH`, a submodule with no `origin/master` ref reachable) now fails `npm run verify` instead of silently reporting `gitlink -`. This is intentional per the finding-4 fix, but means the stage is slightly less forgiving of unusual/constrained checkouts than the other `verify.mjs` stages (`smoke`, `docs`), which degrade to a skip rather than a failure when their prerequisites are missing.
