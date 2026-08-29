# `master.mdb` schema notes

This page is schema *reference* — which tables join to which inside the game client's `master.mdb`, for the specific question of "which unique skill belongs to which costume, and how does it evolve." It is not a regeneration runbook; see `docs/data-pipeline.md` for that, including the naming convention for local copies of `master.mdb`/`meta`/`dat/` referenced throughout this page.

> Verified against a real `master_jp.mdb` (44.5MB, 627 tables) and `master.mdb` (16.5MB Global, 416 tables) on 2026-08-28, via direct `sqlite3` queries (`sqlite3 master_jp.mdb` — bundled on macOS, no install needed; see `uma-skill-tools/CLAUDE.md` for the documented method). Facts below are cited by table/column, not restated from looser phrasing — re-verify with a fresh query if a client update changes the schema.

## Two id namespaces that collide

`card_data.id` (an outfit/costume id) and `skill_data.id` (a skill id) are **separate, colliding numeric namespaces**. `101001` is simultaneously Taiki Shuttle's "Wild Frontier" outfit id and coincidentally looks like a plausible skill id; `100101` is confusable between costumes and skills belonging to entirely different characters. This is not a hypothetical concern — it's exactly how a real investigation went wrong: a correct identification of skill `110101` ("Joyful Voyage!") as Taiki Shuttle's Camping-costume unique was wrongly retracted mid-investigation, on the basis of a numeric resemblance to an unrelated id, rather than checked against the real join below.

**The rule:** never infer skill ownership, or any other cross-table relationship, from numeric resemblance between ids. Always go through a real join, or (for the specific id-formula case in §3) a convention that's been explicitly verified against the data.

## Outfit → base unique skill

The join from a costume/outfit id to its base unique skill is three hops, and **must filter to `rarity >= 3`**:

```sql
SELECT c.id AS outfit, s.skill_id1 AS unique_skill
  FROM card_data c
  JOIN card_rarity_data r ON r.card_id = c.id
  JOIN skill_set        s ON s.id      = r.skill_set
 WHERE r.rarity >= 3;
```

Dropping the `rarity >= 3` filter silently returns the wrong skill for 31 JP rows / 25 Global rows: rarity 1-2 rows belong to R-cards and point at a *different, weaker* pre-awakening unique skill than the same costume's rarity ≥3 row does.

Verified table for Taiki Shuttle's three JP outfits:

| Outfit (`card_data.id`) | Unique skill (`skill_data.id`) | Name |
|---|---|---|
| `101001` (Wild Frontier) | `100101` | Victory Shot! |
| `101002` (Camping) | `110101` | Joyful Voyage! |
| `101003` | `120101` | Have S'more Love! |

## The id formula this repo already depends on

Within the rarity≥3 rows above, `skill_id1` follows an observed pattern:

```
skill_id1 = 100000 + (outfit_num - 1) * 10000 + (chara_id - 1000) * 10 + 1
```

verified with **zero mismatches** at rarity ≥3 across both the JP and Global databases. This is a convention baked into how ids were assigned, **not a foreign key** — it happens to hold everywhere it's been checked, but §2's join is the ground-truth fallback if it's ever wrong for a case not yet checked.

Three production sites already derive this formula instead of joining, so a future reader knows exactly what breaks if the convention is ever violated:

- `components/HorseDef.tsx`'s `uniqueSkillForUma` — confirmed to match this formula exactly.
- `umalator-global/make_global_uma_info.pl:37-41`
- `scripts/add-staged-global-umas.mjs:139`

## Unique-skill evolution (JP only)

A costume's evolved unique-flavor skill evolves from that card's **awakening skill**, not from its base unique skill — the second thing the original investigation got wrong (an evolved-tier skill was handed over when the question was about the base unique).

```sql
SELECT p.card_id, p.rank, p.skill_id
  FROM skill_upgrade_description p
  JOIN available_skill_set a
    ON p.card_id = a.available_skill_set_id AND p.rank = a.need_rank;
```

`skill_upgrade_description(id, card_id, rank, skill_id, start_date)` has 614 rows across 264 distinct `card_id`s in JP, with `rank` ∈ {3, 5, 7}. This is the exact join `make_skill_meta.pl` already performs internally (see §5).

Verified table, Taiki Shuttle's Wild Frontier outfit (`card_id` `101001`):

| Rank | Awakening skill evolved from | Evolved skill |
|---|---|---|
| 3 | `201051` ギアチェンジ | `101001111` 狙い撃ちデス！ |
| 5 | `200681` | `101001211` Frontier Spirit |

A costume's evolved unique-flavor skills are evolved *awakening* skills wearing unique-style names — the base unique (Victory Shot!, etc.) is a separate skill entirely and does not itself evolve.

## What the generators do with this today

`make_skill_meta.pl` performs the §4 join, but only to `COALESCE` a `group_id` for the UI's mutual-exclusivity logic — `card_id`/`rank` are computed and discarded before anything reaches `skill_meta.json`. `card_data`, `card_rarity_data`, and `skill_set` (the §2 join's tables) are read by nothing in this repo's generators today. `skill_upgrade_speciality` (scenario-linked upgrades, has an explicit `base_skill_id` column) is already joined by `make_skill_meta.pl`; `skill_upgrade_succession_skill` (3 rows, inherited-unique renames) is not.

## Global vs JP

Global's `skill_upgrade_description` and `skill_upgrade_condition` tables exist but are **empty**; `skill_upgrade_speciality` and `skill_upgrade_succession_skill` don't exist in the Global schema at all. The unique-skill evolution mechanic described in §4 is JP-only in this data — there is nothing to port for Global today.

## Open questions (explicitly unverified)

- `skill_upgrade_condition`'s non-FK columns: `upgrade_type` was `1` in every sampled row, and no lookup table was found describing what other values would mean.
- `skill_data.unique_skill_id_2`'s semantics: in some rows it points at a skill with a name that doesn't obviously correspond to `unique_skill_id_1`'s target. Not investigated further — flagging so a future investigation doesn't assume it's a simple alternate-id column without checking.
