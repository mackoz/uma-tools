// SKL-7: one place that builds a `ScalingContext` for the UI.
//
// `uma-skill-tools/ValueScaling.ts` already unified the bracket *tables* between engine and UI so
// they cannot drift. This module is the other half of that: unifying how the *context fed into
// them* is constructed. The first round of SKL-7 left three separate hand-rolled constructions
// (components/HorseDef.tsx, umalator/app.tsx's chart popovers, and nothing at all in
// skill-visualizer), and each one read raw `HorseState` slider values where `RaceSolver` reads
// `buildAdjustedStats()` output. Measured: a raw speed slider of 1600 at mood 2 on a 2000m course
// looked up 0.0x on value usage 22, while the solver -- seeing 1747.2 after `adjustOvercap()`
// (1600 -> 1400), motivation (x1.04) and the course modifier (x1.2) -- used 1.0x. The picker
// rendered skill 110321's accel effect as `+0.00`, i.e. "this does nothing"; the correct reading
// is `+0.05`. Same tables, different inputs, different answer.
//
// So: every UI caller goes through `scalingContextFor*()` below, and the actual field derivation
// lives once, in `contextFrom()`.
//
// Two things the UI structurally cannot reproduce, both inherent rather than bugs:
//   - In-race skill effects. `RaceSolver` reads `this.horse.speed` at activation time, after green
//     skills have already moved it. There is no race in progress when the picker or a chart
//     popover renders, so `finalSpeed` here is pre-skill adjusted speed.
//   - A live HP figure. There is no point-in-the-race to sample, so `hpModeled: true` callers use
//     full HP -- the same `0.8 × HpStrategyCoefficient[strategy] × stamina + distance` formula
//     `GameHpPolicy.init()` computes `maxHp` from -- rather than inventing a mid-race value.
//     `hpModeled: false` is for a caller whose simulation runs on `NoopHpPolicy`, where the engine
//     itself sees `hpRemaining() === Infinity` -- which falls past every duration bracket onto
//     `ValueScaling.lookup()`'s identity return, so no duration scaling is applied at all. Passing
//     `Infinity` through here is what makes the UI compute the same thing, via the same table; see
//     uma-skill-tools/docs/adr/0013-value-scaling-identity-fallthrough.md.

import type { CourseData } from '../uma-skill-tools/CourseData';
import type { HorseParameters } from '../uma-skill-tools/HorseTypes';
import { HpStrategyCoefficient } from '../uma-skill-tools/HpPolicy';
import type { GroundCondition } from '../uma-skill-tools/RaceParameters';
import {
	buildAdjustedStats,
	buildBaseStats,
	type HorseDesc,
} from '../uma-skill-tools/RaceSolverBuilder';
import type { ScalingContext } from '../uma-skill-tools/ValueScaling';

function contextFrom(
	adjusted: HorseParameters,
	skillCount: number,
	courseDistance: number,
	hpModeled: boolean,
): ScalingContext {
	return {
		skillCount,
		// Value usage 13 brackets on the maximum *raw* stat -- post-motivation and post-overcap,
		// before any course/ground/strategy modifier. `HorseParameters.maxRawStat` is exactly that
		// quantity, computed by `buildBaseStats()` and carried through `buildAdjustedStats()`
		// unchanged, so engine and UI cannot define it differently.
		maxBaseStat: adjusted.maxRawStat,
		// Value usage 22/23 bracket on `RaceSolver`'s `this.horse.speed`, which is
		// `buildAdjustedStats()` output -- not the raw slider value.
		finalSpeed: adjusted.speed,
		remainingHp: hpModeled
			? 0.8 * HpStrategyCoefficient[adjusted.strategy] * adjusted.stamina +
				courseDistance
			: Infinity,
	};
}

// Everything `buildBaseStats()` actually reads. Deliberately `HorseDesc` minus `skills`: the
// editor's `HorseState` carries an Immutable `SkillSet` there rather than `HorseDesc`'s
// `string[]`, so requiring the full interface would reject the very callers this exists for --
// and `buildBaseStats()` never touches the field. Skill count comes in as its own argument.
export type ScalableHorse = Omit<HorseDesc, 'skills'>;

// For a caller holding editor-shaped stats (`HorseState` satisfies `ScalableHorse` structurally):
// runs the same `buildBaseStats()` -> `buildAdjustedStats()` pipeline `RaceSolverBuilder`'s own
// generator does, so the brackets get the quantities the solver would have looked them up with.
//
// Returns `undefined` -- meaning "render unscaled" to every consumer, all of which already treat a
// missing context that way -- when the horse cannot be built at all. That is a real, reachable
// case: `parseStrategy()`/`parseAptitude()` throw on an unrecognized string, share-link hashes
// deserialize straight into `HorseState` with no validation, and this now runs during render, so a
// hand-edited or corrupted hash would otherwise blank the whole app instead of producing one
// unscaled number.
export function scalingContextForHorseDesc(
	horse: ScalableHorse,
	course: CourseData,
	ground: GroundCondition,
	skillCount: number,
	hpModeled = true,
): ScalingContext | undefined {
	try {
		const base = buildBaseStats(horse as HorseDesc, horse.mood);
		const adjusted = buildAdjustedStats(base, course, ground);
		return contextFrom(adjusted, skillCount, course.distance, hpModeled);
	} catch (_) {
		return undefined;
	}
}

// For a caller that already holds an engine-shaped `HorseParameters` and applies no course/ground
// modifiers of its own (skill-visualizer's fixed inspection horse) -- taking its stats at face
// value is right there, since that same object is what the app feeds the condition evaluator.
export function scalingContextForHorseParameters(
	horse: HorseParameters,
	course: CourseData,
	skillCount: number,
	hpModeled = true,
): ScalingContext {
	return contextFrom(horse, skillCount, course.distance, hpModeled);
}
