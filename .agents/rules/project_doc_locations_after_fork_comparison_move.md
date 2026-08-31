---
name: doc-locations-after-fork-comparison-move
description: "where each category of uma-tools documentation now lives, after moving cross-repo comparison docs to the private plans repo (2026-08-21)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4f13119e-e6aa-436e-b942-e961b966cac7
  modified: 2026-08-22T08:47:46.518Z
---

As of 2026-08-21, docs are split by whether their subject is *this repo's own code* (public, stays in `uma-tools`/`uma-skill-tools`) or *another repository* (private, moved to `uma-tools-plans`, which is private — unlike `uma-tools` and `uma-skill-tools`, both public). This split can't be mentioned in `uma-tools`'s own docs (README/CLAUDE.md/docs/) — doing so would itself reveal to a public reader that comparison research against other maintainers' forks exists and where to find it, which defeats the point of moving it. Keep this distinction in mind (memory only) rather than documenting it in-repo.

**Public — `uma-tools/docs/`:** `apps.md`, `architecture.md`, `data-pipeline.md`, `deployment.md`, `statistical-analysis.md`. Own-repo only: what this app does, how it's built, how a simulation runs, how to regen game data, how to deploy. No comparative content, no upstream/fork-name-heavy prose.

**Public — `uma-skill-tools/README.md` + `CLAUDE.md`:** engine's own design/behavior, stated on its own authority (a "Behavior notes" section, not "upstream's README said X"). Bare fork attribution to `alpha123/uma-skill-tools` and `Werseter/uma-skill-tools@kachi` stays (GitHub shows the fork relationship anyway) — that's not the same as an evaluative comparison.

**Private — `uma-tools-plans/fork-comparison/`:** the actual comparison docs, moved here from `uma-tools/docs/` in this pass and reorganized later the same day (2026-08-21) into **one subdirectory per counterparty repo**, each following `fork-comparison/TEMPLATE.md` (README.md = verdict/snapshot/reproduction, comparison.md = evidence in a fixed section order, port-plan.md = tiers/do-not-port/status log, plus supplementary files): `alpha123/` (the ancestor — consolidated to the template later on 2026-08-21: `comparison.md` merged from the former `upstream-comparison.md` + `architecture-comparison.md`, `port-plan.md` absorbed from the former top-level `upstream-port-ideas.md`, and `architecture.md` (formerly `upstream-architecture.md`) absorbed its `-simple` plain-language twin — all pre-merge files in git history; the whole subtree was also swept on 2026-08-21 to say "alpha123" instead of "upstream" everywhere that meant alpha123's repos, across all three repos' docs), `thecing/` (sibling fork — its work was never merged to `uma-tools` master, PR #13 closed, branch deleted), `torena-sim/` (Rust cousin engine). New files about a compared repo go in that repo's subdirectory. `fork-changes.md` and `scrubbed-from-uma-tools-docs.md` were deleted in the reorg (not comparisons; recoverable from `uma-tools-plans` git history, pre-reorg commit `1ba2c1e`).

**Private — `uma-tools-plans/fork-comparison/alpha123/data-sync.md`** (moved from top-level `upstream-data-sync.md` on 2026-08-21): the operational runbook for `uma-tools`'s `scripts/sync-upstream-data.mjs` — the script itself is still public, unchanged, and keeps its name and `--upstream` flag; only the writeup moved.

**Private — `uma-tools-plans/work-queue/` (+ two `fork-comparison/` reference files):** the engine-mechanics-level stable-ID findings (doc vs. this engine vs. upstream B vs. the wider fork network) originally lived in `uma-tools-plans/engine-comparison/`; on 2026-08-22 that directory was dissolved — actionable findings became `work-queue/` items (see [[feedback_work_queue_workflow]]), no-action reference moved to `fork-comparison/alpha123/engine-mechanics.md` and `fork-comparison/engine-fork-network.md`. Different grain from the rest of `fork-comparison/`'s app/product-level prose.

One leak fixed in this pass: `uma-skill-tools/README.md` used to link the private `uma-tools-plans` repo by a literal `https://github.com/mackoz/uma-tools-plans/...` URL — removed. If adding new cross-repo comparison content in the future, default to writing it directly in `uma-tools-plans`, not `uma-tools/docs/` or `uma-skill-tools/README.md`, and never link the private repo by URL from a public one (a bare, unlinked mention like `plans/foo.md` is also a tell — avoid that too, plain prose only).

See [[feedback_sync_repo_docs_on_change]] and [[project_plans_directory]] for the broader plans/ conventions this builds on.
