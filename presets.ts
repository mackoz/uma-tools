// Champions Meeting (CM) / League of Heroes (LOH) preset data for umalator's PRESET dropdown --
// the JP dataset (see umalator-global/presets.ts for the Global counterpart, and
// docs/cm-presets.md for the schedule these dates feed into).
//
// Hand-maintained, not pipeline output -- there is no generator for this the way there is for
// umas.json/skill_meta.json (see CLAUDE.md hard rule 1's list of exceptions, alongside
// tracknames.json). Values are the engine-canonical enum member names from
// uma-skill-tools/RaceParameters.ts (Season/GroundCondition/Weather/Time), not any UI's display
// label -- umalator/app.tsx converts to the real enum on import via a lookup table built from
// the actual enum members, so a typo here is a build/test-time TS2322, not a silent runtime
// `undefined`.
//
// Kept as a plain string-literal array validated with `satisfies` (not JSON): JSON's
// `resolveJsonModule` widens every value to `string`, so even a *correct* JSON file can only be
// consumed via an unchecked `as` cast, and a mistyped enum name would surface only as a runtime
// throw in the browser. `satisfies` catches it at the exact line at compile time, and -- because
// this file holds no runtime `enum` import -- stays importable under Vitest, so
// umalator/racePresets.test.ts can validate these entries for real.
import type { RawPreset } from './umalator/racePresets';

// JP entries currently carry no `id`/`name` -- upstream doesn't label them the way Global's
// dropdown does. That produces a "CM undefined - undefined" option label; tracked as its own
// follow-up ticket rather than fixed here (out of scope for UI-31).
export default [
	{
		type: 'LOH',
		date: '2026-02',
		courseId: 10602,
		season: 'Winter',
		ground: 'Good',
		weather: 'Sunny',
		time: 'Midday',
	},
	{
		type: 'CM',
		date: '2026-01',
		courseId: 10506,
		season: 'Winter',
		ground: 'Good',
		weather: 'Sunny',
		time: 'Midday',
	},
	{
		type: 'CM',
		date: '2025-12-21',
		courseId: 10903,
		season: 'Winter',
		ground: 'Good',
		weather: 'Sunny',
		time: 'Midday',
	},
	{
		type: 'LOH',
		date: '2025-11',
		courseId: 11502,
		season: 'Autumn',
		ground: 'Good',
		weather: 'Sunny',
		time: 'Midday',
	},
	{
		type: 'CM',
		date: '2025-10',
		courseId: 10302,
		season: 'Autumn',
		ground: 'Good',
		weather: 'Cloudy',
		time: 'Midday',
	},
	{
		type: 'CM',
		date: '2025-09-22',
		courseId: 10807,
		season: 'Autumn',
		ground: 'Good',
		weather: 'Sunny',
		time: 'Midday',
	},
	{
		type: 'LOH',
		date: '2025-08',
		courseId: 10105,
		season: 'Summer',
		ground: 'Good',
		weather: 'Sunny',
		// app.tsx's original literal had this preset's key capitalized `Time:` (a typo -- it
		// never actually set `def.time`, silently falling back to RaceParams' own default of
		// Time.Midday, app.tsx:280). `time: 'Midday'` here reproduces that same effective value
		// explicitly instead of relying on the fallback again.
		time: 'Midday',
	},
	{
		type: 'CM',
		date: '2025-07-25',
		courseId: 10906,
		ground: 'Yielding',
		weather: 'Cloudy',
		season: 'Summer',
		time: 'Midday',
	},
	{
		type: 'CM',
		date: '2025-06-21',
		courseId: 10606,
		ground: 'Good',
		weather: 'Sunny',
		season: 'Spring',
		time: 'Midday',
	},
] satisfies readonly RawPreset[];
