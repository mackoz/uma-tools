---
name: project-plans-directory
description: "game-mechanics reference, fork/upstream comparison docs, and the bug/feature work-queue tracker live in the sibling repo mackoz/uma-tools-plans, symlinked into uma-tools as plans/ — not mentioned in CLAUDE.md"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8d5349f4-9dd8-4bc4-9282-7dd917c217fd
  modified: 2026-08-23T11:44:54.015Z
---

`uma-tools/plans` is a symlink (added 2026-08-19) to a sibling checkout at
`~/github/uma-tools-plans`, its own git repo pushed to `https://github.com/mackoz/uma-tools-plans`.
It used to be a gitignored, local-only directory inside `uma-tools`; it was split out so this
research material could be versioned without being part of the shipped app's history. The symlink
itself is still gitignored in `uma-tools` (`.gitignore` has a no-trailing-slash `plans` entry,
deliberately not `plans/`, since a trailing-slash pattern doesn't match a symlink) — cloning
`uma-tools` alone will not bring this content along; both repos need to be siblings under the same
`github/` parent for the symlink to resolve. `uma-tools-plans` has its own `CLAUDE.md` explaining
this relationship for anyone working in it directly.

Check `plans/` at the start of any mechanics/comparison/porting task — it won't surface from a
normal repo skim of `uma-tools` alone, and it holds prior investigation that's expensive to redo.

- `plans/game-mechanics/` — an imported reverse-engineering doc (KuromiAK's "Uma Musume Race
  Mechanics") describing actual game behavior: stats/speed, HP, skills, lane/blocking, position
  keeping & race dynamics, finish/course/frame-ordering notes. Ground truth for "what should the
  engine do", independent of what either codebase currently does.
- `plans/work-queue/` (**replaced `plans/engine-comparison/` on 2026-08-22** — that directory no
  longer exists) — the tracker for all bug/feature work on `uma-tools`/`uma-skill-tools`: one
  self-contained item file per finding, stable IDs (SPD-#/HP-#/SKL-#/LANE-#/DYN-#/ORD-# engine,
  UI-# app), lifecycle folders `backlog/<category>/` → `in-progress/` → `completed/`, and an
  index/dispatch list in `work-queue/README.md`. Full workflow: [[feedback_work_queue_workflow]].
- `plans/fork-comparison/` — app/product-level comparison docs, one subdirectory per counterparty
  repo (`alpha123/`, `thecing/`, `torena-sim/`), plus the engine-mechanics no-action reference
  (`alpha123/engine-mechanics.md`, `engine-fork-network.md` — the 34-fork survey, incl. the
  lineage correction: `uma-tools`'s engine baseline is `Werseter/uma-skill-tools@kachi`, not an
  independent fork of `alpha123`, so baseline "this repo gets X right" findings usually credit
  Werseter's work). Full layout, move history, and the rule for where *new* comparison content
  goes: [[project_doc_locations_after_fork_comparison_move]].

**Why this matters**: any task about game mechanics accuracy, porting upstream fixes, or comparing
`uma-tools` to `alpha123/uma-skill-tools` (or any of its forks) should check `plans/` first — the
ground-truth doc and prior comparison work already live there, and redoing it from scratch wastes
a full investigation pass. All commits to this repo go on a branch + PR, never directly to `main`
— see [[feedback_plans_branch_pr_workflow]].
