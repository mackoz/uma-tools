import assert from 'node:assert/strict';
import type { LadderIndex } from './shopSkillFilter.ts';
import {
	discountedCost,
	HINT_DISCOUNT,
	loadShopSkillHints,
	type OptimizerInput,
	optimizePurchases,
	pruneHints,
} from './spOptimizer.ts';

// --- discountedCost: every hint level, rounding, edge inputs ---
{
	assert.deepEqual(HINT_DISCOUNT, [0, 0.1, 0.2, 0.3, 0.35, 0.4]);

	// baseCost 170 at every level 0-5.
	assert.equal(discountedCost(170, 0), 170);
	assert.equal(discountedCost(170, 1), 153); // round(170*.9) = round(153) = 153
	assert.equal(discountedCost(170, 2), 136); // round(170*.8) = round(136) = 136
	assert.equal(discountedCost(170, 3), 119); // round(170*.7) = round(119) = 119
	assert.equal(discountedCost(170, 4), 111); // round(170*.65) = round(110.5) = 111
	assert.equal(discountedCost(170, 5), 102); // round(170*.6) = round(102) = 102

	// baseCost 0 -> 0 at every level.
	for (let level = 0; level <= 5; level++) {
		assert.equal(discountedCost(0, level), 0);
	}

	// out-of-range level clamps to [0, 5]; fractional level rounds first.
	assert.equal(discountedCost(170, -1), discountedCost(170, 0));
	assert.equal(discountedCost(170, 6), discountedCost(170, 5));
	assert.equal(
		discountedCost(100, 2.5),
		discountedCost(100, 3),
		'2.5 rounds up to level 3 before clamping',
	);
}

// --- loadShopSkillHints: parsing/validation ---
{
	assert.deepEqual(loadShopSkillHints(null), {});
	assert.deepEqual(
		loadShopSkillHints('not json{{'),
		{},
		'malformed JSON -> {}',
	);
	assert.deepEqual(loadShopSkillHints('[1,2,3]'), {}, 'array JSON -> {}');
	assert.deepEqual(loadShopSkillHints('"hello"'), {}, 'string JSON -> {}');
	assert.deepEqual(loadShopSkillHints('42'), {}, 'number JSON -> {}');
	assert.deepEqual(loadShopSkillHints('null'), {}, 'null JSON -> {}');

	assert.deepEqual(
		loadShopSkillHints('{"a":2,"b":"x","c":7,"d":-3,"e":8.6,"f":true}'),
		{ a: 2, c: 5, d: 0, e: 5 }, // e: round(8.6)=9, then clamped down to 5
		'non-number values dropped; numeric values clamped to integer 0-5',
	);
}

// --- pruneHints: drop non-kept ids; same reference when nothing dropped ---
{
	const hints = { a: 1, b: 2, c: 3 };
	assert.deepEqual(pruneHints(hints, ['a', 'c']), { a: 1, c: 3 });

	const untouched = { a: 1 };
	assert.equal(
		pruneHints(untouched, ['a', 'zzz']),
		untouched,
		'nothing dropped -> same object reference returned',
	);
}

// --- optimizePurchases: single-rung group, exactly-budget vs budget-1 ---
{
	const input: OptimizerInput = {
		candidates: [{ id: 's1', gain: 5 }],
		hints: {},
		ladder: {},
		costs: { s1: 100 },
		budget: 100,
	};
	assert.deepEqual(optimizePurchases(input), [
		{ skillIds: ['s1'], totalCost: 100, totalGain: 5 },
	]);
	assert.deepEqual(optimizePurchases({ ...input, budget: 99 }), [
		{ skillIds: [], totalCost: 0, totalGain: 0 },
	]);
}

// --- optimizePurchases: 3-rung ladder -- terminal tier buys every rung at its own hint level,
// gain is the terminal rung's gain only (never summed across rungs) ---
{
	const ladder: LadderIndex = {
		white: { group: 'g3', rate: 1 },
		gold: { group: 'g3', rate: 2 },
		evo: { group: 'g3', rate: 3 },
	};
	const input: OptimizerInput = {
		candidates: [{ id: 'evo', gain: 50 }], // only the top rung is a candidate
		hints: { white: 2, gold: 1, evo: 4 },
		ladder,
		costs: { white: 130, gold: 140, evo: 170 },
		budget: 341, // discountedCost(130,2)=104 + discountedCost(140,1)=126 + discountedCost(170,4)=111
		topK: 1, // isolate the single tier under test; a 3-skill result is diverse from the empty
		// set (diff 3 >= 2), so with the default topK the empty set would also legitimately
		// appear as a second accepted result -- topK:1 keeps this test focused on the tier itself.
	};
	assert.deepEqual(optimizePurchases(input), [
		{ skillIds: ['white', 'gold', 'evo'], totalCost: 341, totalGain: 50 },
	]);
	assert.deepEqual(optimizePurchases({ ...input, budget: 340 }), [
		{ skillIds: [], totalCost: 0, totalGain: 0 },
	]);
}

// --- optimizePurchases: gold candidate whose white is NOT itself a candidate -- cost still
// includes the white's discountedCost at hints[white] ?? 0 ---
{
	const ladder: LadderIndex = {
		white2: { group: 'g4', rate: 1 },
		gold2: { group: 'g4', rate: 2 },
	};
	const input: OptimizerInput = {
		candidates: [{ id: 'gold2', gain: 20 }],
		hints: {},
		ladder,
		costs: { white2: 100, gold2: 120 },
		budget: 220,
		topK: 1, // a 2-skill result is diverse from the empty set too; isolate the tier under test
	};
	assert.deepEqual(optimizePurchases(input), [
		{ skillIds: ['white2', 'gold2'], totalCost: 220, totalGain: 20 },
	]);
}

// --- optimizePurchases: owned rungs -- free, count toward prerequisites, never a terminal tier ---
{
	const ladder: LadderIndex = {
		white3: { group: 'g5', rate: 1 },
		gold3: { group: 'g5', rate: 2 },
	};
	// owned white: gold tier charges gold only.
	{
		const input: OptimizerInput = {
			candidates: [{ id: 'gold3', gain: 15 }],
			hints: { gold3: 2 },
			ladder,
			costs: { white3: 100, gold3: 150 },
			owned: new Set(['white3']),
			budget: 120, // discountedCost(150,2) = round(150*.8) = 120
		};
		assert.deepEqual(optimizePurchases(input), [
			{ skillIds: ['gold3'], totalCost: 120, totalGain: 15 },
		]);
		assert.deepEqual(optimizePurchases({ ...input, budget: 119 }), [
			{ skillIds: [], totalCost: 0, totalGain: 0 },
		]);
	}
	// owned gold: never offered as a terminal tier -- the whole group contributes nothing.
	{
		const input: OptimizerInput = {
			candidates: [{ id: 'gold3', gain: 15 }],
			hints: {},
			ladder,
			costs: { white3: 100, gold3: 150 },
			owned: new Set(['gold3']),
			budget: 1000,
		};
		assert.deepEqual(optimizePurchases(input), [
			{ skillIds: [], totalCost: 0, totalGain: 0 },
		]);
	}
}

// --- optimizePurchases: two independent groups, budget forces the non-greedy choice.
// Greedy-by-raw-gain would buy 'big' first (highest single gain) and stop; the true optimum
// combines the two cheaper skills for more total gain within the same budget. ---
{
	const input: OptimizerInput = {
		candidates: [
			{ id: 'big', gain: 10 },
			{ id: 'small1', gain: 6 },
			{ id: 'small2', gain: 6 },
		],
		hints: {},
		ladder: {},
		costs: { big: 10, small1: 5, small2: 5 },
		budget: 10,
	};
	const results = optimizePurchases(input);
	assert.deepEqual(results[0], {
		skillIds: ['small1', 'small2'],
		totalCost: 10,
		totalGain: 12,
	});
}

// --- optimizePurchases: dominance counterexample -- a dominated tier (b, cost 5 gain 4, vs a,
// cost 5 gain 3 -- same cost, lower gain than nothing dominates here since both are candidates,
// but 'a' is strictly worse than 'b' standalone) must still surface as part of a diverse #2/#3,
// i.e. it must NOT be pruned away just because it looks locally worse. Also exercises: an id
// ('a') in the ladder as its own singleton group, another ('b') likewise with a distinct group
// id, and a third ('c') absent from the ladder entirely. Doubles as the top-3
// ordering + symmetric-difference-2-is-accepted case. ---
{
	const ladder: LadderIndex = {
		a: { group: 'gA', rate: 1 },
		b: { group: 'gB', rate: 1 },
	};
	const input: OptimizerInput = {
		candidates: [
			{ id: 'a', gain: 3 },
			{ id: 'b', gain: 4 },
			{ id: 'c', gain: 10 }, // 'c' is absent from `ladder` entirely
		],
		hints: {},
		ladder,
		costs: { a: 5, b: 5, c: 5 },
		budget: 10,
	};
	const results = optimizePurchases(input);
	assert.deepEqual(results[0], {
		skillIds: ['b', 'c'],
		totalCost: 10,
		totalGain: 14,
	});
	assert.deepEqual(
		results[1],
		{ skillIds: ['a', 'c'], totalCost: 10, totalGain: 13 },
		"the dominated-looking tier 'a' still surfaces as the diverse #2 (symmetric diff from " +
			'#1 is {a,b}, size 2 -> accepted)',
	);
	assert.deepEqual(
		results[2],
		{ skillIds: ['a', 'b'], totalCost: 10, totalGain: 7 },
		'#3: diff from both #1 and #2 is size 2 in each case -> accepted',
	);
}

// --- optimizePurchases: near-duplicate (symmetric difference 1) is rejected in favor of the
// next diverse option; the empty set legitimately fills a later slot when nothing else qualifies ---
{
	const input: OptimizerInput = {
		candidates: [
			{ id: 'p', gain: 10 },
			{ id: 'q', gain: 0.1 },
			{ id: 'r', gain: 9 },
		],
		hints: {},
		ladder: {},
		costs: { p: 5, q: 1, r: 5 },
		budget: 6,
	};
	const results = optimizePurchases(input);
	// #1: {p,q} gain 10.1. The next-best-by-gain result is {p} (gain 10), a symmetric-difference-1
	// near-duplicate of #1 (differs only by dropping 'q') -- it must be REJECTED.
	assert.deepEqual(results[0], {
		skillIds: ['p', 'q'],
		totalCost: 6,
		totalGain: 10.1,
	});
	assert.deepEqual(
		results[1],
		{ skillIds: ['q', 'r'], totalCost: 6, totalGain: 9.1 },
		'{p} (gain 10) is skipped for being a symmetric-diff-1 near-duplicate of #1; {q,r} ' +
			'(diff {p,r}, size 2) is the next diverse option',
	);
	// {r} alone (gain 9) is diff-1 from {q,r} (#2) -> also rejected; {q} alone is diff-1 from #1 ->
	// also rejected. The empty set (diff 2 from both #1 and #2) legitimately fills slot #3.
	assert.deepEqual(
		results[2],
		{ skillIds: [], totalCost: 0, totalGain: 0 },
		'empty set fills #3 once every other feasible combo conflicts with #1 or #2',
	);
}

// --- optimizePurchases: cost tiebreak (equal gain, cost asc) ---
{
	const input: OptimizerInput = {
		candidates: [
			{ id: 'x', gain: 5 },
			{ id: 'y', gain: 5 },
		],
		hints: {},
		ladder: {},
		costs: { x: 3, y: 8 },
		budget: 8,
	};
	const results = optimizePurchases(input);
	assert.deepEqual(results[0], { skillIds: ['x'], totalCost: 3, totalGain: 5 });
	assert.deepEqual(
		results[1],
		{ skillIds: ['y'], totalCost: 8, totalGain: 5 },
		'same gain as #1 but pricier -> ranks second, not tied/ahead',
	);
}

// --- optimizePurchases: budget 0 -> just the empty set ---
{
	const input: OptimizerInput = {
		candidates: [{ id: 'z', gain: 5 }],
		hints: {},
		ladder: {},
		costs: { z: 10 },
		budget: 0,
	};
	assert.deepEqual(optimizePurchases(input), [
		{ skillIds: [], totalCost: 0, totalGain: 0 },
	]);
}

// --- optimizePurchases: all gains <= 0 -> just the empty set ---
{
	const input: OptimizerInput = {
		candidates: [
			{ id: 'z', gain: 0 },
			{ id: 'y', gain: -3 },
		],
		hints: {},
		ladder: {},
		costs: { z: 1, y: 1 },
		budget: 100,
	};
	assert.deepEqual(optimizePurchases(input), [
		{ skillIds: [], totalCost: 0, totalGain: 0 },
	]);
}

// --- optimizePurchases: determinism -- same input twice -> deep-equal output ---
{
	const input: OptimizerInput = {
		candidates: [
			{ id: 'p', gain: 10 },
			{ id: 'q', gain: 0.1 },
			{ id: 'r', gain: 9 },
		],
		hints: {},
		ladder: {},
		costs: { p: 5, q: 1, r: 5 },
		budget: 6,
	};
	assert.deepEqual(optimizePurchases(input), optimizePurchases(input));
}

console.log('spOptimizer tests passed');
