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
import { runComparison, runComparisonBlock } from './compare';

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
// (baseSurvivesCount). Matches runComparison's `staminaStatsSummary.staminaSurvivalRate`
// definition exactly ("(total - hpDiedCount) / total"): survival is "did not hit hpDied".
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

// HP-7 pt.2: incoming stamina debuffs recorded into data.db (runComparison only -- see
// getActivator's Perspective.Other branch in compare.ts), separately from data.sk. Murmur
// (201162)'s stripped victim-safe condition is `distance_type==3&phase==1` (mid-race, this
// 2000m/distanceType-3 course) and All-Seeing Eyes (201441)'s is `phase_random==2` (late-race,
// any course -- its running_style/order_rate clauses are caster-only and get stripped, same as
// Murmur's blocked_front_continuetime clause; verified via skill_data.json above). Phase
// boundaries per CourseData.ts's phaseStart/phaseEnd: phase 1 (mid) is [distance/6,
// distance*2/3), phase 2 (late) is [distance*2/3, distance*5/6] -- phase 3 is
// [distance*5/6, distance], not phase 2 (fixed HP-7 review-4, M3: this comment previously said
// phase 2 ran all the way to `distance`).
test('an incoming stamina debuff proc lands within its real window (Murmur mid, All-Seeing Eyes late)', () => {
	const uma1 = new TestHorse() as unknown as HorseState;
	const uma2 = new TestHorse().set(
		'incomingDebuffs',
		ImmMap({ '201162': 1, '201441': 1 }),
	) as unknown as HorseState;

	const result = runComparison(20, course, racedef, uma1, uma2, null, options);
	const db = result.runData.minrun.db[1] as Map<
		string,
		Array<[number, number]>
	>;
	expect(db).toBeInstanceOf(Map);

	const murmurActivations = db.get('201162');
	expect(murmurActivations).toBeDefined();
	expect(murmurActivations!.length).toBeGreaterThan(0);
	const [murmurPos] = murmurActivations![0];
	expect(murmurPos).toBeGreaterThanOrEqual(course.distance / 6);
	expect(murmurPos).toBeLessThan((course.distance * 2) / 3);

	const eyesActivations = db.get('201441');
	expect(eyesActivations).toBeDefined();
	expect(eyesActivations!.length).toBeGreaterThan(0);
	const [eyesPos] = eyesActivations![0];
	expect(eyesPos).toBeGreaterThanOrEqual((course.distance * 2) / 3);
	expect(eyesPos).toBeLessThanOrEqual((course.distance * 5) / 6);

	// Must NOT be folded into data.sk (the card's "Skills (N)" count) -- see compare.ts's
	// getActivator comment on why these are tracked separately.
	const sk = result.runData.minrun.sk[1] as Map<string, unknown>;
	expect(sk.has('201162')).toBe(false);
	expect(sk.has('201441')).toBe(false);
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

// PIPE-64 slice 1 review gap: the pacer conversion at compare.ts's two `toHorseDesc(pacer)` call
// sites (runComparison around line 193, runComparisonBlock around line 1119) changed from an
// Immutable Record to toHorseDesc's plain-object FlatHorseState, but until now no test ever drove
// PosKeepMode.Virtual with a non-null `pacer` argument at all. `seed` must be set explicitly here
// -- the shared `options` above omits it, and runComparison/runComparisonBlock both derive their
// pacer-trigger RNG from `options.seed`/`block.seed` respectively, so an undefined seed would make
// pacer-trigger sampling non-deterministic (NaN-seeded) for these pacemakerCount>0 cases even
// though the debuff-only tests above tolerate it fine (they never build a pacer).
const posKeepOptions = {
	...options,
	posKeepMode: PosKeepMode.Virtual,
	pacemakerCount: 1,
	seed: 5150,
};

// 200341 (all_corner_random Accel, +4000 modifier, cooldown 30) is equipped as a Self skill on the
// pacer so the pacer's own equipped-skill list (`horse.skills`, read by
// RaceSolverBuilder.ts's setupPacer) is actually exercised, not just its raw stats.
function pacerWithSkill(): HorseState {
	return new TestHorse().set(
		'skills',
		ImmMap({ '200341': '200341' }),
	) as unknown as HorseState;
}

test('runComparisonBlock with a Virtual-pos-keep pacer is deterministic for a fixed seed', () => {
	const uma1 = new TestHorse() as unknown as HorseState;
	const uma2 = new TestHorse() as unknown as HorseState;
	const pacer = pacerWithSkill();

	const block = { seed: 5150, size: 64 };

	const a = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2,
		pacer,
		posKeepOptions,
	);
	const b = runComparisonBlock(
		block,
		course,
		racedef,
		uma1,
		uma2,
		pacer,
		posKeepOptions,
	);

	expect(Array.from(a.lengths)).toEqual(Array.from(b.lengths));
	expect(Array.from(a.times)).toEqual(Array.from(b.times));
});

// runComparisonBlock's own diff-based `lengths`/`times` (uma1 vs uma2, both identical TestHorse
// builds here) turn out to be insensitive to the pacer entirely in this course/config -- both
// umas' position-keep engagement window closes well before the pacer's own skill trigger window,
// so a pacer stat/skill change that never differentially affects uma1 vs uma2 leaves that diff
// unchanged even though the pacer itself is behaving differently (confirmed by hand: pacerP/pacerT
// differ between a skill-equipped and skill-less pacer, but runComparisonBlock's lengths/times do
// not). runComparison's minrun.pacerP/pacerT (the pacer's own per-tick trace, only exposed via
// runComparison, not runComparisonBlock's ComparisonBlockOutput) is a directly observable, less
// incidental signal that toHorseDesc(pacer) is actually carrying real per-horse data (not just a
// shared default) into the pacer RaceSolver setupPacer/buildPacer builds.
test("runComparison: a pacer equipped with a skill measurably changes the pacer's own trajectory", () => {
	const uma1 = new TestHorse() as unknown as HorseState;
	const uma2 = new TestHorse() as unknown as HorseState;

	const withSkill = runComparison(
		1,
		course,
		racedef,
		uma1,
		uma2,
		pacerWithSkill(),
		posKeepOptions,
	);
	const noSkill = runComparison(
		1,
		course,
		racedef,
		uma1,
		uma2,
		new TestHorse() as unknown as HorseState,
		posKeepOptions,
	);

	const pacerTWith = withSkill.runData.minrun.pacerT[0];
	const pacerTNo = noSkill.runData.minrun.pacerT[0];
	expect(pacerTWith.length).toBeGreaterThan(0);
	expect(pacerTNo.length).toBeGreaterThan(0);
	// If toHorseDesc ever stopped carrying the pacer's skills through (e.g. dropped or emptied the
	// `skills` field), this pacer would run identically to one with no skill at all and this
	// assertion would go from a real check to a tautology.
	expect(pacerTWith.at(-1)).not.toBe(pacerTNo.at(-1));
});

test('runComparison: a Virtual-pos-keep pacer trajectory is deterministic for a fixed seed', () => {
	const uma1 = new TestHorse() as unknown as HorseState;
	const uma2 = new TestHorse() as unknown as HorseState;
	const pacer = pacerWithSkill();

	const a = runComparison(
		1,
		course,
		racedef,
		uma1,
		uma2,
		pacer,
		posKeepOptions,
	);
	const b = runComparison(
		1,
		course,
		racedef,
		uma1,
		uma2,
		pacer,
		posKeepOptions,
	);

	expect(a.runData.minrun.pacerT[0]).toEqual(b.runData.minrun.pacerT[0]);
	expect(a.runData.minrun.pacerP[0]).toEqual(b.runData.minrun.pacerP[0]);
});
