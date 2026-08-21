# ADR-0003: The engine is a git submodule, not vendored code

**Status:** Accepted
**Date:** 2026-08-19 (`d006839`)

## Context

`uma-skill-tools/` had been vendored in-tree since 2025-10-12, when the kachi lineage flattened it out of a submodule (`7a4949a "Remove submodule"`). The commit converting it back records the cost of that state directly: "this repo's own history never actually tracked which upstream/fork commit the engine came from" — engine provenance was unrecoverable, and engine fixes had nowhere to live except mixed into app commits.

## Decision

Remove the vendored copy and re-add `uma-skill-tools/` as a real git submodule pointing at [`mackoz/uma-skill-tools`](https://github.com/mackoz/uma-skill-tools) — "the same relationship `alpha123/uma-tools` has with its own upstream engine submodule" (the conversion commit's own words). Engine changes happen in the engine repo first (its own commits, PRs, and tests), then land here as a gitlink bump.

## Options considered

- **Keep the engine vendored.** Rejected: no engine provenance, no independent engine history or PRs, and nothing stopping app code and engine code from bleeding into each other. (A sibling project's vendored engine contains a debug file importing app code — the exact leak the submodule boundary makes structurally impossible.)
- **Publish the engine as an npm package.** Not chosen: heavier release machinery for a single consumer; the submodule gives an exact-commit pin with none of the packaging overhead.

## Consequences

- Deploys are pinned to an exact engine commit; "which engine is live" is always answerable.
- The workflow has real traps, documented as `CLAUDE.md`'s submodule section: editing the checked-out copy without committing+pushing in the engine repo and bumping the gitlink here leaves fixes silently unrecorded, and a fresh clone needs `git submodule update --init` or every build fails on missing imports.
- The engine stays importable by the web worker and `ts-node` CLI tools alike, and its engine-only/no-DOM rule is enforced by the repo boundary rather than convention alone.
