import assert from 'node:assert/strict';
import { describe, test, vi } from 'vitest';
import type { HorseState } from '../components/HorseDef.tsx';
import { getParser } from '../uma-skill-tools/ConditionParser.ts';
import courseData from '../uma-skill-tools/data/jp/course_data.json' with {
	type: 'json',
};
import {
	acrParser,
	getActivateableSkills,
	hasModeledActivationGate,
} from './BasinnChart.tsx';

// UI-34: BasinnChart.tsx pulls in @tanstack/preact-table at module scope purely for its
// component/rendering exports (BasinnChart itself, SkillNameCell, etc.) -- none of which this
// file touches. That package only resolves under the real app builds via umalator/build.mjs's
// own `redirectTable` esbuild plugin (redirects to vendor/preact-table); Vitest doesn't run that
// plugin, and the vendored table-core code underneath isn't parseable by Vite's own TS
// transform either (a pre-existing `<>` empty-type-parameter syntax choke, unrelated to this
// PR). Stubbing the whole package here avoids ever loading it, so this test never depends on
// either of those unrelated build/vendor mismatches -- the two functions under test don't call
// anything from this package themselves. vi.mock calls are hoisted above the imports above by
// Vitest itself, so declaration order here doesn't matter for that.
vi.mock('@tanstack/preact-table', () => ({
	createSortedRowModel: () => {},
	flexRender: () => {},
	rowSortingFeature: {},
	sortFns: {},
	tableFeatures: () => {},
	useTable: () => {},
}));

// UI-34: this file exercises real skill_data.json/course_data.json content, not mocked skill
// objects -- matching this repo's other test files (chartLadder.test.ts, histogramData.test.ts).
// One thing worth being explicit about: BasinnChart.tsx's `skilldata` import is an unconditional
// `../uma-skill-tools/data/jp/skill_data.json` (JP data). The Global build only gets Global's own
// skill_data.json because umalator-global/build.mjs's esbuild `redirectData` plugin rewrites that
// import path at *build* time -- Vitest doesn't run that plugin, so under test this file always
// reads the JP dataset regardless of which app it's nominally exercising. Every skill id below was
// checked directly against JP `uma-skill-tools/data/jp/skill_data.json` (not assumed from Global's),
// and where a case also matters for Global, that's called out and independently confirmed.

// A JP course with a real, non-degenerate phase 2 -- matches the course used by
// uma-skill-tools/test/activate-counts-as-random.ts for the same reason.
const COURSE_ID = '10101';
const course = (courseData as any)[COURSE_ID];

// Course Chart's own template shape (app.tsx's COURSE_CHART_TEMPLATE_STATS + courseChartTemplate)
// -- a plain object, not a real Immutable HorseState instance. getActivateableSkills only ever
// reads `horse.mood` directly and passes `horse` straight into buildBaseStats's plain field
// access, so a duck-typed object works -- and it must be one here: HorseState's real class
// (components/HorseDefTypes.ts) branches its field defaults on a bare `CC_GLOBAL` identifier that
// only exists as an esbuild `define` substitution in the app builds, not under Vitest.
const template = {
	speed: 1500,
	stamina: 1200,
	power: 1200,
	guts: 600,
	wisdom: 1200,
	strategy: 'Senkou',
	distanceAptitude: 'S',
	surfaceAptitude: 'A',
	strategyAptitude: 'A',
	mood: 2,
} as unknown as HorseState;

const racedef = {
	orderRange: [2, 4] as [number, number],
	numUmas: 9,
	mood: 2,
	groundCondition: 1,
	weather: 1,
	season: 1,
	time: 1,
	grade: 1,
	popularity: 1,
	skillId: '',
} as any;

describe('hasModeledActivationGate', () => {
	test('badges a skill whose every alternative is gated', () => {
		// 110151 (Barcarole of Blessings): both alternatives are activate_count_all-gated
		// (>=7 / <=6) -- verified identical in structure in both JP and Global skill_data.json.
		assert.equal(hasModeledActivationGate('110151'), true);
	});

	test('does not badge a skill with an ungated fallback alternative', () => {
		// 101051 (JP): alt0 is gated (...&distance_type==3&activate_count_all>=7), alt1 is
		// ungated. This is the regression case /project-review found: with the pre-review
		// some()-based implementation this returned true, wrongly badging the row even on the
		// non-distance_type==3 courses where the engine falls through to alt1's plain, ungated
		// trigger before ever reaching SKL-14's second-trigger guard.
		assert.equal(hasModeledActivationGate('101051'), false);
	});

	test('does not badge an ordinary ungated skill', () => {
		// 110031 in JP data: a single alternative, is_last_straight==1 -- no activate_count_*
		// or is_activate_any_skill anywhere.
		assert.equal(hasModeledActivationGate('110031'), false);
	});

	test('returns false for an id with no skill data', () => {
		assert.equal(hasModeledActivationGate('999999'), false);
	});
});

describe('getActivateableSkills', () => {
	test('omitting the parser behaves identically to passing the default parser explicitly', () => {
		// Pins the claim in BasinnChart.tsx's own comment: the two pre-existing call sites
		// (app.tsx's Skill Chart/Uma Chart paths) never pass a 5th argument, and must stay
		// byte-identical to before this parameter was added.
		const ids = ['110151', '101051', '110031', '120011'];
		const omitted = getActivateableSkills(ids, template, course, racedef);
		const explicit = getActivateableSkills(
			ids,
			template,
			course,
			racedef,
			getParser(),
		);
		assert.deepEqual(omitted, explicit);
	});

	test('a modeled-trigger candidate is included the same way under both parsers', () => {
		// 120011 (Dreams Donned with Pride!, is_activate_any_skill-gated): pins a fact
		// documented directly in app.tsx's own comment on this parameter -- swapping in the acr
		// parser changes no candidate's inclusion here today, because the base table's
		// activate_count_*/is_activate_any_skill conditions never empty their own RegionList
		// (only their *dynamic* condition differs, which this prefilter doesn't evaluate at
		// all -- see uma-skill-tools/test/activate-counts-as-random.ts for that half of the
		// fix). If this test starts failing, something changed which candidates the acr parser
		// can exclude/include -- worth a second look, not a quick "fix the test."
		const withDefault = getActivateableSkills(
			['120011'],
			template,
			course,
			racedef,
		);
		const withAcr = getActivateableSkills(
			['120011'],
			template,
			course,
			racedef,
			acrParser,
		);
		assert.deepEqual(withDefault, ['120011']);
		assert.deepEqual(withAcr, ['120011']);
	});

	test('an id with no skill data is filtered out, not thrown', () => {
		assert.deepEqual(
			getActivateableSkills(['999999'], template, course, racedef),
			[],
		);
	});
});
