# Repo layout & doc locations
- [plans/ directory for mechanics reference + tracker](project_plans_directory.md) — game-mechanics docs, fork/upstream comparisons, and the work-queue tracker live in sibling repo mackoz/uma-tools-plans, symlinked as plans/, unmentioned in CLAUDE.md; check it first for any mechanics/comparison/porting task
- [Where each doc type lives post-2026-08-21 move](project_doc_locations_after_fork_comparison_move.md) — public repos (uma-tools, uma-skill-tools) hold only own-repo docs; cross-repo comparison content lives in private uma-tools-plans (fork-comparison/ + work-queue/), unmentioned in the public repos' own docs; never link the private repo from a public one

# Git & PR workflow
- [Branch + PR in all repos incl. plans; merge together](feedback_plans_branch_pr_workflow.md) — since 2026-08-23 never commit directly to uma-tools-plans main; branch + PR in every repo a change touches, merge the related PRs together so all mains stay in sync
- [Prefer one open PR per repo (soft since 2026-08-29)](feedback_one_open_pr_per_repo.md) — default to pushing to the existing open PR's branch, but a second PR is fine when genuinely warranted; flag it and confirm with the user first instead of opening it silently
- [Cross-link paired PRs in their bodies](feedback_crosslink_paired_prs.md) — when one fix spans PRs in multiple repos, each PR body should link the sibling PR(s); a bare tracking link to the plans PR is fine even from a public repo, unlike linking its comparison content
- [Gitlink-on-branch-tip is a review false positive, not a bug](feedback_gitlink_review_false_positive.md) — while engine+code PRs are both open, uma-tools' gitlink legitimately points at the engine PR's branch tip, not origin/master; don't hand-fix, `wq.py land --engine-pr N --code-pr M` resolves it automatically at merge time

# Task tracking
- [Work-queue workflow for all bug/feature work](feedback_work_queue_workflow.md) — read plans/work-queue item when given an ID; create an item first for un-logged work or side-findings; move file backlog/ → in-progress/ → completed/ as work proceeds; skip the queue for tiny self-contained fixes
- [Use the workflow scripts, not manual choreography](feedback_use_workflow_scripts.md) — since 2026-08-23: `npm run verify` for build+metrics, plans `scripts/wq.py` claim/status/complete/land for ticket lifecycle + paired-PR merges, worktree-setup/stage-for-review for worktrees; user asked for this to cut token waste

# Doc-sync obligations after code changes
- [Keep plans/ docs in sync with repo changes](feedback_keep_plans_docs_in_sync.md) — when a uma-tools change affects a claim in plans/work-queue/, engine-mechanics.md, or a port-plan, update+commit+push it (on the plans PR branch) in the same turn
- [Sync repo's own README/CLAUDE.md/docs on change](feedback_sync_repo_docs_on_change.md) — after code changes in uma-tools or uma-skill-tools, fix stale claims in that repo's own docs in the same pass; also has the Global-localization-terminology rule (Global names in changelog/commit prose only; JP-primary with gloss elsewhere; official skill names from master.mdb text_data cat 47, not skillnames.json)

# Working style
- [Ask before working around a missing local tool](feedback_ask_before_tool_install_fallback.md) — if a command fails because a dependency isn't installed, ask whether/how to install it rather than silently substituting a safer workaround
- [Notify other agents when creating a worktree](feedback_notify_agents_on_worktree_create.md) — right after `git worktree add`, check `ListAgents` and message any other active peer sessions with the new worktree's path/branch/purpose; courtesy notification, don't block on a reply

# Testing
- [Keep test tools; generalize them once the plan is finalized](feedback_keep_and_generalize_test_tools.md) — never delete a script/tool built to test new code; once implementation is done, check whether it can be factored into a reusable helper for future tests

# Repo tooling gaps
- [lint-staged glob misses .mjs files](project_lintstaged_mjs_gap.md) — pre-commit hook silently skips biome formatting on scripts/*.mjs; manually run `biome check --write` on any new/edited .mjs before or after committing
- [mkdocs venv PATH exposure varies by session](project_mkdocs_in_venv.md) — check `which mkdocs` before assuming; the explicit `uma-tools-plans/.venv/bin/mkdocs build --strict` path always works

# User-facing changelog
- [Update changelog for umalator-global changes](feedback_changelog_umalator_global.md) — always add a changelog entry in `umalator/IntroText.tsx` when a change affects umalator-global; current-session entries up top, older collapsed; one rolling bullet for multi-phase work (e.g. the UI redesign); skip for tiny polish fixes
