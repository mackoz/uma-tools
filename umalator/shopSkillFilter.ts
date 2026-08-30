// Pure logic for the Skill Chart's "Shop skills" shortlist filter (UI-27): narrows the chart's
// candidate pool to a hand-picked set of skills -- the ones a career run's shop screen is
// actually offering -- instead of ranking the whole activateable pool.
//
// Kept import-free (no Preact, no CSS, no JSON) so it's plain-node testable, matching
// chartLadder.ts and statisticalAnalysis.ts. umalator/app.tsx owns all the JSON imports
// (skill_data.json via getActivateableSkills, etc.) and passes plain values in here.

// Whether the shortlist should actually narrow the candidate pool, vs. being "parked" (kept
// around, e.g. still shown as chips) without being applied to a run.
export function isShopFilterActive(enabled: boolean, ids: string[]): boolean {
	return enabled && ids.length > 0;
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

// Splits the shortlist into skills the chart can actually evaluate here vs. ones it can't --
// drives the chip strip's "won't proc here" dimming (umalator/components/ShopSkillFilter.tsx).
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
