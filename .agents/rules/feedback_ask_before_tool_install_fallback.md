---
name: feedback-ask-before-tool-install-fallback
description: "When a needed tool/library isn't installed locally, ask the user before silently falling back to a safer/alternative approach"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 71571d55-b857-444b-a6cb-3cd92d219acb
  modified: 2026-08-30T05:26:01.323Z
---

When a task needs a tool or library that isn't installed locally (e.g. a Python package
like UnityPy, a system binary), don't silently substitute a safer workaround (hand-rolled
partial reimplementation, skipping the step, a different tool) without asking first.

**Why:** During PIPE-2 CDN-download verification (2026-08-25), `extract-assets.py` failed
with `ModuleNotFoundError: No module named 'UnityPy'`. Instead of asking, the natural
instinct was to fall back to manually replicating just the AB-XOR decrypt layer in an
inline script to confirm a `UnityFS` header — a reasonable partial check, but it skips the
full extraction path the actual script uses and isn't the same as running the real tool.
The user explicitly said to install UnityPy rather than have me quietly route around the
gap, and separately asked to be prompted in future cases like this rather than defaulting
to the safer/lesser path on my own judgment. **Resolved as of 2026-08-29 (see below) —
`UnityPy`/`Pillow` now live in `uma-tools/scripts/.venv`, not bare system Python, which is
the documented, deliberate setup (`scripts/requirements.txt`). This anecdote is historical
now, not a live gap; don't re-ask about `UnityPy` in that venv.**

**How to apply:** If a command fails because a dependency isn't installed, surface that
plainly and ask whether to install it (and how — e.g. `--break-system-packages`, a venv,
system package manager) before reaching for a workaround that avoids installing anything.
This applies broadly, not just to this repo's Python/Node on-demand-install pattern (see
`decrypt-meta-db.mjs`/`extract-assets.py`'s deliberately-undeclared-dependency convention
in `uma-tools/CLAUDE.md`) — the same principle holds for any missing local tool.

**Already installed as of 2026-08-29 — don't re-ask about these:**
- `File::Slurper` (system perl, `/usr/bin/perl`) — unblocks `umalator-global/make_global_uma_info.pl`
  fully. Does **not** unblock the repo-root `make_uma_info.pl` — that one has a separate, still-open
  gap (no CLI override to point at a decrypted `meta` DB); still ask before working around *that* one.
- `uv`, `cpanminus`, `coreutils` (`gtimeout`/`gtac`/`gcat`) — Homebrew, on PATH globally.
- `lz4-napi`, `better-sqlite3-multiple-ciphers` — `npm i --no-save`'d into `uma-tools/node_modules`
  (not in `package.json`/lockfile, by design — see `uma-tools/docs/data-pipeline.md`). These vanish
  on a clean `npm ci`, or on a lone reinstall of just one of the two (`npm install <one>` prunes the
  other as a side effect — confirmed the hard way). If either throws `MODULE_NOT_FOUND`, just re-run
  `npm i --no-save lz4-napi better-sqlite3-multiple-ciphers` (both together), don't re-ask.
- TypeScript LSP for `uma-tools`' pinned TS 7.0.2, via a local Claude Code plugin at
  `~/.claude/skills/uma-tools-tsc-lsp/` (runs `node node_modules/typescript/bin/tsc --lsp --stdio`).
- `mkdocs` — see `project_mkdocs_in_venv.md` for the PATH-hook mechanism and its caveats; that file
  is the source of truth for mkdocs specifically, not this list.
