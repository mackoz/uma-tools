# Architecture Decision Records

This directory records the *why* behind this repo's significant decisions — the things a future reader would otherwise have to reverse-engineer from diffs, or worse, silently "fix". Reference documentation (how things work now) lives in the other `docs/` files; these records hold what was decided, what else was considered, and what it costs. The engine has its own parallel set in `uma-skill-tools/docs/adr/`.

## When to write one

Write an ADR when a change settles a question that could reasonably have gone another way: an architecture split, a build/deploy posture, a modeling or statistics design, a deliberate exception to a rule. Small fixes and refactors don't need one. If a change *reverses* a recorded decision, don't rewrite history — add a dated **Amendment** to the old record (or mark it Superseded and write a new one).

## Format

Each record: **Status** · **Date** · **Context** (the problem and its constraints) · **Decision** (one decision per record) · **Options considered** (including rejected ones and why they lost) · **Consequences** (costs included, honestly) · **Amendments** (dated, appended, never silently edited).

Statuses:
- **Accepted** — current, deliberate.
- **Accepted — under reconsideration** — still current behavior, but evidence has accumulated against it; an amendment says what and why.
- **Inherited (rationale reconstructed)** — the decision predates this fork; the record reconstructs the likely rationale from code, comments, and history rather than first-hand knowledge. Treat the reconstruction as honest inference, not testimony.
- **Superseded** — replaced; the record stays, pointing at its replacement.

Numbers are never reused or renumbered, even if a record is retired — gaps are meaningful and retired records keep a tombstone entry here.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-single-shared-bilingual-app.md) | One shared source builds both the JP and Global apps | Inherited (rationale reconstructed) |
| [0002](0002-uma-tools-absolute-asset-prefix.md) | Assets use a hardcoded `/uma-tools/` absolute prefix | Inherited (rationale reconstructed) |
| [0003](0003-engine-as-git-submodule.md) | The engine is a git submodule, not vendored code | Accepted |
| [0004](0004-ci-is-the-only-build-path.md) | Bundles are not committed; CI is the only build path | Accepted |
| [0005](0005-no-bulk-reformat.md) | Format only touched files; never bulk-reformat | Accepted |
| [0006](0006-add-only-upstream-data-sync.md) | alpha123 data sync is add-only, format-preserving, and loud | Accepted |
| [0007](0007-statistical-skill-chart-method.md) | The Skill Chart ranks by paired comparisons with adaptive, CI-based elimination | Accepted |
| [0008](0008-worker-cancellation-by-terminate.md) | Chart cancellation terminates and respawns workers | Accepted |
| [0009](0009-chart-runs-use-real-hp-policy.md) | Chart runs request `mode: 'compare'` for a real HP policy | Accepted |
| [0010](0010-design-tokens.md) | Umalator styles resolve through a single token file; dark mode is token redefinition | Accepted |
