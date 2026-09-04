import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import type { LadderIndex } from './shopSkillFilter.ts';
import {
	buildHintClusters,
	discountedCost,
	expandHints,
	findBestValue,
	HINT_DISCOUNT,
	loadShopSkillHints,
	type OptimizerInput,
	optimizePurchases,
	pruneHints,
	remapHintKeys,
} from './spOptimizer.ts';

test('discountedCost: every hint level, rounding, edge inputs', () => {
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
});

test('loadShopSkillHints: parsing/validation', () => {
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
});

test('pruneHints: drop non-kept ids; same reference when nothing dropped', () => {
	const hints = { a: 1, b: 2, c: 3 };
	assert.deepEqual(pruneHints(hints, ['a', 'c']), { a: 1, c: 3 });

	const untouched = { a: 1 };
	assert.equal(
		pruneHints(untouched, ['a', 'zzz']),
		untouched,
		'nothing dropped -> same object reference returned',
	);
});

test('buildHintClusters: cluster key is `${group}:${rarity}` when both known, else the id itself', () => {
	const ladder: LadderIndex = {
		circle: { group: 'g1', rate: 1 },
		doubleCircle: { group: 'g1', rate: 2 },
		white: { group: 'g2', rate: 1 },
		gold: { group: 'g2', rate: 2 },
		circle3: { group: 'g3', rate: 1 },
		doubleCircle3: { group: 'g3', rate: 2 },
		gold3: { group: 'g3', rate: 3 },
		singleton: { group: 'g4', rate: 1 },
		noRarity: { group: 'g5', rate: 1 }, // in ladder, absent from rarities
	};
	const rarities: { [id: string]: number } = {
		circle: 1,
		doubleCircle: 1,
		white: 1,
		gold: 2,
		circle3: 1,
		doubleCircle3: 1,
		gold3: 2,
		singleton: 1,
		noLadder: 1, // in rarities, absent from ladder
	};
	const clusters = buildHintClusters(ladder, rarities);

	// ○/◎ pair: same group, same rarity -> same cluster key.
	assert.equal(
		clusters.circle,
		clusters.doubleCircle,
		'○/◎ pair shares a cluster key',
	);
	assert.equal(clusters.circle, 'g1:1');

	// white+gold pair: same group, different rarity -> different cluster keys.
	assert.notEqual(
		clusters.white,
		clusters.gold,
		'white/gold pair does not share a cluster key',
	);
	assert.equal(clusters.white, 'g2:1');
	assert.equal(clusters.gold, 'g2:2');

	// three-rung ○/◎/gold family: ○/◎ share, gold alone.
	assert.equal(
		clusters.circle3,
		clusters.doubleCircle3,
		'○/◎ share within a 3-rung family',
	);
	assert.notEqual(
		clusters.circle3,
		clusters.gold3,
		'gold is its own cluster within a 3-rung family',
	);
	assert.equal(clusters.gold3, 'g3:2');

	// singleton group: still keyed by group:rarity even with no sibling to share with.
	assert.equal(clusters.singleton, 'g4:1');

	// id absent from `rarities` (present only in `ladder`) falls back to its own id.
	assert.equal(clusters.noRarity, 'noRarity');
	// id absent from `ladder` (present only in `rarities`) falls back to its own id.
	assert.equal(clusters.noLadder, 'noLadder');
	// id absent from both inputs entirely never gets an entry (caller does `HINT_CLUSTERS[id] ?? id`).
	assert.equal(clusters.orphan, undefined);
});

test('expandHints: per-cluster level fans out to every member; a bare id keeps its own hint', () => {
	// expandHints: per-cluster level fans out to every member; a key with no cluster members
	// (the B1 JP case: a bare skill id outside the ladder) keeps its own hint through expansion.
	const clusters: { [id: string]: string } = {
		circle: 'g1:1',
		doubleCircle: 'g1:1',
	};
	// A cluster key with two members, neither of which is itself a key in clusterHints.
	assert.deepEqual(expandHints({ 'g1:1': 4 }, clusters), {
		circle: 4,
		doubleCircle: 4,
	});
	// A bare skill id absent from `clusters` entirely (e.g. a JP rarity-6 pink skill outside the
	// rarity<=2 ladder) keeps its own hint level through expansion instead of being dropped.
	assert.deepEqual(expandHints({ pinkSkill: 3 }, clusters), { pinkSkill: 3 });
	// Mixed: one clustered key, one bare passthrough key, in the same call.
	assert.deepEqual(expandHints({ 'g1:1': 2, pinkSkill: 5 }, clusters), {
		circle: 2,
		doubleCircle: 2,
		pinkSkill: 5,
	});
});

test('remapHintKeys: migrates old per-id hints to cluster keys (collision keeps max), is idempotent', () => {
	// remapHintKeys: migrates old per-id hints to cluster keys (collision keeps max), is
	// idempotent, and leaves unknown/already-cluster keys untouched.
	const clusters: { [id: string]: string } = {
		circle: 'g1:1',
		doubleCircle: 'g1:1',
		gold: 'g2:2',
	};
	const oldPerId = { circle: 2, doubleCircle: 4, gold: 1, unknownId: 3 };
	const migrated = remapHintKeys(oldPerId, clusters);
	assert.deepEqual(migrated, { 'g1:1': 4, 'g2:2': 1, unknownId: 3 });

	// Idempotent: running it again on the already-migrated (cluster-keyed) map is a no-op, since
	// no cluster key is ever itself a value looked up in `clusters` (ids/groupIds never contain
	// ':', so `clusters['g1:1']` is undefined and the `?? key` fallback keeps it as-is).
	assert.deepEqual(remapHintKeys(migrated, clusters), migrated);

	// A key already in cluster form, or one `clusters` doesn't recognize at all, passes through
	// untouched.
	assert.deepEqual(remapHintKeys({ 'g1:1': 5, someUnknown: 2 }, clusters), {
		'g1:1': 5,
		someUnknown: 2,
	});
});

describe('optimizePurchases', () => {
	test('single-rung group, exactly-budget vs budget-1', () => {
		const input: OptimizerInput = {
			candidates: [{ id: 's1', gain: 5 }],
			hints: {},
			ladder: {},
			costs: { s1: 100 },
			budget: 100,
		};
		assert.deepEqual(optimizePurchases(input).options, [
			{ skillIds: ['s1'], totalCost: 100, totalGain: 5 },
		]);
		assert.deepEqual(optimizePurchases({ ...input, budget: 99 }).options, [
			{ skillIds: [], totalCost: 0, totalGain: 0 },
		]);
	});

	test('3-rung ladder: terminal tier buys every rung at its own hint level', () => {
		// gain is the terminal rung's gain only (never summed across rungs).
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
		assert.deepEqual(optimizePurchases(input).options, [
			{ skillIds: ['white', 'gold', 'evo'], totalCost: 341, totalGain: 50 },
		]);
		assert.deepEqual(optimizePurchases({ ...input, budget: 340 }).options, [
			{ skillIds: [], totalCost: 0, totalGain: 0 },
		]);
	});

	test('gold candidate whose white is NOT itself a candidate', () => {
		// cost still includes the white's discountedCost at hints[white] ?? 0.
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
		assert.deepEqual(optimizePurchases(input).options, [
			{ skillIds: ['white2', 'gold2'], totalCost: 220, totalGain: 20 },
		]);
	});

	test('owned rungs are free, count toward prerequisites, never a terminal tier', () => {
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
			assert.deepEqual(optimizePurchases(input).options, [
				{ skillIds: ['gold3'], totalCost: 120, totalGain: 15 },
			]);
			assert.deepEqual(optimizePurchases({ ...input, budget: 119 }).options, [
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
			assert.deepEqual(optimizePurchases(input).options, [
				{ skillIds: [], totalCost: 0, totalGain: 0 },
			]);
		}
	});

	test('two independent groups, budget forces the non-greedy choice', () => {
		// Greedy-by-raw-gain would buy 'big' first (highest single gain) and stop; the true optimum
		// combines the two cheaper skills for more total gain within the same budget.
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
		const results = optimizePurchases(input).options;
		assert.deepEqual(results[0], {
			skillIds: ['small1', 'small2'],
			totalCost: 10,
			totalGain: 12,
		});
	});

	test('dominance counterexample', () => {
		// A dominated tier (b, cost 5 gain 4, vs a, cost 5 gain 3 -- same cost, lower gain than
		// nothing dominates here since both are candidates, but 'a' is strictly worse than 'b'
		// standalone) must still surface as part of a diverse #2/#3, i.e. it must NOT be pruned away
		// just because it looks locally worse. Also exercises: an id ('a') in the ladder as its own
		// singleton group, another ('b') likewise with a distinct group id, and a third ('c') absent
		// from the ladder entirely. Doubles as the top-3 ordering + symmetric-difference-2-is-accepted
		// case.
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
		const results = optimizePurchases(input).options;
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
	});

	test('near-duplicate (symmetric difference 1) is rejected in favor of the next diverse option', () => {
		// The empty set legitimately fills a later slot when nothing else qualifies.
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
		const results = optimizePurchases(input).options;
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
	});

	test('cost tiebreak (equal gain, cost asc)', () => {
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
		const results = optimizePurchases(input).options;
		assert.deepEqual(results[0], {
			skillIds: ['x'],
			totalCost: 3,
			totalGain: 5,
		});
		assert.deepEqual(
			results[1],
			{ skillIds: ['y'], totalCost: 8, totalGain: 5 },
			'same gain as #1 but pricier -> ranks second, not tied/ahead',
		);
	});

	test('budget 0 -> just the empty set', () => {
		const input: OptimizerInput = {
			candidates: [{ id: 'z', gain: 5 }],
			hints: {},
			ladder: {},
			costs: { z: 10 },
			budget: 0,
		};
		assert.deepEqual(optimizePurchases(input).options, [
			{ skillIds: [], totalCost: 0, totalGain: 0 },
		]);
	});

	test('all gains <= 0 -> just the empty set', () => {
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
		assert.deepEqual(optimizePurchases(input).options, [
			{ skillIds: [], totalCost: 0, totalGain: 0 },
		]);
	});

	test('determinism: same input twice -> deep-equal output', () => {
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
		assert.deepEqual(
			optimizePurchases(input).options,
			optimizePurchases(input).options,
		);
	});

	test('truncated flag: untruncated at normal scale', () => {
		// ceiling hit is surfaced, not thrown, and still returns a best-effort selection.
		const input = {
			candidates: [{ id: 'a', gain: 1 }],
			hints: {},
			ladder: {},
			costs: { a: 10 },
			budget: 100,
		};
		assert.equal(optimizePurchases(input).truncated, false);
	});
});

// --- end-to-end: a shared cluster hint (expanded via expandHints before reaching
// optimizePurchases) discounts BOTH rungs of a ○/◎ pair, even though only the ◎ is a candidate ---
test('end-to-end: a shared cluster hint discounts both rungs of a circle/double-circle pair', () => {
	const ladder: LadderIndex = {
		circleE: { group: 'gE', rate: 1 },
		doubleE: { group: 'gE', rate: 2 },
	};
	const rarities = { circleE: 1, doubleE: 1 };
	const clusters = buildHintClusters(ladder, rarities);
	assert.equal(clusters.circleE, clusters.doubleE); // sanity: still a shared cluster

	const clusterHints = { [clusters.doubleE]: 3 };
	const expanded = expandHints(clusterHints, clusters);
	assert.deepEqual(expanded, { circleE: 3, doubleE: 3 });

	const input: OptimizerInput = {
		candidates: [{ id: 'doubleE', gain: 20 }], // only the ◎ is shortlisted/candidate
		hints: expanded,
		ladder,
		costs: { circleE: 100, doubleE: 150 },
		// discountedCost(100,3) = round(100*.7) = 70; discountedCost(150,3) = round(150*.7) = 105
		budget: 175,
		topK: 1,
	};
	assert.deepEqual(optimizePurchases(input).options, [
		{ skillIds: ['circleE', 'doubleE'], totalCost: 175, totalGain: 20 },
	]);
	// One level lower would leave the ○ prerequisite's cost undiscounted, which must NOT fit.
	assert.deepEqual(optimizePurchases({ ...input, budget: 174 }).options, [
		{ skillIds: [], totalCost: 0, totalGain: 0 },
	]);
});

describe('findBestValue', () => {
	test('empty input -> null', () => {
		assert.equal(findBestValue([], {}, {}, {}, new Set()), null);
	});

	test('every candidate has non-positive gain -> null', () => {
		const result = findBestValue(
			[
				{ id: 'a', gain: 0 },
				{ id: 'b', gain: -5 },
			],
			{},
			{},
			{ a: 100, b: 100 },
			new Set(),
		);
		assert.equal(result, null);
	});

	test('zero/missing cost is excluded, not treated as an infinite ratio', () => {
		// Both candidates resolve to cost 0 (one explicit baseCost: 0, one absent from costs entirely)
		// -> no candidate qualifies -> null, not a divide-by-zero/Infinity ratio.
		assert.equal(
			findBestValue(
				[
					{ id: 'a', gain: 10 },
					{ id: 'b', gain: 5 },
				],
				{},
				{},
				{ a: 0 }, // b absent from costs -> costs[b] ?? 0 -> 0
				new Set(),
			),
			null,
		);
		// A huge-gain zero-cost candidate must NOT win over a real, positive-cost one.
		const result = findBestValue(
			[
				{ id: 'zero', gain: 100 },
				{ id: 'real', gain: 1 },
			],
			{},
			{},
			{ real: 10 }, // 'zero' absent -> cost 0 -> excluded
			new Set(),
		);
		assert.deepEqual(result, {
			id: 'real',
			gain: 1,
			cost: 10,
			chainIds: [],
			ratio: 0.1,
		});
	});

	test('higher ratio beats higher raw gain', () => {
		const result = findBestValue(
			[
				{ id: 'a', gain: 10 },
				{ id: 'b', gain: 5 },
			],
			{},
			{},
			{ a: 100, b: 10 },
			new Set(),
		);
		// ratio a = 10/100 = 0.1; ratio b = 5/10 = 0.5 -- b wins despite half the raw gain.
		assert.deepEqual(result, {
			id: 'b',
			gain: 5,
			cost: 10,
			chainIds: [],
			ratio: 0.5,
		});
	});

	test('ratio+cost tie -> ascending id; a hint discount on the loser flips the winner', () => {
		const candidates = [
			{ id: 'a', gain: 10 },
			{ id: 'b', gain: 10 },
		];
		const costs = { a: 100, b: 100 };
		// No hints: exact tie on ratio (0.1) and cost (100) -- ascending id picks 'a'.
		assert.deepEqual(findBestValue(candidates, {}, {}, costs, new Set()), {
			id: 'a',
			gain: 10,
			cost: 100,
			chainIds: [],
			ratio: 0.1,
		});
		// Hint discount on 'b' (level 5 -> discountedCost(100,5) = round(100*0.6) = 60) raises its
		// ratio above 'a's -- the winner flips even though raw gain is identical.
		assert.deepEqual(
			findBestValue(candidates, { b: 5 }, {}, costs, new Set()),
			{
				id: 'b',
				gain: 10,
				cost: 60,
				chainIds: [],
				ratio: 10 / 60,
			},
		);
	});

	test("chain cost: an unowned gold's cost includes its white prerequisite", () => {
		const ladder: LadderIndex = {
			white: { group: 'g1', rate: 1 },
			gold: { group: 'g1', rate: 2 },
		};
		const costs = { gold: 20, white: 150 };

		// Gold alone: cost is gold's own cost PLUS the unowned white prerequisite's cost, not just its
		// own price -- matches optimizePurchases/buildGroups' chain-cost semantics.
		assert.deepEqual(
			findBestValue([{ id: 'gold', gain: 20 }], {}, ladder, costs, new Set()),
			{ id: 'gold', gain: 20, cost: 170, chainIds: ['white'], ratio: 20 / 170 },
		);

		// An OWNED prerequisite is excluded from the chain -- gold's cost is then just its own price.
		assert.deepEqual(
			findBestValue(
				[{ id: 'gold', gain: 20 }],
				{},
				ladder,
				costs,
				new Set(['white']),
			),
			{ id: 'gold', gain: 20, cost: 20, chainIds: [], ratio: 1 },
		);

		// The chain cost flips the winner vs. what an own-cost-only comparison would pick: gold's own
		// cost (20) beats x's (10), but gold's REAL chain cost (170, including white) loses to x.
		const result = findBestValue(
			[
				{ id: 'gold', gain: 20 },
				{ id: 'x', gain: 5 },
			],
			{},
			ladder,
			{ ...costs, x: 10 },
			new Set(),
		);
		assert.deepEqual(result, {
			id: 'x',
			gain: 5,
			cost: 10,
			chainIds: [],
			ratio: 0.5,
		});
	});
});
