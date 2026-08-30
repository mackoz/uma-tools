# ADR-0012: Asset decryption/extraction is a separate script layer, not a patch to the Perl pipeline

**Status:** Accepted
**Date:** 2026-08-24 (`scripts/decrypt-meta-db.mjs`, `scripts/download-game-assets.mjs`,
`scripts/extract-assets.py`; PIPE-2)

## Context

Current game clients encrypt the `meta` asset-manifest DB (sqleet/ChaCha20, not the SQLCipher
this fork's own investigation originally assumed) and apply a per-asset XOR keystream to bundle
bytes in `dat/`. This fork's existing Perl pipeline (`extract_resource.pl`, `make_uma_info.pl`)
assumes both are plaintext — it opens `meta` with a bare `DBI->connect` and never decrypts
anything, so neither script currently produces useful output against a live client.

Unblocking this required adding, at minimum, ChaCha20-frame decryption for `meta` and an XOR
keystream reversal for each asset bundle — genuinely new capability, not a bug fix, and this
is the same class of decision `ADR-0006` already records for `sync-upstream-data.mjs` (layer a
stopgap alongside a broken pipeline rather than fix the pipeline in place).

## Decision

Decryption and extraction live in three new, standalone scripts rather than as changes to
`extract_resource.pl`/`make_uma_info.pl` themselves:

- **`scripts/decrypt-meta-db.mjs`** decrypts a *copy* of `meta` into a plaintext SQLite
  sibling (`<input>.decrypted` by default) via `better-sqlite3-multiple-ciphers`, a Node
  binding for the sqleet/ChaCha20 cipher family. `extract_resource.pl` reads the plaintext
  output with zero changes to itself, because the design goal was specifically that a
  plaintext SQLite file — decrypted once, up front — is indistinguishable to the Perl side
  from an already-unencrypted `meta`.
- **`scripts/download-game-assets.mjs`** fetches individual files from the CDN by hash, an
  entirely new capability the Perl pipeline never had (it always assumed a game client
  install's `dat/` folder was already present locally).
- **`scripts/extract-assets.py`** reverses the per-asset XOR layer and unpacks Unity texture/
  sprite assets via UnityPy, as an alternative to the existing `need_unpack/` +
  external-unpacker + `move_unpacked_resources.pl` flow when a decrypted `meta` and `dat/`
  blobs are already in hand.

Neither `better-sqlite3-multiple-ciphers` (native binding) nor UnityPy/Pillow (Python) are
declared as project dependencies — installed on demand, matching this pipeline's existing
undeclared-Perl-module precedent (`DBI`, `File::Slurper`).

## Options considered

- **Patch `extract_resource.pl`/`make_uma_info.pl` directly to decrypt in place.** Rejected:
  Perl has no maintained sqleet/ChaCha20 binding to reach for (the ecosystem's crypto tooling
  here is thin compared to Node's), so this would mean hand-rolling frame parsing and stream
  decryption in Perl — real, avoidable risk for a cipher whose key is already known to rotate
  on client updates (a "come back and re-derive it" maintenance cost this fork will pay
  again regardless of which language holds the logic).
- **A single combined script instead of three.** Rejected: the three capabilities
  (DB-level decrypt, CDN fetch, per-asset decrypt+unpack) have genuinely different
  failure/retry/dependency profiles (native binding vs. plain HTTP vs. Python+UnityPy) and are
  each independently useful — `decrypt-meta-db.mjs` alone already fully unblocks
  `extract_resource.pl`'s existing flow with no CDN or Python involved at all.
- **Wait and file this as a documentation-only gap, like the CDN individual-asset-bundle 404
  issue known at the time.** Rejected for the `meta`-decryption half specifically: unlike the
  CDN gap as understood when this ADR was written (where the missing piece — thought to be a
  resource-version path segment or session-scoped auth — seemed genuinely unknown), the cipher
  and both keys were independently confirmed against two unrelated sources, so there was a
  concrete, buildable fix available rather than an open unknown to document around. **Correction
  (2026-08-25, later the same day): the CDN gap referenced above turned out not to be an open
  unknown either** — it was a platform mismatch (Android- vs Windows-sourced asset hashes),
  diagnosed and fixed same-day; see `docs/data-pipeline.md`'s PIPE-2 section and
  `plans/work-queue/in-progress/pipe-2.md`. Left here rather than rewritten since it accurately
  reflects what was known at the time this decision was made.

## Consequences

- `extract_resource.pl`/`make_uma_info.pl` stay untouched by this decision, but that also
  means neither script *automatically* picks up a decrypted `meta` — `make_uma_info.pl`
  specifically has no CLI override to point it at a decrypted copy
  (`docs/data-pipeline.md`'s "Formerly-known bugs" section documents this residual gap). This
  no-CLI-override gap is the unconditional blocker regardless of which Perl modules happen to
  be installed on a given machine — `File::Slurper` is an ordinary prerequisite (see
  `docs/data-pipeline.md`'s module list), not a separate standing gap.
- The decryption key is a genuine maintenance liability independent of where the logic lives:
  a future client update can rotate it, and whoever picks that up re-derives the key (the
  script's own header comment records both independent sources used this time) rather than
  reverse-engineering the whole cipher family again.
- Keeping decryption in Node/Python instead of Perl means the pipeline is now polyglot in one
  more direction, on top of its existing Perl+Node split — a real but accepted cost, consistent
  with `docs/data-pipeline.md` already documenting the pipeline as multi-language.
