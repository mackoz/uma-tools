---
name: feedback-use-workflow-scripts
description: "since 2026-08-23, use the committed workflow scripts (npm run verify, scripts/wq.py, worktree helpers) instead of hand-running the per-phase choreography — the user asked for this specifically to cut token/context waste"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d852cd66-a070-4b94-b50a-7aae1154277e
  modified: 2026-08-25T00:05:20.589Z
---

Since 2026-08-23 (uma-tools#22 / uma-tools-plans#3), the repetitive per-phase choreography is
scripted. Use the scripts, not manual command sequences:

- **`npm run verify`** (uma-tools) — builds both umalator apps + typecheck + `.dark`/color-literal
  counts, one diff line vs `scripts/verify-baseline.json`. `npm run verify:baseline` re-records
  (run on master right after a merge). `--skip-build` for fast CSS-only loops.
  Note: tsc 7.x caps diagnostics at 1000 and the backlog saturates it — shown as `>=1000 (capped)`;
  the old 1084/1136 counts were an artifact and are gone from CLAUDE.md.
- **`scripts/wq.py`** (uma-tools-plans) — `claim <id>`, `status <id> "<text>"`,
  `complete <id> --refs "..."` (requires `## Outcome` first), and
  `land --code-pr N --plans-pr N [--engine-pr N]` (ordered merges, branch cleanup both repos,
  Pages-deploy poll). It leaves `## Plan`/`## Outcome`/dispatch-list prose to the LLM and prints a
  reminder. `--no-push` for dry runs.
  Since 2026-08-24 (PIPE-4): `ENGINE_REPO` is the submodule inside the `uma-tools` checkout, not a
  separate sibling clone (that duality — plus `land` never re-recording the engine merge commit —
  is why the `uma-tools` gitlink kept drifting stale across five prior cleanup commits). `land`
  with `--engine-pr` now re-bumps the gitlink onto the still-open code PR's branch right after the
  engine PR merges, before the code PR merges, so the bump ships *inside* the code PR instead of as
  a follow-up commit. `wq.py doctor` (no args) is a standalone read-only check for the same
  invariant — run it if a PR merged outside `wq land`, or to sanity-check gitlink state at the
  start of a session.
- **`scripts/worktree-setup.sh`** (uma-tools) — run once inside a fresh worktree (submodule init,
  node_modules symlink, git-exclude). **`scripts/stage-for-review.sh <branch>`** — safe worktree
  teardown + checkout + `npm run verify` before the user's local-deploy check.

**Why**: the user explicitly asked to offload repetitive rule-based work from LLM tokens into
local scripts ("minimize token usage, reduce context bloat"). Each phase's bookkeeping was
~15–25 tool calls; the scripts collapse it to a handful.

**How to apply**: reach for the script first; fall back to the manual steps (still documented in
[[feedback_work_queue_workflow]] and `work-queue/README.md`) only when a case doesn't fit, and
prefer extending the script over hand-running the sequence again. Related:
[[feedback_plans_branch_pr_workflow]] (the workflow the scripts implement).
