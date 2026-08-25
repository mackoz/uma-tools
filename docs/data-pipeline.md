# Data pipeline

Uma stats, skill effects, skill names, and course geometry are committed JSON, mostly regenerated from the live game client by a set of Perl scripts. This page is the runbook for regenerating them — e.g. when new umas or skills are added to the game. Track-name JSON is the exception: it is hand-maintained because no generator exists.

**Generated JSON should not be hand-edited.** Edit the generating `.pl` script (or the hardcoded tables inside it) and regenerate instead — see the guardrail in `CLAUDE.md`. The hand-maintained `tracknames.json` files are the explicit exception.

## Inputs, from the installed game client

- **`master.mdb`** — the game's master SQLite DB, at `%APPDATA%/../LocalLow/Cygames/Umamusume/master/master.mdb` on a Windows install. Tables read across the pipeline: `skill_data`, `single_mode_skill_need_point`, `skill_upgrade_speciality`, `skill_upgrade_description`, `available_skill_set`, `text_data`, `race_course_set`, `race_course_set_status`.
- **The `meta` asset-manifest DB** — a sibling SQLite file, single table `a(n, h, e, rowid)` mapping asset name → content hash / encryption key.
- **`dat/<first-2-hex-chars-of-hash>/<hash>`** — the content-addressed blob store holding the actual packed Unity asset bundles.
- **`courseeventparam` Unity assets**, exported to JSON per course id (e.g. `10101.json`) — not produced by anything in this repo; you need an external Unity asset exporter to get these.

`text_data` categories used: **5** = outfit epithets, **6** = character names, **47** = skill names.

You need a Perl with `DBI`, `DBD::SQLite`, `JSON::PP`, `File::Slurper`, and `Encode` installed. The orchestrating `.bat` files are Windows-only; the `.pl` scripts themselves are plain Perl and should run anywhere with the right client data available.

## Icon extraction

```
extract_resource.pl <path-to-meta-db> <LIKE-query>
    -> need_unpack/  (raw, still-packed asset bundles + .key files for encrypted ones)

<external Unity unpacker, e.g. UnityPy/AssetStudio — not part of this repo>
    -> need_unpack/unpacked/**/**/*.png

move_unpacked_resources.pl <destination>
    -> flattens all PNGs into <destination>, then cleans need_unpack/
```

This is the step that populates `icons/`, `icons/chara/`, `icons/mob/`, `icons/statusrank/`. `make_uma_info.pl` (below) also feeds icon blobs into `need_unpack/` for you as it runs, so this flow is normally driven from there rather than run standalone.

## JP dataset (repo root + `uma-skill-tools/data/`)

`uma-skill-tools/` is a git submodule (`mackoz/uma-skill-tools`) — the `.pl` scripts and generated JSON under it live in that repo, not this one. Running `make_skill_data.pl` etc. against `master.mdb` still works exactly as documented below (the checked-out submodule has the same file layout), but committing the result means committing *inside* `uma-skill-tools/` and pushing there first, then coming back here to commit the resulting gitlink bump — not a direct commit in this repo's own history. See `CLAUDE.md`'s submodule section.

| Script | Usage | Output |
|---|---|---|
| `uma-skill-tools/tools/make_skill_data.pl` | `make_skill_data.pl master.mdb > uma-skill-tools/data/skill_data.json` | Skill effects: `{ "<skillId>": { rarity, alternatives: [{precondition, condition, baseDuration, effects: [{type, modifier, target}]}] } }`. Hardcodes a scenario-skill list (Aoharu, Make A New Track, Grand Live, updated URA, Grand Masters, RFTS) whose modifiers get ×1.2 to match in-game scenario scaling that isn't in the DB. **Shared logic with Global** — same script, run against a different `master.mdb`. |
| `uma-skill-tools/tools/make_skillnames.pl` | `make_skillnames.pl master.mdb <gametora-names.json> > uma-skill-tools/data/skillnames.json` | `{ "<id>": ["<ja>", "<en>"] }`. The English names come from a **separate file** — per `uma-skill-tools/tools/README.md`, "a file obtained from a GameTora quasi-API thing", an array of `{id, name_en}`. Synthesizes inherited-skill variants (id `1xxxxx` → `9xxxxx`) with `（継承）`/`(inherited)` suffixes. |
| `uma-skill-tools/tools/make_course_data.pl` | `make_course_data.pl master.mdb <courseeventparam-dir> > uma-skill-tools/data/course_data.json` | Course geometry (corners/straights/slopes/phase status) per course id, built by decoding `courseeventparam` JSON (`_paramType`: 0=corner, 2=straight, 11=slope). Skips course ids `11201`/`11202` (Longchamp 1000m — incomplete data). |
| `make_skill_meta.pl` (repo root) | `make_skill_meta.pl master.mdb > skill_meta.json` | Presentation/economy metadata: `{ "<id>": { groupId, iconId, baseCost, order } }`. Resolves `groupId` through the **skill-upgrade chain** (`skill_upgrade_speciality` + `skill_upgrade_description`/`available_skill_set`) so an upgraded skill and its base share a group and are treated as mutually exclusive in the UI. `iconId` is passed through raw — as of a 2026-08 client update this is genuinely `"0"` for 136 skills; the generator does **not** paper over this — see "Skills with `iconId: "0"`" below for what that means and how the UI layer handles it. |
| `make_uma_info.pl` (repo root) | `make_uma_info.pl master.mdb` (reads + rewrites `umas.json`/`icons.json` in place, **not** stdout) | Uma names + outfit epithets + icon extraction. Only processes umas not already present. **Interactive**: prompts on STDIN for an English name if one isn't found in `umadle/icons.json`. |

Track names (`uma-skill-tools/data/tracknames.json`) are **hand-maintained** — there's no generator script for them.

## Skills with `iconId: "0"`

136 skills (as of the 2026-08 `master-jp.mdb` this section was written against) carry `iconId: "0"` in `skill_meta.json`. **If you're investigating this for the first time, read this whole section before changing anything** — the obvious assumptions (both "Cygames hasn't drawn the art yet" and "just add a fallback icon") are each only partly right, and re-deriving this from scratch cost a full investigation session (PIPE-2/PIPE-5, 2026-08-24).

**Why `iconId` is `"0"` — confirmed, not guessed:**

- **Decrypting the game's `meta` asset-manifest DB proves there is no icon asset for these skills at all** (PIPE-2). This isn't a gap in our extraction; `master.mdb` itself has no name to look one up by. Don't go looking for a missing icon file to extract; there isn't one.
- **Most of them (117 of 136) are not new content** — diffing the current `skill_meta.json` against the pre-refresh version (`git log -- skill_meta.json`) shows 117 of these skills previously had a real `iconId` (confirmed by `baseCost`/`groupId`/`order` being otherwise byte-identical, ruling out id reuse for unrelated content) that Cygames has since reset to `"0"`. Only 19 are genuinely brand-new skills with no prior icon. **The reason for the reset is not known** — it reads like a support-card-generation rework given the pattern (mostly small, `140`–`190`-SP-cost "training hint" skills), but that's inference, not a confirmed fact from any source. Don't assert a specific cause in code comments or docs beyond "Cygames reset it" without a better source than this investigation had.

**The fix — an effect-type-based icon guess, not a fixed placeholder:**

`components/SkillIcons.ts`'s `getSkillIconSrc()` does **not** show a single generic placeholder for every zero-icon skill. The in-game icon tracks a skill's **primary effect type**, not its name or rarity alone — e.g. among already-iconed skills, a rarity-6 skill whose first effect is `TargetSpeed` uses icon `20016` 259/324 times, but a same-rarity `Accel` skill uses `20046` instead (114/120) — two icons that look similar at a glance (both a running-figure glyph) but are genuinely different assets (flame particles vs. sparkle particles). `getSkillIconSrc()` precomputes the majority icon per `(rarity, effect type)` from every already-iconed skill once at module load (`iconByRarityAndType`, right above the function), then looks up the zero-icon skill's own `(rarity, effect type)` in that table.

This logic used to live in `components/SkillList.tsx` with the icon-type-filter prefix table duplicated separately in `SkillPicker.tsx` and `umalator/app.tsx` — a review of PR #31 found that duplication had let the same "filter/classify checks the raw, unresolved `iconId`" bug recur in a third place after the first two were fixed, so it was consolidated into one DOM-free module (`components/SkillIcons.ts`, exporting `getResolvedIconId`/`getSkillIconSrc`/`matchesIconType`) and every consumer re-pointed at it: `SkillList.tsx`, `SkillPicker.tsx`, `umalator/BasinnChart.tsx`, `umalator/app.tsx` (the Skill Chart's icon-type filter), and `umalator/components/UmasTab.tsx`'s three `<img>` render sites. Three call sites deliberately still key off the *raw* `iconId` rather than this resolved guess — `HorseDefTypes.ts`'s `isDebuffSkill`, `BasinnChart.tsx`'s `isPurpleSkill`, and `app.tsx`'s `NO_SHOW` filter — because they're semantic classifications, not display, and the resolved id is only a display guess; see the comments at each site for the reasoning and the verified today's-data counts.

**Verified against ground truth, not just against our own data.** The above (rarity, type) → icon correlations came from statistics over our *own* already-iconed skills, which risked being circular reasoning applied back onto the zero-icon skills. To check it against an independent source, a GameTora export of all 661 "Evolved"-rarity skills (`evolved.pdf`, not committed — GameTora content, regenerate from `https://gametora.com/umamusume/skills?rarity=evolved` if you need to re-verify) was spot-checked row by row against our zero-icon ids. Confirmed matches include Special Week's 強襲のラン (`100101311`, `TargetSpeed` → `20016`, correct) and two skills that would have been wrong under the old flat-per-rarity fallback: `100201311`/`111302111` are `SpeedUp`-flat-boost skills (effect type `1`, not `27`) and GameTora shows them with icon `10016` (a document glyph), not `20016` — exactly what the type-based lookup now produces, and exactly what the old code (hardcoded `20016` for every rarity-6 skill) got wrong.

**The 10-example threshold has an exception, also checked against real data.** `iconByRarityAndType` trusts a `(rarity, type)` pair's majority icon once it has ≥10 already-iconed examples, **or** at any count if every example unanimously agrees on the same icon — checked directly against the data rather than assumed: small `(rarity, type)` buckets are either fully unanimous or genuinely mixed roughly evenly, with no middle ground of "looks unanimous by chance" to worry about. This closed a real gap found via the GameTora spot-check: `107002121` (rarity 6, `PowerUp` primary effect) has only 2 already-iconed same-type examples, but both agree on `10036` — GameTora confirms `10036` is correct for the zero-icon skill too. Pairs that are still genuinely mixed at low sample counts (e.g. rarity 1, effect type 10, split 1-1) correctly fall through to the flat per-rarity default (`20013` unique / `20016` evolution / `10011` everything else) rather than guessing off a coin flip.

**If a future `master-jp.mdb` refresh finds more zero-icon skills**, no manual work is needed — `iconByRarityAndType` recomputes from whatever's in `skill_meta.json`/`skill_data.json` at build time. Only re-open this investigation if the *pattern* itself changes (e.g. a large batch of zero-icon skills in effect types that don't correlate with an icon in the existing data at all) — in that case, re-run the GameTora spot-check methodology above rather than guessing.

## Global dataset (`umalator-global/`)

`umalator-global/update.bat` is the orchestrator:

```bat
if "%1" == "" (
  set mastermdb=%APPDATA%\..\LocalLow\Cygames\Umamusume\master\master.mdb
) else (
  set mastermdb=%1
)

perl ../uma-skill-tools/tools/make_skill_data.pl %mastermdb% > skill_data.json
perl make_global_skillnames.pl %mastermdb% > skillnames.json
perl make_global_skill_meta.pl %mastermdb% > skill_meta.json
perl make_global_uma_info.pl %mastermdb%

node build.mjs
```

Run it with the **Global** client's `master.mdb` (either the default path or `update.bat <path>`).

**`make_global_course_data.pl` is deliberately not in this list** — courses change rarely, so it's run manually: `perl make_global_course_data.pl master.mdb courseeventparam`. It's byte-for-byte the same logic as the JP `make_course_data.pl`.

### How the Global scripts differ from their JP counterparts

| Concept | JP | Global | Difference |
|---|---|---|---|
| Skill effects | `uma-skill-tools/tools/make_skill_data.pl` | *(same script)* | Identical generator, different `master.mdb`. |
| Skill names | `make_skillnames.pl` → `[ja, en]` | `make_global_skillnames.pl` → `[en]` (one-element array, since it queries the Global client's `text_data` which is already English) | Consumers index `[0]`/`[1]` by language; Global falls back to `[0]`. |
| Skill meta | `make_skill_meta.pl` resolves the upgrade-chain `groupId` via two extra `LEFT JOIN`s | `make_global_skill_meta.pl` uses `s.group_id` directly | Global doesn't have the skill-upgrade system, so no chain to resolve. |
| Umas | `make_uma_info.pl` — extracts icons from `master.mdb`+`meta` DB, prompts for missing English names | `make_global_uma_info.pl` — **no icon extraction at all** (reuses JP-extracted icons), and filters candidate umas by whether their unique skill exists in `skill_meta.json` ("global for some reason has data for umas not implemented yet") | Global build ends up with roughly half the roster of JP. |
| Courses | `make_course_data.pl` | `make_global_course_data.pl` (identical logic, separate CWD) | The committed Global dataset has 119 courses versus JP's 139; Global lacks several overseas and later-added courses. |

There is also `umalator-global/convert_old_course_data.pl` — a **one-off migration script**, not part of the routine pipeline, for converting a legacy nested course-data format. It references a hardcoded sibling path (`../../skilltool/data/course_data.json`) that doesn't exist in this repo, so it isn't runnable as-is; leave it alone unless you're specifically doing a data-format migration.

## Formerly-known bugs in the pipeline scripts (fixed 2026-08-24, PIPE-1)

Both were literal one-line fixes, landed alongside a JP data refresh (PIPE-5) that needed the first one working:

- `use Encoding` → `use Encode` in both `make_uma_info.pl:14` and `uma-skill-tools/tools/make_skillnames.pl:11` — `Encoding` was never a real module (Global's `make_global_skillnames.pl` already had this right). **Verified end-to-end**: `make_skillnames.pl` ran successfully against a real `master.mdb`.
- `make_uma_info.pl:29`: `$root . "./meta"` → `$root . "/meta"`. **Fixed by inspection only, not verified by a run** — `make_uma_info.pl` still can't complete end to end; see the next two sections for why.

`make_uma_info.pl` remains blocked by two things unrelated to the two bugs above: `File::Slurper` isn't installed in every environment this pipeline gets run from (an environment gap, not a code bug), and the encrypted `meta` asset DB it needs. **The next section only unblocks `extract_resource.pl`, not this script** — `make_uma_info.pl:29` hardcodes the literal filename `meta` with no way to point it at `decrypt-meta-db.mjs`'s `<input>.decrypted` output, so decrypting `meta` doesn't by itself let `make_uma_info.pl` run (PIPE-2 review, 2026-08-25) — someone would need to either overwrite `meta` in place with the decrypted copy (defeating `decrypt-meta-db.mjs`'s own "never touch the original" design) or add a CLI override to this script, neither of which has been done. Combined with the still-open `File::Slurper` gap, `make_uma_info.pl` remains fully blocked either way.

## Asset extraction against the current game client (PIPE-2)

The game's `meta` asset-manifest DB is encrypted in current game clients, and this fork's `extract_resource.pl` still assumes a plain, unencrypted `meta` DB — it opens it with a bare `DBI->connect` and merely writes an undecrypted `.key` sidecar for each row. As of 2026-08-24 this is unblocked by a separate decrypt step rather than a change to `extract_resource.pl` itself:

```
scripts/decrypt-meta-db.mjs <encrypted-meta> [output]
    -> a plaintext SQLite file (default: <input>.decrypted)

extract_resource.pl <decrypted-meta> <LIKE-query>
    -> need_unpack/  (raw, still-packed asset bundles + .key files for encrypted ones)

scripts/extract-assets.py --dat <dat-dir> --hash <H> --key <e-column-value> --out <dir>
    -> PNGs (handles the per-asset AB XOR layer + UnityPy unpacking in one step;
       an alternative to the need_unpack/ + external-unpacker + move_unpacked_resources.pl
       flow above when you already have a decrypted meta DB and dat/ blobs to hand)
```

**The cipher is ChaCha20 (sqleet/SQLite3MultipleCiphers), not SQLCipher** — confirmed from `meta`'s own file header: bytes 16 onward (page size, format version, reserved-space byte) are valid plaintext SQLite header fields; only the first 16 bytes are replaced with a random salt, and each page carries 32 reserved bytes (16-byte nonce + 16-byte Poly1305 tag). SQLCipher encrypts the whole first page including those header fields; sqleet does not. `scripts/decrypt-meta-db.mjs` uses `better-sqlite3-multiple-ciphers` (a maintained drop-in Node binding for exactly this cipher family) rather than hand-rolling a page-level KDF — install it yourself before running the script (`npm i -D better-sqlite3-multiple-ciphers`; deliberately not a `package.json` dependency, same reasoning as this pipeline's undeclared Perl modules).

**Verified end-to-end 2026-08-24, re-verified 2026-08-25** against a real `master-jp.mdb` + `meta` + `dat/` from a Windows client install: decrypted `meta` (364,706 rows), extracted the previously-missing outfit `114101` (エピファネイア) icon, and re-extracted an already-committed icon (`icons/chara/chr_icon_1001.png`) for a pixel diff against the original. Quantified on the 2026-08-25 re-verification rather than described qualitatively: mean per-channel diff 2.2/255 (~0.9%), zero-shift confirmed as the *optimal* alignment via an exhaustive ±3px search (rules out a crop/offset bug), and an amplified diff visualization shows the nonzero pixels tracing every outline in the artwork (hair strands, eyes, collar, the circular mask) — not confined to the mask border alone, as an earlier pass through this same data had characterized it. Still no misalignment and no wrong content, just antialiasing/interpolation rounding at every edge in the image, not only the outer border. `extract_resource.pl` opens the decrypted output without modification, confirming the plaintext-sibling design actually unblocks that script (though not `make_uma_info.pl` — see above).

**The per-asset XOR layer** (applied to bundle bytes past offset 256, keyed by the `meta` row's `e` column) is reimplemented in `scripts/extract-assets.py`, adapted alongside texture/sprite extraction logic from `rockisch/umamusu-utils` (MIT) — see that script's header comment for the attribution and the key-derivation sourcing.

**The CDN download route is a mixed result — read this before assuming it replaces a game install.** `scripts/download-game-assets.mjs` can fetch files from the CDN by hash, and this is **confirmed working for `master.mdb` refreshes** (the `Generic` endpoint — proven with a real download, LZ4-frame compressed, matching `forceDownloadMasterDb`'s approach) **and for `Manifest`-kind rows**, meaning `master.mdb` itself can be refreshed with no game install at all. It is **confirmed NOT working for individual asset bundles** (icons, textures) under the `Windows/assetbundles` endpoint — every hash tried 404s, including ones independently confirmed present in a real client's `dat/` folder, so this isn't resource-version staleness on an old `meta` snapshot; the endpoint just doesn't serve individual bundles this way (at minimum a missing resource-version path segment or session-scoped auth, not yet found). **Until someone finds the missing piece, individual asset/icon extraction requires a real client install's `dat/` folder**, copied in alongside `meta`/`master.mdb` the same way this fork already handles those two files.

**Until decryption is available to you, if game data just looks stale (missing umas/skills/courses) rather than needing this whole pipeline run, see `scripts/sync-upstream-data.mjs`** — it ports already-computed data from a local checkout of `alpha123/uma-tools` instead of extracting from a live client. It's a stopgap for exactly this gap, not a replacement for the pipeline above.

**`sync-upstream-data.mjs` is not a viable catch-up path for JP engine skill data specifically** — confirmed 2026-08-24: `alpha123/uma-skill-tools`'s own `data/skill_data.json` was itself stuck at the same 2026-03-12 commit this fork's copy was, so there was nothing newer for the sync script to port. Regenerating from a fresh `master.mdb` (see the JP dataset section above) is the only real fix once alpha123 is also stale — this is exactly what happened here (+156 skills, 86 changed, one real engine regression found and fixed).

## Adding not-yet-released Global umas ahead of `make_global_uma_info.pl`'s filter

`make_global_uma_info.pl`'s guard above (skip any uma whose unique skill isn't in `skill_meta.json` yet) is deliberate — the Global client's own `master.mdb` routinely carries `text_data` rows (epithets, character names, unique-skill names) for umas that are staged but not live. `scripts/add-staged-global-umas.mjs` is a separate, narrower script that intentionally bypasses that guard: it reads the Global `master.mdb`'s already-official English text for such umas, pairs it with the mechanics JP already has (`skill_meta.json` / `uma-skill-tools/data/skill_data.json`), and writes them into `umalator-global/{umas,skill_meta,skill_data}.json` plus `umalator-global/unreleased.json` (the list the app's "Show Unreleased Umas" Settings toggle filters on — off by default, so the visible roster still matches what's actually playable unless a user opts in).

The script also syncs each ported unique's **inherited variant** — a separate skill row (id: the base unique's leading `1` swapped for `9`) with its own `baseDuration`/modifiers/`baseCost`/`iconId`, not derivable from the base row. This needs the same JP→Global port as the base unique, since it's what makes the skill selectable on a *different* uma in the picker (`Object.keys(skill_data.json)` is the picker's whole candidate universe — a base-only port leaves the unique visible on its own uma but silently unfindable as an inherited skill anywhere else). The sweep runs over every base unique *this script already tracks as JP-sourced* (not every base unique in Global `skill_data.json` — an unconditional sweep would silently write JP-sourced mechanics for an already-live, Global-authoritative uma's inherited twin too, bypassing the "Show Unreleased Umas" toggle; fixed during PR review, see the script's own header comment), so it's idempotent and self-healing for exactly the entries this script is responsible for.

Since neither `master.mdb` nor any JSON here carries a real "not released yet" release-order field (`chara_data.start_date` is a `2524608000`/2050 sentinel for anything unreleased), the cutoff for *how far* to add is a **hand-maintained table**, `scripts/data/global-release-order.json`, mapping outfit id → the JP implementation date it actually shipped on (Global has historically replayed JP's rollout order unchanged, so this doubles as the expected Global order too). The table also covers outfits already in `umalator-global/umas.json` that turn out not to be live yet — the script cross-checks `chara_data.start_date` against it and warns if a roster outfit's character is sentinel-dated but uncovered, which is how an earlier gap (Hokko Tarumae, added to the roster without ever being added to `unreleased.json`) was caught. Extending this to a later batch means adding more rows to that table from a JP implementation-date source (see the file's own header comment), then re-running the script with a later `--until` date — not guessing.

Add-only, dry-run-by-default, same conventions as `sync-upstream-data.mjs` above. Guarded against overwriting an existing Global-authoritative entry (checks `umalator-global/unreleased.json`'s `provenance` map — see below — before writing; `--force` overrides).

## JP and Global are independent datasets, not one dataset at two ages

JP rebalances skills (thresholds, durations, even wholesale condition rewrites) and revises course geometry on its own schedule; Global does not inherit those changes automatically, ever — the two `master.mdb`s are genuinely different games' worth of data, related only by having started from a common source. Measured 2026-08-24 (PIPE-5): of the ids shared between the two datasets, 91/737 `skill_data`, 11/737 `skill_meta`, and 9/119 `course_data` entries already disagree. **This is expected steady state, not a bug to reconcile** — don't "fix" a shared-id divergence by copying one side's value onto the other without checking which side is actually authoritative for that id.

The one exception: outfits/skills staged into Global ahead of release via `scripts/add-staged-global-umas.mjs` above genuinely are JP-sourced (there's no Global-native value yet to be authoritative). `umalator-global/unreleased.json`'s `provenance` map records which Global entries are in this state — `{ "<skillId>": { source: "jp", jpSkillDataCommit } }` — and is the signal both the overwrite guard above and `scripts/check-jp-global-divergence.mjs` key off of. Run the latter to see the current shared-id divergence numbers plus, more actionably, whether any JP-sourced Global entry has gone stale relative to current JP data (i.e. JP moved since it was staged). It caught a real case on its first run: `100661`/`900661`. There is currently no path that *refreshes* an already-staged entry once it goes stale, only one that adds new ones — the overwrite guard above deliberately protects against clobbering Global-authoritative data, and re-syncing a stale JP-sourced entry needs a different code path than "add" (tracked internally, not yet built).
