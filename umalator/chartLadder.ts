// The Skill Chart's adaptive sampling schedule: how many paired scenarios each round of a
// candidate skill gets, and the rule that decides which skills keep receiving more samples versus
// which get frozen out early.
//
// Master's chart ran a fixed 3-round ladder (25 -> 50 -> 125 samples) with a crude `max > 0.1`
// survival filter. A later branch replaced the ladder entirely with one flat round at a fixed
// sample count for every candidate, with no pruning -- at its "Thorough" preset that was 1600
// samples x ~520 candidate skills, about 25x the total work the original ladder did, most of it
// spent proving already-obviously-bad skills are bad.
//
// This ladder keeps the "cheap first, spend more only on skills that still look competitive"
// shape master had, but replaces the ad hoc filter with a defensible one: a skill is eliminated
// once its confidence interval's upper bound falls below both an absolute "not worth it" floor
// and the lower bound of the current top candidates -- not because a handful of early samples
// happened to look unimpressive. See evaluateRound() below for the exact rule.

import type { SkillStatistics } from './statisticalAnalysis';

export type AnalysisPresetName = 'quick' | 'balanced' | 'thorough';

export interface LadderRound {
	// Cumulative sample count a surviving skill should have after this round.
	n: number;
	// Max number of skills allowed to enter this round; Infinity for round 1 (every candidate
	// gets at least the first round's samples).
	cap: number;
}

export interface LadderPreset {
	rounds: LadderRound[];
	// How many of the current best skills evaluateRound() will never eliminate, regardless of
	// how their interval compares to the gate -- keeps a competitive skill in the running even if
	// an early, noisy read makes it look worse than the gate for a round or two.
	targetPool: number;
	bootstrapSamples: number;
	// A skill stops sampling early, before its last scheduled round, once its interval half-width
	// (at the screening z, see evaluateRound()) is at or under this many lengths.
	precisionTarget: number;
	// Screening z-score and absolute "not worth it" floor -- see the SCREEN_Z / MIN_INTERESTING_GAIN
	// module consts below for the rationale behind the default values every preset here starts
	// from. Per-preset (rather than global consts) so derivePreset() can scale them independently
	// of the Preset selector's round-depth knobs.
	screenZ: number;
	minInterestingGain: number;
}

// Default screening z -- see evaluateRound()'s SCREEN_Z-equivalent rationale: a screening bound,
// not a claim of simultaneous 95% coverage across every candidate in the pool. A real Bonferroni
// correction across ~500 arms x up to 4 rounds would need z ~ 4.2, wide enough that this rule
// would eliminate almost nothing and the round cap would end up doing all the actual work; 3.5 is
// the deliberate, documented compromise between the two.
const SCREEN_Z = 3.5;

// Default "not worth considering at all" floor, in lengths -- replaces master's `max > 0.1`
// round-1 filter with a fixed, scale-free threshold. 12.5 cm; a skill has to clear this even to
// be compared against the current best candidates.
const MIN_INTERESTING_GAIN = 0.05;

// Total scenario counts (K candidates, worst case, cap always binding): quick ~32,000, balanced
// ~61,800, thorough ~119,300 at K=520 -- versus master's own ladder at ~33,000 and the flat-N
// branch's Thorough at 832,000. See docs/statistical-analysis.md for the derivation.
export const CHART_LADDERS: Record<AnalysisPresetName, LadderPreset> = {
	quick: {
		rounds: [
			{ n: 32, cap: Number.POSITIVE_INFINITY },
			{ n: 128, cap: 96 },
			{ n: 384, cap: 24 },
		],
		targetPool: 16,
		bootstrapSamples: 1000,
		precisionTarget: 0.03,
		screenZ: SCREEN_Z,
		minInterestingGain: MIN_INTERESTING_GAIN,
	},
	balanced: {
		rounds: [
			{ n: 48, cap: Number.POSITIVE_INFINITY },
			{ n: 192, cap: 128 },
			{ n: 768, cap: 32 },
		],
		targetPool: 20,
		bootstrapSamples: 2000,
		precisionTarget: 0.02,
		screenZ: SCREEN_Z,
		minInterestingGain: MIN_INTERESTING_GAIN,
	},
	thorough: {
		rounds: [
			{ n: 64, cap: Number.POSITIVE_INFINITY },
			{ n: 256, cap: 160 },
			{ n: 1024, cap: 40 },
			{ n: 3072, cap: 12 },
		],
		targetPool: 24,
		bootstrapSamples: 2000,
		precisionTarget: 0.015,
		screenZ: SCREEN_Z,
		minInterestingGain: MIN_INTERESTING_GAIN,
	},
};

// How quickly the ladder cuts a skill that looks unpromising, as a 0-100 UI slider position;
// PRUNING_DEFAULT reproduces CHART_LADDERS' own numbers exactly (see derivePreset()'s identity
// test in chartLadder.test.ts -- the ramps below are centered to fall out to identity at t=0
// rather than special-cased at pruning===50, so a mis-centered ramp can't hide behind a shortcut).
export const PRUNING_DEFAULT = 50;

// Derive a LadderPreset from a base preset and a 0-100 "pruning aggressiveness" slider position.
// Lower prunes sooner (tighter screening z, smaller protected pool and round caps, coarser
// precision/floor targets -- faster, more likely to cut a skill that would've turned out fine).
// Higher keeps marginal skills sampling longer (wider z, bigger pool and caps, finer targets --
// slower, less likely to cut a skill early). Deliberately does NOT touch rounds[i].n or
// bootstrapSamples: sample depth is the Preset selector's job, not this knob's, and keeping the
// two orthogonal is what makes both controls independently explainable.
export function derivePreset(
	base: LadderPreset,
	pruning: number,
): LadderPreset {
	const clamped = Number.isFinite(pruning)
		? Math.min(100, Math.max(0, pruning))
		: PRUNING_DEFAULT;
	const t = (clamped - 50) / 50;

	const targetPool = Math.max(4, Math.round(base.targetPool * 2 ** t));
	return {
		rounds: base.rounds.map((r) => ({
			n: r.n,
			// Not clamped to targetPool: CHART_LADDERS.thorough's own last round already caps below
			// its targetPool by design (12 < 24) -- the budget rule (evaluateRound step 6) is allowed
			// to narrow past the protected pool on a final round, so a clamp here would break the
			// t=0 identity for that preset. Math.max(1, ...) only guards against a degenerate <1 cap
			// at the most aggressive slider position.
			cap: Number.isFinite(r.cap)
				? Math.max(1, Math.round(r.cap * 2.5 ** t))
				: r.cap,
		})),
		targetPool,
		bootstrapSamples: base.bootstrapSamples,
		precisionTarget: base.precisionTarget * 2 ** -t,
		screenZ: base.screenZ + t * 1.0,
		minInterestingGain: base.minInterestingGain * 2 ** -t,
	};
}

// Worst-case total scenario count for a preset over K candidates, assuming every round's cap
// binds (every candidate that could survive does, until capped) -- used for the Skill Chart's
// pre-run runtime estimate. Pure function of the preset's shape, so it lives with the ladder
// rather than in app.tsx (which only knows how to format the result for display).
export function estimateWorstCaseScenarios(
	preset: LadderPreset,
	skillCount: number,
): number {
	let total = 0;
	let pool = skillCount;
	let prevN = 0;
	for (const round of preset.rounds) {
		const blockSize = round.n - prevN;
		total += pool * blockSize;
		pool = Number.isFinite(round.cap) ? Math.min(pool, round.cap) : pool;
		prevN = round.n;
	}
	return total;
}

// Round r's scenarios are a fresh block, disjoint from every other round's, so a skill's sample
// set after round r is exactly the union of blocks 1..r regardless of which other skills were
// also being sampled or eliminated along the way -- no fast-forwarding or resuming a stream, and
// every skill that reaches round r has seen exactly the same scenario families in the same order.
// The stride only needs to exceed the largest block size (round.n), which 0x9e3779b1 always does
// at the preset sizes above; compare.ts's scenarioId = seed + i confirms blocks don't collide.
export function roundBlockSeed(baseSeed: number, roundIndex: number): number {
	return (baseSeed + roundIndex * 0x9e3779b1) >>> 0;
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Float32Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

function concatUint16(chunks: Uint16Array[]): Uint16Array {
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint16Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

export interface BlockLike {
	lengths: Float32Array;
	times: Float32Array;
	procCounts: Uint16Array;
	procPositions: Float32Array;
}

// Accumulates one candidate skill's results across however many rounds it survives. Mean and
// variance are tracked incrementally (O(block size) per round) so a round-boundary screening
// check never has to re-scan a skill's earlier rounds; the full sample arrays (needed only for
// percentiles, help/hurt/tie counts, and a final BCa bootstrap) are concatenated lazily, on the
// rare path where a skill's final summary is actually being computed.
// Which (blockSeed, blockSize) a chunk of samples came from, and how many samples of it are in
// this chunk -- kept in call order so a global sample index (position in the concatenated
// lengths()/times() arrays) can be mapped back to the exact scenario that produced it, for an
// expanded row's on-demand detail fetch (see app.tsx's requestChartDetail).
interface ChunkProvenance {
	blockSeed: number;
	blockSize: number;
	count: number;
}

export class SkillAccumulator {
	readonly id: string;
	private lengthChunks: Float32Array[] = [];
	private timeChunks: Float32Array[] = [];
	private procCountChunks: Uint16Array[] = [];
	private procPositionChunks: Float32Array[] = [];
	private provenance: ChunkProvenance[] = [];
	private _n = 0;
	private _sum = 0;
	private _sumSq = 0;
	private _procTotal = 0;
	private _allZero = true;

	constructor(id: string) {
		this.id = id;
	}

	// `provenance` identifies the block this chunk's samples came from (its scenario seed and
	// size) -- required, and always supplied by every real caller, so resolveIndex()'s offset
	// walk can assume the provenance list lines up 1:1 with lengthChunks.
	addBlock(
		block: BlockLike,
		provenance: { blockSeed: number; blockSize: number },
	): void {
		const { lengths, procCounts } = block;
		for (let i = 0; i < lengths.length; ++i) {
			const v = lengths[i];
			this._sum += v;
			this._sumSq += v * v;
			if (v !== 0) this._allZero = false;
		}
		for (let i = 0; i < procCounts.length; ++i)
			this._procTotal += procCounts[i];
		this.lengthChunks.push(block.lengths);
		this.timeChunks.push(block.times);
		this.procCountChunks.push(block.procCounts);
		this.procPositionChunks.push(block.procPositions);
		this.provenance.push({ ...provenance, count: lengths.length });
		this._n += lengths.length;
	}

	// Maps a global sample index (an index into lengths()/times(), i.e. concatenation order) back
	// to which block produced it and that block's own local index -- the (blockSeed, blockSize,
	// index) triple runComparisonBlock's `only` parameter needs to re-simulate that one sample.
	resolveIndex(
		globalIndex: number,
	): { blockSeed: number; blockSize: number; index: number } | null {
		let offset = 0;
		for (const p of this.provenance) {
			if (globalIndex < offset + p.count) {
				return {
					blockSeed: p.blockSeed,
					blockSize: p.blockSize,
					index: globalIndex - offset,
				};
			}
			offset += p.count;
		}
		return null;
	}

	get n(): number {
		return this._n;
	}

	get procTotal(): number {
		return this._procTotal;
	}

	get allZero(): boolean {
		return this._allZero;
	}

	// O(1): mean and Bessel-corrected sample variance from the running sum/sumSq. Slightly less
	// numerically stable than a two-pass computation, which doesn't matter at this magnitude
	// (length-gain values are O(1), n is at most a few thousand) for a screening/display statistic.
	meanVariance(): { mean: number; variance: number } {
		const n = this._n;
		if (n === 0) return { mean: 0, variance: 0 };
		const mean = this._sum / n;
		if (n === 1) return { mean, variance: 0 };
		const biased = this._sumSq / n - mean * mean;
		return { mean, variance: Math.max(0, biased * (n / (n - 1))) };
	}

	lengths(): Float32Array {
		return concatFloat32(this.lengthChunks);
	}

	times(): Float32Array {
		return concatFloat32(this.timeChunks);
	}

	procCounts(): Uint16Array {
		return concatUint16(this.procCountChunks);
	}

	procPositions(): Float32Array {
		return concatFloat32(this.procPositionChunks);
	}
}

export type SkillStatus = 'refining' | 'screened' | 'final' | 'inert';
export type EliminationReason = 'ci' | 'budget' | 'converged' | 'inert' | null;

export interface RoundCandidate {
	id: string;
	n: number;
	mean: number;
	variance: number;
	procTotal: number;
	allZero: boolean;
}

export interface RoundDecision {
	id: string;
	status: SkillStatus;
	eliminationReason: EliminationReason;
	ucb: number;
	lcb: number;
}

// Below this many cumulative samples, a skill's variance estimate is too noisy to eliminate on --
// it can still be capped out by the budget rule, just not CI-eliminated.
const MIN_SAMPLES_FOR_CI_ELIMINATION = 24;

// Decide every skill's fate at one round boundary. `pool` should contain only skills that were
// still active going into this round (i.e. not already inert/screened/final from an earlier
// round) with their *cumulative* stats through whichever round they've each just finished.
//
// Order of evaluation, matching plans/statistical-skill-analysis.md's design:
//   1. Inert (exact zero effect, never proc'd) -- dropped unconditionally.
//   2. Gate = max(preset.minInterestingGain, the targetPool-th largest lower bound in the pool).
//   3. Protect: the current top targetPool by mean are never eliminated by step 4, regardless
//      of how their interval compares to the gate.
//   4. CI elimination: upper bound below the gate, with enough samples to trust the interval.
//   5. Converged: interval already narrower than the preset's precision target -- freeze as
//      final without spending the ladder's remaining rounds on it. Not gated by protection:
//      a protected skill whose interval is already this tight isn't being judged unpromising,
//      it's being judged precisely known, which is exactly when spending no more of the
//      ladder's budget on it is correct -- including for a top skill.
//   6. Budget: cap whatever's left to `round.cap`, keeping the most optimistic (highest upper
///     bound) survivors so an unlucky-so-far skill isn't dropped on a rough early read.
//
// preset.screenZ and preset.minInterestingGain default to CHART_LADDERS' fixed values but can be
// scaled by derivePreset() (the Skill Chart's Pruning slider) -- everything else about this
// function is unaware that's happening; it just reads whatever preset it's handed.
export function evaluateRound(
	pool: RoundCandidate[],
	round: LadderRound,
	preset: LadderPreset,
	isLastRound: boolean,
): RoundDecision[] {
	const bounds = new Map<
		string,
		{ ucb: number; lcb: number; zEff: number; se: number }
	>();
	for (const c of pool) {
		const zEff = preset.screenZ * Math.sqrt(1 + 2 / Math.max(1, c.n));
		const se = Math.sqrt(c.variance / Math.max(1, c.n));
		bounds.set(c.id, {
			ucb: c.mean + zEff * se,
			lcb: c.mean - zEff * se,
			zEff,
			se,
		});
	}

	const inertIds = new Set(
		pool.filter((c) => c.allZero && c.procTotal === 0).map((c) => c.id),
	);
	const active = pool.filter((c) => !inertIds.has(c.id));

	const sortedByLcb = active
		.map((c) => bounds.get(c.id)!.lcb)
		.sort((a, b) => b - a);
	const kthBestLcb =
		sortedByLcb.length >= preset.targetPool
			? sortedByLcb[preset.targetPool - 1]
			: Number.NEGATIVE_INFINITY;
	const gate = Math.max(preset.minInterestingGain, kthBestLcb);

	const protectedIds = new Set(
		active
			.slice()
			.sort((a, b) => b.mean - a.mean)
			.slice(0, preset.targetPool)
			.map((c) => c.id),
	);

	const decisions: RoundDecision[] = [];
	const survivorsForBudget: RoundCandidate[] = [];

	for (const c of pool) {
		const b = bounds.get(c.id)!;
		if (inertIds.has(c.id)) {
			decisions.push({
				id: c.id,
				status: 'inert',
				eliminationReason: 'inert',
				ucb: b.ucb,
				lcb: b.lcb,
			});
			continue;
		}
		if (
			!protectedIds.has(c.id) &&
			b.ucb < gate &&
			c.n >= MIN_SAMPLES_FOR_CI_ELIMINATION
		) {
			decisions.push({
				id: c.id,
				status: 'screened',
				eliminationReason: 'ci',
				ucb: b.ucb,
				lcb: b.lcb,
			});
			continue;
		}
		if (b.zEff * b.se <= preset.precisionTarget) {
			decisions.push({
				id: c.id,
				status: 'final',
				eliminationReason: 'converged',
				ucb: b.ucb,
				lcb: b.lcb,
			});
			continue;
		}
		survivorsForBudget.push(c);
	}

	const cap = round.cap;
	const budgetSurvivors =
		Number.isFinite(cap) && survivorsForBudget.length > cap
			? survivorsForBudget
					.slice()
					.sort((a, b) => bounds.get(b.id)!.ucb - bounds.get(a.id)!.ucb)
			: null;
	const kept = budgetSurvivors
		? new Set(budgetSurvivors.slice(0, cap).map((c) => c.id))
		: null;

	for (const c of survivorsForBudget) {
		const b = bounds.get(c.id)!;
		if (kept && !kept.has(c.id)) {
			decisions.push({
				id: c.id,
				status: 'screened',
				eliminationReason: 'budget',
				ucb: b.ucb,
				lcb: b.lcb,
			});
		} else {
			decisions.push({
				id: c.id,
				status: isLastRound ? 'final' : 'refining',
				eliminationReason: null,
				ucb: b.ucb,
				lcb: b.lcb,
			});
		}
	}

	return decisions;
}

// Convenience wrapper: build a RoundCandidate straight from an accumulator.
export function candidateFromAccumulator(
	acc: SkillAccumulator,
): RoundCandidate {
	const { mean, variance } = acc.meanVariance();
	return {
		id: acc.id,
		n: acc.n,
		mean,
		variance,
		procTotal: acc.procTotal,
		allZero: acc.allZero,
	};
}

// One table row. 'pending' (no accumulator data yet) is a UI-only addition to SkillStatus --
// every other status corresponds to a real evaluateRound() decision.
export interface ChartRow {
	id: string;
	n: number;
	statistics: SkillStatistics | null;
	status: SkillStatus | 'pending';
	eliminationReason: EliminationReason;
}
