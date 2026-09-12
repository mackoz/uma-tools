import { Map as ImmMap } from 'immutable';
import { test, expect } from 'vitest';
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
// validateAndParseUmaJson below is the actually-importable half of the same round trip: it runs
// the identical `|| {}` sanitising fallback deserialize's `ImmMap(o.uma1.incomingDebuffs || {})`
// uses, just on a plain JSON object (the shape horseStateToUmaState/toJS() produce and
// umaStateToHorseState/ImmMap() consume) rather than a live HorseState instance.

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
