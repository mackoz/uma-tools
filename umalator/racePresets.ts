// Schedule logic for the PRESET dropdown's default selection (UI-31). Champions Meeting (CM)
// events all follow one pattern anchored to the daily server reset, and this module encodes
// that pattern in one place instead of the ad hoc calendar-month heuristic app.tsx used to use.
// See docs/cm-presets.md for the full worked-out schedule table and the reasoning behind the
// UTC-anchoring choice.
//
// Kept import-free (no Preact, no CSS, no JSON, and critically no `enum` -- see below) so it's
// plain-node testable under `node --experimental-strip-types`, matching chartLadder.ts,
// shopSkillFilter.ts, spOptimizer.ts, and statisticalAnalysis.ts. umalator/app.tsx owns the
// `presets.ts` data imports and the string-to-enum lookup tables, and passes plain string
// values (and epoch milliseconds for "now") in here.
//
// IMPORTANT: node's `--experimental-strip-types` mode (which `npm run test` runs under) rejects
// ANY `enum` -- plain or `const` -- with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. This file must never
// import Season/GroundCondition/Weather/Time/EventType from uma-skill-tools/RaceParameters, or
// every test importing it stops working. `import type` is fine (fully erased); a runtime import
// is not.

// Literal string unions mirroring the *member names* (not values) of
// uma-skill-tools/RaceParameters.ts's Season/GroundCondition/Weather/Time enums. These are
// type-only -- erased at compile time -- so importing them costs nothing at runtime and doesn't
// reintroduce the `enum` `--experimental-strip-types` can't handle (see the file header). Their
// entire purpose is to make `presets.ts`'s `satisfies readonly RawPreset[]` actually reject a
// misspelled or nonexistent member (e.g. `ground: 'Firm'`, which isn't a GroundCondition member
// at all -- see docs/cm-presets.md) instead of silently widening to `string`, which is exactly
// the gap that let that bug ship unnoticed.
export type RawSeason = 'Spring' | 'Summer' | 'Autumn' | 'Winter' | 'Sakura';
export type RawGroundCondition = 'Good' | 'Yielding' | 'Soft' | 'Heavy';
export type RawWeather = 'Sunny' | 'Cloudy' | 'Rainy' | 'Snowy';
export type RawTime = 'NoTime' | 'Morning' | 'Midday' | 'Evening' | 'Night';

// The event's own schedule, as raw data -- one flat object per preset. `type` and the enum-ish
// fields are kept as plain (literal-typed) strings, matching how presets.ts stores them, so this
// module has nothing to import from RaceParameters.ts at runtime.
export interface RawPreset {
	// JP entries currently carry neither -- see UI-31's follow-up ticket for the resulting
	// "CM undefined - undefined" dropdown label, deliberately left alone here.
	id?: number;
	name?: string;
	type: 'CM' | 'LOH';
	// ISO date, either full ('2026-08-25') or legacy month-only ('2026-03') -- see
	// parseEventDate.
	date: string;
	// True for a handful of Global's not-yet-reached second-zodiac-lap cups whose date is a flat
	// 21-day extrapolation rather than an observed one. See docs/cm-presets.md.
	estimated?: boolean;
	courseId: number;
	season: RawSeason;
	ground: RawGroundCondition;
	weather: RawWeather;
	time: RawTime;
}

// The daily server reset, observed as "3 PM in my timezone" during Pacific Daylight Time.
// ASSUMPTION, not verified against the actual game server: encoded as one wall-clock hour plus
// one UTC offset so every other constant derives from these two rather than risking independent
// drift. If this offset is wrong the whole schedule shifts uniformly, which is a much easier bug
// to spot (and fix in one place) than the reset and the switchover disagreeing with each other.
export const CM_RESET_LOCAL_HOUR = 15; // 3 PM
export const CM_RESET_UTC_OFFSET = -7; // PDT

// The CM round structure, in days from the event's start (the server reset on `date`):
//   prep opens @ +0d, round 1 @ +3d..+5d, round 2 @ +5d..+7d, final round @ +7d..+8d,
//   final-round roster lock-in @ +7d12h, and the default preset switches to the next cup at
//   local midnight of the day after the final round ends, i.e. +8d @ 00:00 local -- which in UTC
//   terms is `CM_SCHEDULE_DAYS` days after `date` at `-CM_RESET_UTC_OFFSET` hours UTC.
export const CM_SCHEDULE_DAYS = 8;
// LOH's real schedule isn't documented anywhere in this repo or upstream. Rather than let LOH
// silently fall through to some default, this assumption is named and kept equal to CM's so it's
// visible and easy to correct once someone actually knows LOH's cadence.
export const LOH_SCHEDULE_DAYS = 8;

function scheduleDays(type: 'CM' | 'LOH'): number {
	switch (type) {
		case 'CM':
			return CM_SCHEDULE_DAYS;
		case 'LOH':
			return LOH_SCHEDULE_DAYS;
	}
}

// Parses both the full-date form ('2026-08-25') presets use going forward and the legacy
// month-only form ('2026-03') older entries still carry, approximating the latter to the 1st of
// the month. Every month-only entry in the current data is historical, so this approximation has
// no effect on the default-preset pick -- it only needs to parse without throwing.
export function parseEventDate(iso: string): {
	year: number;
	month: number;
	day: number;
} {
	const parts = iso.split('-').map(Number);
	const [year, month, day] = parts;
	return { year, month, day: day ?? 1 };
}

// The reset instant (event start / prep opens), as epoch milliseconds.
function resetInstant(iso: string): number {
	const { year, month, day } = parseEventDate(iso);
	return Date.UTC(
		year,
		month - 1,
		day,
		CM_RESET_LOCAL_HOUR - CM_RESET_UTC_OFFSET,
	);
}

export interface CmSchedule {
	start: number;
	round1: number;
	round2: number;
	final: number;
	lockIn: number;
	switchover: number;
}

// The full phase breakdown for one preset's date, all as epoch milliseconds. `Date.UTC`
// normalizes day-of-month overflow (e.g. day 33) into the correct following month/year for
// free, which is what lets every phase below be expressed as a flat day offset from `date`.
export function cmSchedule(dateISO: string, type: 'CM' | 'LOH'): CmSchedule {
	const { year, month, day } = parseEventDate(dateISO);
	const hour = CM_RESET_LOCAL_HOUR - CM_RESET_UTC_OFFSET;
	const days = scheduleDays(type);
	return {
		start: resetInstant(dateISO),
		round1: Date.UTC(year, month - 1, day + 3, hour),
		round2: Date.UTC(year, month - 1, day + 5, hour),
		final: Date.UTC(year, month - 1, day + 7, hour),
		lockIn: Date.UTC(year, month - 1, day + 7, hour + 12),
		switchover: Date.UTC(year, month - 1, day + days, 0 - CM_RESET_UTC_OFFSET),
	};
}

// Picks the index of the preset that should be the dropdown's default, given the current time.
//
// Rule, deliberately independent of array order (the old app.tsx logic silently depended on
// `presets` being sorted newest-first, which this doesn't need): the active preset is the one
// with the smallest switchover that is still in the future. If every preset's switchover has
// already passed, fall back to the one with the largest (most recent) switchover -- this
// preserves the intent of the pre-UI-31 fix for "the current time goes past the last CM preset
// added" (commit 8fc296c) rather than leaving the picker to fall off the end of the list. Ties
// resolve to whichever entry appears first in `entries`.
export function pickDefaultPresetIndex(
	entries: readonly Pick<RawPreset, 'date' | 'type'>[],
	nowMs: number,
): number {
	let bestFutureIdx = -1;
	let bestFutureSwitchover = Infinity;
	let bestPastIdx = -1;
	let bestPastSwitchover = -Infinity;
	for (let i = 0; i < entries.length; i++) {
		const { switchover } = cmSchedule(entries[i].date, entries[i].type);
		if (switchover > nowMs) {
			if (switchover < bestFutureSwitchover) {
				bestFutureSwitchover = switchover;
				bestFutureIdx = i;
			}
		} else {
			if (switchover > bestPastSwitchover) {
				bestPastSwitchover = switchover;
				bestPastIdx = i;
			}
		}
	}
	if (bestFutureIdx > -1) return bestFutureIdx;
	return Math.max(bestPastIdx, 0);
}
