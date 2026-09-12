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
