import assert from 'node:assert/strict';
import {
	CHART_LADDERS,
	candidateFromAccumulator,
	derivePreset,
	estimateWorstCaseScenarios,
	evaluateRound,
	PRUNING_DEFAULT,
	type RoundCandidate,
	roundBlockSeed,
	SkillAccumulator,
} from './chartLadder.ts';

// --- roundBlockSeed: distinct, deterministic seeds per round ---
{
	const s0 = roundBlockSeed(42, 0);
	const s1 = roundBlockSeed(42, 1);
	const s2 = roundBlockSeed(42, 2);
	assert.notEqual(s0, s1);
	assert.notEqual(s1, s2);
	assert.equal(roundBlockSeed(42, 1), roundBlockSeed(42, 1));
	// Stride must exceed the largest configured block size, so scenarioId = seed + i (compare.ts)
	// never collides between two rounds' blocks.
	const maxBlockSize = Math.max(
		...Object.values(CHART_LADDERS).flatMap((p) => p.rounds.map((r) => r.n)),
	);
	assert.ok(0x9e3779b1 > maxBlockSize);
}

// --- SkillAccumulator: incremental mean/variance, concatenation, inert/proc tracking ---
{
	const acc = new SkillAccumulator('skillA');
	assert.equal(acc.n, 0);
	assert.equal(acc.allZero, true);

	acc.addBlock(
		{
			lengths: Float32Array.from([1, 2, 3]),
			times: Float32Array.from([0.1, 0.2, 0.3]),
			procCounts: Uint16Array.from([1, 0, 1]),
			procPositions: Float32Array.from([100, 250]),
		},
		{ blockSeed: 111, blockSize: 3 },
	);
	assert.equal(acc.n, 3);
	assert.equal(acc.procTotal, 2);
	assert.equal(acc.allZero, false);
	let mv = acc.meanVariance();
	assert.equal(mv.mean, 2);

	acc.addBlock(
		{
			lengths: Float32Array.from([4, 5]),
			times: Float32Array.from([0.4, 0.5]),
			procCounts: Uint16Array.from([1, 1]),
			procPositions: Float32Array.from([300, 400]),
		},
		{ blockSeed: 222, blockSize: 2 },
	);
	assert.equal(acc.n, 5);
	assert.equal(acc.procTotal, 4);
	mv = acc.meanVariance();
	assert.equal(mv.mean, 3); // mean of 1..5
	assert.deepEqual(Array.from(acc.lengths()), [1, 2, 3, 4, 5]);
	assert.deepEqual(Array.from(acc.procPositions()), [100, 250, 300, 400]);

	const cand = candidateFromAccumulator(acc);
	assert.equal(cand.id, 'skillA');
	assert.equal(cand.n, 5);
	assert.equal(cand.procTotal, 4);

	// resolveIndex: global index 0..2 belongs to the first block (seed 111, size 3), local index
	// unchanged; global index 3..4 belongs to the second block (seed 222, size 2), local index
	// shifted back by the first block's count -- this is what a detail fetch needs to reproduce
	// one specific sample exactly.
	assert.deepEqual(acc.resolveIndex(0), {
		blockSeed: 111,
		blockSize: 3,
		index: 0,
	});
	assert.deepEqual(acc.resolveIndex(2), {
		blockSeed: 111,
		blockSize: 3,
		index: 2,
	});
	assert.deepEqual(acc.resolveIndex(3), {
		blockSeed: 222,
		blockSize: 2,
		index: 0,
	});
	assert.deepEqual(acc.resolveIndex(4), {
		blockSeed: 222,
		blockSize: 2,
		index: 1,
	});
}

{
	// A skill that never activates and never differs from baseline is exactly inert.
	const acc = new SkillAccumulator('dead');
	acc.addBlock(
		{
			lengths: Float32Array.from([0, 0, 0, 0]),
			times: Float32Array.from([0, 0, 0, 0]),
			procCounts: Uint16Array.from([0, 0, 0, 0]),
			procPositions: Float32Array.from([]),
		},
		{ blockSeed: 333, blockSize: 4 },
	);
	assert.equal(acc.allZero, true);
	assert.equal(acc.procTotal, 0);
}

// --- evaluateRound: the actual screening decision ---
const preset = CHART_LADDERS.quick; // targetPool 16, precisionTarget 0.03

function candidate(
	id: string,
	n: number,
	mean: number,
	variance: number,
	procTotal = n,
	allZero = false,
): RoundCandidate {
	return { id, n, mean, variance, procTotal, allZero };
}

{
	// A clearly-good skill (high mean, tight variance) should survive and be protected even
	// against a large pool of mediocre competitors.
	const good = candidate('good', 100, 2.0, 0.5);
	const mediocrePool = Array.from({ length: 30 }, (_, i) =>
		candidate(`mediocre${i}`, 100, 0.02, 0.01),
	);
	const decisions = evaluateRound(
		[good, ...mediocrePool],
		preset.rounds[0],
		preset,
		false,
	);
	const goodDecision = decisions.find((d) => d.id === 'good')!;
	assert.equal(goodDecision.status, 'refining');
	assert.equal(goodDecision.eliminationReason, null);
}

{
	// A clearly-bad skill (near-zero mean, tight variance, so its upper bound is genuinely low)
	// sitting alongside enough clearly-good skills to fill the protected pool should be eliminated
	// once it has enough samples to trust the interval.
	const bad = candidate('bad', 100, 0.001, 0.0001);
	const goodPool = Array.from({ length: 20 }, (_, i) =>
		candidate(`good${i}`, 100, 1.0 + i * 0.01, 0.05),
	);
	const decisions = evaluateRound(
		[bad, ...goodPool],
		preset.rounds[0],
		preset,
		false,
	);
	const badDecision = decisions.find((d) => d.id === 'bad')!;
	assert.equal(badDecision.status, 'screened');
	assert.equal(badDecision.eliminationReason, 'ci');
}

{
	// A skill with n below the CI-elimination floor must not be eliminated on CI grounds alone,
	// even if it looks bad -- only the budget rule (or inert-check) can remove it that early.
	const tooFew = candidate('tooFew', 10, 0.001, 0.0001);
	const goodPool = Array.from({ length: 20 }, (_, i) =>
		candidate(`good${i}`, 100, 1.0 + i * 0.01, 0.05),
	);
	const decisions = evaluateRound(
		[tooFew, ...goodPool],
		preset.rounds[0],
		preset,
		false,
	);
	const decision = decisions.find((d) => d.id === 'tooFew')!;
	assert.notEqual(decision.eliminationReason, 'ci');
}

{
	// High-variance, zero-mean skill: genuinely inconsistent, not obviously bad -- should not be
	// eliminated on a small pool where it isn't crowded out by better options.
	const volatile = candidate('volatile', 100, 0.0, 3.0);
	const decisions = evaluateRound([volatile], preset.rounds[0], preset, false);
	const decision = decisions.find((d) => d.id === 'volatile')!;
	assert.notEqual(decision.status, 'screened');
}

{
	// Exact zero effect and zero procs -- inert, regardless of pool composition.
	const dead = candidate('dead', 100, 0, 0, 0, true);
	const good = candidate('good', 100, 1.5, 0.2);
	const decisions = evaluateRound(
		[dead, good],
		preset.rounds[0],
		preset,
		false,
	);
	const decision = decisions.find((d) => d.id === 'dead')!;
	assert.equal(decision.status, 'inert');
	assert.equal(decision.eliminationReason, 'inert');
}

{
	// A very tight interval (huge n, tiny variance) should converge and freeze as final even on a
	// non-final round, without needing to reach the ladder's last round.
	const converged = candidate('converged', 5000, 1.0, 0.0001);
	const decisions = evaluateRound([converged], preset.rounds[0], preset, false);
	const decision = decisions.find((d) => d.id === 'converged')!;
	assert.equal(decision.status, 'final');
	assert.equal(decision.eliminationReason, 'converged');
}

{
	// Budget: more survivors than the round's cap should keep exactly `cap` of them, by upper
	// bound, and screen the rest with reason 'budget'. Means are packed into a band far narrower
	// than the screening interval's half-width so nothing gets CI-eliminated first -- this
	// isolates the budget rule specifically, rather than exercising both at once.
	const round = preset.rounds[1]; // cap 96 in 'quick'
	const pool = Array.from({ length: round.cap + 20 }, (_, i) =>
		candidate(`c${i}`, 100, 1.0 + i * 0.0001, 0.02),
	);
	const decisions = evaluateRound(pool, round, preset, false);
	const kept = decisions.filter(
		(d) => d.status === 'refining' || d.status === 'final',
	);
	const budgeted = decisions.filter((d) => d.eliminationReason === 'budget');
	assert.equal(kept.length, round.cap);
	assert.equal(budgeted.length, pool.length - round.cap);
	// The highest-mean (highest-ucb, all same variance/n here) candidates should be the ones kept.
	const keptIds = new Set(kept.map((d) => d.id));
	for (let i = pool.length - round.cap; i < pool.length; ++i) {
		assert.ok(keptIds.has(`c${i}`), `expected c${i} to survive the budget cut`);
	}
}

{
	// On the ladder's last round, any surviving (non-eliminated) skill becomes 'final', not
	// 'refining' -- there is no next round to refine into.
	const decisions = evaluateRound(
		[candidate('last', 100, 1.0, 0.1)],
		preset.rounds[preset.rounds.length - 1],
		preset,
		true,
	);
	assert.equal(decisions[0].status, 'final');
}

// --- derivePreset: the Pruning slider's derivation ---

{
	// PRUNING_DEFAULT must reproduce the base preset exactly -- not approximately -- for all three
	// presets. This is the regression guard for the whole feature: every ramp in derivePreset() is
	// centered so t=0 falls out to an exact identity rather than being special-cased at pruning===50.
	for (const name of Object.keys(
		CHART_LADDERS,
	) as (keyof typeof CHART_LADDERS)[]) {
		const base = CHART_LADDERS[name];
		assert.deepEqual(
			derivePreset(base, PRUNING_DEFAULT),
			base,
			`${name} not identity at default`,
		);
	}
}

{
	// Sample depth (rounds[i].n) and round 1's unbounded cap are the Preset selector's job, not
	// Pruning's -- they must never move, at any slider position.
	const base = CHART_LADDERS.balanced;
	for (let pruning = 0; pruning <= 100; pruning += 5) {
		const derived = derivePreset(base, pruning);
		assert.deepEqual(
			derived.rounds.map((r) => r.n),
			base.rounds.map((r) => r.n),
			`rounds[].n moved at pruning=${pruning}`,
		);
		assert.equal(derived.rounds[0].cap, Number.POSITIVE_INFINITY);
	}
}

{
	// Monotonicity across the full sweep, for every preset: lower pruning must never be less
	// aggressive than a higher pruning value on any of the five scaled fields.
	for (const base of Object.values(CHART_LADDERS)) {
		let prev = derivePreset(base, 0);
		for (let pruning = 5; pruning <= 100; pruning += 5) {
			const cur = derivePreset(base, pruning);
			assert.ok(
				cur.screenZ > prev.screenZ,
				`screenZ not strictly increasing at ${pruning}`,
			);
			assert.ok(
				cur.targetPool >= prev.targetPool,
				`targetPool decreased at ${pruning}`,
			);
			assert.ok(
				cur.precisionTarget <= prev.precisionTarget,
				`precisionTarget increased at ${pruning}`,
			);
			assert.ok(
				cur.minInterestingGain <= prev.minInterestingGain,
				`minInterestingGain increased at ${pruning}`,
			);
			for (let i = 0; i < cur.rounds.length; ++i) {
				if (Number.isFinite(cur.rounds[i].cap)) {
					assert.ok(
						cur.rounds[i].cap >= prev.rounds[i].cap,
						`rounds[${i}].cap decreased at ${pruning}`,
					);
				}
			}
			prev = cur;
		}
	}
}

{
	// Structural invariants that must hold at every slider position, not just the default: every
	// positive-scale field stays positive, and every finite cap stays a positive integer. (A round's
	// cap is allowed to sit below targetPool -- CHART_LADDERS.thorough's own last round already
	// does that by design, since evaluateRound's budget step 6 is allowed to narrow past the
	// protected pool on a final round; derivePreset must not disturb that.)
	for (const base of Object.values(CHART_LADDERS)) {
		for (let pruning = 0; pruning <= 100; pruning += 5) {
			const derived = derivePreset(base, pruning);
			assert.ok(derived.targetPool >= 4);
			assert.ok(derived.precisionTarget > 0);
			assert.ok(derived.minInterestingGain > 0);
			assert.ok(derived.screenZ > 0);
			for (const r of derived.rounds) {
				if (Number.isFinite(r.cap))
					assert.ok(r.cap >= 1, `cap < 1 at pruning=${pruning}`);
			}
		}
	}
}

{
	// Behavioral end-to-end: on the same fixed candidate pool, the aggressive end of the slider
	// must stop sampling strictly more skills this round than the lenient end. "Stops sampling"
	// means status !== 'refining' -- not just CI/budget screening, but also an early 'converged'
	// freeze, since a coarser precisionTarget (also part of the aggressive derivation) is just as
	// much a way a skill stops getting sampled as being screened out is. Reuses the budget test's
	// pool shape above (a tight mean band spanning the round's cap).
	const round = CHART_LADDERS.quick.rounds[1]; // cap 96 in 'quick'
	const pool = Array.from({ length: round.cap + 20 }, (_, i) =>
		candidate(`c${i}`, 100, 1.0 + i * 0.0001, 0.02),
	);
	const aggressive = derivePreset(CHART_LADDERS.quick, 0);
	const lenient = derivePreset(CHART_LADDERS.quick, 100);
	const stoppedAggressive = evaluateRound(
		pool,
		aggressive.rounds[1],
		aggressive,
		false,
	).filter((d) => d.status !== 'refining').length;
	const stoppedLenient = evaluateRound(
		pool,
		lenient.rounds[1],
		lenient,
		false,
	).filter((d) => d.status !== 'refining').length;
	assert.ok(
		stoppedAggressive > stoppedLenient,
		`expected aggressive (${stoppedAggressive}) to stop sampling more than lenient (${stoppedLenient})`,
	);
}

// --- estimateWorstCaseScenarios: cost model behind the Skill Chart's runtime estimate ---

{
	const base = CHART_LADDERS.balanced;
	const costAt = (pruning: number) =>
		estimateWorstCaseScenarios(derivePreset(base, pruning), 520);
	const aggressive = costAt(0);
	const standard = costAt(PRUNING_DEFAULT);
	const lenient = costAt(100);
	assert.ok(
		aggressive < standard,
		`expected aggressive cost (${aggressive}) < standard (${standard})`,
	);
	assert.ok(
		standard < lenient,
		`expected standard cost (${standard}) < lenient (${lenient})`,
	);
}

console.log('chartLadder tests passed');
