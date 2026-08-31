---
name: feedback-crosslink-paired-prs
description: "When opening paired PRs across uma-tools/uma-skill-tools/uma-tools-plans for one fix, cross-link them in each PR body"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 71571d55-b857-444b-a6cb-3cd92d219acb
  modified: 2026-08-25T23:36:39.996Z
---

When a single fix spans multiple PRs across the three repos (e.g. one PR each in
`uma-tools`, `uma-skill-tools`, `uma-tools-plans` for the same bugfix/feature), include a
link to each *other* open PR in every PR's body — e.g. `uma-tools`' PR body links to the
`uma-tools-plans` and `uma-skill-tools` PRs for the same change, and vice versa.

**Why:** the user asked for this explicitly (2026-08-25) so paired PRs are traceable from
any one of them without having to know to go look in the other repos. They also clarified
this doesn't conflict with [[project_doc_locations_after_fork_comparison_move]]'s "never
link the private repo from a public one" rule — that rule is about not exposing
fork-comparison *content* from a public repo, not about withholding the existence of a
tracking link. A bare link to the `uma-tools-plans` PR itself (not to comparison content
inside it) is fine to include in a public `uma-tools`/`uma-skill-tools` PR body.

**How to apply:** whenever opening PRs in more than one of these three repos for the same
piece of work (this is the same "paired PR" concept [[feedback_one_open_pr_per_repo]] and
`wq.py land` already track), add a short line/section in each PR body linking to the
sibling PR(s) — e.g. "Paired with: mackoz/uma-tools-plans#16". Do this at PR-creation time,
not as a follow-up edit, and update it if a sibling PR's number wasn't known yet when the
first PR was opened.
