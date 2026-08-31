---
name: feedback-gitlink-review-false-positive
description: "a /code-review or /paired-review finding that uma-tools' gitlink points at an unmerged engine PR's branch tip (not origin/master) is expected pre-landing state, not a defect to hand-fix -- wq.py land's sync_gitlink resolves it automatically at merge time"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2766936e-0ab9-40d6-8271-50a96037e520
  modified: 2026-08-29T10:24:59.998Z
---

When `uma-tools`' `uma-skill-tools` gitlink points at the paired engine PR's own branch tip
instead of `uma-skill-tools`' `origin/master`, and neither PR has merged yet, **that is
correct, expected WIP state — not gitlink drift to fix by hand.** Don't re-bump it during
review, and don't treat a review finding that flags it as an actionable defect on its own;
the real fix is landing order, not an edit.

**Why**: confirmed by reading `uma-tools-plans/scripts/wq.py`'s actual gitlink mechanics
(`sync_gitlink`, `land_one`, `cmd_land`) during a 2026-08-29 `/paired-review medium` run on
HP-5's three paired PRs. `wq.py land --engine-pr N --code-pr M [--plans-pr K]`:
1. Merges the engine PR first (`land_one(ENGINE_REPO, engine_pr)`), capturing GitHub's real
   `mergeCommit` sha — not the branch's pre-merge tip.
2. `sync_gitlink` checks out that merge sha in the submodule and commits the gitlink bump
   **onto the still-open code PR's branch**, so the bump ships *inside* the code PR's own
   merge, never as a follow-up cleanup commit on `master`.
3. `land_one(CODE_REPO, code_pr)` has a structural gate: before merging, it re-reads the
   code branch's recorded gitlink and refuses to merge if it doesn't match engine
   `origin/master` — *unless* `--engine-pr` was passed (which means step 1–2 already made
   them match). This is the safety net that makes manual pre-emptive re-bumping unnecessary
   and actively wrong (a hand bump to the branch tip becomes stale garbage the moment
   `sync_gitlink` runs its own real bump).
`wq.py land --dry-run` previews this whole sequence, including printing the exact
"gitlink check: MISMATCH" message a reviewer would otherwise see and mistake for a live bug.

This is the direct cause of a real false-positive: `uma-tools#41`'s own PR body already
disclosed the gitlink pointed at `uma-skill-tools#13`'s branch tip pending merge, and a
`/paired-review` per-repo `code-review` sub-review still flagged it (correctly, given only
`CLAUDE.md`'s unqualified "must always point at the merged master tip" wording) as a
violation of that rule. The rule itself is right for the *landed* end state; it just didn't
say anything about the *in-review* state, which is what tripped the false positive. Fixed by
adding a clarifying sub-bullet directly under that rule in `uma-tools/CLAUDE.md`'s submodule
section (2026-08-29) — check there first; if it's been edited since, this memory's mechanics
description may have drifted from the doc's current wording.

**How to apply**: when a review (self-authored or a sub-review's finding) surfaces "gitlink
points at branch X instead of origin/master" while the paired engine PR is still open,
classify it as **defer/no-action**, not a fix — the correct next step is running (or noting
that the user should later run) `wq.py land --engine-pr <engine PR#> --code-pr <code PR#>
[--plans-pr <plans PR#>]` once ready to land, not editing the gitlink or the docs. If asked
to write review guidance for future paired-PR reviews, cite this note rather than
re-deriving the mechanism from scratch — the mechanics are read directly out of `wq.py`
(`sync_gitlink`/`land_one`/`cmd_land`), not inferred. Related: [[feedback_use_workflow_scripts]]
(the general "use wq.py, don't hand-run choreography" rule this is a specific instance of).
