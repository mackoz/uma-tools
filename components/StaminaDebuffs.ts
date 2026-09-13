// HP-7: the catalog of incoming stamina debuffs the settings UI offers, derived from the shipped
// skill data rather than hand-maintained. Each shipped debuff effect (type 9, negative modifier,
// non-Self target) is grouped into a "bucket" of skills that are indistinguishable from a
// victim's perspective -- same drain fraction, same victim-safe-stripped
// condition (see VictimSafeConditions in RaceSolverBuilder.ts) -- because the UI only ever needs
// to offer "how much stamina, when, on what course", not which specific skill caused it.
//
// The allowlist and stripping logic are NOT duplicated here -- they are imported from the engine
// module that actually evaluates these conditions at race time (RaceSolverBuilder.ts), so a future
// game-data refresh can't change which debuffs fire in the engine without changing which ones this
// catalog offers. See components/ScalingContext.ts for the same "import the runtime value from
// the engine module" precedent.

import type { Map as ImmMap } from 'immutable';

import skilldata from '../uma-skill-tools/data/jp/skill_data.json';
import {
	VictimSafeConditions,
	victimSafeCondition,
} from '../uma-skill-tools/RaceSolverBuilder';

// Re-export so callers/tests that want to reason about the allowlist don't need their own import
// path into the engine module.
export { VictimSafeConditions };

export interface DebuffBucket {
	id: string; // representative skill id = numerically lowest id among memberIds
	drain: number; // fraction of maxHp, positive (0.01 === 1%)
	window: 'early' | 'mid' | 'late';
	distanceType: number | null; // null === any course
	// Peer-review fix (HP-7 Important 1): the victim's own running style this bucket is gated on,
	// parsed out of a `running_style_count_{nige,senko,sashi,oikomi}_otherself` clause the same way
	// `distanceType` is parsed out of a `distance_type` clause -- null === any running style. See
	// STRATEGY_TERM_MAP/parseStrategy below and RaceSolverBuilder.ts's ANCHOR
	// victim-safe-condition-allowlist for why this term is now victim-safe and kept rather than
	// stripped.
	strategy: 'Nige' | 'Senkou' | 'Sasi' | 'Oikomi' | null;
	memberIds: string[];
}

// Effect type 9 is `SkillType.Recovery` (checked in uma-skill-tools/RaceSolver.ts:167,1795).
// Its handler (RaceSolver.ts:1795-1801) is `this.hp.recover(ef.modifier)`, and `HpPolicy.recover()`
// adds `maxHp * modifier` -- so a negative modifier drains rather than heals, and a non-Self
// target means the drain lands on someone else. See the engine-side ADR
// (uma-skill-tools/docs/adr/0014-victim-safe-debuff-conditions.md) for the victim-safe-condition
// rationale referenced above.
const DEBUFF_EFFECT_TYPE = 9;

// Non-`Self` values of SkillTarget (RaceSolverBuilder.ts's `enum SkillTarget`) that a debuff can
// be aimed at from the victim's perspective. Verified against the shipped data: this exact set
// yields 30 debuff effects across 30 distinct skill ids, grouping into 21 buckets over 14 distinct
// stripped conditions (JP; peer-review fix restoring the four running_style_count_*_otherself
// terms to VictimSafeConditions -- see RaceSolverBuilder.ts -- re-split what used to be 15 buckets
// over 8 conditions. Global's shipped data yields 20 buckets, not exercised by this repo's Vitest
// suite since it only loads JP -- see StaminaDebuffs.test.ts).
const OTHER_TARGETS: ReadonlySet<number> = new Set([
	2, 4, 9, 11, 18, 19, 20, 21, 22, 23,
]);

function parseWindow(stripped: string): 'early' | 'mid' | 'late' | null {
	const clauses = stripped.split(/[&@]/);
	for (const clause of clauses) {
		const m = /^phase(?:_random)?==(\d+)$/.exec(clause);
		if (m != null) {
			switch (m[1]) {
				case '0':
					return 'early';
				case '1':
					return 'mid';
				case '2':
					return 'late';
			}
		}
	}
	return null;
}

function parseDistanceType(stripped: string): number | null {
	const clauses = stripped.split(/[&@]/);
	for (const clause of clauses) {
		const m = /^distance_type==(\d+)$/.exec(clause);
		if (m != null) {
			return +m[1];
		}
	}
	return null;
}

// Peer-review fix (HP-7 Important 1): term name -> the app's own strategy-string spelling
// (components/HorseDefTypes.ts: 'Nige' | 'Senkou' | 'Sasi' | 'Oikomi' | 'Oonige'), matching
// ActivationConditions.ts's own term names (note "senko"/"sashi", not "senkou"/"sasi", in the
// term itself).
const STRATEGY_TERM_MAP: Readonly<Record<string, DebuffBucket['strategy']>> = {
	running_style_count_nige_otherself: 'Nige',
	running_style_count_senko_otherself: 'Senkou',
	running_style_count_sashi_otherself: 'Sasi',
	running_style_count_oikomi_otherself: 'Oikomi',
};

function parseStrategy(stripped: string): DebuffBucket['strategy'] {
	const clauses = stripped.split(/[&@]/);
	for (const clause of clauses) {
		const term = clause.replace(/[<>=!].*/, '');
		if (term in STRATEGY_TERM_MAP) {
			return STRATEGY_TERM_MAP[term];
		}
	}
	return null;
}

// Peer-review fix (HP-7 Important 1): mirrors uma-skill-tools' StrategyHelpers.strategyMatches
// (HorseTypes.ts), verified directly -- an Oonige victim's `running_style_count_nige_otherself`
// clause evaluates true too (`strategyMatches(Strategy.Oonige, Strategy.Nige)` is true in both
// directions there), so a Nige-gated bucket must read as possible for an Oonige uma, not just a
// Nige one. Re-implemented locally against the app's own strategy string spelling rather than
// importing the engine's `const enum Strategy` across the esbuild module boundary (no existing
// precedent for that import in this codebase, and `const enum` re-export across separately
// transpiled files is a known esbuild/isolatedModules trap).
export function strategyMatchesBucket(
	victimStrategy: string | null | undefined,
	bucketStrategy: DebuffBucket['strategy'],
): boolean {
	if (bucketStrategy == null || victimStrategy == null) return true;
	if (victimStrategy === bucketStrategy) return true;
	return bucketStrategy === 'Nige' && victimStrategy === 'Oonige';
}

// Peer-review fix (HP-7 Important 1): true iff `bucket` can both exist on `distanceType` (as
// bucketsForCourse already checked) AND fire for a victim running `strategy` -- the second gating
// axis the allowlist fix re-opened (restoring running_style_count_*_otherself to
// VictimSafeConditions style-gates the Subdued/Flustered family by the victim's own running
// style, which buildSkillData/bucketsForCourse's course gate alone doesn't account for). Either
// argument being null/undefined means "unknown, don't gate on this axis" -- same convention
// distanceType already uses.
export function isBucketPossible(
	bucket: DebuffBucket,
	distanceType: number | null | undefined,
	strategy: string | null | undefined,
): boolean {
	const courseOk =
		distanceType == null ||
		bucket.distanceType == null ||
		bucket.distanceType === distanceType;
	const styleOk = strategyMatchesBucket(strategy, bucket.strategy);
	return courseOk && styleOk;
}

function deriveBuckets(): DebuffBucket[] {
	// key: `${drain}|${strippedCondition}`
	const grouped = new Map<
		string,
		{ drain: number; stripped: string; memberIds: Set<string> }
	>();

	for (const skillId of Object.keys(skilldata)) {
		const skill = (skilldata as any)[skillId];
		for (const alt of skill.alternatives) {
			for (const ef of alt.effects) {
				if (
					ef.type === DEBUFF_EFFECT_TYPE &&
					ef.modifier < 0 &&
					OTHER_TARGETS.has(ef.target)
				) {
					const drain = Math.abs(ef.modifier) / 10000;
					const stripped = victimSafeCondition(alt.condition);
					const key = `${drain}|${stripped}`;
					let entry = grouped.get(key);
					if (entry == null) {
						entry = { drain, stripped, memberIds: new Set() };
						grouped.set(key, entry);
					}
					entry.memberIds.add(skillId);
				}
			}
		}
	}

	const buckets: DebuffBucket[] = [];
	for (const { drain, stripped, memberIds } of grouped.values()) {
		const window = parseWindow(stripped);
		if (window == null) {
			// No shipped debuff condition is missing a phase/phase_random clause after stripping
			// (verified against the current data), so this is defensive only -- skip a bucket we
			// can't meaningfully place in a window rather than crash the whole derivation.
			continue;
		}
		// Numeric sort, matching compare.ts's `(a, b) => +a - +b` -- these are all numeric skill ids,
		// and a default string sort picks the lexicographically-least id rather than the spec's
		// "lowest-ID member" (e.g. a 9-digit pink unique like 100502111 sorts before 200772 as a
		// string despite being numerically larger).
		const ids = [...memberIds].sort((a, b) => +a - +b);
		buckets.push({
			id: ids[0],
			drain,
			window,
			distanceType: parseDistanceType(stripped),
			strategy: parseStrategy(stripped),
			memberIds: ids,
		});
	}
	return buckets;
}

export const STAMINA_DEBUFF_BUCKETS: readonly DebuffBucket[] = deriveBuckets();

// Every member id (not just the lowest/representative) -> drain, for totalDrain() and
// drainForSkill() below.
const drainById: ReadonlyMap<string, number> = new Map(
	STAMINA_DEBUFF_BUCKETS.flatMap((b) =>
		b.memberIds.map((id) => [id, b.drain] as const),
	),
);

// Every member id -> its bucket's representative id, for normalizeDebuffId() below.
const representativeIdByMemberId: ReadonlyMap<string, string> = new Map(
	STAMINA_DEBUFF_BUCKETS.flatMap((b) =>
		b.memberIds.map((id) => [id, b.id] as const),
	),
);

// Every member id -> its bucket, for totalDrain()/excludedDebuffCount() below -- keyed by every
// member id, not just the representative, mirroring drainById's own comment above (production
// `incoming` maps are always keyed by representative id after normalizeDebuffId(), but this
// matches drainById's existing lookup universe rather than narrowing it).
const bucketByMemberId: ReadonlyMap<string, DebuffBucket> = new Map(
	STAMINA_DEBUFF_BUCKETS.flatMap((b) =>
		b.memberIds.map((id) => [id, b] as const),
	),
);

// Peer-review fix (HP-7 Important 1): `strategy`, when given, additionally excludes a bucket
// gated to a running style the victim doesn't have (see isBucketPossible above) -- omitted (or
// null/undefined), no style gating is applied, matching pre-fix behavior for existing callers.
export function bucketsForCourse(
	distanceType: number,
	strategy?: string | null,
): DebuffBucket[] {
	return STAMINA_DEBUFF_BUCKETS.filter((b) =>
		isBucketPossible(b, distanceType, strategy),
	);
}

// I2 fix (HP-7 fix-round-2): `distanceType` narrows the total to buckets that can actually exist
// on the current course, the same test `bucketsForCourse()` applies to the dialog's own row
// gating -- omitted (or null/undefined), every configured bucket counts, matching the pre-fix
// behavior. Without this, a bucket the engine drops entirely for the wrong course (its regions
// come out empty and it never activates -- RaceSolverBuilder.ts's condition parsing) still showed
// up in the "−N% max HP" total, contradicting a same-screen simulation that drains exactly 0 for
// it. Configured counts themselves are left untouched in `incoming` -- only the displayed total
// narrows -- so switching the course back restores them.
//
// Peer-review fix (HP-7 Important 1): `strategy` narrows the same way for the victim's own
// running style -- the second gating axis restoring running_style_count_*_otherself to the
// engine's allowlist re-opened (see isBucketPossible above and StaminaDebuffDialog.tsx's own
// comment for the full story). Omitted, no style gating is applied.
export function totalDrain(
	incoming: ImmMap<string, number>,
	distanceType?: number | null,
	strategy?: string | null,
): number {
	let total = 0;
	incoming.forEach((count, id) => {
		const bucket = bucketByMemberId.get(id);
		if (bucket == null) return;
		if (!isBucketPossible(bucket, distanceType, strategy)) return;
		total += bucket.drain * count;
	});
	return total;
}

// Companion to totalDrain() above: how many configured debuffs (by count, not by distinct bucket)
// are being excluded from the displayed total, broken down by WHY -- the current course can't
// produce them, or the victim's own running style doesn't match their gate. The two are reported
// separately (rather than one combined count) so the dialog/card can word each reason correctly;
// no shipped bucket is gated on both axes at once (verified against the current data). A bucket
// gated on both is counted under wrongCourse only (course checked first), matching totalDrain's
// own single `if...return` exclusion above -- HP-7 review-3, Minor 10: this used to add the same
// count to BOTH categories for such a bucket, so wrongCourse + wrongStyle could overcount relative
// to totalDrain's one-time exclusion (zero shipped buckets are affected either way).
export interface ExcludedDebuffCounts {
	wrongCourse: number;
	wrongStyle: number;
}

export function excludedDebuffCount(
	incoming: ImmMap<string, number>,
	distanceType: number | null | undefined,
	strategy?: string | null,
): ExcludedDebuffCounts {
	const result: ExcludedDebuffCounts = { wrongCourse: 0, wrongStyle: 0 };
	incoming.forEach((count, id) => {
		const bucket = bucketByMemberId.get(id);
		if (bucket == null) return;
		if (
			distanceType != null &&
			bucket.distanceType != null &&
			bucket.distanceType !== distanceType
		) {
			result.wrongCourse += count;
		} else if (!strategyMatchesBucket(strategy, bucket.strategy)) {
			result.wrongStyle += count;
		}
	});
	return result;
}

// All skill ids that appear as a member of any bucket above -- i.e. every shipped skill that is
// itself an opponent-targeting stamina debuff (effect type 9, negative modifier, non-Self target;
// see deriveBuckets()). HP-7 fix-round-2 (C1): used to suppress the Skill Chart's Survives column
// for these candidates specifically -- see BasinnChart.tsx/app.tsx for why a debuff skill's own
// Survives number is a simulation artifact, not a real result.
const opponentStaminaDebuffIds: ReadonlySet<string> = new Set(
	STAMINA_DEBUFF_BUCKETS.flatMap((b) => b.memberIds),
);

export function isOpponentStaminaDebuff(skillId: string): boolean {
	return opponentStaminaDebuffIds.has(skillId);
}

// Minor fix (HP-7 review-2): no current callers -- kept as the predicate half of
// normalizeDebuffId() below (which both rehydration call sites, umalator/storage.ts and
// umalator/app.tsx's share-link decode, call directly instead: it does this same "is `id` a KNOWN
// debuff skill id in this build's derived catalog at all" check AND normalises to the bucket's
// representative id in one step, so the two-step "check then normalise" this function's callers
// used to require doesn't exist anymore). `drainById` is keyed by every `memberIds` entry, not
// just its representative -- exported in case a future caller wants the check without the
// normalisation.
export function isKnownDebuffBucketId(id: string): boolean {
	return drainById.has(id);
}

// Peer-review fix (HP-7 Important 3): `id` -> its bucket's REPRESENTATIVE id, covering every
// member id of every bucket (not just representatives) -- returns null for an id this build's
// catalog doesn't recognize at all (same universe as isKnownDebuffBucketId above). Before this,
// a non-representative member id in a saved config or share link passed isKnownDebuffBucketId
// (true for any member) unnormalised, and reached HorseState.incomingDebuffs keyed by that
// non-representative id -- invisible and uneditable in StaminaDebuffDialog.tsx (keyed by
// `bucket.id`, the representative) and miscounted by totalDrain()/excludedDebuffCount() (which
// build representative-only id sets), while still firing normally via addIncomingDebuffs. Both
// rehydration call sites (umalator/storage.ts, umalator/app.tsx's share-link decode) call this
// instead of isKnownDebuffBucketId directly, so any known id -- representative or not -- ends up
// stored under its bucket's representative id, visible and editable like any other configured
// debuff.
export function normalizeDebuffId(id: string): string | null {
	return representativeIdByMemberId.get(id) ?? null;
}

// HP-7 pt.2: drain fraction (0.01 === 1%) for any skill id that is itself an opponent stamina
// debuff (isOpponentStaminaDebuff above) -- not just a bucket representative id. `drainById` is
// keyed by every memberIds entry, not only representative ids (see its construction above), so
// this covers whichever specific skill actually activated in a run, letting callers (e.g.
// ResultsPane's Incoming Debuffs section) look up a proc's drain % without duplicating or
// re-deriving the map.
export function drainForSkill(skillId: string): number | undefined {
	return drainById.get(skillId);
}

// Post-review fix (HP-7 pt.2, round 2): the ONE formatting rule for a drain fraction, moved here
// from StaminaDebuffDialog.tsx so ResultsPane.tsx/app.tsx's course-map markers can share it
// instead of re-deriving their own (which is exactly how a real bucket -- 910301, drain 0.0025 --
// rendered as "0.3%" in two new call sites while the dialog correctly showed "0.25%": both new
// formatters rounded to a fixed number of decimal places instead of trimming trailing zeros off
// 2, and the overstated rounding is the wrong direction for a number people reason about HP
// with). Returns the unsigned magnitude ("0.25%", "3%") -- callers that need a sign prepend the
// U+2212 minus sign themselves (the established convention: see HorseDef.tsx's
// `` `−${...}% max HP` `` and StaminaDebuffDialog.tsx's own total line), not the ASCII hyphen.
export function formatPercent(fraction: number): string {
	const pct = fraction * 100;
	// Trims to at most 2 decimal places without trailing zeros (0.25%, 1%, 3%).
	return `${Number(pct.toFixed(2))}%`;
}

// Peer-review fix (HP-7 Critical 2): the single source of truth for a valid incoming-debuff count.
// StaminaDebuffDialog.tsx's stepper caps a count at 9 (`disabled={... || value >= 9}`), but neither
// rehydration path that reads a count from outside the dialog -- umalator/app.tsx's share-link
// decode (`filterKnownIncomingDebuffs`) nor umalator/storage.ts's saved-slot decode
// (`validateAndParseUmaJson`) -- enforced that cap, or even that the value was a finite number:
// `JSON.parse('{"count": 1e400}')` parses to `Infinity`, and `compare.ts`'s
// `addIncomingDebuffs` does `for (let i = 0; i < count; ++i)`, an infinite loop for a crafted or
// corrupted share link. Coerces to a number, rejects non-finite (Infinity/-Infinity/NaN), floors
// to an integer, and clamps to [0, 9] -- the same range the dialog itself enforces. Returns null
// for a count that isn't a usable number at all (the caller drops the entry, same as an unknown
// skill id); a value that clamps to 0 is returned as 0, not null, so callers can choose whether
// "explicitly zero" is worth keeping or dropping.
// Minor fix (HP-7 review-2): the single source of truth for the [0, 9] cap, previously the
// literal `9` duplicated across this function, StaminaDebuffDialog.tsx's stepper, and
// umalator/compare.ts's defense-in-depth clamp.
export const MAX_DEBUFF_COUNT = 9;

export function clampDebuffCount(raw: unknown): number | null {
	const num = typeof raw === 'number' ? raw : parseFloat(raw as string);
	if (!Number.isFinite(num)) return null;
	return Math.max(0, Math.min(MAX_DEBUFF_COUNT, Math.floor(num)));
}

// HP-7 review-3, Minor 10: the ONE normalize->clamp->sum->re-clamp sequence for a raw
// (untrusted) incomingDebuffs record, shared by every construction site instead of each
// hand-rolling it -- umalator/app.tsx's `filterKnownIncomingDebuffs` (share-link decode) and
// umalator/storage.ts's `validateAndParseUmaJson` (saved-slot decode) previously duplicated this
// exact logic, and it has already needed two hand-applied fixes (Critical 2's clamp, review-2
// Important 3's re-clamp-after-sum) during this feature's own review history. Drops any entry
// whose id isn't a known bucket member (normalizeDebuffId) or whose count isn't a usable number
// (clampDebuffCount), folds every member id of a multi-member bucket onto its representative id,
// sums duplicate representative ids, and re-clamps the sum to [0, MAX_DEBUFF_COUNT] so two
// already-clamped-to-9 counts under different member ids of the same bucket can't add up past 9.
export function sanitizeIncomingDebuffs(
	raw: { [key: string]: number } | undefined | null,
): { [key: string]: number } {
	const sanitized: { [key: string]: number } = {};
	if (raw == null) return sanitized;
	for (const [skillId, count] of Object.entries(raw)) {
		const representativeId = normalizeDebuffId(skillId);
		if (representativeId == null) continue;
		const clamped = clampDebuffCount(count);
		if (clamped != null && clamped > 0) {
			const summed = (sanitized[representativeId] ?? 0) + clamped;
			sanitized[representativeId] = Math.min(summed, MAX_DEBUFF_COUNT);
		}
	}
	return sanitized;
}
