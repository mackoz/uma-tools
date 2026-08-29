---
name: paired-land
description: Land a work-queue ticket's paired PRs across uma-skill-tools, uma-tools, and uma-tools-plans together in the correct order — the merge-side counterpart to /paired-review. Wraps `plans/scripts/wq.py land`, handling PR discovery by ticket ID, the required-before-land `## Outcome` narrative, a dry-run preflight, and this project's known rough edges around landing (non-resumable failures, the engine-only-ticket placeholder-PR workaround, telling expected mid-review gitlink state apart from real drift). Use whenever the user asks to land, merge, ship, or close out a ticket's PRs — "land PIPE-3", "merge these PRs", "ship this", "land the paired PRs for X", "the PRs are reviewed, land them" — even if they don't name this skill or mention wq.py directly.
argument-hint: "<TICKET-ID> [--engine-pr N] [--code-pr N] [--plans-pr N] [--skip-review-check]"
---

# /paired-land

Lands one work-queue ticket's PRs across the three sibling repos (`uma-skill-tools`,
`uma-tools`, `uma-tools-plans`) together, in the right order, via `plans/scripts/wq.py
land`. This is the merge-side counterpart to `/paired-review`: that skill reviews the
paired PRs without touching anything; this one merges them once you're satisfied.

`wq.py land` already does the deterministic mechanics correctly — merge order, the gitlink
bump, branch cleanup, waiting for the Pages deploy. Read `plans/scripts/wq.py`'s own module
docstring and `cmd_land`/`land_one`/`sync_gitlink`/`land_dry_run` if you want the exact
mechanics; this skill exists for everything *around* that call: finding the right PR
numbers, making sure the ticket is actually ready, catching the specific ways a land can go
sideways in this project (documented below, each backed by a real past incident, not a
hypothetical), and reporting back clearly. Don't reimplement anything `wq.py` already
checks — `require_clean`, the gitlink-mismatch refusal, `checkout_pr_head`'s unpushed-commit
guard, and the `## Outcome`-must-exist check are all already enforced by the script itself.

## Step 0 — Parse arguments

The ticket ID is the one required input (e.g. `PIPE-3`). `--engine-pr`/`--code-pr`/
`--plans-pr` bypass discovery for that repo, the same override convention `/paired-review`
uses. `--skip-review-check` silences the Step 2.1 nudge below for a ticket you've already
confirmed is reviewed by some other means.

## Step 1 — Discover the ticket's PRs

`wq.py land` doesn't discover PRs itself — it only takes explicit numbers — so find them
first. For each repo without an explicit override, search by ticket ID (case-insensitive,
same idea as `wq.py ready`'s own PR search):

```
gh pr list --repo <github repo> --state open --search "<TICKET-ID> in:title" --json number,title,headRefName,url
```

Repo table (same as `/paired-review`'s Step 1 — derive local paths from where you're
actually running, don't hardcode a machine's home directory):

| Slot | Local path | GitHub repo |
|---|---|---|
| engine | `<code>/uma-skill-tools` | `mackoz/uma-skill-tools` |
| code | current `uma-tools` checkout root | `mackoz/uma-tools` |
| plans | `../uma-tools-plans` (sibling of `code`'s repo root) | `mackoz/uma-tools-plans` |

- **Zero results for engine or code**: this ticket may genuinely not touch that repo
  (a plans-only doc ticket, or an app-only UI ticket with no engine change) — that's fine,
  just omit that `--*-pr` flag entirely when you get to Step 4. But if it's an *engine*-only
  ticket (engine PR exists, no code PR), see the PIPE-23 note in Step 2 before assuming
  you can just omit `--code-pr`.
- **Zero results for plans**: unusual — almost everything has a plans-repo PR (the ticket
  file move alone requires one). Double-check before concluding there isn't one.
- **More than one open PR** in any repo matching the ticket ID: stop and ask which one —
  don't guess.

Print the resolved PR numbers/titles/URLs before doing anything else, so the user can catch
a wrong match early.

## Step 2 — Preconditions, before touching `wq.py land` at all

**2.1 — Has this actually been reviewed?** `wq.py land` has no idea whether anyone looked
at the diff — it only checks git/GitHub mechanics. If this session (or a recent one) hasn't
run `/paired-review` or individual `/code-review`s on these PRs, say so and suggest doing
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

## Step 3 — Always dry-run first

```
wq.py land --engine-pr N --code-pr M --plans-pr K [--complete-id ID] --dry-run
```

This is read-only — no mutating git/gh calls. Check three things in its output:

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
wq.py land --engine-pr N --code-pr M --plans-pr K --complete-id ID
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

After a successful run:
- `git status --porcelain=v1 -b` in all three local checkouts — should be clean, on
  `master`/`master`/`main` respectively. `uma-skill-tools` ending in detached HEAD after the
  submodule update is expected and healthy, not a problem.
- If `--complete-id` was used, confirm the ticket file actually moved from
  `work-queue/in-progress/<id>.md` to `work-queue/completed/<id>.md`.
- `wq.py land` itself waits for and reports the GitHub Pages deploy result at the very end —
  confirm it printed a `success`, not left hanging or reported a failed deploy.

Report back to the user: which PRs merged and their merge commit SHAs, and where the ticket
ended up. Don't just say "landed" — the SHAs are what someone would need to bisect against
later.
