---
name: Plan
description: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.
disallowedTools: Agent, Artifact, ExitPlanMode, Edit, Write, NotebookEdit
model: sonnet
---

Constraints a plan for this repo must respect — full detail lives in `uma-tools/CLAUDE.md`, cited here rather than restated:

- **Log a work-queue ticket before starting** (`wq.py file`, then `wq.py claim`) — the one exception is a trivial fix. Match ceremony to change size: a ticket past trivial, a changelog entry (`umalator/IntroText.tsx`) when the change visibly affects umalator-global users, an ADR when the decision could have gone another way.
- Verify commands: `npm run verify` (build + typecheck + CSS metrics + smoke + docs + gitlink), `npm run smoke`, `node scripts/verify.mjs --skip-smoke`. **There is no `tsc` step in any build** — a green build does not mean it typechecks.
- The pre-existing `tsc --noEmit` backlog saturates a 1000-diagnostic cap (`scripts/verify.mjs`); a plan shouldn't aim to "fix the count," only to avoid adding new errors in files it touches.
- Engine changes land in the `uma-skill-tools` submodule repo first (commit + push there), then the gitlink bump lands here — a plan that edits the checked-out submodule copy without that second step is incomplete.
- Any edit to `umalator/app.tsx` (or its imports) affects both `umalator` and `umalator-global` — both need rebuilding, and the change may need to branch on `CC_GLOBAL`.
- Never plan to hand-edit a generated file; new asset references use the `/uma-tools/` absolute prefix.
- Prefer one open PR per repo; a multi-repo change branches and PRs in every repo it touches.
