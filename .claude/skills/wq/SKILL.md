---
name: wq
description: Drive scripts/wq.py's file/claim/status lifecycle for a work-queue ticket in mackoz/uma-tools-plans — minting an ID, moving a ticket to in-progress, or narrating progress. States the exact invocation contract and enum vocab wq.py itself enforces (someone passed --net-gain a whole sentence in a real transcript; --category doesn't exist as a flag), so a call doesn't fail on a guessed value or the wrong cwd. Use whenever the user asks to file a ticket, log a bug/feature, claim a ticket, or update a ticket's status — "file a ticket for this", "log this as a bug", "claim PIPE-3", "update the ticket with progress" — even if they don't name wq.py or this skill directly. Do NOT use this for landing (see /project-land) or for writing a ticket's Summary/Evidence/Suggested-approach prose (the wq-ticket-writer agent, if present, or write it inline).
argument-hint: "file <PREFIX> --type ... | claim <id> | status <id> \"<narrative>\""
---

# /wq

Drives `uma-tools-plans/scripts/wq.py`'s `file`/`claim`/`status` mechanics — the part of the
work-queue lifecycle that happens before landing (`/project-land`'s job) and before the ticket
even has a PR (also `/project-land`). Root cause for this skill's existence: a scan of past
sessions' `wq.py` calls turned up recurring failures that were never about the ticket itself —
guessed enum values, the wrong invocation form, and a since-fixed transactional gap in `cmd_file`
that once burned a real id (UI-30). See `uma-tools-plans/work-queue/completed/pipe-38.md` for the
full incident writeup.

## Invocation

Always `uv run scripts/wq.py <subcommand> ...` from the plans repo root (real path or the
`uma-tools/plans/` symlink both work — `wq.py`'s own `PLANS = Path(__file__).resolve().parent
.parent` follows symlinks fine, and `uma-tools/CLAUDE.md` prescribes the symlinked form). **Never
a bare `python3 scripts/wq.py ...`** — since PIPE-30 it declares PyYAML + `wcmatch` as PEP 723
inline dependencies that only `uv run` resolves automatically; a bare `python3` dies on the
`wcmatch` import. A `Failed to spawn: plans/scripts/wq.py` error almost always means the command
ran from the wrong cwd (the `plans/` symlink not resolving relative to where you happen to be),
not a real problem with the script — `cd` into the plans repo (or use its absolute path) rather
than guessing at a different invocation form.

## Vocab — copy these verbatim, don't guess

- `--type {bug,feature}` — *bug* = the behavior exists but is wrong; *feature* = the
  mechanic/capability is absent entirely (a registered-but-no-op condition counts as a feature).
- `--effort {small,medium,large}`
- `--net-gain {high,medium,low}` — **free text goes in `--scope`/`--title`, not here.** A past
  session passed `--net-gain` an entire sentence describing the net gain; the flag only accepts
  one of the three words above.
- `--tier {"Quick wins","Major ports","Research first","Low priority"}` — optional; omit it and
  the ticket files as `Untiered`, picked up later.
- Prefix (the first positional arg to `file`): one of `SPD HP SKL LANE DYN ORD PIPE UI`, from
  `work-queue/prefix-map.json`. An unfamiliar prefix isn't yours to invent — that file's own
  message says to add it there first, which is a deliberate manual edit, not something this
  skill does for you.
- **There is no `--category` flag.** `Category` (`engine`/`ui`/`tooling`) is derived from the
  prefix via `prefix-map.json` — passing `--category` fails argparse outright.
- Never hand-pick a ticket number. `wq.py file` mints it; `wq.py next-id <PREFIX>` mints without
  filing, if you just need to know the number ahead of time. Since PIPE-55 (2026-09-05) `next-id`
  is genuinely read-only — it used to also rewrite `work-queue/next-ids.json`, leaving an
  uncommitted change to a tracked file that then blocked the next `claim`.

## `file` — mint a ticket

```
uv run scripts/wq.py file <PREFIX> --type {bug,feature} --title "..." --effort {small,medium,large} \
  --net-gain {high,medium,low} --scope "..." [--tier TIER --why "..."] [--dry-run] [--park]
```

Writes the skeleton from `TEMPLATE.md`, plus the README backlog row, mkdocs nav entry, and a
dispatch-list row, all in one commit on whatever branch the plans repo currently has checked
out — `cmd_file` never switches branches itself, unlike `claim`/`land`. This is session-agnostic:
it's whatever's checked out at the moment you run it, regardless of which session (this one, an
earlier one, or a manual `git checkout`) left it there. Check `git status`/`git branch
--show-current` in the plans repo before filing if it matters where the ticket lands — `main` is
the common case, but a branch backing an open PR is just as plausible, and filing there bundles
the new ticket into that PR instead of standing alone. If you want a standalone filing on `main`
specifically, `git checkout main` first. `--dry-run` stages the diff and prints exactly how to
discard it, without committing.

If a real (non-`--dry-run`) call refuses with "file(s) already staged that look like a leftover
--dry-run preview" — that's residue from an earlier aborted or `--dry-run` call, not this one.
Run the printed `git reset`/`git checkout` commands, or pass `--park`: it unstages `wq.py`'s own
`README.md`/`mkdocs.yml`/`next-ids.json` in place and relocates any other untracked foreign file
to `plans/leftovers/<timestamp>/` (recorded in `leftovers/MANIFEST.jsonl`) instead of discarding
it — a tracked file outside that trio still refuses regardless, since `--park` can't move it
without making a real edit disappear. **`--park` can't be combined with `--dry-run`** — park is
inherently mutating, so there's nothing left to safely preview; passing both refuses outright
rather than parking for real during what's billed as a preview. Since PIPE-38, a `file` call that
fails after this point (a rejected commit, most commonly the pre-commit hook, or any other
failure before the commit lands) now rolls itself back — the minted id is free again, not burned
— so there's no need to hunt for an orphaned skeleton the way UI-30's recovery once did.

## `claim` — move a ticket to in-progress

```
uv run scripts/wq.py claim <id> [--branch NAME]
```

Branches (reusing `--branch NAME` if it already exists — useful for a side-finding claimed onto
the branch you're already on), moves the ticket file to `in-progress/`, updates README/mkdocs,
and opens a **draft** PR.

**`--branch` is how you get one PR for several tickets.** Without it the branch defaults to
`<id>-work`, so claiming three tickets for one fix set silently opens three branches and three
PRs — pass `--branch <first-id>-work` on the second and third claims instead. `claim` prints
"already has an open PR: #N -- skipping gh pr create" when it correctly reuses one.

**Cleanliness**: `claim` force-switches branches, so it refuses on a dirty plans tree — with one
exception since PIPE-55 (2026-09-05): an *unstaged* edit to the very ticket file being claimed is
allowed through, which is exactly what `file`'s own "next: write Summary/Evidence/Suggested
approach ... then `wq.py claim`" instruction produces. A *staged* edit to that file, or any other
dirty path, still refuses. Note stashing was never a workaround here — `claim` `git mv`s the
ticket from `backlog/` to `in-progress/`, so a stash taken against the old path can't be popped
cleanly afterwards. That draft is deliberate — claiming doesn't mean "ready for review" —
but it also means nothing un-drafts it automatically. Run `wq.py ready <id>` yourself once
implementation is actually done, or a `/project-review` pass over the repo will flag it as a
draft you may have forgotten (see that skill's Step 1) — neither is a substitute for the other.

## `status` — narrate progress

```
uv run scripts/wq.py status <id> "<narrative>" [--blocked | --unblock] [--dry-run] [--park]
```

Updates only the README "Where it stands" column — never the frontmatter `Status` line (that's
tool-only: `claim`/`complete`/`land --complete-id` set it, `--blocked`/`--unblock` are the only
way `status` itself touches it). Same `--park` escape hatch as `file` (including the same
can't-combine-with-`--dry-run` rule), scoped to what `status` itself guards (`README.md` and this
ticket's own file); since PIPE-38 it also gets `file`'s rollback protection for its own writes.

## Not this skill's job

- **Landing** (`gh pr merge`, the gitlink dance, waiting on the Pages deploy) → `/project-land`.
- **Writing the ticket's Summary/Evidence/Suggested-approach prose** → the `wq-ticket-writer`
  agent if the session has one (it's gitignored per `uma-tools/.gitignore`, so a fresh clone
  won't); otherwise write it inline in the filed skeleton.
- **`complete`** (moving to `completed/`, writing `## Outcome`) isn't covered here either — it's
  one call (`wq.py complete <id> --refs "..."`), always paired with landing, so it belongs in
  that skill's flow rather than duplicated in both.

## Guardrail

Branch and PR in the plans repo for `claim`/`status`/`complete` — never hand-commit yourself
outside of `file`'s own direct-to-current-branch convention above (which lands on whatever's
checked out, not necessarily `main` — see that section).
