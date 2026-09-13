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
	id: string; // representative skill id = lowest id (string sort) among memberIds
	drain: number; // fraction of maxHp, positive (0.01 === 1%)
	window: 'early' | 'mid' | 'late';
	distanceType: number | null; // null === any course
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
		const ids = [...memberIds].sort();
		buckets.push({
			id: ids[0],
			drain,
			window,
			distanceType: parseDistanceType(stripped),
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

export function bucketsForCourse(distanceType: number): DebuffBucket[] {
	return STAMINA_DEBUFF_BUCKETS.filter(
		(b) => b.distanceType === null || b.distanceType === distanceType,
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
export function totalDrain(
	incoming: ImmMap<string, number>,
	distanceType?: number | null,
): number {
	const possibleIds =
		distanceType != null
			? new Set(bucketsForCourse(distanceType).map((b) => b.id))
			: null;
	let total = 0;
	incoming.forEach((count, id) => {
		if (possibleIds != null && !possibleIds.has(id)) return;
		const drain = drainById.get(id);
		if (drain != null) {
			total += drain * count;
		}
	});
	return total;
}

// Companion to totalDrain() above: how many configured debuffs (by count, not by distinct bucket)
// are being excluded from the displayed total because the current course can't produce them --
// the UI-facing half of the same course-gating so it can say so rather than silently drop them.
export function excludedDebuffCount(
	incoming: ImmMap<string, number>,
	distanceType: number | null | undefined,
): number {
	if (distanceType == null) return 0;
	const possibleIds = new Set(bucketsForCourse(distanceType).map((b) => b.id));
	let excluded = 0;
	incoming.forEach((count, id) => {
		if (!possibleIds.has(id) && drainById.has(id)) {
			excluded += count;
		}
	});
	return excluded;
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

// M8 fix (HP-7 fix-round-2): is `id` a KNOWN debuff skill id in this build's derived catalog at
// all -- i.e. any `memberIds` entry of any bucket, not just its representative (`drainById`, per
// its own comment above, is keyed by every member id). Bucket ids are dataset-derived and differ
// between JP and Global for the same conceptual debuff (e.g. Murmur's JP-only unique `105901111`
// vs. Global's `201441`), so a share link or exported uma JSON produced against one dataset can
// carry an id this build's catalog has never heard of -- rehydration call sites
// (umalator/storage.ts, umalator/app.tsx's share-link decode) filter through this rather than
// passing the id straight to `buildSkillData`/`addOpponentDebuff`, which throws `bad skill ID
// <id>` on anything not in `skill_data.json` at all.
//
// Peer-review fix (HP-7 Important 3): this was previously documented as checking a bucket's
// *representative* id specifically, which the implementation never actually did (`drainById.has`
// is true for any member id) -- a real doc/impl mismatch, now corrected to describe what the code
// has always done. Both rehydration call sites now call `normalizeDebuffId()` below instead of
// this function directly, so a non-representative member id is normalised to its bucket's
// representative rather than passing this check and then reaching `HorseState.incomingDebuffs`
// unnormalised -- see that function's own comment for why that mattered.
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
export function clampDebuffCount(raw: unknown): number | null {
	const num = typeof raw === 'number' ? raw : parseFloat(raw as string);
	if (!Number.isFinite(num)) return null;
	return Math.max(0, Math.min(9, Math.floor(num)));
}
