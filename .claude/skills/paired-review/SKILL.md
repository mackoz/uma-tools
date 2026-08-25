---
name: paired-review
description: Review every open PR across uma-tools, uma-skill-tools, and uma-tools-plans together, in dependency order, then run a cross-repo pass over the combined change. Use when a change spans paired PRs in these sibling repos and a single /code-review run on one PR would miss how it interacts with the others.
argument-hint: "[low|medium|high|xhigh|max] [--comment] [--fix] [--engine-pr N] [--code-pr N] [--plans-pr N]"
---

# /paired-review

Reviews the open PRs across all three repos this project spans, in dependency order,
carrying each repo's findings forward as context for the next, then runs a dedicated
cross-repo pass to catch what no single-repo review can: an engine PR whose merge commit
the code PR's gitlink must record, an engine signature change `uma-tools` depends on, a
doc claim in `uma-tools-plans` a code change makes stale.

This is the review-side counterpart to `plans/scripts/wq.py land`, which automates the
paired *merge*. `/paired-review` never merges, pushes, or lands anything — it only reviews
and (optionally) comments.

## Step 0 — Parse arguments

`args` = everything after `/paired-review`, whitespace-separated, flags position-independent:

- `--comment` — passed through to every `code-review` call and to the cross-repo pass.
- `--fix` — passed through to every `code-review` call. Each sub-review fixes only its own
  repo's working tree; this skill never commits on the user's behalf.
- `--engine-pr N` / `--code-pr N` / `--plans-pr N` — explicit PR numbers that bypass
  discovery (Step 1) for that repo.
- First remaining token, if one of `low|medium|high|xhigh|max` → the level.
- `ultra` → **stop immediately** and tell the user: ultra is a user-triggered, billed,
  multi-agent cloud review launched only via `/code-review ultra` (or `/ultrareview`)
  interactively — it cannot be launched programmatically from inside this skill. Point
  them at running it directly per repo instead.

**Level handling — do not default to a value.** If the user passed a level, remember it
literally and forward it to every `code-review` call. If they did not, **omit the level
entirely** from every `code-review` call — call it as `Skill(code-review, "--comment <url>")`,
not `Skill(code-review, "high --comment <url>")`. `code-review` persists whatever level it's
given as the user's global `codeReviewLastEffort` default; inventing a default here would
silently overwrite the user's own last-used setting the next time they type `/code-review`
bare. Passing nothing lets it fall back to what they last chose themselves — the same
contract `/code-review` already offers when invoked with no level.

## Step 1 — Discover the three PRs

Repo table (mirrors `plans/scripts/wq.py`'s `ENGINE_REPO`/`CODE_REPO`/`PLANS` constants —
note `ENGINE_REPO` is deliberately the *submodule inside* `uma-tools`, not any sibling
clone, per that script's own comment on why a sibling clone let gitlink drift go
unnoticed):

| Slot | Local path | GitHub repo | Base branch |
|---|---|---|---|
| engine | `/Users/mackoz/github/uma-tools/uma-skill-tools` | `mackoz/uma-skill-tools` | `master` |
| code | `/Users/mackoz/github/uma-tools` | `mackoz/uma-tools` | `master` |
| plans | `/Users/mackoz/github/uma-tools-plans` | `mackoz/uma-tools-plans` | `main` |

Reach `uma-tools-plans` by that real path, **never** through the `uma-tools/plans/`
symlink — `uma-tools-plans/CLAUDE.md` warns the symlinked path trips tool path guards.
The base branch genuinely differs per repo (`main` on plans); don't assume it, read it
off the PR object.

For each slot without an explicit override from Step 0, run:

```
gh pr list --repo <github repo> --state open --json number,title,headRefName,url
```

- **Zero results** → skip that slot. Note it in the final summary as "no open PR — skipped."
- **Exactly one** → that's the slot's PR.
- **More than one** → this violates the repos' own "one open PR per repo" rule. Stop and
  ask the user which one they mean rather than guessing.

**Relatedness check (warn, don't block).** Paired PRs share an identical head branch name
in practice, though nothing enforces it and `wq.py` never reads it. If two or more
discovered PRs' `headRefName`s differ, print a warning — `"heads differ (<a> vs <b>) —
these may be unrelated PRs, reviewing anyway"` — and continue. This is a cheap sanity
check, not a hard gate.

Print the resolved plan (which slots have a PR, their numbers/titles/URLs, which slots
are being skipped) before doing anything else, so the user can interrupt if it's wrong.

## Step 2 — Per-repo reviews, in order: engine → code → plans

For each slot that has a PR, **in this order**, do the following. This is dependency
order: engine lands first in `wq.py land` too, and a code-side PR is usually easiest to
understand after seeing what changed underneath it.

1. If this isn't the first slot being reviewed, state the prior slot(s)' HANDOFF block(s)
   (see below) in your own turn, in plain text, immediately before the next call. A forked
   `code-review` run inherits the session transcript, so stating it here is how context
   reaches it — the `code-review` argument string is positional (level, then target) and
   cannot carry extra context itself.

2. Call the skill **directly** — do not wrap this in an `Agent` call:

   ```
   Skill(skill: "code-review", args: "<level, or omit> <--comment/--fix if set> <PR URL>")
   ```

   Direct is required, not a style choice: `code-review` forks into its own subagent and
   spawns its angle-finder subagents *itself* — that's already the orchestrator → review
   agent → finder agents layering this skill wants. But it also probes at runtime for the
   `Agent` tool and an agent-depth budget; if either is unavailable (which nesting it a
   level deeper inside a Task/Agent call risks triggering) it silently falls back to a
   single-pass review with no fan-out, and explicitly announces that it did so. If you
   ever see a sub-review state it ran "without the Agent tool, not the full multi-agent
   fan-out," something upstream nested it — stop and flag this to the user rather than
   quietly accepting a degraded review.

   If `Skill(code-review, ...)` is not invocable at all in this session (its
   model-invocation gate is feature-flagged and may be off), stop and tell the user to
   run the three `/code-review` commands by hand instead of attempting a lesser
   in-line substitute.

3. From that call's result, distill and record a HANDOFF block. Append it to
   `<scratchpad dir>/paired-review-handoffs.md` (your scratchpad directory is named in
   your system prompt) so it survives context compaction, and keep a copy in your own
   working context for Step 3:

   ```
   ## HANDOFF <slot> (<owner/repo>#<number>)
   REVIEW: <posted, with link | not posted (no --comment)>
   DIFF SCOPE: <files touched; one line on the shape of the change>
   FINDINGS: <count>; each as `file:line — one-line summary`, severity-first, cap ~8
   CROSS-REPO INVARIANTS AT RISK: <bullets, or "none">
   ```

   "Cross-repo invariants at risk" means: does this PR's change depend on, or promise
   something about, code that lives in one of the *other* two repos? Concretely, watch
   for: a gitlink bump that must match a specific engine merge commit; an engine function
   signature or numeric-output change that `umalator/compare.ts`, `simulator.worker.ts`,
   or `uma-skill-tools/tools/` call; a change to `wq.py`/`verify.mjs` (the paired-merge
   machinery itself); a claim in `plans/work-queue/`, `engine-mechanics.md`, or a port
   plan that this PR's change makes stale.

## Step 3 — Cross-repo pass

This is the step a single-repo `/code-review` structurally cannot perform, and the reason
this skill exists rather than three manual `/code-review` calls. Skip this step only if
fewer than two slots had an open PR — there's nothing cross-repo to check with just one.

Launch one `Agent` (fan-out isn't needed here — this is synthesis, not diff-scanning).
Give it: every HANDOFF block from Step 2, the PR URLs, and the specific things to check,
drawn from the "cross-repo invariants at risk" list above plus:

- Do findings in one repo contradict findings or assumptions recorded in another?
- Is a change to the paired-merge machinery (`wq.py`, `verify.mjs`) landing in the same
  batch as PRs that machinery is meant to land?

Hold cross-repo findings to the same evidence bar `uma-tools-plans/CLAUDE.md` sets
generally: cite `file:line` from an actual read of the file, **on every repo/side being
compared** — never infer a match or a conflict from a PR title or commit message alone.

If `--comment` was passed, each confirmed cross-repo finding gets posted as an inline
comment on whichever repo's PR it actually belongs to (same posting mechanism the
sub-reviews use: `gh api repos/{owner}/{repo}/pulls/{pr}/comments`, since the inline-
comment MCP server `code-review` prefers isn't connected in this environment). A finding
that implicates two repos at once (e.g. the gitlink-drift invariant) gets posted to both.

## Step 4 — Consolidated summary

Print, to the terminal only (this skill posts to GitHub only through Steps 2–3, never a
separate top-level PR comment):

- One section per repo slot: PR number/title/link and posted-review link, or
  "no open PR — skipped."
- A **Cross-repo** section: the findings from Step 3, or "none found" if the pass ran and
  found nothing actionable.

## Guardrails

- Never merge, push, or land anything from this skill. `wq.py land` is a separate,
  deliberate step the user runs themselves when ready.
- Before Step 2, if `--fix` was passed, check each target repo's working tree
  (`git status --porcelain`) and warn if it's dirty — `--fix` will write into it.
- The `uma-skill-tools` submodule sitting in detached HEAD is its normal, healthy state
  (see `uma-tools/CLAUDE.md`'s submodule section) — never treat that alone as a problem
  to fix or flag.
- `xhigh` and `max` are valid levels for the underlying `code-review` skill; forward them
  unchanged like any other level.
