import { Map as ImmMap, Record } from 'immutable';
import { expect, test } from 'vitest';
import type { HorseState } from '../components/HorseDefTypes';
import courseData from '../uma-skill-tools/data/jp/course_data.json' with {
	type: 'json',
};
import {
	Grade,
	GroundCondition,
	Season,
	Time,
	Weather,
} from '../uma-skill-tools/RaceParameters';
import { PosKeepMode } from '../uma-skill-tools/RaceSolver';
import { runComparisonBlock } from './compare';

// HP-7: wiring incomingDebuffs into runComparisonBlock. HorseState (components/HorseDefTypes.ts)
// can't be constructed directly under Vitest -- its Record({...}) default values branch on a bare
// `CC_GLOBAL` identifier that only exists as an esbuild `define` substitution in the app builds
// (same note already in umalator/BasinnChart.test.ts; confirmed here too: `new HorseState()`
// throws `ReferenceError: CC_GLOBAL is not defined`). TestHorse below is a structurally identical
// stand-in Immutable Record (same fields, same methods -- .set()/.update()/.toJS()/.get()) built
// with concrete defaults instead, which is all runComparisonBlock/compare.ts's addIncomingDebuffs
// actually need: it never does an `instanceof HorseState` check, only reads/updates fields.
const TestHorse = Record({
	outfitId: '',
	speed: 400,
	stamina: 300,
	power: 400,
	guts: 400,
	wisdom: 1200, // high wisdom + skillWisdomCheck:false/rushedKakari:false below to cut extra RNG noise
	strategy: 'Senkou',
	distanceAptitude: 'A',
	surfaceAptitude: 'A',
	strategyAptitude: 'A',
	mood: 2,
	skills: ImmMap<string, string>(),
	forcedSkillPositions: ImmMap<string, number>(),
	incomingDebuffs: ImmMap<string, number>(),
});

// 2000m, distanceType 3 (Mid) -- Murmur (201162, see components/StaminaDebuffs.test.ts) requires
// distance_type==3&phase==1 (the &blocked_front_continuetime>=1 caster clause is stripped by
// victim-safe rewriting; uma-skill-tools/RaceSolverBuilder.ts's VictimSafeConditions keeps only
// phase/phase_random/accumulatetime/distance_type), so this course/skill pair fires deterministically
// every sample regardless of race positioning, unlike a debuff whose surviving clauses depend on
// running_style/order_rate.
const COURSE_ID = '10104';
const course = courseData[COURSE_ID] as any;

const racedef = {
	mood: 2,
	groundCondition: GroundCondition.Good,
	weather: Weather.Sunny,
	season: Season.Spring,
	time: Time.Midday,
	grade: Grade.Daily,
	popularity: 1,
	skillId: '',
} as any;

const options = {
	posKeepMode: PosKeepMode.None,
	mode: 'compare',
	syncRng: true, // keep the two runs' RNG streams maximally aligned so the debuff is the only lever
	skillWisdomCheck: false,
	rushedKakari: false,
	pacemakerCount: 0,
};

function meanLengths(lengths: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < lengths.length; ++i) sum += lengths[i];
	return sum / lengths.length;
}

test('an incoming stamina debuff on uma2 lowers mean length vs the same run without it', () => {
	const uma1 = new TestHorse() as unknown as HorseState;
	const uma2Baseline = new TestHorse() as unknown as HorseState;
	const uma2Debuffed = new TestHorse().set(
		'incomingDebuffs',
		ImmMap({ '201162': 2 }),
	) as unknown as HorseState;

	const block = { seed: 12345, size: 200 };

	const without = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2Baseline,
		null,
		options,
	);
	const withDebuffs = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2Debuffed,
		null,
		options,
	);

	const meanWithout = meanLengths(without.lengths);
	const meanWith = meanLengths(withDebuffs.lengths);
	expect(meanWith).toBeLessThan(meanWithout);
});

test('runComparisonBlock with incomingDebuffs is deterministic for a fixed seed', () => {
	const uma1 = new TestHorse() as unknown as HorseState;
	const uma2 = new TestHorse().set(
		'incomingDebuffs',
		ImmMap({ '201162': 2 }),
	) as unknown as HorseState;

	const block = { seed: 999, size: 64 };

	const a = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2,
		null,
		options,
	);
	const b = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2,
		null,
		options,
	);

	expect(Array.from(a.lengths)).toEqual(Array.from(b.lengths));
	expect(Array.from(a.times)).toEqual(Array.from(b.times));
});

// HP-7 task 8: survivesCount/baseSurvivesCount -- how many of a block's scenarios did NOT hit
// hpDied, counted separately for uma2/candidate (survivesCount) and uma1/baseline
// (baseSurvivesCount). Matches runComparison's staminaSurvivalRate definition exactly
// (compare.ts:722, "(total - hpDiedCount) / total"): survival is "did not hit hpDied".
//
// CONTROLLER RULING (overrides this task's original brief text): the brief asked for a test
// asserting baseSurvivesCount is identical across two different candidate skills on the same block
// seed. That's not asserted here -- it rests on an invariant that isn't actually guaranteed:
// runComparisonBlock adds the candidate uma's skill to the BASELINE builder too, as
// Perspective.Other (see addIncomingDebuffs's call sites above and this file's runComparisonBlock
// file-level note), so the baseline build is not provably identical across two different candidate
// rows -- most candidate skills happen to contribute only a Noop there, but that's not a
// guarantee worth pinning a test to. Determinism and the debuff-lowers-survival property below are
// asserted instead.
test('runComparisonBlock: survivesCount/baseSurvivesCount are deterministic for a fixed (candidate, seed)', () => {
	const uma1 = new TestHorse() as unknown as HorseState;
	const uma2 = new TestHorse().set(
		'incomingDebuffs',
		ImmMap({ '201162': 8 }),
	) as unknown as HorseState;

	const block = { seed: 999, size: 64 };

	const a = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2,
		null,
		options,
	);
	const b = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2,
		null,
		options,
	);

	expect(a.survivesCount).toBeLessThanOrEqual(block.size);
	expect(a.baseSurvivesCount).toBeLessThanOrEqual(block.size);
	expect(a.survivesCount).toBe(b.survivesCount);
	expect(a.baseSurvivesCount).toBe(b.baseSurvivesCount);
});

test('runComparisonBlock: survivesCount falls when incoming debuffs are configured, for a stamina-limited uma', () => {
	// Stamina high enough that this build survives the course with no debuffs at all (baseline
	// case: 0 stacks), but not high enough to shrug off 8 stacks of Murmur's drain -- see this
	// file's header comment on why COURSE_ID/skill 201162 fire deterministically every sample.
	const uma1 = new TestHorse().set('stamina', 900) as unknown as HorseState;
	const uma2NoDebuff = new TestHorse({ stamina: 900 }) as unknown as HorseState;
	const uma2Debuffed = new TestHorse({ stamina: 900 }).set(
		'incomingDebuffs',
		ImmMap({ '201162': 8 }),
	) as unknown as HorseState;

	const block = { seed: 12345, size: 200 };

	const without = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2NoDebuff,
		null,
		options,
	);
	const withDebuffs = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2Debuffed,
		null,
		options,
	);

	// Sanity: this build really does survive the course by default, so the drop below is actually
	// caused by the debuff, not by the build already dying from natural drain alone.
	expect(without.survivesCount).toBe(block.size);
	expect(withDebuffs.survivesCount).toBeLessThan(without.survivesCount);
});
