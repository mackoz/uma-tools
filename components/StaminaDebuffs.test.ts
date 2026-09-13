import { Map as ImmMap } from 'immutable';
import { describe, expect, test } from 'vitest';
import {
	bucketsForCourse,
	clampDebuffCount,
	formatPercent,
	isOpponentStaminaDebuff,
	normalizeDebuffId,
	STAMINA_DEBUFF_BUCKETS,
	totalDrain,
} from './StaminaDebuffs';

describe('stamina debuff catalog', () => {
	// HP-7 peer-review fix: VictimSafeConditions used to wrongly strip
	// running_style_count_{nige,senko,sashi,oikomi}_otherself as "caster state" (they are not --
	// see RaceSolverBuilder.ts's ANCHOR victim-safe-condition-allowlist comment). Restoring them to
	// the allowlist re-splits the Subdued/Flustered debuff family by the victim's running style,
	// raising JP's bucket count from 15 to 21. Vitest only ever loads the JP dataset (the build
	// plugin redirects Global's import at build time, not at test time), so Global's count -- also
	// measured directly against uma-skill-tools/data/global/skill_data.json with this same
	// allowlist: 14 -> 20 -- isn't exercised here; recorded for anyone diffing Global's behavior.
	test('derives 21 buckets from the shipped JP data', () => {
		expect(STAMINA_DEBUFF_BUCKETS.length).toBe(21);
	});

	test('each bucket is named after its lowest-id member and has a positive drain', () => {
		for (const b of STAMINA_DEBUFF_BUCKETS) {
			expect(b.memberIds).toContain(b.id);
			expect(b.id).toBe([...b.memberIds].sort()[0]);
			expect(b.drain).toBeGreaterThan(0);
		}
	});

	test('Murmur is 1%, mid-race, Mid-distance only', () => {
		const murmur = STAMINA_DEBUFF_BUCKETS.find((b) =>
			b.memberIds.includes('201162'),
		)!;
		expect(murmur.drain).toBeCloseTo(0.01, 6);
		expect(murmur.window).toBe('mid');
		expect(murmur.distanceType).toBe(3);
	});

	test('All-Seeing Eyes is 3%, late race, any course', () => {
		const ase = STAMINA_DEBUFF_BUCKETS.find((b) =>
			b.memberIds.includes('201441'),
		)!;
		expect(ase.drain).toBeCloseTo(0.03, 6);
		expect(ase.window).toBe('late');
		expect(ase.distanceType).toBeNull();
	});

	test('course gating hides Mid-only debuffs on a Mile course', () => {
		const mile = bucketsForCourse(2);
		expect(mile.some((b) => b.memberIds.includes('201162'))).toBe(false);
		expect(mile.some((b) => b.memberIds.includes('201441'))).toBe(true);
	});

	test('totalDrain sums count x drain', () => {
		const m = ImmMap<string, number>({ '201162': 2, '201441': 1 });
		expect(totalDrain(m)).toBeCloseTo(0.05, 6);
	});

	test('isOpponentStaminaDebuff identifies known debuff ids and rejects an ordinary skill', () => {
		expect(isOpponentStaminaDebuff('201162')).toBe(true); // Murmur
		expect(isOpponentStaminaDebuff('201441')).toBe(true); // All-Seeing Eyes
		expect(isOpponentStaminaDebuff('200332')).toBe(false); // ordinary skill
	});

	// Post-review fix (HP-7 pt.2, round 2, issue 1): table-driven over the four distinct drain
	// fractions that actually appear across STAMINA_DEBUFF_BUCKETS (verified against
	// skill_data.json directly, not just against whichever buckets a hand-picked test happens to
	// exercise) -- this would have caught the previous round's bug instantly: two new call sites
	// (ResultsPane.tsx/app.tsx) each hand-rolled a `Number.isInteger(pct) ? toFixed(0) :
	// toFixed(1)` rounding rule that rendered bucket 910301's real 0.25% drain as "0.3%", the only
	// one of these four values it got wrong.
	test.each([
		[0.0025, '0.25%'],
		[0.005, '0.5%'],
		[0.01, '1%'],
		[0.03, '3%'],
	])('formatPercent(%f) === %s', (fraction, expected) => {
		expect(formatPercent(fraction)).toBe(expected);
	});

	test('formatPercent is exercised by every distinct drain value actually in the catalog', () => {
		const distinctDrains = new Set(STAMINA_DEBUFF_BUCKETS.map((b) => b.drain));
		expect([...distinctDrains].sort((a, b) => a - b)).toEqual([
			0.0025, 0.005, 0.01, 0.03,
		]);
	});

	// HP-7 peer-review Critical 2: both incoming-debuff-count rehydration paths (umalator/app.tsx's
	// filterKnownIncomingDebuffs, umalator/storage.ts's validateAndParseUmaJson) delegate their
	// numeric validation to this one function -- see its own comment for why an unvalidated count
	// is an infinite-loop vector via compare.ts's `for (let i = 0; i < count; ++i)`.
	describe('clampDebuffCount', () => {
		test('rejects a non-finite value (the JSON.parse(\'{"count":1e400}\') === Infinity case)', () => {
			expect(clampDebuffCount(JSON.parse('1e400'))).toBeNull();
			expect(clampDebuffCount(Infinity)).toBeNull();
			expect(clampDebuffCount(-Infinity)).toBeNull();
		});

		test('rejects NaN and non-numeric strings', () => {
			expect(clampDebuffCount(NaN)).toBeNull();
			expect(clampDebuffCount('not a number')).toBeNull();
		});

		test('clamps a negative value to 0', () => {
			expect(clampDebuffCount(-5)).toBe(0);
		});

		test('floors a non-integer value', () => {
			expect(clampDebuffCount(2.7)).toBe(2);
		});

		test("clamps an over-cap value to 9, matching StaminaDebuffDialog.tsx's stepper cap", () => {
			expect(clampDebuffCount(500)).toBe(9);
		});

		test('passes an in-range integer through unchanged', () => {
			expect(clampDebuffCount(3)).toBe(3);
			expect(clampDebuffCount(0)).toBe(0);
			expect(clampDebuffCount(9)).toBe(9);
		});
	});

	// HP-7 peer-review Important 3: isKnownDebuffBucketId was documented as checking a bucket's
	// representative id but implemented as "any member id" -- normalizeDebuffId is the function
	// that actually normalises to the representative, used by both rehydration call sites so a
	// non-representative member id becomes visible/editable (keyed by bucket.id) instead of
	// silently bypassing the dialog and the totalDrain()/excludedDebuffCount() representative-only
	// id sets.
	describe('normalizeDebuffId', () => {
		test('a bucket with multiple members normalises every member id to the same representative', () => {
			const multiMemberBucket = STAMINA_DEBUFF_BUCKETS.find(
				(b) => b.memberIds.length > 1,
			)!;
			for (const memberId of multiMemberBucket.memberIds) {
				expect(normalizeDebuffId(memberId)).toBe(multiMemberBucket.id);
			}
		});

		test('an unknown id returns null', () => {
			expect(normalizeDebuffId('not-a-real-skill-id')).toBeNull();
		});
	});
});
