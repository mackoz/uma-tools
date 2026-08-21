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
| `make_skill_meta.pl` (repo root) | `make_skill_meta.pl master.mdb > skill_meta.json` | Presentation/economy metadata: `{ "<id>": { groupId, iconId, baseCost, order } }`. Resolves `groupId` through the **skill-upgrade chain** (`skill_upgrade_speciality` + `skill_upgrade_description`/`available_skill_set`) so an upgraded skill and its base share a group and are treated as mutually exclusive in the UI. |
| `make_uma_info.pl` (repo root) | `make_uma_info.pl master.mdb` (reads + rewrites `umas.json`/`icons.json` in place, **not** stdout) | Uma names + outfit epithets + icon extraction. Only processes umas not already present. **Interactive**: prompts on STDIN for an English name if one isn't found in `umadle/icons.json`. |

Track names (`uma-skill-tools/data/tracknames.json`) are **hand-maintained** — there's no generator script for them.

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

## Known bugs in the pipeline scripts

- **`use Encoding` should be `use Encode`** in both `make_uma_info.pl:14` and `uma-skill-tools/tools/make_skillnames.pl:11` — there is no `Encoding` module, so both scripts die at compile time as currently written. (Global's `make_global_skillnames.pl` correctly uses `Encode`.)
- **Malformed path** in `make_uma_info.pl:29`: `my $meta = $root . "./meta";` produces something like `.../Umamusume./meta` — the missing path separator needs fixing before this script can locate the asset-manifest DB.

If you're actually running this pipeline, fix those two lines first.

## This fork's asset extraction is broken against the current game client

The game's `meta` asset-manifest DB is encrypted in current game clients (chacha20 on the SQLite file itself, plus a per-asset XOR keystream applied past byte offset 256) — this fork's `extract_resource.pl` still assumes an unencrypted `meta` DB and merely writes an undecrypted `.key` sidecar. **Icon/asset extraction (the flow above) will not work against a current client's data until this fork adds decryption logic for both layers.** Regenerating JSON from an already-decrypted/legacy dataset is unaffected.

**Until that's fixed, if game data just looks stale (missing umas/skills/courses) rather than needing this whole pipeline run, see `scripts/sync-upstream-data.mjs`** — it ports already-computed data from a local checkout of `alpha123/uma-tools` instead of extracting from a live client. It's a stopgap for exactly this gap, not a replacement for the pipeline above.
