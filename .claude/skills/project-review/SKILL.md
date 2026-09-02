---
name: project-review
description: Review the linked open PR(s) across uma-tools, uma-skill-tools, and uma-tools-plans — whether that's one PR alone or several that link up together via body cross-references or a shared ticket ID — in dependency order, then run a cross-repo synthesis pass whenever two or more repos are actually involved. Discovery is link-aware: it groups open PRs by real evidence (not just "one repo, one PR"), so it also handles a repo with more than one open PR — reviewing the linked set and reporting the rest as excluded — without stopping to ask, except when the grouping is genuinely ambiguous. Use whenever the user wants to review or sanity-check a change in this project before landing it: "review this PR," "check this diff before I merge it," a single-repo fix, an engine PR plus its uma-tools gitlink bump, a plans-repo ticket paired with either, "I've got a few PRs open, review the ones for X," "which of these PRs go together" — even if they phrase it as "review these PRs together," "check these are in sync," "does this match the engine PR," or name a specific ticket's PRs without naming this skill. A bare /code-review run on one PR alone would miss how it interacts with sibling repos when there are any; this skill handles that whether or not there turn out to be any, and without assuming every open PR belongs to the same change.
argument-hint: "[low|medium|high|xhigh|max] [--comment] [--fix] [<PR URL>] [--engine-pr N] [--code-pr N] [--plans-pr N]"
---

# /project-review

Reviews one **linked group** of open PRs across the three repos this project spans — however
many repos and PRs that group actually touches — in dependency order, recording each repo's
findings, then runs a dedicated cross-repo synthesis pass over the collected findings whenever
two or more repos are represented in the group, to catch what no single-repo review can: an
engine PR whose merge commit the code PR's gitlink must record, an engine signature change
`uma-tools` depends on, a doc claim in `uma-tools-plans` a code change makes stale.

Discovery no longer assumes "one repo, one PR, all PRs are the same change" — see Step 1's
`### Linkage evidence`. A repo with more than one open PR is not an error; an open PR in two
repos is not automatically a pair. Both get resolved by evidence, not by counting.

**A single open PR is a first-class, fully supported case, not a degenerate one** — Step 1's
per-slot discovery skips a repo with nothing open, and Step 3 skips the cross-repo pass when
fewer than two repos are represented in the selected group. Don't hand-roll Step 2 and Step 4
yourself instead of invoking this skill just because only one PR happens to be open; see
`references/incidents.md` for why that shortcut cost more than it saved once.

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
automates the paired *merge*. `/project-review` never merges, pushes, or lands anything —
it only reviews and (optionally) comments.

## Step 0 — Parse arguments

`args` = everything after `/project-review`, whitespace-separated, flags position-independent:

- `--comment` — passed through to every `code-review` call and to the cross-repo pass.
- `--fix` — passed through to every `code-review` call. Each sub-review fixes only its own
  repo's working tree; this skill never commits on the user's behalf.
- `--engine-pr N` / `--code-pr N` / `--plans-pr N` — an **anchor**: this PR is in the group,
  full stop, no evidence required. It doesn't bypass discovery for that repo — discovery still
  runs there and elsewhere (see Step 1); it forces this specific PR's membership regardless of
  what discovery finds or fails to find for it.
- **A bare GitHub PR URL** (e.g. `https://github.com/mackoz/uma-tools-plans/pull/31`) —
  resolves to whichever slot's `owner/repo` it exactly matches in Step 1's table (never a
  substring match: `mackoz/uma-tools` is a literal prefix of `mackoz/uma-tools-plans`, so a
  loose check would misroute a plans URL into the code slot and hand its sub-review the
  wrong base branch). A URL for a repo outside the three slots is a hard stop, not a guess.
  It's the same anchor as a `--*-pr` flag, just given by URL instead of number — a convenience
  for not having to know which flag name applies to which repo, not a "review only this repo"
  mode: Step 1 still runs full discovery everywhere, so a linked sibling PR you didn't know
  about still gets found and included in the same group. If the URL and an explicit `--*-pr`
  flag both resolve to the same repo, that repo now has two anchors; a group may legitimately
  contain two PRs from one repo (see Step 1), so this is plausible intent, not a collision —
  proceed with both as anchors rather than stopping to ask, unless they resolve to the exact
  same PR number, in which case just dedupe.
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

## Step 1 — Discover the PRs

**Defensive sweep first.** Run `rm -f <scratchpad dir>/*.diff` (your scratchpad directory
is named in your system prompt) before doing anything else. A per-repo `code-review`
sub-review in Step 2 may dump its PR diff to a scratch file there (observed names:
`pr<N>.diff`, `pr<N>_v2.diff` — an ad hoc choice each sub-review makes itself, not a fixed
contract), and the scratchpad directory is scoped to the *session*, not to a single
`/project-review` run — so a file left behind by an earlier run (including one that was
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

### Discover — every open PR in every repo, not just one per slot

Run, per repo:

```
gh pr list --repo <github repo> --state open --json number,title,headRefName,baseRefName,url,body
```

(`baseRefName` is what lets you read the base branch off the PR object per above, instead of
trusting the table's per-repo guess. `body` is new — it carries the linkage evidence below.)

For a PR resolved via an explicit `--engine-pr`/`--code-pr`/`--plans-pr` override or a bare PR
URL from Step 0, look up the same fields with `gh pr view <number> --repo <github repo> --json
number,title,headRefName,baseRefName,url,body` so it contributes real evidence too, not just a
bare number.

**Zero results in a repo** → skip that slot, same as always; note it in the final summary as
"no open PR — skipped." **One or more** → every one of them is a *candidate*, full stop — there
is no "more than one → stop and ask" here anymore. The repos' own one-PR-per-repo convention is
soft guidance now (a second, unrelated PR in flight is legitimate), so more than one open PR in
a repo is an expected shape, not an error condition; whether they're related is exactly what
grouping, next, is for. A draft PR is a candidate too — flag it in the printed plan rather than
silently including or excluding it.

### Linkage evidence

Four kinds of evidence connect two PRs, in order of what they can do:

**Direct link** — PR A's body names PR B: `owner/repo#N`, `repo#N`, or a full
`https://github.com/<owner>/<repo>/pull/N` URL, where B is a discovered candidate. One direction
is enough — the first PR opened often can't link a sibling that doesn't exist yet
(`uma-skill-tools#17`'s body says `Code PR: [uma-tools#50](…)` / `Tracking ticket:
[uma-tools-plans#41](…)`; `uma-tools-plans#42` says `Pairs with mackoz/uma-tools#51`). A bare
`#N` means PR N *in that PR's own repo* — never resolve it against a different repo's numbering.

**Shared ticket ID** — both titles *start* with the same ticket ID: `PIPE-21: …`,
`PIPE-21 (…): claim + plan`, `UI-21 + PIPE-15: …`. Match the whole ID — `UI-3` is not `UI-31`.
This is the same signal `wq.py`'s own `cmd_ready` trusts for PR↔ticket lookup, which is why it
counts as strongly as a direct link. It is **not** evidence when the ID appears mid-title rather
than leading it: `uma-tools-plans#26`, "Fix stale in-progress/pipe-21.md links after PIPE-21
completed," matches a naive `PIPE-21 in:title` search but is an unrelated follow-up — its body
carries no cross-links either. Leading-vs-mid-title is the whole test.

A direct link or a shared leading ticket ID is what **forms a group** — chain PRs together
through either and take the transitive closure. The next two kinds can only refine a group that
already exists this way, never create or merge one on their own:

**Branch name alone** — identical `headRefName`, or branches sharing a full ticket-ID prefix
(`pipe-37-work` / `pipe-37-artifact`; whole-ID again — `pipe-3-` doesn't match `pipe-30-`). A
body reference naming an unqualified branch instead of a PR number (`uma-skill-tools#15` once
wrote `mackoz/uma-tools#pipe-3-work`) counts here too. Branch name is corroborating only: PIPE-21
landed with three PRs on three *different* branches (`pipe-21-replay-parser`/
`pipe-21-gitlink-bump`/`pipe-21-work`) — see `references/incidents.md` — so a shared branch name
can attach a loose candidate to a group that direct links or ticket IDs already formed, but it
must never be the thing that bridges two otherwise-unconnected groups together. Without that
restriction, one two-ticket title (`UI-21 + PIPE-15: …`) or a body saying "supersedes #48" could
chain two genuinely separate landings into a false supergroup.

**User-asserted** — an explicit `--engine-pr`/`--code-pr`/`--plans-pr` or a bare PR URL from
Step 0. The user said so; this outranks everything above and needs no corroboration.

**Not evidence, ever:** both PRs simply being open at the same time; the same author; similar
timestamps; a ticket ID mentioned mid-title or mid-body rather than leading it (the `#26` case
again); a body that asserts an unnamed sibling without naming one — `wq.py cmd_claim`'s default
plans-PR body, "Pairs with the matching code-repo PR; both merge together," proves a sibling is
*expected*, not which PR it is. This list is the one thing standing between this skill and
quietly reverting to "both are open, so they must be the same change" — don't let corroborating
evidence (branch names, timing) substitute for it just because nothing stronger turned up.

### Group and select

**Group** every candidate by chaining direct links and shared leading ticket IDs (transitive
closure); let branch-name evidence attach loose candidates to a group that already formed.

**Select one group to review:**

- One anchor exists (`--*-pr` or a bare PR URL) → the group containing it. The anchor is
  itself a member regardless of what other evidence does or doesn't say about it.
- **More than one anchor exists** (e.g. `--engine-pr` and `--code-pr` given together) →
  union every group any anchor belongs to into a single selected set, even if those anchors
  landed in different, otherwise-unlinked groups. Two explicit anchors are two things the
  user asked for by name; picking "the group containing it" for only one of them would
  silently drop the other from the run, and — since the selected set now spans the repos
  those groups touched — this is also what keeps Step 3's cross-repo pass from being
  silently skipped just because the anchors didn't happen to share body/ticket-ID evidence.
  If the anchors turn out to be genuinely unrelated changes the user didn't mean to combine,
  that will surface as confusing findings in Step 2 rather than a silent drop — tell the user
  plainly if that seems to be happening rather than pushing through it.
- No anchor, exactly one group → that group, no prompt.
- No anchor, more than one group → **print every group with the evidence that formed it** (see
  below), plus any unlinked singletons, and **stop and ask which to review** — one group per
  run, rerun for another. Recommend rather than just asking blind: when every repo has exactly
  one open PR and the only reason they're in separate groups is that no evidence links them —
  nothing *contradicts* either — recommend treating them as one group anyway (today's behavior);
  don't let a case with real evidence for one relationship and none against it read as equally
  uncertain as a case with real evidence for two different ones.

### Print the plan

Before doing anything else, so the user can interrupt if it's wrong:

- Each selected member with the evidence that linked it — quote the actual body line, or state
  it plainly ("both titles lead with `PIPE-37`"). Flag a draft.
- Each **excluded** open PR, one line each, with why it didn't make the group. Excluded is not
  settled: if a repo has an open PR that wasn't linked in, say so explicitly and offer to include
  it on request rather than treating the exclusion as final — the PR most likely to be missed
  this way is exactly the kind Step 3 exists to catch (e.g. a gitlink-bump PR titled "Bump
  uma-skill-tools to `<sha>`" with an empty body).
- A body link to a sibling that's already merged or closed (normal mid-landing state — `wq land`
  merges the engine PR first) is context worth noting, not something to chase down further.

## Step 2 — Per-PR reviews, in order: engine → code → plans

For each PR in the selected group, **in that repo order** (a group can hold more than one PR
from the same repo — a stacked pair — in which case order those two by base-on-head: whichever
PR's `headRefName` another candidate's `baseRefName` names goes first, else ascending number; the
engine → code → plans ordering is between repos, not within one), do the following. This is
dependency order: engine lands first in `wq.py land` too, and a code-side PR is usually easiest
to understand after seeing what changed underneath it.

1. If this isn't the first PR being reviewed, state the prior PR(s)' HANDOFF block(s) (see
   below) in your own turn, in plain text, immediately before the next call — every PR in
   the group gets one, including a second PR from a repo already reviewed in this run. This is
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
   code/plans), the ticket ID and one-line purpose if inferable from the PR title, the other
   PR(s) in this same linked group by `owner/repo#number` and how each was linked in (direct
   link, shared ticket ID, branch name, or user-asserted — see Step 1's `### Linkage evidence`;
   don't overstate a branch-only link as a confirmed pairing), and the repo's resolved base
   branch (the real `baseRefName` Step 1 already looked up — pass that value along rather than
   making the sub-review re-derive it; see `references/incidents.md` for what happens when it
   isn't). E.g.:

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
   what it actually did is to inspect the record afterward — see `references/incidents.md`
   for a confirmed case where a sub-review reasoned about skipping fan-out entirely in its
   private thinking and never surfaced that decision anywhere the caller could see. So after
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
   for Step 3 by default; append it to `<scratchpad dir>/project-review-handoffs.md` (your
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
if the selected group represents **fewer than two repos** — a stacked pair of PRs in one
repo doesn't trigger this, only two-or-more distinct repos does; there's nothing cross-repo
to check otherwise. Group membership is exactly what gates this step now — it's gated on
the linkage evidence Step 1 collected, not a branch-name guess, so run it for whatever group
Step 1 actually selected without re-litigating whether the members belong together.

Launch one `Agent` with `subagent_type: "cross-repo-synthesis"` (fan-out isn't needed here
— this is synthesis, not diff-scanning). Give it: every HANDOFF block from Step 2, the PR
URLs, **how the group was linked** (state it plainly — if branch names alone did the
linking, say so, and don't let the synthesis assert a relationship the diffs themselves
don't support), and the specific things to check, drawn from the "cross-repo invariants at
risk" list above plus:

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

- One section per reviewed PR (`owner/repo#N` — a group holding two PRs from one repo gets
  two sections, not one merged one): PR number/title/link and posted-review link, or
  "no open PR — skipped" for a repo the group didn't touch at all. Include that PR's
  `FAN-OUT` line from its HANDOFF verbatim — the Agent-call count, and any reasoning
  recovered from the transcript when the count is zero, or "no reasoning found" if none was
  recoverable. State it plainly, without editorializing on whether the reasoning was good
  enough; that judgment isn't this skill's job yet.
- A **Cross-repo** section: the findings from Step 3, or "none found" if the pass ran and
  found nothing actionable, or "skipped — only one repo in this group" if it didn't run.
- An **Excluded** section: every open PR Step 1 found but didn't include, one line each,
  same as the printed plan — so a `--fix`/`--comment` run doesn't bury that information
  behind the action it just took.

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

   "Finding" identifies where it lives (`owner/repo#N:file:line` — the PR number, not just
   the repo slot, since a group can hold two PRs from one repo — or the repo slot alone for
   a process-level finding with no single line) and states the problem in one clause —
   enough to act on without cross-referencing the HANDOFF blocks again. Sort however makes
   the table easiest to scan (severity-first is usually right, but use judgment); don't
   split it into a separate table per repo — one table, every finding.

3. **List excluded open PRs** below the table, one line each, same as the printed plan —
   don't let a silent exclusion look like a repo genuinely had nothing open.

4. **Do not fix, comment, or otherwise act on anything in the table.** State plainly that
   you're waiting for the user to say which rows to act on, and stop there — this is a
   hold point, not a formality; the whole reason this branch exists is that `--fix`/
   `--comment` weren't passed, meaning the user hasn't yet told you to act. Only proceed
   once they name specific items (or say "the ones you recommended," "all of them," etc.)
   — and only touch what they actually asked for, the same discipline `--fix` runs inside
   Step 2 already have to a single repo's working tree.

## Step 5 — Cleanup

Run `rm -f <scratchpad dir>/*.diff` again, now that every Step 2 sub-review has finished. A
stale `.diff` left in the scratchpad has already been read as current by mistake once — see
`references/incidents.md` — which is exactly what this cleanup and the Step 1 defensive
sweep exist to prevent.

`project-review-handoffs.md` is the only file in `<scratchpad dir>` this skill's own state
depends on — every `.diff` file a sub-review wrote there is safe to discard once that
sub-review has finished, whether or not it found anything to report. Do this even if a
slot was skipped (no open PR) or a sub-review call failed partway — leftover `.diff` files
from a partial run are exactly what the Step 1 defensive sweep exists to catch next time,
but cleaning up now means there's nothing left for that sweep to have to catch.

## Guardrails

- Never merge, push, or land anything from this skill. `wq.py land` is a separate,
  deliberate step the user runs themselves when ready.
- If `/project-review` was invoked with neither `--fix` nor `--comment`, Step 4's
  consolidated-table branch is a hard stop — do not fix, comment, or otherwise act on any
  finding until the user names which ones. This is the same rule as the line above,
  applied one level down: `--fix`/`--comment` are how the user tells this skill it's
  allowed to act; their absence means it isn't, yet.
- Before Step 2, if `--fix` was passed, check each target repo's working tree
  (`git status --porcelain`) and warn if it's dirty — `--fix` will write into it. If the
  selected group holds two PRs from the same repo, that's one working tree for two
  sub-reviews: run them sequentially with a `git status` re-check between the two, or refuse
  `--fix` for that shape and say why, rather than letting the second `--fix` clobber
  uncommitted output from the first.
- Never treat two PRs as related just because both happen to be open at the same time, share
  an author, or were opened around the same time — group only on the evidence in Step 1's
  `### Linkage evidence` (a direct body link, a leading shared ticket ID, or user assertion;
  branch name corroborates but never forms a group on its own) and say which evidence applied
  when you print the plan.
- The `uma-skill-tools` submodule sitting in detached HEAD is its normal, healthy state —
  standard for any git submodule checkout, and this repo's own CI/gitlink tooling is built
  around it (see `docs/adr/0011-gitlink-drift-guard.md`, which rejects a branch-name check
  specifically because it breaks on detached-HEAD checkouts) — never treat that alone as a
  problem to fix or flag.
- `xhigh` and `max` are valid levels for the underlying `code-review` skill; forward them
  unchanged like any other level.
