import assert from 'node:assert/strict';
import { test } from 'vitest';

import { getEffectValueOutcomes } from './SkillEffectValue.ts';

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
