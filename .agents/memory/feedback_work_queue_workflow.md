---
name: feedback-work-queue-workflow
description: "all bug/feature work on uma-tools/uma-skill-tools is tracked in plans/work-queue/ — read the item file when given an ID, create an item first for un-logged work, move the file through backlog/ → in-progress/ → completed/ as work proceeds"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6fe89abf-95b2-47e5-ad27-1a570d4e81c0
  modified: 2026-08-24T19:47:16.411Z
---

All bug/feature work on `uma-tools`/`uma-skill-tools` is tracked in `plans/work-queue/` (the
sibling `uma-tools-plans` repo — see [[project_plans_directory]]). Created 2026-08-22, replacing
the old `plans/engine-comparison/` tracker.

**Why**: the user dispatches agents by item ID ("work on SKL-2"), watches parallel work via the
`in-progress/` folder, and wants every executed plan archived in `completed/` — none of which
works if an agent fixes things without touching the queue.

**How to apply**:

- **Given an ID** (e.g. "work on skl-2"): the item file is `plans/work-queue/backlog/<category>/<id>.md`
  (or `in-progress/`). Read it end to end first — it's self-contained (evidence, code reads,
  suggested approach). Then claim it: `git mv` to `in-progress/`, fix link depth per
  `work-queue/TEMPLATE.md`, write your implementation plan into its `## Plan` section *before*
  coding, and update `work-queue/README.md`'s tables.
- **Asked for un-logged work, or you discover a side-finding mid-task**: create the item first —
  mint the next free ID (engine areas SPD/HP/SKL/LANE/DYN/ORD, next-free list in the README; UI
  items are `UI-#`), copy `work-queue/TEMPLATE.md` into the right `backlog/` category dir, add
  the index row — then claim and work it. A one-line Summary suffices for a fresh idea.
  Side-findings get filed as new items rather than fixed silently (that's how SKL-11, SKL-12,
  and SKL-13 were found). Everything ever worked on should end up in `completed/` with its plan.
- **Size threshold (user correction, 2026-08-22): skip the queue entirely for genuinely small,
  self-contained fixes** — e.g. a hard-coded CSS color making input text invisible in one theme
  ("the css changes were way too small to warrant something to be added into the queue"). The
  queue is for things worth tracking progress on across a session or handing to another agent by
  ID — a fix small enough to just make and verify in the same breath doesn't need that
  scaffolding. When unsure which side a change falls on, ask rather than default to logging
  everything. Same judgment call as [[feedback_changelog_umalator_global]]'s size threshold.
- **Docs-only work skips the queue too (user correction, 2026-08-24)**: updating or creating
  documentation — even a large multi-file docs deliverable like a new `fork-comparison/`
  counterparty set — needs no work-queue ticket; the queue is for functional or UI changes
  ("no need for a wq ticket since this is just updating docs"). The branch + PR rule still
  applies to the plans repo regardless.
- **On completion** (merged to master only): append `## Outcome` (date, commits, PRs, deviations,
  verification), Status → done, `git mv` to `completed/`, update the README tables + dispatch
  list, and update `mkdocs.yml`'s `nav:` (the pre-commit hook enforces nav coverage).
- Refer to other items by plain ID text ("see SKL-13"), never relative links — item files move.
- **All plans-repo commits — bookkeeping and content alike — go on a branch + PR, never directly
  to `main`** (since 2026-08-23; see [[feedback_plans_branch_pr_workflow]]). This retires an
  earlier 2026-08-22 rule about not pushing bookkeeping-only commits to the shared main — moot
  now that nothing is pushed to main directly. The actual code fix always lands in
  `uma-tools`/`uma-skill-tools`, never in the plans repo.
