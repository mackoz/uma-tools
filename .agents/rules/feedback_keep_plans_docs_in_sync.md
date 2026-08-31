---
name: feedback-keep-plans-docs-in-sync
description: "whenever a uma-tools change touches something documented under plans/, update the corresponding plans/ doc in the same turn — don't let it drift"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8d5349f4-9dd8-4bc4-9282-7dd917c217fd
  modified: 2026-08-23T11:44:15.962Z
---

When making a change in `uma-tools` (engine, data, or app-layer) that affects a claim documented
under `plans/` (a symlink to the sibling repo `mackoz/uma-tools-plans` — see
[[project_plans_directory]]), update the relevant `plans/` doc in the same turn — don't leave the
correction for later.

**This is a two-repo change, not one.** Editing the file under `plans/` only updates the working
tree of the sibling repo `uma-tools-plans` — it is never part of a `uma-tools` commit (`plans` is
gitignored there). The edit isn't done until it's also committed and pushed from
`~/github/uma-tools-plans` (`cd` into the symlink target, not the symlink path, for `git` commands
to behave normally) — onto a **branch + PR**, never directly to `main` (since 2026-08-23; see
[[feedback_plans_branch_pr_workflow]]). Skipping the commit+push leaves the fix sitting
uncommitted on disk, invisible to anyone who doesn't happen to check that repo's working tree —
functionally the same as not having made the fix at all.

**Why**: `plans/` holds `plans/work-queue/`'s finding-by-finding item files (this repo's engine
vs. upstream B vs. the fork network vs. the game-mechanics ground-truth doc — replaced
`plans/engine-comparison/` on 2026-08-22), `plans/fork-comparison/alpha123/engine-mechanics.md`
(parity inventory + no-action findings), and `plans/fork-comparison/alpha123/port-plan.md`'s port
backlog. All make specific, cited claims — "this repo does X, upstream does Y at `file:line`" —
about `uma-tools`'s current state. Once `uma-tools` changes, an unedited claim stops being a
snapshot-in-time and starts being wrong: the whole point of these docs (letting a human or a
future session trust a citation without re-deriving it) breaks silently if they drift. This
already happened once — the alpha123 port plan's "fork-only strengths" table went stale for a
session and needed a dedicated correction pass to fix 6 misattributed rows and 3 prose claims
after a later investigation session found the truth.

**How to apply**: before finishing a turn that changed engine behavior, skill/data handling, or
anything else a `plans/work-queue/` item, `plans/fork-comparison/alpha123/engine-mechanics.md`, or
a `plans/fork-comparison/*/` comparison/port-plan makes a claim about — grep the affected
file/mechanism/finding-ID across `plans/` (e.g. `grep -rn "RaceSolver.ts:1013"` or the finding's
ID like `DYN-1`) and check whether anything now describes stale state. Resolving a finding follows
the work-queue lifecycle (see [[feedback_work_queue_workflow]]): the item file moves
`backlog/ → in-progress/ → completed/` with an `## Outcome` (commits, PRs, date) — never delete an
item or reuse its ID. This applies even though `plans/` lives in a separate repo and isn't part of
`uma-tools`'s own commit — the sync step (edit `plans/...`, `cd` into the symlink target, commit,
push to the plans PR branch) is still part of finishing the `uma-tools` change, not optional
follow-up work.

See also [[feedback_sync_repo_docs_on_change]] — a separate, complementary memory for the repos'
*own* in-tree docs (`README.md`/`CLAUDE.md`/`docs/*.md` in `uma-tools` and `uma-skill-tools`
themselves), as opposed to this memory's scope (the `plans/` analysis docs in the sibling
`uma-tools-plans` repo). Both need checking after a change; they're easy to conflate but cover
different files for different audiences.
