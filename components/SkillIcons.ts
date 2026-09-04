// Zero-icon (`iconId: "0"`) fallback resolution and icon-type-filter matching, shared by every
// UI surface that renders or filters skill icons. Deliberately DOM-free (no Preact import) so a
// non-component consumer -- currently umalator/app.tsx's Skill Chart filter -- can use it too.
//
// PIPE-2 review (round 2): this logic used to be duplicated three times (SkillList.tsx,
// SkillPicker.tsx, umalator/app.tsx each had their own copy of the prefix table and match
// function). All three copies were byte-identical, and one of the three was still checking the
// raw, unresolved iconId when the other two were fixed in round 1 -- exactly the kind of miss
// three independent copies invite. Consolidated here so there's only one place to fix next time.

import skillmeta from '../skill_meta.json';
import skilldata from '../uma-skill-tools/data/jp/skill_data.json';
import { SkillRarity } from '../uma-skill-tools/RaceSolver.ts';

// The in-game icon for a skill tracks its primary effect type, not its rarity or name -- e.g.
// a rarity-6 skill whose first effect is TargetSpeed almost always uses icon 20016 (259/324
// already-iconed examples), but a same-rarity Accel skill almost always uses 20046 instead
// (114/120) -- confirmed both from our own already-iconed data AND by spot-checking a GameTora
// export of all 661 "Evolved" skills against their actual in-game icons (PIPE-2, 2026-08-24):
// e.g. 100201311/111302111 are TargetSpeed-flat-boost skills (effect type 1, not 27) and
// GameTora shows them with icon 10016 (a document glyph, not the 20016 running-figure), while
// 114101111/114101211 (Epiphaneia's evolved skills, real type-27 TargetSpeed) do show 20016 as
// expected. A single fixed icon per rarity is wrong whenever a zero-icon skill's type isn't the
// rarity's dominant one -- this previously happened for Unique/Evolution specifically (hardcoded
// to 20013/20016 unconditionally). Precompute the majority icon per (rarity, effect type) from
// the skills that already have one, once at module load, so the zero-icon fallback below can
// guess a same-type icon instead of a fixed, often visually-unrelated one.
const iconByRarityAndType: Record<string, string> = (() => {
	const counts: Record<string, Record<string, number>> = {};
	for (const id of Object.keys(skilldata)) {
		const s = skilldata[id];
		const iconId = skillmeta[id]?.iconId;
		if (!iconId || iconId === '0') continue;
		const type = s.alternatives[0]?.effects[0]?.type;
		if (type === undefined) continue;
		const key = `${s.rarity}:${type}`;
		if (!counts[key]) counts[key] = {};
		counts[key][iconId] = (counts[key][iconId] ?? 0) + 1;
	}
	const result: Record<string, string> = {};
	for (const key of Object.keys(counts)) {
		const entries = Object.entries(counts[key]);
		const total = entries.reduce((sum, [, c]) => sum + c, 0);
		// Require enough real examples to trust the majority -- OR every example agreeing
		// regardless of count, since unanimous small samples are a low-noise signal (if the
		// mapping were random, they wouldn't all happen to land on the same icon). This was
		// checked, not assumed: most small (rarity, type) buckets in the real data (<10
		// examples) are either fully unanimous or genuinely split roughly evenly -- there's no
		// middle case of "looks unanimous by chance." A confirmed real case: rarity 6 + PowerUp
		// (type 3) has only 2 already-iconed examples, both icon 10036 -- unanimous despite the
		// low count, and independently confirmed correct against GameTora for the zero-icon
		// skill this maps to (107002121, PIPE-2 2026-08-24).
		if (total < 10 && entries.length > 1) continue;
		entries.sort((a, b) => b[1] - a[1]);
		result[key] = entries[0][0];
	}
	return result;
})();

// A handful of skills carry iconId "0" straight from master.mdb -- master.mdb itself never
// assigned them a dedicated icon graphic (confirmed against the game's meta asset-manifest
// DB, PIPE-2: there is no icon asset named for these ids to extract in the first place),
// even though their mechanics are final (see docs/data-pipeline.md's JP/Global independence
// note). `/uma-tools/icons/0.png` doesn't exist, so fall back to a generic placeholder --
// prefer iconByRarityAndType's same-type-and-rarity guess (verified accurate against a
// GameTora export, see the comment above); fall back further to a rarity-matched flat
// placeholder only when there isn't enough same-(rarity,type) data to trust a guess, so the
// colour family (white/gold/pink/unique/inherit) still reads correctly instead of every
// zero-icon skill flattening to a single generic icon.
//
// Returns the bare icon id (not a path) -- both getSkillIconSrc (the <img> src) and
// matchesIconType (the icontype filter below) need this same resolved value. Checking the raw
// skillmeta[id].iconId instead of this resolved id was a real, recurring bug (PIPE-2 review,
// rounds 1 and 2): since iconId is genuinely "0" for 136 skills, none of ICON_ID_PREFIXES'
// prefixes ever matched, so every one of those skills silently failed every icontype filter (or
// rendered a broken /uma-tools/icons/0.png) as soon as one was active.
//
// Guards skillmeta[id]/skilldata[id] existence rather than assuming both are present (PIPE-2
// review, round 3): skill_meta.json and skill_data.json are generated by two independent .pl
// scripts against the same master.mdb, and today their key sets are byte-identical (verified
// 2119/2119 JP, 737/737 Global) -- but that's a fact about today's data, not a guarantee this
// function can lean on. A future partial/out-of-sync regen producing a skillmeta id with no
// matching skilldata entry (or no skillmeta entry at all, reaching this function through a
// caller that doesn't already check -- e.g. BasinnChart.tsx's SkillNameCell calls
// getSkillIconSrc(id) with no guard of its own) would otherwise throw here and crash whatever
// UI surface tried to render it, rather than falling back to a generic icon like every other
// unrecognized-skill case already does.
export function getResolvedIconId(id: string): string {
	const meta = skillmeta[id];
	if (!meta) return '10011';
	const iconId = meta.iconId;
	if (iconId !== '0') return iconId;
	const skill = skilldata[id];
	if (!skill) return '10011';
	const rarity = skill.rarity;
	const type = skill.alternatives[0]?.effects[0]?.type;
	const byType = iconByRarityAndType[`${rarity}:${type}`];
	if (byType) return byType;
	// Matches SkillPicker.tsx's matchRarity 'unique' range (r > Gold && r < Evolution, i.e.
	// rarities 3-5) rather than an exact SkillRarity.Unique (=3) check -- PIPE-2 review found
	// the narrower check silently mis-colors a rarity-4/5 zero-icon skill that also misses the
	// iconByRarityAndType lookup above. No such skill exists in today's data (this is currently
	// unreachable), but a future data refresh could produce one.
	if (rarity > SkillRarity.Gold && rarity < SkillRarity.Evolution)
		return '20013';
	if (rarity === SkillRarity.Evolution) return '20016';
	return '10011';
}

export function getSkillIconSrc(id: string): string {
	return `/uma-tools/icons/${getResolvedIconId(id)}.png`;
}

// they really just gave up with the ids for scenario pinks
export const ICON_ID_PREFIXES = Object.freeze({
	'1001': ['1001'],
	'1002': ['1002', '2018'],
	'1003': ['1003'],
	'1004': ['1004'],
	'1005': ['1005'],
	'1006': ['1006'],
	'2002': ['2002', '2011', '2028'],
	'2001': [
		'2001',
		'2010',
		'2014',
		'2015',
		'2016',
		'2019',
		'2021',
		'2022',
		'2024',
		'2026',
		'2029',
		'2031',
		'2032',
		'2033',
	],
	'2004': ['2004', '2012', '2017', '2020', '2025', '2027', '2030'],
	'2005': ['2005', '2013'],
	'2006': ['2006'],
	'2009': ['2009'],
	'3001': ['3001'],
	'3002': ['3002'],
	'3004': ['3004'],
	'3005': ['3005'],
	'3007': ['3007'],
	'4001': ['4001'],
});

// Single shared icon-type-filter predicate for every consumer (skill list, skill picker, Skill
// Chart). Resolves the icon id the same way getSkillIconSrc does before matching, and returns
// false for a skill id with no skillmeta entry at all (distinct from iconId "0", which
// getResolvedIconId already handles).
//
// This guard is about filter-matching semantics, not crash safety (getResolvedIconId is safe on
// its own regardless, including for a missing skillmeta entry -- see its own comment): a truly
// unrecognized skill id shouldn't silently match whatever icon type the generic '10011'
// placeholder happens to fall under, it should just never match any filter. Checking
// `skillmeta[skillId]` presence rather than the old per-file `!meta?.iconId` (any falsy iconId)
// is narrower in theory -- a present-but-empty-string iconId would now reach the resolver instead
// of failing fast here -- but verified unreachable in today's data (0 such values in either
// dataset), and getResolvedIconId's own guard means it can't crash on one either way.
export function matchesIconType(skillId: string, iconType: string): boolean {
	if (!skillmeta[skillId]) return false;
	const resolvedIconId = getResolvedIconId(skillId);
	return (
		ICON_ID_PREFIXES[iconType]?.some((p) => resolvedIconId.startsWith(p)) ??
		false
	);
}

// Same as matchesIconType, but resolves the skill's icon id once and tests it against every
// requested type -- for a caller (like umalator/app.tsx's Skill Chart filters) that checks the
// same skill against several active icon types in a loop. matchesIconType(id, t) called once per
// type re-resolves per call, which repeats getResolvedIconId's heavier zero-icon fallback work
// (a skilldata lookup + an iconByRarityAndType lookup) up to once per type instead of once per
// skill (PIPE-2 review, round 3).
export function matchesAnyIconType(
	skillId: string,
	iconTypes: Iterable<string>,
): boolean {
	if (!skillmeta[skillId]) return false;
	const resolvedIconId = getResolvedIconId(skillId);
	for (const iconType of iconTypes) {
		if (ICON_ID_PREFIXES[iconType]?.some((p) => resolvedIconId.startsWith(p)))
			return true;
	}
	return false;
}
