---
name: feedback-notify-agents-on-worktree-create
description: "when creating a new git worktree in uma-tools/uma-tools-plans, message other active peer sessions (via ListAgents/SendMessage) right after creating it so they have context on the new checkout"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2766936e-0ab9-40d6-8271-50a96037e520
  modified: 2026-08-29T10:45:32.000Z
---

When you create a new git worktree (`git worktree add ...`) in `uma-tools` or
`uma-tools-plans`, check for other active sessions via `ListAgents` and send
them a short message (path, branch, what it's for) right after creating it.

**Why**: this project routinely has multiple agent sessions working the repo
concurrently — confirmed this session, where another peer session
(`sync-runaway-skill-strategy`) had the main `uma-tools` and `uma-tools-plans`
checkouts on `ui-25-work` with real uncommitted work, while this session did
HP-5 entirely from worktrees to avoid disturbing it. That precaution worked,
but it was passive — this session never told the other one a worktree existed
or what it was for. The same session also nearly wrote a file into the main
checkout by accident (a skill-creator call given a plain repo-root path
resolved to the main checkout instead of the worktree, landing an edit next
to the other agent's uncommitted files) and had `wq.py land`'s `CODE_REPO`/
`ENGINE_REPO` sibling-path derivation resolve to the main checkout instead of
the worktree (full incident + fix options in `uma-tools-plans` ticket
PIPE-25) — both caught before causing damage, but both were near-misses a
heads-up message wouldn't have prevented on its own, though it would have
made the *right* checkout more obvious at a glance, and let the other session
flag if it planned to touch something the new worktree also touches.

**How to apply**: right after `git worktree add` succeeds (and after running
`scripts/worktree-setup.sh` if it's a `uma-tools` worktree), call `ListAgents`
to see what other sessions are running. If any are active on the same repo
family, send each a short message: the worktree's path, the branch it's on,
and a one-line reason ("HP-5 work, so I don't touch your ui-25-work
checkout"). Don't block on a reply — this is a courtesy notification, not a
coordination handshake; proceed with the work either way. Skip it only if
`ListAgents` shows no other active sessions at all.
