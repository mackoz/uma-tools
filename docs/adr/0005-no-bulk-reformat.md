# ADR-0005: Format only touched files; never bulk-reformat

**Status:** Accepted
**Date:** 2026-08-20 (Biome/husky adoption)

## Context

The codebase had no prior lint or format history. Adopting a formatter over such a codebase forces a choice: reformat everything once, or format incrementally as files are touched.

## Decision

[Biome](https://biomejs.dev) is the single lint+format tool (`biome.json`: tabs, single quotes, TSX-aware), enforced by a husky pre-commit hook running `lint-staged`, which runs `biome check --write` **only on staged files**. The codebase is deliberately not bulk-reformatted; files pick up the format as they're actually edited.

The decision was made empirically: a full `biome check --write .` run was performed, measured, and **discarded** — it touched ~160 files and produced a 50k+ line diff (`CLAUDE.md`'s lint section records this). Vendored code (`vendor/table-core`) and the engine submodule are excluded from Biome's file set entirely.

Alongside the same adoption, several "recommended" rule categories were deliberately turned off rather than inherited blindly, each with its finding count recorded at decision time: `a11y` (172 findings — needs UX judgment, not mechanical fixes), `noExplicitAny` (367 — already tracked as the typecheck backlog), `noDoubleEquals` (192 — many intentional `== null` idioms), `noNonNullAssertion`, `noDescendingSpecificity`. Revisiting any of these is meant to be a deliberate, scoped pass.

## Options considered

- **One-shot repo-wide reformat.** Rejected after actually trying it: the diff buries real changes, poisons `git blame`, touches vendored code, and guarantees conflicts with every in-flight branch.
- **No formatter at all.** Rejected: new code was already drifting in style, and review time was going to whitespace.

## Consequences

- Mixed formatting persists in files nobody has touched — accepted as the cost of reviewable diffs and usable blame.
- The pre-commit hook will never reformat a file you didn't stage, so a diff's formatting changes are always attributable to that change's author actually editing the file.
- Disabled rule categories are a recorded backlog with counts, not a silent configuration accident.
