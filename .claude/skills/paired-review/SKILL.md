---
name: paired-review
description: Review every open PR across uma-tools, uma-skill-tools, and uma-tools-plans together, in dependency order, then run a cross-repo pass over the combined change. Use whenever the user wants to review or sanity-check a change that spans paired PRs across these three sibling repos before landing it — an engine PR plus its uma-tools gitlink bump, a plans-repo ticket paired with either — even if they phrase it as "review these PRs together," "check these are in sync," "does this match the engine PR," or name a specific ticket's paired PRs without naming this skill. A single /code-review run on one PR alone would miss how it interacts with the others.
argument-hint: "[low|medium|high|xhigh|max] [--comment] [--fix] [--engine-pr N] [--code-pr N] [--plans-pr N]"
---

# /paired-review

Reviews the open PRs across all three repos this project spans, in dependency order,
recording each repo's findings, then runs a dedicated cross-repo synthesis pass over the
collected findings to catch what no single-repo review can: an engine PR whose merge
commit the code PR's gitlink must record, an engine signature change `uma-tools` depends
on, a doc claim in `uma-tools-plans` a code change makes stale.

**Important limitation, confirmed 2026-08-25 by inspecting raw subagent transcripts:**
each per-repo `code-review` call in Step 2 is fully independent — it does not receive the
prior slots' findings, and nothing you say in your own turn before calling it reaches its
context. `code-review`'s forked run is seeded *only* from the `args` string (level, flags,
target, plus the context clause Step 2 now appends — see below), constructed entirely by
its own template; a Skill call does not carry the calling turn's surrounding conversation
into the fork the way an `Agent` call's `prompt` does. So "in dependency order" here means
only that *you* review them in a sensible reading order and use what you learn along the
way when composing Step 3's synthesis prompt — it does not mean each sub-review is aware
of what came before it. Don't describe a per-repo review to the user as having been
informed by a prior slot's findings; it wasn't — the context clause tells it *what kind of
change this is*, not what a sibling slot's review already found.

This is the review-side counterpart to `uma-tools-plans/scripts/wq.py land`, which
automates the paired *merge*. `/paired-review` never merges, pushes, or lands anything —
it only reviews and (optionally) comments.

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

**Defensive sweep first.** Run `rm -f <scratchpad dir>/*.diff` (your scratchpad directory
is named in your system prompt) before doing anything else. A per-repo `code-review`
sub-review in Step 2 may dump its PR diff to a scratch file there (observed names:
`pr<N>.diff`, `pr<N>_v2.diff` — an ad hoc choice each sub-review makes itself, not a fixed
contract), and the scratchpad directory is scoped to the *session*, not to a single
`/paired-review` run — so a file left behind by an earlier run (including one that was
interrupted before reaching Step 5's cleanup) is still there the next time this skill
runs. See Step 5 for why this matters and the incident that surfaced it.

Repo table (mirrors `uma-tools-plans/scripts/wq.py`'s `ENGINE_REPO`/`CODE_REPO`/`PLANS`
constants — note `ENGINE_REPO` is deliberately the *submodule inside* `uma-tools`, not any
sibling clone, per that script's own comment on why a sibling clone let gitlink drift go
unnoticed). Derive the local paths from where you're actually running, the same way
`wq.py` derives them from its own script location — don't hardcode one machine's home
directory into this file: `code`'s local path is the current `uma-tools` checkout's repo
root; `engine`'s is `<code>/uma-skill-tools`; `plans`'s is the sibling directory
`../uma-tools-plans` next to `code`'s repo root. If you want to check `wq.py`'s constants
yourself, read the script at `<plans>/scripts/wq.py` — not through the `uma-tools/plans/`
symlink; see the path-guard warning just below.

| Slot | Local path | GitHub repo | Base branch |
|---|---|---|---|
| engine | `<code>/uma-skill-tools` | `mackoz/uma-skill-tools` | `master` |
| code | current `uma-tools` checkout root | `mackoz/uma-tools` | `master` |
| plans | `../uma-tools-plans` (sibling of `code`'s repo root) | `mackoz/uma-tools-plans` | `main` |

Reach `uma-tools-plans` by that real path, **never** through the `uma-tools/plans/`
symlink — `uma-tools-plans/CLAUDE.md` warns the symlinked path trips tool path guards.
The base branch genuinely differs per repo (`main` on plans); don't assume it, read it
off the PR object.

For each slot without an explicit override from Step 0, run:

```
gh pr list --repo <github repo> --state open --json number,title,headRefName,baseRefName,url
```

(`baseRefName` is what lets you read the base branch off the PR object per above, instead
of trusting the table's per-repo guess.)

- **Zero results** → skip that slot. Note it in the final summary as "no open PR — skipped."
- **Exactly one** → that's the slot's PR.
- **More than one** → the repos' own "one open PR per repo" convention is soft guidance now,
  not a hard rule (a second PR can be legitimate, e.g. two genuinely unrelated efforts
  in flight at once), so this isn't necessarily wrong — but this skill still can't guess
  which one the user means. Stop and ask.

For a slot resolved via an explicit `--engine-pr`/`--code-pr`/`--plans-pr` override instead
of discovery, look up the same fields with
`gh pr view <number> --repo <github repo> --json number,title,headRefName,baseRefName,url`
so the printed plan (below) and the rest of this skill have real title/URL/branch data to
work with, not just a bare number.

**Relatedness check (informational only — never gates Step 3).** Paired PRs share an
identical head branch name in practice, though nothing enforces it and `wq.py` never reads
it. If two or more discovered PRs' `headRefName`s differ, print a warning —
`"heads differ (<a> vs <b>) — these may be unrelated PRs, reviewing anyway"` — and
continue. Print this for the user's own situational awareness only; it does **not** skip
or otherwise affect Step 3's cross-repo pass (this used to gate Step 3, and stopped — see
that step for why). A real landing this project did, PIPE-21 on 2026-08-29, had three PRs
with three different branch names — `pipe-21-replay-parser`/`pipe-21-gitlink-bump`/
`pipe-21-work` — despite being unambiguously the same paired change, since nothing forces
one branch name across repos. Branch-name mismatch is too weak a signal to skip the one
step that could catch a real cross-repo problem.

Print the resolved plan (which slots have a PR, their numbers/titles/URLs, which slots
are being skipped) before doing anything else, so the user can interrupt if it's wrong.

## Step 2 — Per-repo reviews, in order: engine → code → plans

For each slot that has a PR, **in this order**, do the following. This is dependency
order: engine lands first in `wq.py land` too, and a code-side PR is usually easiest to
understand after seeing what changed underneath it.

1. If this isn't the first slot being reviewed, state the prior slot(s)' HANDOFF block(s)
   (see below) in your own turn, in plain text, immediately before the next call. This is
   for the user's visibility into your progress and for your own context going into Step
   3's synthesis prompt (the `Agent` call there does receive an explicit `prompt`, which is
   how context genuinely reaches that step) — it is **not** how context reaches the next
   `code-review` call. See the limitation note above: nothing said here propagates into a
   forked `code-review` run's context.

2. Call the skill **directly** — do not wrap this in an `Agent` call:

   ```
   Skill(skill: "code-review", args: "<level, or omit> <--comment/--fix if set> <PR URL> -- <context clause>")
   ```

   **Context clause**: one short sentence orienting the sub-review, since the args string is
   its only channel in (see the limitation note above). Include: which slot this is (engine/
   code/plans), the ticket ID and one-line purpose if inferable from the PR title, the
   sibling PR(s) in this same paired landing by `owner/repo#number`, and the repo's resolved
   base branch (the real `baseRefName` Step 1 already looked up — pass that value along
   rather than making the sub-review re-derive it). That last one earns its place: a
   sub-review reviewing `uma-tools-plans#28` on 2026-08-29 assumed `master` (the convention
   in the other two repos, and the wrong one here) and hit two failed git commands —
   `fatal: couldn't find remote ref master`, then `unknown revision 'origin/master...HEAD'`
   — before self-recovering via `git branch -a`/`git remote -v` and discovering the real
   default is `main`. It got there on its own, but only after burning tool calls rediscovering
   something Step 1 had already resolved and simply never passed along. E.g.:

   ```
   -- this is the plans repo (base branch: main) in a paired HP-5 landing (dead-import +
   orphaned-file cleanup); sibling PRs: mackoz/uma-skill-tools#13 (engine, the actual fix),
   mackoz/uma-tools#41 (code, gitlink bump); review this repo's own diff, but flag anything
   that assumes state only visible in a sibling repo
   ```

   This is best-effort, not a verified contract — `code-review`'s own argument parsing of
   trailing prose after the target hasn't been independently confirmed by this skill. If a
   sub-review's result reads as though it ignored, mis-parsed, or choked on the clause,
   say so when you record that slot's HANDOFF and drop the clause from the remaining calls
   this run rather than repeating something that isn't working.

   Direct is required, not a style choice: `code-review` forks into its own subagent and
   spawns its angle-finder subagents *itself* — that's already the orchestrator → review
   agent → finder agents layering this skill wants. It also probes at runtime for the
   `Agent` tool and an agent-depth budget; if either is unavailable (which nesting it a
   level deeper inside a Task/Agent call risks triggering) its own prompt says to fall
   back to a single-pass review with no fan-out and announce that it did so. If you ever
   see a sub-review state it ran "without the Agent tool, not the full multi-agent
   fan-out," something upstream nested it — stop and flag this to the user rather than
   quietly accepting a degraded review.

   If `Skill(code-review, ...)` is not invocable at all in this session (its
   model-invocation gate is feature-flagged and may be off), stop and tell the user to
   run the three `/code-review` commands by hand instead of attempting a lesser
   in-line substitute.

3. **Check whether fan-out happened by reading the sub-review's own transcript — there is
   no way to ask it in advance, so this is archaeology, not disclosure.** Since nothing you
   say before the call reaches it (see the limitation note at the top of this skill), you
   cannot instruct a sub-review to fan out or to explain itself; the only way to find out
   what it actually did is to inspect the record afterward. Confirmed by inspecting a raw
   subagent transcript on 2026-08-25: a `code-review` run reasoned mid-run ("weighing
   whether to spawn parallel agents... diff is small, mostly data regen... proceeding
   manually — still seems worthwhile to follow protocol"), never attempted the `Agent` tool
   once (zero calls, not a rejected/errored attempt), and its final report said nothing
   about it either way — the reasoning existed, but only in its own private thinking, never
   surfaced anywhere the caller could see without reading the transcript directly. So after
   each call:

   - The task-completion notification for the `Skill(code-review, ...)` call names an
     `<output-file>`. If its content says "Output too large... Full output saved to:
     `<path>`", read that path instead — the inline file is a truncated pointer, and the
     content you're checking for is usually past the truncation point.
   - Grep that transcript for `"name":"Agent"` tool_use entries — a raw count via
     `grep -c '"name":"Agent"'` is enough, no need to read the whole transcript.
   - If the count is zero, search the same transcript's `thinking`/`text` blocks for
     reasoning about the decision — keywords like `spawn`, `fan.?out`, `finder angle`,
     `sequential`, `manually` are what surfaced the real example above. Quote whatever
     reasoning you find (or note plainly that none was found — a silent skip with no
     recoverable reasoning at all is itself worth recording).
   - Record what you found in the `FAN-OUT` line of that slot's HANDOFF block (see below):
     the Agent-call count, and any reasoning recovered from the transcript when the count
     is zero.

   This step is purely observational for now: it's collecting what reasoning sub-reviews
   actually have for skipping fan-out (or that none is recoverable at all), so a future
   revision of this skill can add explicit push-back for the reasons that turn out to be
   bad ones, without guessing in advance at what "bad" looks like. Don't editorialize about
   whether a given reason was good enough — just capture it accurately.

4. From that call's result, distill and record a HANDOFF block. Use your in-context copy
   for Step 3 by default; append it to `<scratchpad dir>/paired-review-handoffs.md` (your
   scratchpad directory is named in your system prompt) as well, and re-read that file
   instead only if context compaction has visibly happened since — i.e. the file is a
   fallback for surviving compaction, not a second source Step 3 needs to reconcile
   against the in-context copy:

   ```
   ## HANDOFF <slot> (<owner/repo>#<number>)
   REVIEW: <posted, with link | not posted (no --comment)>
   FAN-OUT: <N Agent calls | 0 Agent calls, reasoning recovered from transcript: "..." | 0 Agent calls, no reasoning found>
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
this skill exists rather than three manual `/code-review` calls. Skip this step **only**
if fewer than two slots had an open PR — there's nothing cross-repo to check with just
one. Run it regardless of Step 1's relatedness-check warning, even if the discovered PRs'
head branches differ — see Step 1's note on why that check no longer gates this one.
Nothing here licenses *inventing* a relationship that isn't backed by evidence, though:
the "hold cross-repo findings to the same evidence bar" rule below still applies exactly
as strictly as if the branches had matched.

Launch one `Agent` with `subagent_type: "cross-repo-synthesis"` (fan-out isn't needed here
— this is synthesis, not diff-scanning). Give it: every HANDOFF block from Step 2, the PR
URLs, and the specific things to check, drawn from the "cross-repo invariants at risk" list
above plus:

- Do findings in one repo contradict findings or assumptions recorded in another?
- Is a change to the paired-merge machinery (`wq.py`, `verify.mjs`) landing in the same
  batch as PRs that machinery is meant to land?

If that agent type isn't defined in this session (its definition lives in the gitignored
`.claude/agents/`, so a fresh clone won't have it), fall back to a `general-purpose` Agent
and put the same context — including the gitlink-false-positive rule and evidence bar below
— into the prompt inline. If the `Agent` tool isn't available in this session at all, don't
skip this step silently — do the synthesis yourself, in this same turn, against the same
HANDOFF blocks and checks above.

Hold cross-repo findings to the same evidence bar `uma-tools-plans/CLAUDE.md` sets
generally: cite `file:line` from an actual read of the file, **on every repo/side being
compared** — never infer a match or a conflict from a PR title or commit message alone.

If `--comment` was passed, each confirmed cross-repo finding gets posted as an inline
comment on whichever repo's PR it actually belongs to. Use the `github` MCP server's
inline-comment flow if it's loaded in this session — `pull_request_review_write` (method
`create`) to open a pending review, `add_comment_to_pending_review` per finding, then
`pull_request_review_write` (method `submit_pending`) to post it — otherwise fall back to
`gh api repos/{owner}/{repo}/pulls/{pr}/comments`; the same choice `code-review` itself
makes for its own inline comments, so check what's actually loaded at run time (exact
`mcp__github__*` tool names can vary by server config) rather than assuming either way. A
finding that implicates two repos at once (e.g. the gitlink-drift invariant) gets posted
to both.

## Step 4 — Consolidated summary

This step branches on whether `--fix` or `--comment` was passed. The two branches are
mutually exclusive — run exactly one, not both.

**If `--fix` or `--comment` was passed**, print to the terminal only (this skill posts to
GitHub only through Steps 2–3, never a separate top-level PR comment):

- One section per repo slot: PR number/title/link and posted-review link, or
  "no open PR — skipped." Include that slot's `FAN-OUT` line from its HANDOFF verbatim —
  the Agent-call count, and any reasoning recovered from the transcript when the count is
  zero, or "no reasoning found" if none was recoverable. State it plainly, without
  editorializing on whether the reasoning was good enough; that judgment isn't this
  skill's job yet.
- A **Cross-repo** section: the findings from Step 3, or "none found" if the pass ran and
  found nothing actionable.

**If neither `--fix` nor `--comment` was passed** (the bare/default invocation — the
common case, since most runs are a first look before deciding what to do about it), skip
the per-repo/cross-repo prose above entirely — a table that already carries every finding
makes it redundant, not complementary — and instead:

1. **Form your own recommendation for every finding** — every per-repo finding from every
   slot's HANDOFF, plus everything Step 3 surfaced. Unlike the `code-review` sub-reviews
   (which are isolated forks, per the limitation note at the top of this skill), *you* are
   not isolated — you're still in the same conversation this run started in, so bring
   whatever you already know from it: what the change was for, decisions already made
   earlier in the session, prior findings you've already assessed. Judge confidence (is the
   finding actually correct, not just plausible-sounding — re-verify a claim yourself
   against the real file if a HANDOFF's evidence looks thin), impact (what breaks, and how
   badly, if this ships as-is), and effort (rough size of the fix), and land on one
   recommendation per finding: fix it, defer it, or skip it, with a one-clause reason.

2. **Present one consolidated table** — every finding across every repo and the
   cross-repo pass as its own row, columns in this exact order:

   | Finding | Confidence | Impact | Effort | Recommendation |
   |---|---|---|---|---|

   "Finding" identifies where it lives (`repo:file:line`, or the repo slot for a
   process-level finding with no single line) and states the problem in one clause —
   enough to act on without cross-referencing the HANDOFF blocks again. Sort however makes
   the table easiest to scan (severity-first is usually right, but use judgment); don't
   split it into a separate table per repo — one table, every finding.

3. **Do not fix, comment, or otherwise act on anything in the table.** State plainly that
   you're waiting for the user to say which rows to act on, and stop there — this is a
   hold point, not a formality; the whole reason this branch exists is that `--fix`/
   `--comment` weren't passed, meaning the user hasn't yet told you to act. Only proceed
   once they name specific items (or say "the ones you recommended," "all of them," etc.)
   — and only touch what they actually asked for, the same discipline `--fix` runs inside
   Step 2 already have to a single repo's working tree.

## Step 5 — Cleanup

Run `rm -f <scratchpad dir>/*.diff` again, now that every Step 2 sub-review has finished.

Confirmed by inspecting a raw subagent transcript on 2026-08-25: a Step 2 sub-review
reviewing `uma-tools-plans#15` tried `git diff origin/main...origin/pipe-5-jp-data-refresh
> <scratchpad>/pr15.diff`, hit a zsh `file exists` (noclobber) error because a 605-line
`pr15.diff` from an *earlier* `/paired-review` run in the same session was still sitting
there, read that stale file believing it was current, only caught the mismatch because it
happened to cross-check one file's presence in the diff against the `--stat` summary, and
then had to `rm -f` and regenerate (706 lines — confirming the original really was stale)
before it could proceed. That cost several wasted tool calls and could just as easily have
produced a wrong finding (or a missed one) on a diff the sub-review never actually saw.

`paired-review-handoffs.md` is the only file in `<scratchpad dir>` this skill's own state
depends on — every `.diff` file a sub-review wrote there is safe to discard once that
sub-review has finished, whether or not it found anything to report. Do this even if a
slot was skipped (no open PR) or a sub-review call failed partway — leftover `.diff` files
from a partial run are exactly what the Step 1 defensive sweep exists to catch next time,
but cleaning up now means there's nothing left for that sweep to have to catch.

## Guardrails

- Never merge, push, or land anything from this skill. `wq.py land` is a separate,
  deliberate step the user runs themselves when ready.
- If `/paired-review` was invoked with neither `--fix` nor `--comment`, Step 4's
  consolidated-table branch is a hard stop — do not fix, comment, or otherwise act on any
  finding until the user names which ones. This is the same rule as the line above,
  applied one level down: `--fix`/`--comment` are how the user tells this skill it's
  allowed to act; their absence means it isn't, yet.
- Before Step 2, if `--fix` was passed, check each target repo's working tree
  (`git status --porcelain`) and warn if it's dirty — `--fix` will write into it.
- The `uma-skill-tools` submodule sitting in detached HEAD is its normal, healthy state —
  standard for any git submodule checkout, and this repo's own CI/gitlink tooling is built
  around it (see `docs/adr/0011-gitlink-drift-guard.md`, which rejects a branch-name check
  specifically because it breaks on detached-HEAD checkouts) — never treat that alone as a
  problem to fix or flag.
- `xhigh` and `max` are valid levels for the underlying `code-review` skill; forward them
  unchanged like any other level.
