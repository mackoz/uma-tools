# Syncing game data from upstream

This fork's committed game data (umas, skills, courses, icons) can fall behind — it only updates when someone runs the data pipeline against a current game client, and this fork's own pipeline currently **can't** do that against the live client (see [Limitations](#limitations)). Meanwhile [`alpha123/uma-tools`](https://github.com/alpha123/uma-tools) keeps updating on its own schedule.

This page documents a stopgap: `scripts/sync-upstream-data.mjs` ports whatever's new in a local upstream checkout into this fork's JSON, converting schema where the two have diverged. It's not a substitute for the real pipeline (see [docs/data-pipeline.md](data-pipeline.md)) — it only moves data upstream has *already* computed, in the shape upstream computed it.

## When to reach for this

Game data looks stale (a released uma/skill/course is missing) and you don't have a current `master.mdb` handy, but you can get a local upstream checkout. This is the common case right now, since this fork's asset extraction is broken against the current (encrypted) game client — see [data-pipeline.md](data-pipeline.md#this-forks-asset-extraction-is-broken-against-the-current-game-client).

## Setup

```sh
git clone https://github.com/alpha123/uma-tools ../uma-tools-og
cd ../uma-tools-og
git submodule update --init uma-skill-tools
cd uma-skill-tools && git fetch origin
```

The last step matters: upstream's own `uma-tools` checkout pins `uma-skill-tools` (the JP engine data source) at a commit that can be months stale relative to the engine repo's own history — the same trap documented in [upstream-comparison.md](upstream-comparison.md#the-comparison-has-three-reference-points-not-two). This script defaults to comparing JP engine data (`uma-skill-tools/data/*.json`) against `origin/master` of the engine repo, not the pinned submodule commit, which is why the `git fetch` is needed.

If you already have an upstream checkout from a previous sync, just `git -C ../uma-tools-og pull` and re-fetch the engine repo before running the script again.

## Running it

```sh
cd uma-tools   # this repo
node scripts/sync-upstream-data.mjs --upstream ../uma-tools-og                # dry run — report only
node scripts/sync-upstream-data.mjs --upstream ../uma-tools-og --no-dry-run   # write changes
```

Always dry-run first and read the report before writing. It covers 12 file-pairs: Global umas/skill_meta/skill_data/course_data/tracknames (`umalator-global/`), JP umas/skill_meta/icons (repo root), and JP engine skill_data/skillnames/course_data/tracknames (`uma-skill-tools/data/`, compared against `--engine-ref`, default `origin/master`).

For each file it reports two numbers:

- **New keys** — present upstream, absent in this fork. These get added.
- **Shared keys that diverge in value** — present in both, but not equal after stripping the schema differences described below. **These are never touched.** See [Known, deliberately-unsynced differences](#known-deliberately-unsynced-differences) — some are real, upstream is not automatically "more correct."

After a real run: rebuild the three apps with a `build.mjs` (data changes don't take effect until rebuilt and committed — same rule as any other data-pipeline run, see `CLAUDE.md`):

```sh
cd umalator && node build.mjs
cd ../umalator-global && node build.mjs
cd ../skill-visualizer-global && node build.mjs
```

Then commit the data files, the new icon PNGs, and the rebuilt bundles together.

## What it does and doesn't touch

**Strictly additive.** The script only ever adds a key that doesn't already exist in the fork's JSON — for umas, that includes adding a missing *outfit* to an uma the fork already has, not just whole new umas (this is easy to miss with a naive top-level-key diff; a good chunk of what's "missing" on a given sync turns out to be new alt costumes on existing umas, not new umas). It never overwrites or deletes an existing key, even when the value differs from upstream's.

**Schema downgrades applied when adding a new entry**, because this fork's own generator scripts produce a narrower schema than upstream's now do (see [upstream-comparison.md](upstream-comparison.md) for why):

- Uma outfits: upstream's `{epithet, aptitudes, awakenings, rarity, strategy}` object → this fork's bare epithet string. The aptitudes/awakenings/rarity/strategy data is simply **not carried over** — this fork's `make_uma_info.pl` never extracts it, so there's nowhere for it to go. If you want it, that's a source change to the Perl script, not something this script can produce.
- `skill_meta`: drops `score`. Keeps `groupId`/`iconId`/`baseCost`/`order` verbatim from upstream — including upstream's upgrade-chain-folded `groupId`, which is *more* correct than this fork's own un-folded scheme, so it's kept as-is rather than reverse-engineered back to this fork's convention. (Meaning: newly-synced entries and this fork's older entries won't have visually consistent `groupId` numbering. That's fine — nothing compares it against a hardcoded format, it's only used for matching within the dataset.)
- `skill_data` effects: drops `tags`, `wisdomCheck`, `durationScaling`, `scaling`. Keeps `condition`/`precondition`/`baseDuration`/`effects[].{type,modifier,target}`/`rarity` verbatim.
- `icons.json`: upstream's outfit-keyed entries are `[gray-border, normal]` trained-icon pairs (added upstream after the fork point); this fork's are a single string. New entries take the second (`_02`, normal) element only, converting from upstream's bare basename to this fork's `/uma-tools/icons/chara/<name>.png` absolute-path convention. The corresponding PNG is copied from `<upstream>/icons/chara/` into this repo's `icons/chara/`.

**Formatting:** the script preserves each file's existing indent style (tab vs N-space vs minified) and line-ending convention (this repo's data files are a mix of LF and CRLF — yes, really) so a sync's diff is mostly just the new content. It can't perfectly reproduce every generator script's exact pretty-printing quirks (a couple of files, notably `umalator-global/course_data.json`, use a non-uniform indent step that doesn't map cleanly onto a single indent width), so those files' diffs come out larger than the actual content change — this is cosmetic, not a sign of corruption. If you want to confirm, diff the file against its own history with `--ignore-all-space` or just spot-check that old keys are byte-identical.

## Known, deliberately-unsynced differences

The "shared keys that diverge in value" the script reports are not simply "upstream is ahead, sync it." A few categories, found while first building this script (checked against a fork HEAD from 2026-07 vs upstream `cdb7ead`/engine `8b3f5e2` — re-check current numbers with a dry run, don't trust these counts to still be exact):

- **`umalator-global/course_data.json`: 105 of 107 shared courses differ**, all in minor ways — a handful of meters on a corner or straight boundary (e.g. course `10507`'s corner length `250` vs upstream's `240`, straight start `3300` vs `3290`). This is **not understood** — it could be a rounding/precision difference between this fork's `make_global_course_data.pl` and whatever upstream uses to produce its Global course data (upstream's own app repo doesn't have an equivalent script — see [upstream-comparison.md](upstream-comparison.md) — so its `course_data.json` may come from a different generation path entirely). Flagged here rather than resolved; don't silently pick one side without investigating further, since it'd need cross-referencing against actual in-game data to know which is right.
- **A cluster of skills with `phase==0` (this fork) vs `always==1` (upstream)** in their condition string, plus modifier values differing by a consistent ~25x on a `distance_rate_after_random` skill cluster. These look like two *different* fixes to the same underlying condition-generation logic, made independently on each side after the fork point (the same kind of convergent-but-different evolution documented at [upstream-comparison.md#where-both-converged-independently](upstream-comparison.md#where-both-converged-independently) for the race solver). Needs investigation before touching either side.
- **A consistent ×1.2 modifier scaling on `phase_random`-conditioned skills** (this fork's values are upstream's × 1.2). This one *is* understood — it's this fork's deliberate scenario-skill scaling hack, documented in [data-pipeline.md](data-pipeline.md) (`make_skill_data.pl`'s `%split_alternatives`-adjacent scenario list). Upstream doesn't apply it. **Do not sync this away** — it's intentional fork behavior, not upstream catching up on a fix.
- **`groupId` folding**, already covered above — expected, not a bug.

If you're looking at a dry-run report and a file shows a large "diverge in value" count, check here first before assuming something's broken.

## Limitations

- **This only moves already-computed values.** It can't backfill anything upstream hasn't extracted or computed itself, and it can't upgrade this fork's schema (aptitudes, awakenings, `score`, `tags`, etc.) — that requires changing the generating Perl scripts, per the normal rule in `CLAUDE.md` (never hand-edit the generated JSON; edit the script and regenerate). This script is explicitly an exception to "regenerate from the script" made necessary by the fact this fork's script can't run against a current client at all right now.
- **Doesn't fix asset extraction.** New umas/skills that need icons upstream *hasn't* extracted yet won't be pulled in by this (there's nothing to copy) — see [data-pipeline.md](data-pipeline.md#this-forks-asset-extraction-is-broken-against-the-current-game-client).
- **Not a substitute for running the real pipeline** against a current `master.mdb` once this fork's `extract_resource.pl` can handle the encrypted client — that's the actual fix, this is a way to not fall further behind in the meantime.
