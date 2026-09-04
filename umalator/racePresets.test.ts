import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import jpPresets from '../presets.ts';
import globalPresets from '../umalator-global/presets.ts';
import {
	cmSchedule,
	parseEventDate,
	pickDefaultPresetIndex,
} from './racePresets.ts';

test("cmSchedule: full Libra Cup 2 phase table (docs/cm-presets.md's worked example)", () => {
	const s = cmSchedule('2026-08-25', 'CM');
	assert.equal(new Date(s.start).toISOString(), '2026-08-25T22:00:00.000Z');
	assert.equal(new Date(s.round1).toISOString(), '2026-08-28T22:00:00.000Z');
	assert.equal(new Date(s.round2).toISOString(), '2026-08-30T22:00:00.000Z');
	assert.equal(new Date(s.final).toISOString(), '2026-09-01T22:00:00.000Z');
	assert.equal(new Date(s.lockIn).toISOString(), '2026-09-02T10:00:00.000Z');
	assert.equal(
		new Date(s.switchover).toISOString(),
		'2026-09-02T07:00:00.000Z',
	);
});

test('parseEventDate: full date and legacy month-only form', () => {
	assert.deepEqual(parseEventDate('2026-08-25'), {
		year: 2026,
		month: 8,
		day: 25,
	});
	assert.deepEqual(parseEventDate('2026-03'), { year: 2026, month: 3, day: 1 });
});

describe('pickDefaultPresetIndex', () => {
	test('the boundary instant, exactly at the switchover', () => {
		const entries = [
			{ date: '2026-09-15', type: 'CM' as const }, // id 19 Scorpio Cup 2
			{ date: '2026-08-25', type: 'CM' as const }, // id 18 Libra Cup 2
			{ date: '2026-08-05', type: 'CM' as const }, // id 17 Virgo Cup 2
		];
		const justBefore = Date.parse('2026-09-02T06:59:59.999Z');
		assert.equal(
			pickDefaultPresetIndex(entries, justBefore),
			1,
			'still Libra Cup 2 just before switchover',
		);
		const atSwitchover = Date.parse('2026-09-02T07:00:00.000Z');
		assert.equal(
			pickDefaultPresetIndex(entries, atSwitchover),
			0,
			'flips to Scorpio Cup 2 at switchover',
		);
	});

	test('today (2026-09-01) resolves to Libra Cup 2, pinning the fix', () => {
		// The pre-UI-31 month-granular heuristic picked Scorpio Cup 2 here instead -- 2 weeks before
		// it even starts. This case exists specifically to catch a regression back to that behavior.
		const entries = [
			{ date: '2026-09-15', type: 'CM' as const }, // id 19 Scorpio Cup 2
			{ date: '2026-08-25', type: 'CM' as const }, // id 18 Libra Cup 2
			{ date: '2026-08-05', type: 'CM' as const }, // id 17 Virgo Cup 2
		];
		const today = Date.parse('2026-09-01T20:00:00.000Z');
		assert.equal(pickDefaultPresetIndex(entries, today), 1);
	});

	test('order-independence (same answer from a shuffled array)', () => {
		const ordered = [
			{ date: '2026-09-15', type: 'CM' as const },
			{ date: '2026-08-25', type: 'CM' as const },
			{ date: '2026-08-05', type: 'CM' as const },
		];
		const shuffled = [ordered[2], ordered[0], ordered[1]];
		const now = Date.parse('2026-09-01T20:00:00.000Z');
		const orderedPick = ordered[pickDefaultPresetIndex(ordered, now)];
		const shuffledPick = shuffled[pickDefaultPresetIndex(shuffled, now)];
		assert.deepEqual(orderedPick, shuffledPick);
	});

	test('all-past fallback picks the most recent (largest switchover)', () => {
		const entries = [
			{ date: '2025-08', type: 'CM' as const }, // id 1 Taurus Cup, oldest
			{ date: '2026-02', type: 'LOH' as const }, // newest
			{ date: '2025-12-21', type: 'CM' as const },
		];
		const farFuture = Date.parse('2030-01-01T00:00:00.000Z');
		assert.equal(pickDefaultPresetIndex(entries, farFuture), 1);
	});

	test('single-entry list', () => {
		assert.equal(
			pickDefaultPresetIndex([{ date: '2026-08-25', type: 'CM' as const }], 0),
			0,
		);
	});

	test('LOH branch uses the same schedule length as CM', () => {
		const cm = cmSchedule('2026-08-25', 'CM');
		const loh = cmSchedule('2026-08-25', 'LOH');
		assert.equal(cm.switchover, loh.switchover);
	});
});

test('JP list is unaffected by the schedule rewrite', () => {
	// every entry is past, so the fallback picks the same newest-switchover entry the old
	// findIndex()-1 heuristic already picked today.
	const now = Date.parse('2026-09-01T20:00:00.000Z');
	const idx = pickDefaultPresetIndex(jpPresets, now);
	// Newest JP entry is the LOH dated '2026-02' -- its switchover (2026-02-09T07:00Z) is the
	// largest among an all-past list, so the fallback must land there.
	assert.equal(jpPresets[idx].date, '2026-02');
	assert.equal(jpPresets[idx].type, 'LOH');
});

test('today (2026-09-01), the real Global list resolves to Libra Cup 2 (id 18)', () => {
	// Not Scorpio Cup 2 (id 19) -- the exact behavior change this ticket makes, pinned against
	// the real data file rather than a hand-built fixture.
	const now = Date.parse('2026-09-01T20:00:00.000Z');
	const idx = pickDefaultPresetIndex(globalPresets, now);
	assert.equal(globalPresets[idx].id, 18);
	assert.equal(globalPresets[idx].name, 'Libra Cup 2');
});

test('real-file validation: every entry uses a recognized enum-member-name string and a parseable date', () => {
	// This is the guard that would have caught the `ground: 'Firm'` bug (GroundCondition has no
	// `Firm` member) at test time instead of it silently evaluating to `undefined` in the
	// browser -- see docs/cm-presets.md.
	const SEASONS = new Set(['Spring', 'Summer', 'Autumn', 'Winter', 'Sakura']);
	const GROUNDS = new Set(['Good', 'Yielding', 'Soft', 'Heavy']);
	const WEATHERS = new Set(['Sunny', 'Cloudy', 'Rainy', 'Snowy']);
	const TIMES = new Set(['NoTime', 'Morning', 'Midday', 'Evening', 'Night']);
	const TYPES = new Set(['CM', 'LOH']);

	function validate(label: string, entries: readonly unknown[]) {
		for (const raw of entries) {
			const p = raw as Record<string, unknown>;
			const where = `${label} id=${p.id ?? '?'} name=${p.name ?? '?'}`;
			assert.ok(
				TYPES.has(p.type as string),
				`${where}: unrecognized type ${p.type}`,
			);
			assert.ok(
				SEASONS.has(p.season as string),
				`${where}: unrecognized season ${p.season}`,
			);
			assert.ok(
				GROUNDS.has(p.ground as string),
				`${where}: unrecognized ground ${p.ground}`,
			);
			assert.ok(
				WEATHERS.has(p.weather as string),
				`${where}: unrecognized weather ${p.weather}`,
			);
			assert.ok(
				TIMES.has(p.time as string),
				`${where}: unrecognized time ${p.time}`,
			);
			assert.ok(
				!Number.isNaN(parseEventDate(p.date as string).year),
				`${where}: unparseable date ${p.date}`,
			);
			assert.equal(
				typeof p.courseId,
				'number',
				`${where}: courseId must be a number`,
			);
		}
	}

	validate('JP', jpPresets);
	validate('Global', globalPresets);
	assert.equal(jpPresets.length, 9);
	assert.equal(globalPresets.length, 24);
});
