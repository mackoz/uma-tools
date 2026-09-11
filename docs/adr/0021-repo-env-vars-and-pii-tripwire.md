# ADR-0021: Repo paths as `UMA_*_REPO` env vars; PII tripwire with personal patterns kept out of git

**Status:** Accepted
**Date:** 2026-09-11 (PIPE-67)

## Context

Three repos make up one working loop — this one, its `uma-skill-tools` submodule, and the private
`uma-tools-plans` tracker reached through the gitignored `plans/` symlink. Before PIPE-67 five
places each re-derived those paths independently (`plans/scripts/wq.py`, `check-citations.py`,
`scripts/verify.mjs`, `scripts/worktree-setup.sh`, and the repo tables in the `project-review` /
`project-land` skills), and agents that had no variable to cite wrote the absolute path into ticket
prose instead. The 2026-09-02 history rewrite had already scrubbed the account holder's name from
this repo's history; a sweep on 2026-09-11 found the public repos clean but 12 tracked tickets in
the plans repo still carrying the home path, with nothing in any repo to refuse the next one.

## Decision

1. **`scripts/repo-env.sh` is the single source of the three paths.** It derives `UMA_CODE_REPO`
   from its own location (`git rev-parse --show-toplevel`, so a worktree resolves to itself),
   `UMA_ENGINE_REPO` as `<code>/uma-skill-tools`, and `UMA_PLANS_REPO` from the `plans/` symlink
   with the sibling-directory convention as fallback. A value already in the environment wins.
   Every consumer honors the variables and keeps its old derivation only as a fallback.
2. **Claude sessions get the variables from a tracked `SessionStart` hook** that runs the script
   with `--print` into `$CLAUDE_ENV_FILE`. The hook is computed from `CLAUDE_PROJECT_DIR`, so the
   tracked settings file contains no path from anyone's machine.
3. **A pre-commit tripwire in all three repos refuses staged added lines that look like a home
   path or a sanitized transcript directory.** The tracked patterns are generic (`/Users/<x>/`,
   `/home/<x>/`, `-Users-<x>-github-`) and deliberately tolerate placeholder notation (a `<` in the
   user segment), so docs can still write `/Users/<user>/...`. Personal identifiers — a real name,
   a real email — live only in an untracked per-user file,
   `${XDG_CONFIG_HOME:-$HOME/.config}/uma-tools/pii-patterns`, that each hook reads if present.
   Each hook exempts its own source and tests, so editing the tripwire never needs `--no-verify`.

## Options considered

- **A `"env"` block in `.claude/settings.json`.** Rejected: Claude Code's `env` takes literal
  values, which would have to be absolute paths — the exact thing this ADR exists to keep out of
  a tracked file. The hook computes them instead.
- **Only `.claude/settings.local.json`.** Rejected: untracked, so every clone and every worktree
  starts without the variables, and nothing outside a Claude session (a human shell, `wq.py`)
  benefits. The local file remains the right place for per-machine overrides.
- **Track the personal patterns with the hook.** Rejected outright: a tracked regex containing the
  account holder's name would itself be the leak. Generic patterns are tracked; personal ones are
  not.
- **Strict patterns with no placeholder tolerance.** Rejected: the tripwire's own display names,
  three CLAUDE.md sentences, and future docs legitimately write `/Users/<user>/...`; refusing them
  forced three `--no-verify` commits during implementation, which is the habit the hook exists to
  prevent. Excluding `<` from the user segment costs nothing real — no account is named `<x>`.
- **`git config` hooks for the engine via husky.** Rejected: the engine has no `package.json`
  hook tooling and shouldn't grow a devDependency for a five-line sh check; `.githooks/` plus a
  documented `core.hooksPath` matches the plans repo's existing convention.
- **Rewriting the plans repo's history as part of this change.** Deferred, not rejected: the
  working tree was scrubbed on the same PR; whether to rewrite that private repo's history is a
  separate decision with its own blast radius.

## Consequences

- The sibling-directory layout is now a default, not a requirement — set `UMA_PLANS_REPO` and
  everything follows.
- A subagent's shell does not receive the SessionStart exports (`$CLAUDE_ENV_FILE` does not
  propagate into nested sessions — first observed for the mkdocs `PATH` hook on 2026-08-29). The
  five workflow scripts are unaffected because they source `repo-env.sh` themselves; a subagent
  using the variables directly in Bash must `source scripts/repo-env.sh` first.
- `core.hooksPath` is per clone: a fresh engine clone runs no tripwire until
  `git config core.hooksPath .githooks` is run there (documented in the engine's CLAUDE.md).
- The tripwire checks added lines only. Moving or renaming a file that already contains a home
  path is not caught; the scrub handled the known 12, and a future sweep is `git grep`.
- Squash-merged PR branches are never force-deleted by `scripts/sync-main.sh`; they are reported
  with the exact `branch -D` command, because deleting unmerged local work is the user's call.

## Amendments

None yet.
