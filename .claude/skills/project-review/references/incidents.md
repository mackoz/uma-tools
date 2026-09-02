# `/project-review` incident log

Forensics behind rules stated in `../SKILL.md`. Read a section here only when you want to know
*why* a rule exists — the rule itself is always stated inline in `SKILL.md` and is usable without
this file. Nothing here changes run-to-run behavior.

## Single-PR case duplicated by hand (backs the intro's "a single open PR is fully supported")

Step 1's per-slot discovery already skips a repo with nothing open, and Step 3 already skips the
cross-repo pass when too few repos have a linked PR — this was true before it was written down, it
just wasn't said out loud anywhere. Once, reviewing `uma-tools-plans#31`, an agent hand-rolled Step 2
and Step 4 instead of invoking this skill, reasoning that a single open PR was a degenerate case this
skill didn't really cover. It wasn't a degenerate case — inventing a manual substitute just duplicated
what calling this skill directly already does.

## Wrong assumed base branch (backs Step 2's instruction to pass `baseRefName` along)

A sub-review reviewing `uma-tools-plans#28` on 2026-08-29 assumed `master` (the convention in the
other two repos, and the wrong one here) and hit two failed git commands — `fatal: couldn't find
remote ref master`, then `unknown revision 'origin/master...HEAD'` — before self-recovering via
`git branch -a`/`git remote -v` and discovering the real default is `main`. It got there on its own,
but only after burning tool calls rediscovering something Step 1 had already resolved and simply
never passed along.

## Fan-out silently skipped, reasoning never surfaced (backs Step 2 item 3's transcript-check)

Confirmed by inspecting a raw subagent transcript on 2026-08-25: a `code-review` run reasoned
mid-run ("weighing whether to spawn parallel agents... diff is small, mostly data regen...
proceeding manually — still seems worthwhile to follow protocol"), never attempted the `Agent` tool
once (zero calls, not a rejected/errored attempt), and its final report said nothing about it either
way — the reasoning existed, but only in its own private thinking, never surfaced anywhere the caller
could see without reading the transcript directly.

## PIPE-21's three different branch names (backs the branch-name evidence tier)

A real landing this project did, PIPE-21 on 2026-08-29, had three PRs with three different branch
names — `pipe-21-replay-parser`/`pipe-21-gitlink-bump`/`pipe-21-work` — despite being unambiguously
the same paired change, since nothing forces one branch name across repos. That's why branch-name
match/mismatch is corroborating evidence only, never enough on its own to form or split a group.

## Stale `.diff` file read as current (backs Step 5's cleanup and the Step 1 defensive sweep)

Confirmed by inspecting a raw subagent transcript on 2026-08-25: a Step 2 sub-review reviewing
`uma-tools-plans#15` tried `git diff origin/main...origin/pipe-5-jp-data-refresh > <scratchpad>/
pr15.diff`, hit a zsh `file exists` (noclobber) error because a 605-line `pr15.diff` from an
*earlier* `/project-review` run in the same session was still sitting there, read that stale file
believing it was current, only caught the mismatch because it happened to cross-check one file's
presence in the diff against the `--stat` summary, and then had to `rm -f` and regenerate (706
lines — confirming the original really was stale) before it could proceed. That cost several wasted
tool calls and could just as easily have produced a wrong finding (or a missed one) on a diff the
sub-review never actually saw.
