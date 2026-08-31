---
name: feedback-plans-branch-pr-workflow
description: "since 2026-08-23, never commit directly to main in uma-tools-plans — branch + PR in every repo a piece of work touches (uma-tools, uma-skill-tools, uma-tools-plans), then merge all the PRs together so master/main stays in sync across repos"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d852cd66-a070-4b94-b50a-7aae1154277e
  modified: 2026-08-29T23:56:05.338Z
---

Since 2026-08-23: **no direct commits to `main` in `uma-tools-plans`.** For any piece of work,
create a branch and open a PR in *every* repo that needs changes — `uma-tools`,
`uma-skill-tools`, and `uma-tools-plans` alike — and merge the related PRs together, so the
default branches of all three repos are always in sync with each other.

**Why**: the prior split flow (branches + PRs in the two code repos, direct-to-main in plans)
meant plans/`main` could describe work as claimed/in-review/done before the corresponding code
PR merged — the repos' default branches told inconsistent stories. The user wants merging to be
the single synchronization event: nothing lands on any main until everything lands together.

**How to apply**:

- Starting work that touches `plans/` (claiming a ticket, filling a Plan section, doc sync,
  `## Outcome`): branch in `~/github/uma-tools-plans` (cd into the symlink target), commit
  there, push the branch, open a PR — same as the code repos. Same for `uma-skill-tools`
  (engine + gitlink-bump PR pair) and `uma-tools`.
- The [[feedback_one_open_pr_per_repo]] rule applies to plans too: one open-PR slot per repo;
  if a plans PR is already open, push further plans commits to that PR's branch.
- At merge time, merge all the related PRs in the same turn (engine first if there's a gitlink
  bump, then uma-tools, then plans), so no main is left referencing unmerged work elsewhere.
- Mid-work status edits ("in review — PR #NN") live on the plans branch; the ticket's move to
  `completed/` + `## Outcome` can go on the same PR, written as of the expected merge.

[[feedback_keep_plans_docs_in_sync]] and [[feedback_work_queue_workflow]] both reference this
rule: their "commit+push in the same turn" steps still apply, but target the plans PR branch,
not main. (Before 2026-08-23 those flows committed straight to plans/main — that behavior is
retired.)

**Exception, confirmed by re-reading `wq.py`'s source (2026-08-29): `wq.py file` itself still
commits straight to `main`.** That's the tool's designed behavior for the mechanical
ticket-filing step (mint ID, write the skeleton, add the README/nav rows) — not a violation of
this rule. `wq.py claim` is the step that actually cuts the branch and opens the PR; the
branch+PR rule kicks in once real work starts, not at the moment a ticket is logged. Confirmed
in practice this session: PIPE-26/27/28 were all filed via `wq.py file` directly onto
`uma-tools-plans` `main`, same as the established precedent this memory was already built on.
