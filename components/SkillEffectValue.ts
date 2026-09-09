// Shared between SkillList.tsx and SkillPicker.tsx, whose skill-effect-value formatters had
// already drifted apart from each other before this file existed. Keep this piece -- the
// valueUsage 8/9 scaling -- factored out so it can't drift a third time.
//
// SKL-7: every *deterministic* valueUsage/timeUsage code is now imported from the engine's own
// uma-skill-tools/ValueScaling.ts rather than mirrored here -- mirroring these constants in the
// UI is what let HP-6 nearly ship a picker reading "-100.0% HP drain" where "-4.0%" belonged.
// Importing the same table the solver calls makes that class of divergence impossible rather
// than review-prevented. See that file's header for exactly which codes are implemented and why
// the rest fall through to 1.0.
import type { ScalingContext } from '../uma-skill-tools/ValueScaling';
import {
	durationScaleFactor,
	valueScaleFactor,
} from '../uma-skill-tools/ValueScaling';

// Mirrors RaceSolver.ts's scaleEffectValue(): ability_value_usage 8 or 9 ("Multiply Random")
// rolls 60% -> 0.0x, 30% -> 0.02x, 10% -> 0.04x against the stored modifier at activation time,
// instead of the modifier applying directly. Every other valueUsage -- including undefined,
// which the engine uses for internally-synthesized effects -- passes the modifier straight
// through untouched, same as valueUsage 1 ("Direct").
//
// This one stays local rather than moving into ValueScaling.ts: it is stochastic (a random roll
// at activation), so it cannot be a pure function of a ScalingContext the way the other codes
// are -- both RaceSolver.ts's scaleEffectValue() and this file branch on 8/9 *before* consulting
// the shared table, and ValueScaling.ts returns 1.0 for these two codes precisely because both
// callers already handle them separately.
const MULTIPLY_RANDOM_SCALE_FACTORS = [0, 0.02, 0.04] as const;

function isMultiplyRandomValueUsage(valueUsage: number | undefined): boolean {
	return valueUsage === 8 || valueUsage === 9;
}

// Returns the distinct raw modifier values (ascending) a skill effect can actually resolve to
// at activation time. For valueUsage 8/9 that's up to 3 values -- the stored modifier is never
// itself the outcome, so displaying it verbatim (as the pre-HP-6 code did) is simply wrong. For
// every other deterministic valueUsage, it's a single-element array holding the modifier scaled
// by `scalingContext` -- or the raw modifier, unscaled, if no context is supplied. Note that
// "unscaled" is not the same as "as it rendered before SKL-7": SKL-7 also removed the baked x1.2
// approximation from the stored modifiers of the skills carrying value usage 2 and 13, so a
// context-less call site renders those *lower* than it used to. See the note above
// ExpandedSkillDetails in SkillList.tsx for which call sites that leaves.
export function getEffectValueOutcomes(
	rawModifier: number,
	valueUsage: number | undefined,
	scalingContext?: ScalingContext,
): number[] {
	if (!isMultiplyRandomValueUsage(valueUsage)) {
		// SKL-7: the deterministic codes come from the engine's own table, imported rather than
		// mirrored, so this file cannot drift from RaceSolver.scaleEffectValue() again.
		const factor = scalingContext
			? valueScaleFactor(valueUsage, scalingContext)
			: 1;
		return [rawModifier * factor];
	}
	const outcomes = MULTIPLY_RANDOM_SCALE_FACTORS.map(
		(scale) => rawModifier * scale,
	);
	return Array.from(new Set(outcomes)).sort((a, b) => a - b);
}

// Scales a skill alternative's baseDuration by its timeUsage (e.g. MultiplyRemainHp), the
// duration-side counterpart to getEffectValueOutcomes above. Omitting scalingContext is again
// identity -- and here that genuinely does render the same base duration as before SKL-7, since
// no baked duration approximation was removed from the data the way it was on the value side.
// A caller whose simulation runs without an HP model should still pass a context carrying
// `remainingHp: Infinity` rather than omitting one, so the value-side codes stay scaled.
export function getScaledBaseDuration(
	baseDuration: number,
	timeUsage: number | undefined,
	scalingContext?: ScalingContext,
): number {
	return (
		baseDuration *
		(scalingContext ? durationScaleFactor(timeUsage, scalingContext) : 1)
	);
}
