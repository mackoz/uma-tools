---
name: project-mkdocs-in-venv
description: "uma-tools-plans' mkdocs lives in a repo-local venv, and a SessionStart hook in uma-tools' .claude/settings.local.json now puts it on PATH automatically for sessions started there"
metadata: 
  node_type: memory
  type: project
  originSessionId: 71571d55-b857-444b-a6cb-3cd92d219acb
  modified: 2026-08-30T05:26:09.266Z
---

`mkdocs` (used for `mkdocs build --strict` verification on `uma-tools-plans` doc changes) is
installed in a repo-local virtualenv, documented in `uma-tools-plans/CLAUDE.md` (setup: line
17, `python3 -m venv .venv && .venv/bin/pip install mkdocs-material`; verify: line 29,
`.venv/bin/mkdocs build --strict`):

```sh
/Users/william.lu/github/uma-tools-plans/.venv/bin/mkdocs build --strict
```

**As of 2026-08-29, sessions started in `uma-tools` get this on `$PATH` automatically.**
`uma-tools/.claude/settings.local.json` (gitignored, machine-local) has a `SessionStart` hook
that appends `export PATH="/Users/william.lu/github/uma-tools-plans/.venv/bin:$PATH"` to
`$CLAUDE_ENV_FILE`, which Claude Code sources into every subsequent Bash call that session.
That's what resolved the earlier "cause unconfirmed" mystery — the 2026-08-29 session that saw
it on PATH was started after this hook existed; the 2026-08-25 "command not found" session
predates it. A session started in a *different* cwd (no `uma-tools/.claude/` in scope, e.g. a
worktree or `uma-tools-plans` itself) won't get the hook — fall back to `which mkdocs` there,
or use the explicit venv path above, which always works regardless.

**Also confirmed not to propagate: a subagent/nested Claude Code session's Bash calls, even with
cwd `uma-tools`.** Reproduced independently twice (a research subagent and a plan-review subagent,
both 2026-08-29) — `which mkdocs` returned "not found" and `$CLAUDE_ENV_FILE` was empty from
inside the subagent, despite the parent session's own hook being present and working. Don't rely
on the hook inside a subagent; use the explicit venv path there.

**Why this matters:** on 2026-08-25, a bare `mkdocs build --strict` failed with "command not
found" and nearly triggered a fresh-install prompt to the user when the tool was already
documented and installed — the miss was skipping CLAUDE.md, not a real gap. The PATH hook
(filed as part of a 2026-08-29 tooling-gap review) closes that gap going forward for the common
case; it doesn't remove the underlying `uma-tools-plans/CLAUDE.md` documentation, which stays
authoritative.

**How to apply:** in a `uma-tools`-rooted session, a bare `mkdocs build --strict` should just
work. Elsewhere, or if in doubt, `which mkdocs` first or use the explicit venv path — cheap and
environment-proof either way. Don't re-propose adding this to CLAUDE.md, it's already there.
