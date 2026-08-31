---
name: feedback-one-open-pr-per-repo
description: "prefer one open PR per repo (uma-tools, uma-skill-tools, uma-tools-plans), but as of 2026-08-29 it's soft guidance, not a hard rule — a second PR is fine if genuinely warranted, just flag it and confirm with the user first instead of opening it silently"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 6fe89abf-95b2-47e5-ad27-1a570d4e81c0
  modified: 2026-08-29T10:50:34.066Z
---

**Prefer at most one PR open at a time in each repo** — `mackoz/uma-tools`, `mackoz/uma-skill-tools`,
and `mackoz/uma-tools-plans` each get their own default single slot. As of 2026-08-29 this is
**soft guidance, not a hard rule**: the user explicitly relaxed it (`Prefer one open PR per repo
at a time — soft guidance, not a hard rule` is now the literal wording in all three repos'
`CLAUDE.md`, plus `paired-review/SKILL.md`'s Step 1 discovery logic, which used to call a second
discovered PR a rule "violation"). Don't cite the old absolute framing from before this date.

**Why the preference still exists**: the user reviews and merges serially; parallel open PRs in
one repo stack up, drift against each other (submodule gitlink bumps and rebuilt bundles conflict
easily), and make it unclear which branch new work should land on. None of that changed — what
changed is that a second PR is no longer *automatically* wrong when there's a real reason for it
(e.g. two genuinely unrelated efforts legitimately in flight at once, as happened this session:
HP-5's three PRs landed and merged while another peer session's UI-25 PRs were still open in the
same three repos the whole time).

**How to apply now**:

- Before creating a branch/PR in any of the three repos, still check for an existing open PR
  (`gh pr list --repo mackoz/<repo> --state open`). If one is open and the new work is genuinely
  the same thread, **commit and push to that PR's branch** rather than opening a second — this
  default hasn't changed.
- If the new work is *not* the same thread, opening a second PR is fine — but **flag it and
  confirm with the user first**, rather than opening it silently. This is the actual behavior
  change: previously the rule blocked a second PR outright; now it just requires a check-in.
- **The slot is consumed by an *open PR*, not by a local branch.** Work that is committed
  locally but unpushed with no PR does not occupy the slot — a second, unrelated ticket
  should still default to its **own branch** rather than being folded onto that local branch,
  unless the repo genuinely has a PR open (see the 2026-08-24 PIPE-2 correction this memory
  originally recorded — still the right default). When the new branch touches files the
  pending local branch already rewrote, base it on that branch (stack it) and rebase onto
  the default branch after the first one merges.
- This pairs with the two-repo engine flow: if `uma-skill-tools` has an open PR, engine changes
  still default to its branch; the matching `uma-tools` gitlink bump still defaults to
  `uma-tools`'s open PR branch.
- `uma-tools-plans` uses branches + PRs like the other two repos (since 2026-08-23 — see
  [[feedback_plans_branch_pr_workflow]]) and the same soft-guidance change applies there too.

**Doc locations this rule lives in**, if it needs updating again: `uma-tools/CLAUDE.md`'s
"Branching & PRs" section, `uma-skill-tools/CLAUDE.md`'s "Branching & PRs" section,
`uma-tools-plans/CLAUDE.md`'s "Conventions" section, and `paired-review/SKILL.md`'s Step 1
("More than one" branch of the PR-count logic).
