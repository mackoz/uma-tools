// Pure logic for the Skill Chart's "Shop skills" shortlist filter (UI-27): narrows the chart's
// candidate pool to a hand-picked set of skills -- the ones a career run's shop screen is
// actually offering -- instead of ranking the whole activateable pool.
//
// Kept import-free (no Preact, no CSS, no JSON) so it's plain-node testable, matching
// chartLadder.ts and statisticalAnalysis.ts. umalator/app.tsx owns all the JSON imports
// (skill_data.json via getActivateableSkills, etc.) and passes plain values in here.

// Whether the shortlist should actually narrow the candidate pool. UI-28 dropped the separate
// enabled/disabled toggle ("parked" state) -- a non-empty shortlist is now always active.
export function isShopFilterActive(ids: string[]): boolean {
	return ids.length > 0;
}

// Intersects the chart's own candidate pool with the shortlist, preserving the CANDIDATE pool's
// order (not the shortlist's) -- callers downstream (the ladder, the table) expect the same
// ordering convention applyShopFilter's caller already produces for the rarity/icon-type filters.
// A shortlisted id that isn't in `candidates` (not proc-able on this course/style, or excluded as
// a purple/character-unique/hidden-unreleased skill) is silently dropped here -- the UI surfaces
// that separately via partitionShopSkills's `wontProc`, not as a run-time error.
export function applyShopFilter(candidates: string[], ids: string[]): string[] {
	const allow = new Set(ids);
	return candidates.filter((id) => allow.has(id));
}

// Whether the Skill Chart's shop-filter state has drifted from what the last run actually
// evaluated, i.e. whether pressing Run again would produce a different candidate set.
//
// This intentionally does NOT compare `ids` against which skills have rows in the results table.
// An earlier draft did, and that's wrong two ways: (1) a shortlisted id that can never be a chart
// candidate (not proc-able here, or excluded as a purple/character-unique/hidden-unreleased
// skill) never gets a row, so that comparison would read as dirty permanently, no matter how many
// times Run is pressed; (2) mid-run, before every batch has reported, every not-yet-scored
// shortlisted id would read as dirty even though the run in progress is exactly the one that will
// resolve it, and a run halted by Stop would leave that stuck forever.
//
// Instead this compares against `lastRunCandidateIds` -- the exact post-filter pool the last run
// was DISPATCHED with (captured once, before any results come back, and never revised for the
// rest of that run) -- intersected with `procable` so an id that can never be evaluated here
// can't register as "missing". That's monotone within a run and correct across Stop.
export function shopFilterDirty(
	active: boolean,
	ids: string[],
	procable: Set<string> | null,
	lastRunCandidateIds: Set<string>,
	lastRun: string[] | null,
): boolean {
	if (active) {
		return ids.some(
			(id) => (procable?.has(id) ?? false) && !lastRunCandidateIds.has(id),
		);
	}
	// Filter is off (or the shortlist is empty) now; if the last run had it on, the candidate
	// pool has widened back out and needs a re-run. If the last run also had it off (or there's
	// been no run yet), nothing changed on this axis.
	return lastRun !== null;
}

// Parses and validates a persisted shortlist. `isKnown` should be the same general/non-purple
// predicate the chart itself uses to build its candidate pool (not bare skill-data membership),
// so a stale persisted id that can never be a chart candidate (a character unique, a purple, an
// id from a build that no longer recognizes it) doesn't sit in the shortlist as a permanently
// inert, unremovable entry.
export function loadShopSkills(
	raw: string | null,
	isKnown: (id: string) => boolean,
): string[] {
	if (raw == null) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of parsed) {
		if (typeof entry !== 'string') continue;
		if (seen.has(entry)) continue;
		if (!isKnown(entry)) continue;
		seen.add(entry);
		result.push(entry);
	}
	return result;
}

// UI-28: the shop shortlist models the career shop's upgrade ladder, not a flat skill set --
// picking a gold skill (e.g. Professor of Curvature) auto-adds its white prerequisite (Corner
// Adept o), and removing a prerequisite cascades up to remove everything built on top of it.
//
// A skill's rung on its ladder, derived from skill_meta.json's groupId/groupRate joined with
// skill_data.json's rarity. Built once in umalator/app.tsx (which owns both JSON imports) and
// passed in here, so this module stays import-free. Only ids with rarity <= 2 and groupRate >= 1
// belong in this index at all -- see app.tsx's SKILL_LADDER comment for exactly why (in short:
// make_skill_meta.pl remaps groupId for evolved/rarity-6 skills onto an unrelated white/gold
// family's group, and the rarity<=2 guard is what keeps those out; group_rate -1 is the debuff/
// "x" variant and must never be treated as a rung).
export interface LadderRung {
	group: string;
	rate: number;
}
export type LadderIndex = { [skillId: string]: LadderRung };

// Every id sharing id's group with a strictly lower rate -- i.e. everything id's ladder requires
// you to already have. Empty for an unindexed id, a rate-1 id, or a singleton group.
export function prerequisitesOf(id: string, ladder: LadderIndex): string[] {
	const rung = ladder[id];
	if (!rung) return [];
	const out: string[] = [];
	for (const other in ladder) {
		if (other === id) continue;
		const r = ladder[other];
		if (r.group === rung.group && r.rate >= 1 && r.rate < rung.rate)
			out.push(other);
	}
	return out;
}

// The inverse of prerequisitesOf, restricted to ids actually in the shortlist: everything in
// `ids` that sits above id on the same ladder, i.e. everything that would become invalid if id
// were removed. Drives the removal cascade.
export function dependentsOf(
	id: string,
	ids: string[],
	ladder: LadderIndex,
): string[] {
	const rung = ladder[id];
	if (!rung) return [];
	return ids.filter((other) => {
		if (other === id) return false;
		const r = ladder[other];
		return !!r && r.group === rung.group && r.rate > rung.rate;
	});
}

// Adds `id` to the shortlist along with every prerequisite its ladder requires, deduped and
// insertion-ordered (prerequisites first, then id, matching ascending rate). `isEligible` lets
// the caller exclude a prerequisite that can't actually be a chart candidate here (unreleased,
// not in the chart's pool) rather than injecting a dead, unremovable entry -- id itself is always
// added regardless of isEligible, since the caller only invokes this for an id it already chose
// to add (e.g. via the picker, which only offers eligible ids in the first place).
export function addShopSkill(
	ids: string[],
	id: string,
	ladder: LadderIndex,
	isEligible: (skillId: string) => boolean,
): string[] {
	if (ids.includes(id)) return ids;
	const prereqs = prerequisitesOf(id, ladder)
		.filter((p) => isEligible(p) && !ids.includes(p))
		.sort((a, b) => ladder[a].rate - ladder[b].rate);
	return [...ids, ...prereqs, id];
}

// Removes `id` from the shortlist along with everything in the shortlist that depends on it
// (cascade-up: you can't keep Professor of Curvature shortlisted after removing Corner Adept o).
export function removeShopSkill(
	ids: string[],
	id: string,
	ladder: LadderIndex,
): string[] {
	const toRemove = new Set([id, ...dependentsOf(id, ids, ladder)]);
	return ids.filter((x) => !toRemove.has(x));
}

// Repairs a shortlist that may have been assembled by something other than addShopSkill --
// today, only umalator/app.tsx's hydration path, which folds a persisted (possibly pre-UI-28)
// shortlist through addShopSkill one id at a time. addShopSkill's own contract (see its comment)
// deliberately always keeps the id it's asked to add, even when one of that id's prerequisites
// gets filtered out by `isEligible` -- correct for an interactive pick (the picker's pool only
// ever offers ids `isEligible` would accept, so the gap can't occur there), but not safe to lean
// on during hydration: `isEligible` there is `isKnownShopSkill`, a different and stricter bar
// (general/non-purple/released) than "can be a chart candidate," so a persisted higher rung can
// survive while its lower rung gets dropped, leaving a gold shortlisted with no white base --
// exactly the state the rest of this feature (and the shop itself) says can't happen. Iterates to
// a fixed point since dropping one id can cascade (a 3-rung chain where only the middle rung fails
// isKnownShopSkill must drop the top rung too, once the middle is gone).
export function pruneUnsatisfiedPrerequisites(
	ids: string[],
	ladder: LadderIndex,
): string[] {
	const kept = new Set(ids);
	let changed = true;
	while (changed) {
		changed = false;
		for (const id of kept) {
			if (prerequisitesOf(id, ladder).some((p) => !kept.has(p))) {
				kept.delete(id);
				changed = true;
			}
		}
	}
	return ids.filter((id) => kept.has(id));
}

// Splits the shortlist into skills the chart can actually evaluate here vs. ones it can't --
// drives ShopSkillPanel.tsx's "Won't activate here" section (umalator/components/ShopSkillPanel.tsx;
// originally ShopSkillFilter.tsx's chip strip dimming, UI-27, relocated by UI-28).
// `procable === null` means the pool hasn't been computed yet (e.g. before the picker has ever
// been opened for this uma/course) -- everything is provisionally treated as procable rather than
// flagged as a problem before there's any basis to say so.
export function partitionShopSkills(
	ids: string[],
	procable: Set<string> | null,
): { procable: string[]; wontProc: string[] } {
	if (procable === null) return { procable: ids.slice(), wontProc: [] };
	const ok: string[] = [];
	const bad: string[] = [];
	for (const id of ids) {
		(procable.has(id) ? ok : bad).push(id);
	}
	return { procable: ok, wontProc: bad };
}
