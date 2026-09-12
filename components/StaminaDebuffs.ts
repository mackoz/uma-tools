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
// yields 30 debuff effects across 30 distinct skill ids, grouping into 15 buckets over 8 distinct
// stripped conditions.
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

// Lowest-id member -> drain, for totalDrain() below.
const drainById: ReadonlyMap<string, number> = new Map(
	STAMINA_DEBUFF_BUCKETS.flatMap((b) =>
		b.memberIds.map((id) => [id, b.drain] as const),
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

// M8 fix (HP-7 fix-round-2): is `id` a bucket REPRESENTATIVE id in this build's derived catalog --
// i.e. a key `incomingDebuffs`/`HorseState.incomingDebuffs` can legitimately carry (see
// StaminaDebuffDialog.tsx's `incoming.get(bucket.id, 0)`/`setCount`). Bucket representative ids
// are dataset-derived and differ between JP and Global for the same conceptual debuff (e.g.
// Murmur's JP-only unique `105901111` vs. Global's `201441`), so a share link or exported uma
// JSON produced against one dataset can carry an id this build's catalog has never heard of --
// rehydration call sites (umalator/storage.ts, umalator/app.tsx's share-link decode) filter
// through this rather than passing the id straight to `buildSkillData`/`addOpponentDebuff`, which
// throws `bad skill ID <id>` on anything not in `skill_data.json` at all.
export function isKnownDebuffBucketId(id: string): boolean {
	return drainById.has(id);
}
