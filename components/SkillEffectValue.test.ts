import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { ScalingContext } from '../uma-skill-tools/ValueScaling';
import {
	getEffectValueOutcomes,
	getScaledBaseDuration,
} from './SkillEffectValue.ts';

// A baseline context for tests that only care about one field -- valueScaleFactor/
// durationScaleFactor each switch on valueUsage/timeUsage first, so a field this specific test
// isn't targeting is never actually read.
const BASE_CONTEXT: ScalingContext = {
	skillCount: 0,
	maxBaseStat: 1000,
	finalSpeed: 1800,
	remainingHp: 2000,
};

test('getEffectValueOutcomes: valueUsage 8/9 ("Multiply Random") returns the 3 real scaled outcomes', () => {
	// 202032 Risky Business's Recovery effect: raw modifier -10000, valueUsage 8. The real
	// drain is 0%, 2%, or 4% -- never the raw -100%. RaceSolver.ts's scaleEffectValue() rolls
	// 0.0x/0.02x/0.04x, so the outcomes here are -10000*0.04, -10000*0.02, -10000*0, ascending.
	assert.deepEqual(getEffectValueOutcomes(-10000, 8), [-400, -200, 0]);
	assert.deepEqual(getEffectValueOutcomes(-10000, 9), [-400, -200, 0]);
});

test('getEffectValueOutcomes: valueUsage 1 ("Direct"), other codes, and undefined pass through unchanged', () => {
	assert.deepEqual(getEffectValueOutcomes(500, 1), [500]);
	assert.deepEqual(getEffectValueOutcomes(500, 2), [500]);
	assert.deepEqual(getEffectValueOutcomes(500, undefined), [500]);
});

test('getEffectValueOutcomes: displayed as percentages matches "-4.0% / -2.0% / 0.0%" for 202032', () => {
	const formatPercent = (n: number) => `${((n / 10000) * 100).toFixed(1)}%`;
	const rendered = getEffectValueOutcomes(-10000, 8)
		.map(formatPercent)
		.join(' / ');
	assert.equal(rendered, '-4.0% / -2.0% / 0.0%');
});

test('getEffectValueOutcomes: valueUsage 13 (MultiplyMaximumRawStatus) scales by maxBaseStat, e.g. 0.8x at 500', () => {
	const ctx: ScalingContext = { ...BASE_CONTEXT, maxBaseStat: 500 };
	assert.deepEqual(getEffectValueOutcomes(1000, 13, ctx), [1000 * 0.8]);
});

test("getEffectValueOutcomes: valueUsage 22 (MultiplySpeed) floors to 0 below 1700 final speed -- SKL-7's headline case", () => {
	const ctx: ScalingContext = { ...BASE_CONTEXT, finalSpeed: 1000 };
	assert.deepEqual(getEffectValueOutcomes(1000, 22, ctx), [0]);
});

test('getEffectValueOutcomes: omitting the scalingContext leaves every deterministic valueUsage unscaled', () => {
	// Same valueUsage/modifier pairs as the two tests above, minus the context -- must render
	// identically to the pre-SKL-7 single-element-passthrough behavior so no existing call site
	// (which doesn't pass a third argument yet) regresses.
	assert.deepEqual(getEffectValueOutcomes(1000, 13), [1000]);
	assert.deepEqual(getEffectValueOutcomes(1000, 22), [1000]);
	assert.deepEqual(getEffectValueOutcomes(500, 2), [500]);
});

test('getEffectValueOutcomes: valueUsage 8 (Multiply Random) still yields its three stochastic outcomes regardless of context', () => {
	// A context whose fields would otherwise floor value usage 22 to 0 (finalSpeed 1000) or halve
	// usage 13 (maxBaseStat 500) must not leak into the Multiply Random branch -- it stays local
	// and stochastic, per the brief.
	const ctx: ScalingContext = {
		...BASE_CONTEXT,
		maxBaseStat: 500,
		finalSpeed: 1000,
	};
	assert.deepEqual(getEffectValueOutcomes(-10000, 8, ctx), [-400, -200, 0]);
});

test('getScaledBaseDuration: valueUsage-free timeUsage 3 (MultiplyRemainHp) scales duration, and omitting context is identity', () => {
	const ctx: ScalingContext = { ...BASE_CONTEXT, remainingHp: 2900 };
	assert.equal(getScaledBaseDuration(10, 3, ctx), 10 * 2.5);
	assert.equal(getScaledBaseDuration(10, 3), 10);
});
