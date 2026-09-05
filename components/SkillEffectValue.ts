// Shared between SkillList.tsx and SkillPicker.tsx, whose skill-effect-value formatters had
// already drifted apart from each other before this file existed. Keep this piece -- the
// valueUsage 8/9 scaling -- factored out so it can't drift a third time.

// Mirrors RaceSolver.ts's scaleEffectValue(): ability_value_usage 8 or 9 ("Multiply Random")
// rolls 60% -> 0.0x, 30% -> 0.02x, 10% -> 0.04x against the stored modifier at activation time,
// instead of the modifier applying directly. Every other valueUsage -- including undefined,
// which the engine uses for internally-synthesized effects -- passes the modifier straight
// through untouched, same as valueUsage 1 ("Direct").
const MULTIPLY_RANDOM_SCALE_FACTORS = [0, 0.02, 0.04] as const;

function isMultiplyRandomValueUsage(valueUsage: number | undefined): boolean {
	return valueUsage === 8 || valueUsage === 9;
}

// Returns the distinct raw modifier values (ascending) a skill effect can actually resolve to
// at activation time. For valueUsage 8/9 that's up to 3 values -- the stored modifier is never
// itself the outcome, so displaying it verbatim (as the pre-HP-6 code did) is simply wrong. For
// every other valueUsage, or none, it's a single-element array holding the stored modifier
// unchanged, so callers that always map+join over this result render identically to before.
export function getEffectValueOutcomes(
	rawModifier: number,
	valueUsage: number | undefined,
): number[] {
	if (!isMultiplyRandomValueUsage(valueUsage)) {
		return [rawModifier];
	}
	const outcomes = MULTIPLY_RANDOM_SCALE_FACTORS.map(
		(scale) => rawModifier * scale,
	);
	return Array.from(new Set(outcomes)).sort((a, b) => a - b);
}
