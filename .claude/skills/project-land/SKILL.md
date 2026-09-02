---
name: project-land
description: Land a work-queue ticket's PR(s) across uma-skill-tools, uma-tools, and uma-tools-plans in the correct order — whether that's a full paired multi-repo landing or a single repo touched alone (a plans-only tooling ticket, or a CLAUDE.md-exempt trivial fix with no ticket at all). The merge-side counterpart to /project-review. Wraps `plans/scripts/wq.py land` when it applies, and a documented direct-merge fallback when it structurally can't (wq.py land hard-requires --code-pr and --plans-pr, so a single-repo landing needs a different path, not a workaround). Handles PR discovery by ticket ID plus real linkage evidence (a repo with more than one PR matching the ticket ID gets disambiguated by body cross-links and leading-title match, not a blind stop), the required-before-land `## Outcome` narrative, a dry-run preflight, and this project's known rough edges around landing (non-resumable failures, the engine-only-ticket placeholder-PR workaround, telling expected mid-review gitlink state apart from real drift). Use whenever the user asks to land, merge, ship, or close out a ticket's PR(s) — "land PIPE-3", "merge this PR", "ship this", "land the paired PRs for X", "the PR is reviewed, land it", "there are two PRs open in uma-tools, land the PIPE-3 one" — even if they don't name this skill or mention wq.py directly.
argument-hint: "<TICKET-ID> [--engine-pr N] [--code-pr N] [--plans-pr N] [--skip-review-check]"
---

# /project-land

Lands one work-queue ticket's PR(s) across the three sibling repos (`uma-skill-tools`,
`uma-tools`, `uma-tools-plans`), in the right order. This is the merge-side counterpart to
`/project-review`: that skill reviews without touching anything; this one merges once
you're satisfied.

**Most landings involve `wq.py land`, but not all of them can — a single repo touched
alone is a real, first-class case, not an edge case to route around.** `wq.py land`
hard-requires both `--code-pr` and `--plans-pr` (`scripts/wq.py`'s argparse, both
`required=True`; only `--engine-pr` is optional) — so it simply cannot run at all for a
plans-only ticket (a tooling/doc change with no engine or app-code PR) or for a
`CLAUDE.md`-exempt trivial fix that never got a ticket in the first place. Step 1.5 below
is the documented path for that shape, worked out for real landing PIPE-28 (a plans-only
ticket) before this skill had a name for it.

`wq.py land` already does the deterministic mechanics correctly for the case it *does*
cover — merge order, the gitlink bump, branch cleanup, waiting for the Pages deploy. Read
`plans/scripts/wq.py`'s own module docstring and `cmd_land`/`land_one`/`sync_gitlink`/
`land_dry_run` if you want the exact mechanics; this skill exists for everything *around*
that call: finding the right PR numbers, making sure the ticket is actually ready, catching
the specific ways a land can go sideways in this project (documented below, each backed by
a real past incident, not a hypothetical), and reporting back clearly. Don't reimplement
anything `wq.py` already checks — `require_clean`, the gitlink-mismatch refusal,
`checkout_pr_head`'s unpushed-commit guard, and the `## Outcome`-must-exist check are all
already enforced by the script itself, for the path where the script runs at all.

## Step 0 — Parse arguments

The ticket ID is the one required input (e.g. `PIPE-3`). `--engine-pr`/`--code-pr`/
`--plans-pr` skip the title search for that repo — there's no need to search when you
already have the PR number. This isn't quite `/project-review`'s anchor mechanism: that
skill still runs discovery on an anchored repo (to find linked siblings), it just forces the
anchor's membership regardless of what discovery turns up; here, with the number already in
hand and no group to build, skipping the search outright is simpler and correct. Both are
still "the user said so, trust it" for *which PR is which* — see Step 2.5 for where that
trust does and doesn't extend. `--skip-review-check` silences the Step 2.1 nudge below for a
ticket you've already confirmed is reviewed by some other means.

## Step 1 — Discover the ticket's PRs

`wq.py land` doesn't discover PRs itself — it only takes explicit numbers — so find them
first. For each repo without an explicit override, search by ticket ID (case-insensitive,
same idea as `wq.py ready`'s own PR search):

```
gh pr list --repo <github repo> --state open --search "<TICKET-ID> in:title" --json number,title,headRefName,url,body
```

(`body` is there so a repo with more than one match can be disambiguated by real evidence,
not just a guess — see below.)

Repo table (same as `/project-review`'s Step 1 — derive local paths from where you're
actually running, don't hardcode a machine's home directory):

| Slot | Local path | GitHub repo |
|---|---|---|
| engine | `<code>/uma-skill-tools` | `mackoz/uma-skill-tools` |
| code | current `uma-tools` checkout root | `mackoz/uma-tools` |
| plans | `../uma-tools-plans` (sibling of `code`'s repo root) | `mackoz/uma-tools-plans` |

- **Zero results for engine or code, but a plans PR exists**: this ticket may genuinely not
  touch that repo (a plans-only doc ticket, or an app-only UI ticket with no engine change)
  — omit that `--*-pr` flag when you get to Step 4. But if it's an *engine*-only ticket
  (engine PR exists, no code PR), see the PIPE-23 note in Step 2.4 before assuming you can
  just omit `--code-pr` — that shape still needs the placeholder-PR workaround, not a plain
  omission.
- **Zero results for plans, period**: unusual — almost everything has a plans-repo PR (the
  ticket file move alone requires one) — but not automatically wrong. If there's *also* no
  code and no engine PR either, or if the only PR that exists is the plans one, `wq.py land`
  doesn't apply at all — go to Step 1.5, don't try to force `--plans-pr` around this.
- **More than one open PR** in any repo matching `<TICKET-ID> in:title`: this happens more
  than the title search alone suggests — a ticket ID can appear in an unrelated PR's title
  too (`uma-tools-plans#26`, "Fix stale in-progress/pipe-21.md links after PIPE-21
  completed," matches a `PIPE-21` search but isn't a PIPE-21 landing PR). Disambiguate with
  the same evidence `/project-review`'s Step 1 uses (full detail in
  `../project-review/SKILL.md`'s `### Linkage evidence`; the short version below covers the
  common case):
  - Prefer the PR whose title *leads* with the ticket ID (`PIPE-21: …`, not a mid-title
    mention) **and** whose body cross-links whatever other PR(s) this discovery already
    resolved for the sibling repos (`owner/repo#N`, `repo#N`, or a full PR URL — see
    `/project-review` for the exact forms and the "one direction is enough" rule).
  - If exactly one candidate satisfies both, that's the match — no need to ask.
  - If evidence still doesn't separate them (e.g. two open PRs both lead with the ticket ID,
    or neither has a body link to check against), **stop and ask which one** — this is now a
    rarer, better-informed stop than a blanket "more than one, ask" would be, and landing the
    wrong PR isn't recoverable the way reviewing the wrong one is, so don't guess even when
    one candidate looks more likely.

Print the resolved PR numbers/titles/URLs (and, if disambiguation ran, the evidence that
picked the winner) before doing anything else, so the user can catch a wrong match early.

## Step 1.5 — Choose the landing path

`wq.py land` can run only when it has both a code PR and a plans PR (`--engine-pr` alone is
never enough, and neither is skipping straight to a bare `gh pr merge` for the sake of it).
Based on what Step 1 found:

- **A plans PR plus an engine PR and/or a code PR** → this is the normal case. Continue to
  Step 2 as written; nothing below applies to you (Step 2.4's placeholder-PR workaround
  already covers the "engine PR but no code PR" gap within this case).
- **A plans PR alone — no engine, no code** → this is PIPE-28's actual shape. Skip Steps
  3-4 (they're `wq.py land`-specific) and follow the **single-repo-plans path** below
  instead, then jump to Step 6.
- **No plans PR at all, but a code and/or engine PR exists** → don't assume the plans PR is
  simply absent; every bug/feature change is supposed to have one per this project's own
  hard rule. Check `../uma-tools-plans/work-queue/in-progress/` for a ticket file whose ID
  appears in the PR title or head branch name. If one exists, **stop** — the plans PR was
  probably just not opened yet, not genuinely unnecessary, and completing this ticket needs
  its own plans branch+PR, which takes it out of "single-repo" landing entirely; go open
  that PR (or ask the user to) before landing anything. If none exists and the change
  matches `CLAUDE.md`'s own tiny-fix exemption (a two-line CSS tweak, a typo — no ticket
  required), follow the **single-repo code/engine path** below instead, then jump to Step 6.

Either single-repo path: if a sibling PR shows up in the repo(s) you thought had none —
someone opens it while you're mid-sequence — stop and reassess whether the normal
`wq.py land` flow (Steps 2-4) now applies instead of continuing down the fallback.

**Single-repo-plans path** (plans PR alone):

1. `require_clean`-equivalent, by hand — `wq.py land`'s own `land_one`/`checkout_pr_head`
   normally guarantee this before touching anything, and there's no script call doing it
   for you here. In `../uma-tools-plans`: confirm `git status --porcelain` is empty, then
   `git fetch origin <head> && git checkout <head>` for the plans PR's branch. Skipping this
   is not a shortcut — `wq.py complete` (step 3 below) calls `commit_push`, which pushes to
   *whatever branch is currently checked out*; landing straight on `main` if that's what
   happens to be checked out is exactly the violation `cmd_land`'s own code exists to
   prevent for the normal path. (Since PIPE-19, two separate mechanisms close a different
   failure mode — content riding into this commit that `wq.py complete` itself didn't
   write: `commit_push` stages/commits only the specific files `cmd_complete` wrote, not
   the whole tree with `git add -A`, closing the case of a wholly unrelated file already
   staged; and `cmd_complete`'s underlying `finish_completion` separately refuses outright
   if README.md/mkdocs.yml *themselves* already have a staged change at entry, closing the
   case `commit_push` structurally can't — those two files are legitimately part of what
   this step writes, so they can never be "foreign" to it. Neither helps with the
   wrong-branch risk here; the pre-check above is still the only thing preventing that.)
2. Write the ticket's `## Outcome` narrative — same content bar as Step 2.2 (what was
   implemented, what review found and how it was fixed, what verification ran) — but
   **include the mechanical bullets yourself this time**, inverting Step 2.2's instruction
   for the normal path: `wq.py complete` (unlike `land --complete-id`) never auto-generates
   them, so without writing them by hand the ticket ships with no Fixed/Commits/PRs record
   at all. Write:
   ```
   - **Fixed**: <today's date>
   - **Commits**: <this branch's real commits — there's no merge SHA yet>
   - **PRs / merge status**: [uma-tools-plans#N](url) (this PR)
   ```
   The `(this PR)` self-reference form matches what `wq.py land` itself generates for a
   plans-repo citing its own not-yet-merged PR (`cmd_land`'s `pr_parts` construction).
3. `uv run scripts/wq.py complete <id> --refs "[uma-tools-plans#N](url) (this PR)"` (run from
   `../uma-tools-plans` — step 1 already put you there, so this is repo-relative, not the
   `plans/scripts/wq.py` form Steps 3/4 of the normal path use below) — commits and pushes
   the completion to this still-open branch, so the PR's own merge is what lands it, same
   principle as `land --complete-id` (just done by hand since that flag requires
   `wq.py land` to be running at all).
4. `gh pr merge N --merge --repo mackoz/uma-tools-plans`.

**Single-repo code/engine path** (anomaly-checked, no ticket):

1. `git status --porcelain` clean in the target repo.
2. **If it's the code repo, check the gitlink invariant by hand before merging** — a bare
   `gh pr merge` skips `land_one`'s structural gate entirely (the check that normally
   refuses to merge the code PR at all if its gitlink is stale), and this is exactly the
   invariant `CLAUDE.md`'s submodule section and `docs/adr/0011` exist to protect — the
   `ui-25` incident (Step 3, below) shows the same invariant getting invalidated by a
   *different* route (an unrelated engine merge landing in the gap between planning and
   executing), so don't assume "genuinely single-repo" means "safe to skip the check
   entirely." Compare the branch's recorded `uma-skill-tools` gitlink against
   `uma-skill-tools`'s own `origin/master` — they must match, or stop and resolve it first
   (this shouldn't come up for a genuinely ticket-exempt trivial fix, which by definition
   shouldn't be touching the engine submodule at all — treat a mismatch here as a sign this
   isn't actually the simple case it looked like).
3. `gh pr merge N --merge`.
4. Clean up by hand, matching what `land_one` normally does automatically: checkout the
   default branch, pull, delete the local and remote feature branch, and — code repo only —
   `git submodule update --init`.

## Step 2 — Preconditions, before touching `wq.py land` at all

**2.0 — A plans-side `wq.py` step refusing on staged residue isn't a landing blocker to work
around by hand.** `file`/`status`/`finish_completion` (so `complete`/`land --complete-id` too)
all refuse outright if `README.md`/`mkdocs.yml`/`next-ids.json` or the ticket's own file already
has something staged that call didn't write — usually a leftover `--dry-run` preview, or
unrelated in-progress work (PIPE-19). Since PIPE-38, `file`/`status` have a `--park` escape
hatch through this (see `/wq`'s own `file`/`status` sections for exactly what it does and its
`--dry-run` incompatibility) — but **`complete`/`land --complete-id` don't get `--park` at
all**; a refusal there still needs the printed `git reset`/`git checkout` commands run by hand.
Don't assume `--park complete <id>` is a thing to try — it isn't, and argparse will say so.

**2.1 — Has this actually been reviewed?** `wq.py land` has no idea whether anyone looked
at the diff — it only checks git/GitHub mechanics. If this session (or a recent one) hasn't
run `/project-review` or individual `/code-review`s on these PRs, say so and suggest doing
that first, unless `--skip-review-check` was passed or the user has otherwise made clear
they're landing without a fresh review (e.g. they just watched you fix the last review's
findings, like this session's PIPE-3 land did).

**2.2 — The ticket's `## Outcome` section must already exist, with a real narrative, before
you run anything with `--complete-id`.** This is enforced by the script (`land --dry-run`
and the real run both refuse without it), but *writing it during the run isn't possible* —
you have to add it yourself first. PIPE-8's landing hit this the hard way: the first `land`
attempt correctly stopped short of the plans PR because the Outcome section wasn't there
yet, after engine and code had already merged. Write a real narrative — what was
implemented, what review found and how it was fixed, what verification ran — not a
placeholder; look at the ticket's own `## Plan` section and this session's history as your
source material. **Do not** write the `- **Fixed**:`/`- **Commits**:`/`- **PRs**:` bullets
yourself — `wq.py` auto-generates and prepends those from the real merge results; adding
them by hand makes the tool refuse ("already has a Fixed bullet, remove it"). Commit and
push this to the plans PR's branch before moving on.

**2.3 — A gitlink pointing at the engine PR's own branch tip (not `origin/master`) is
expected, not drift.** While both the engine and code PRs are open, the code PR's gitlink
legitimately points at the engine branch's tip — that commit isn't on `origin/master` yet
because the engine PR hasn't merged. Don't hand-rebump this or treat a `/code-review`
finding that flags it as a real defect (this has happened before, on `hp-5`/`uma-tools#41`).
`land --engine-pr` resolves it correctly as part of the run.

**2.4 — Engine-only ticket, no `uma-tools` changes at all?** `wq.py land` structurally
requires `--code-pr` regardless (PIPE-23, open, unfixed) — `sync_gitlink` needs *some*
branch in `uma-tools` to commit the gitlink bump onto. You'll need a placeholder `uma-tools`
PR: commit something trivial on its own branch first (`gh pr create` refuses a truly-empty
diff, so a one-line comment or similar is enough), open the PR, and pass its number as
`--code-pr`.

**2.5 — Final confirmation that the resolved PRs actually belong together.** Step 1's
disambiguation already checked this for a repo with more than one title match, but do one
last check across *all* the PR numbers you're about to hand to `wq.py land` — including any
that came in via `--engine-pr`/`--code-pr`/`--plans-pr` and so skipped Step 1's search
entirely: do they cross-link each other in their bodies, or at minimum do their titles lead
with the same ticket ID? If something doesn't check out — an anchor PR that shares no
evidence with the others, say — **stop and ask**, don't proceed on the assumption that
"the user passed the number, so it must be right." Trusting an anchor for *which PR number
goes with which repo* is a reasonable thing to do unchecked — that's just the user telling
you a fact; trusting it for *whether it actually belongs with the other PRs you're about to
merge* is a different, bigger claim, and this last check is what verifies that claim before
anything irreversible happens. `/project-review` can afford to skip an equivalent check and
trust an anchor's group membership outright (see its Step 1) precisely because the worst
case there is a wasted review; landing the wrong PR is not recoverable the same way, so this
skill checks instead of trusting.

## Step 3 — Always dry-run first

```
uv run plans/scripts/wq.py land --engine-pr N --code-pr M --plans-pr K [--complete-id ID] --dry-run
```

This is read-only — no mutating git/gh calls. Check four things in its output:

- **Merge order** — sanity-check it matches what you expect (engine → code → plans).
- **Gitlink check** — `OK` means the branch's recorded gitlink already matches engine
  `origin/master`. `MISMATCH` is *fine* if you're passing `--engine-pr` (the real run
  resolves it). If you're **not** passing `--engine-pr` and still see `MISMATCH`, that's
  real drift, not the expected mid-review state from 2.3 — this has happened for real (an
  unrelated engine PR merged to `master` in between planning and executing a landing,
  `ui-25`) — stop and resolve it (bump the gitlink, or add `--engine-pr`) before proceeding.
- **complete-id check** — must read `OK`, not `PROBLEM`. A `PROBLEM` here means Step 2.2
  isn't actually done yet (missing `## Outcome`, or a stray `Fixed` bullet you added by
  hand) — go fix it, don't try to work around the refusal.
- **Pages deploy check** (since PIPE-30) — a line starting `Pages deploy check:` predicting
  whether the merge will trigger a Pages deploy, from `uma-tools`' own `deploy.yml` trigger
  config against the code PR's changed files. `none expected` is normal and correct for a
  docs-only PR (`deploy.yml`'s `paths-ignore` structurally excludes it); a `>=100 changed
  files` note means gh's file list may be truncated and the check couldn't evaluate with
  confidence (also normal — treated as `expected` to be safe). Neither outcome is something
  to "fix" before landing.

If real time passes between this dry-run and Step 4's actual run (you went and did
something else, waited on the user, whatever), **re-run the dry-run immediately before the
real run** — engine `origin/master` or PR state can move underneath you in that gap, per
the `ui-25` case above.

## Step 4 — Confirm intent, then run for real

Landing merges real PRs on GitHub, deletes their branches, and pushes new commits (the
gitlink bump, the ticket completion) — treat it like any other hard-to-reverse, externally
visible action. If the user's own request already asked to land/ship/merge this ticket, that
is the authorization — proceed straight to the real run. If you arrived here on your own
initiative rather than a direct ask, confirm with the user first.

```
uv run plans/scripts/wq.py land --engine-pr N --code-pr M --plans-pr K --complete-id ID
```

Omit `--engine-pr` if there's no engine PR for this ticket (per Step 1). Omit
`--complete-id` if you don't want the ticket auto-completed as part of this run (rare — only
if the user explicitly wants to land without closing the ticket yet).

## Step 5 — If it dies partway through

`wq.py land` is **not resumable or idempotent by design** (PIPE-12, open) — it has no
checkpoint. A real partial failure has happened before: a git "divergent branches" error
mid-sequence, after the engine PR's branch state had already changed on origin, left the
run half-done. Each individual step (`land_one`, `sync_gitlink`) happens to no-op cleanly
if you re-run it against already-completed state, but that's incidental behavior, not a
designed guarantee — don't treat "just run the same command again" as automatically safe.

This doesn't apply to a failed `wq.py file` or `wq.py status`, though — since PIPE-38 both roll
themselves back if the pre-commit hook (or any other failure before a real commit lands) rejects
the commit, restoring whatever they'd written and, for `file`, freeing the minted id again — so
a rejected filing or status update during this same session isn't a burned id or a stranded
partial write to go hunt down by hand the way UI-30's recovery once was. `complete`/
`land --complete-id` (`finish_completion`) don't have this protection yet — a rejected commit
there still needs manual cleanup.

If a run dies:
1. Check what actually happened before doing anything else: `gh pr view <N> --repo <repo>
   --json state,mergeCommit` for each of the three PRs, and `git log --oneline -5` in each
   local checkout.
2. Finish whatever step it died on by hand (or the matching individual `wq.py` primitive —
   `complete`, a manual `gh pr merge`, a manual gitlink commit) rather than re-running the
   whole `land` command blind.
3. If it's genuinely unclear which step failed or what state things are in, stop and ask —
   a wrong guess here can double-merge a PR or skip a step silently.

## Step 6 — Verify the landed state

**After a normal `wq.py land` run** (Steps 2-4):
- `git status --porcelain=v1 -b` in all three local checkouts — should be clean, on
  `master`/`master`/`main` respectively. `uma-skill-tools` ending in detached HEAD after the
  submodule update is expected and healthy, not a problem.
- If `--complete-id` was used, confirm the ticket file actually moved from
  `work-queue/in-progress/<id>.md` to `work-queue/completed/<id>.md`.
- `wq.py land` waits for and reports the GitHub Pages deploy result at the very end, but only
  if it predicted one would actually fire (since PIPE-30 — it reads `uma-tools`' own
  `deploy.yml` trigger config against the merge's changed files first, since a docs-only merge
  structurally can't trigger a run). Confirm the output is a normal, complete outcome: either
  it printed `success` after waiting, or a line starting `no Pages deploy expected` and skipped
  the wait (whether because `deploy.yml`'s own filters ruled it out, or because `uma-tools` has
  no `.github/workflows/deploy.yml` at all — both print that same prefix). A wait that's still
  hanging, or one that reports a failed deploy, is the real problem to chase. This only fires
  when the code repo was actually part
  of this run.

**After either single-repo path from Step 1.5** — only check the *one* repo actually
touched, not all three (the others were never involved):
- That repo's checkout is clean, on its default branch (`master` for code/engine, `main`
  for plans), with the feature branch gone locally and on `origin`.
- Single-repo-plans: confirm the ticket file moved to `completed/` and its `## Outcome`
  section really does have the three mechanical bullets (step 2 of that path).
- Single-repo-code: this *does* trigger a real Pages deploy, but nothing in this path waits
  on or reports it the way `wq.py land` does — don't claim it succeeded without checking
  (`gh run list --repo mackoz/uma-tools --workflow deploy.yml -L1`, or just say you didn't
  check). Single-repo-plans has nothing to wait on at all — `uma-tools-plans` has no Pages
  deploy (no `.github/` workflow there).

Report back to the user: which PRs merged and their merge commit SHAs, and where the ticket
ended up. Don't just say "landed" — the SHAs are what someone would need to bisect against
later.
