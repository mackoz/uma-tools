import { Map as ImmMap } from 'immutable';
import { describe, expect, test } from 'vitest';
import {
	bucketsForCourse,
	isOpponentStaminaDebuff,
	STAMINA_DEBUFF_BUCKETS,
	totalDrain,
} from './StaminaDebuffs';

describe('stamina debuff catalog', () => {
	test('derives 15 buckets from the shipped data', () => {
		expect(STAMINA_DEBUFF_BUCKETS.length).toBe(15);
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
});
