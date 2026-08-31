---
name: project-lintstaged-mjs-gap
description: "uma-tools' lint-staged glob (*.{ts,tsx,js,jsx,css}) does not match .mjs files, so the pre-commit hook silently skips them"
metadata: 
  node_type: memory
  type: project
  originSessionId: 71571d55-b857-444b-a6cb-3cd92d219acb
  modified: 2026-08-25T05:55:27.202Z
---

`package.json`'s `lint-staged` config in `mackoz/uma-tools` is `"*.{ts,tsx,js,jsx,css}"` —
this does **not** match `.mjs`, even though several `scripts/*.mjs` files exist
(`check-jp-global-divergence.mjs`, `add-staged-global-umas.mjs`, and as of PIPE-2
`decrypt-meta-db.mjs`/`download-game-assets.mjs`).

**Why this matters**: committing a new or edited `.mjs` file prints
`lint-staged could not find any staged files matching configured tasks` and silently skips
`biome check --write` on it — no error, easy to miss. Found 2026-08-24 when a newly-written
`.mjs` script's commit went through with unformatted code the hook should have caught.

**How to apply**: after committing any `.mjs` file, manually run
`npx biome check --write <file>` and commit the formatting fix separately if it changes
anything (safe to do — the file is new/already yours, not the "reformat unrelated
pre-existing files" trap [[feedback_sync_repo_docs_on_change]] warns about). Don't assume the
pre-commit hook covers `.mjs` the way it covers `.js`/`.ts`. Widening the glob in
`package.json` itself would fix this permanently but wasn't done — out of scope for
whatever task surfaces this, don't fix it silently without being asked.
