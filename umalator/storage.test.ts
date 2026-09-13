import { Map as ImmMap } from 'immutable';
import { expect, test } from 'vitest';
import { validateAndParseUmaJson } from './storage';

// HP-7: incomingDebuffs (a Map of stamina-debuff bucket skill id -> count) is threaded through
// the same HorseState <-> plain-JSON round trip forcedSkillPositions already uses -- app.tsx's
// horseStateToUmaState (`state.incomingDebuffs.toJS()`) and umaStateToHorseState
// (`ImmMap(uma.incomingDebuffs)`) reduce to exactly the plain-object <-> ImmMap conversion this
// test drives by hand.
//
// Neither the real HorseState class nor app.tsx's own serialize/deserialize (the share-link
// path) are imported here. HorseState (components/HorseDefTypes.ts) branches its field defaults
// on a bare `CC_GLOBAL` identifier that only exists as an esbuild `define` substitution in the
// app builds, not under Vitest -- confirmed by the same note already in umalator/BasinnChart.test.ts,
// and reproduced directly: `new HorseState()` throws `ReferenceError: CC_GLOBAL is not defined`.
// app.tsx itself can't be imported under Vitest's node environment either -- it transitively
// touches `localStorage`/other DOM-only globals at module scope (e.g. components/Language.tsx);
// confirmed by attempting the import, which throws `TypeError: Cannot read properties of
// undefined (reading 'getItem')` from components/Language.tsx:8.
//
// validateAndParseUmaJson below is the actually-importable half of the same round trip. It does
// NOT use the identical fallback app.tsx's deserialize (the share-link path) does for
// `incomingDebuffs` -- that comment previously here confused this field with the adjacent
// `forcedSkillPositions` field, which genuinely does use an `|| {}` fallback.
// `incomingDebuffs` instead runs through its own filtering, `filterKnownIncomingDebuffs` in
// app.tsx and the inline loop below in validateAndParseUmaJson, both of which call the shared
// `clampDebuffCount` (components/StaminaDebuffs.ts) for numeric validation -- previously neither
// path had any numeric coercion at all, which is exactly how HP-7 peer-review Critical 2 (an
// unvalidated count enabling an infinite loop from a crafted share link or hand-edited saved
// slot) shipped untested. The tests below exercise validateAndParseUmaJson's half of that fix
// directly; components/StaminaDebuffs.test.ts exercises clampDebuffCount itself, which is the
// only logic app.tsx's half (not importable under Vitest -- see above) also relies on.

const BASE_UMA = {
	outfitId: '',
	speed: 1000,
	stamina: 1000,
	power: 1000,
	guts: 1000,
	wisdom: 1000,
	strategy: 'Senkou',
	distanceAptitude: 'A',
	surfaceAptitude: 'A',
	strategyAptitude: 'A',
	mood: 2,
	skills: [] as string[],
	forcedSkillPositions: {},
};

test('incomingDebuffs survives a validate/parse round trip', () => {
	const parsed = validateAndParseUmaJson({
		...BASE_UMA,
		incomingDebuffs: { '201162': 2 },
	});
	expect(parsed).not.toBeNull();
	const restored = ImmMap(parsed!.incomingDebuffs);
	expect(restored.get('201162')).toBe(2);
});

test('a saved horse predating the field parses with an empty incomingDebuffs map', () => {
	const parsed = validateAndParseUmaJson({ ...BASE_UMA }); // no incomingDebuffs key at all
	expect(parsed).not.toBeNull();
	expect(ImmMap(parsed!.incomingDebuffs).size).toBe(0);
});

// HP-7 peer-review Critical 2: validateAndParseUmaJson used to only NaN-guard incomingDebuffs'
// count, with no upper bound and no rejection of other non-finite values -- a hand-edited or
// corrupted saved slot carrying `Infinity` reaches compare.ts's `for (let i = 0; i < count; ++i)`
// and hangs the tab. These pin the fix: clampDebuffCount coerces, rejects non-finite, floors, and
// clamps to [0, 9] (the same range StaminaDebuffDialog.tsx's stepper enforces).
test('an Infinity count (JSON.parse(\'{"count":1e400}\') === Infinity) is dropped, not stored', () => {
	const parsed = validateAndParseUmaJson({
		...BASE_UMA,
		incomingDebuffs: { '201162': JSON.parse('1e400') },
	});
	expect(parsed).not.toBeNull();
	expect(ImmMap(parsed!.incomingDebuffs).has('201162')).toBe(false);
});

test('a NaN count is dropped entirely, not stored as NaN', () => {
	const parsed = validateAndParseUmaJson({
		...BASE_UMA,
		incomingDebuffs: { '201162': 'not a number' },
	});
	expect(parsed).not.toBeNull();
	expect(ImmMap(parsed!.incomingDebuffs).has('201162')).toBe(false);
});

test('a negative count is clamped to 0 and dropped', () => {
	const parsed = validateAndParseUmaJson({
		...BASE_UMA,
		incomingDebuffs: { '201162': -5 },
	});
	expect(parsed).not.toBeNull();
	expect(ImmMap(parsed!.incomingDebuffs).has('201162')).toBe(false);
});

test('a non-integer count is floored', () => {
	const parsed = validateAndParseUmaJson({
		...BASE_UMA,
		incomingDebuffs: { '201162': 2.7 },
	});
	expect(parsed).not.toBeNull();
	expect(ImmMap(parsed!.incomingDebuffs).get('201162')).toBe(2);
});

test('an over-cap finite count is clamped to 9', () => {
	const parsed = validateAndParseUmaJson({
		...BASE_UMA,
		incomingDebuffs: { '201162': 500 },
	});
	expect(parsed).not.toBeNull();
	expect(ImmMap(parsed!.incomingDebuffs).get('201162')).toBe(9);
});

// HP-7 peer-review Important 3: a non-representative member id (200781, part of the same bucket
// as representative 200771) used to pass isKnownDebuffBucketId (true for any member) and get
// stored unnormalised -- invisible/uneditable in StaminaDebuffDialog.tsx (keyed by bucket.id) and
// miscounted by totalDrain()/excludedDebuffCount(). It's now normalised to its bucket's
// representative id at rehydration time.
test('a non-representative member id is normalized to its bucket representative', () => {
	const parsed = validateAndParseUmaJson({
		...BASE_UMA,
		incomingDebuffs: { '200781': 3 },
	});
	expect(parsed).not.toBeNull();
	const restored = ImmMap(parsed!.incomingDebuffs);
	expect(restored.has('200781')).toBe(false);
	expect(restored.get('200771')).toBe(3);
});
