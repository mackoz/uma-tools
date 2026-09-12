// HP-7: the catalog of incoming stamina debuffs the settings UI offers, derived from the shipped
// skill data rather than hand-maintained. Each shipped debuff effect (type 9 [TargetSpeed... see
// note below], negative modifier, non-Self target) is grouped into a "bucket" of skills that are
// indistinguishable from a victim's perspective -- same drain fraction, same victim-safe-stripped
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

export function totalDrain(incoming: ImmMap<string, number>): number {
	let total = 0;
	incoming.forEach((count, id) => {
		const drain = drainById.get(id);
		if (drain != null) {
			total += drain * count;
		}
	});
	return total;
}
