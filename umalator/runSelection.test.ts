import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import {
	DEFAULT_DISPLAYING_RUN,
	type DisplayingRun,
	type DisplayRun,
	displayingRunOf,
	displayRunOf,
} from './runSelection.ts';

// --- displayRunOf: exact inverse of the `${run}run` template ---
describe('displayRunOf', () => {
	test('round-trips all four DisplayingRun values', () => {
		assert.equal(displayRunOf('minrun'), 'min');
		assert.equal(displayRunOf('meanrun'), 'mean');
		assert.equal(displayRunOf('medianrun'), 'median');
		assert.equal(displayRunOf('maxrun'), 'max');
	});

	test('round-trips DEFAULT_DISPLAYING_RUN', () => {
		assert.equal(displayRunOf(DEFAULT_DISPLAYING_RUN), 'median');
	});
});

// --- displayingRunOf: the forward direction of the same mapping ---
describe('displayingRunOf', () => {
	test('round-trips all four DisplayRun values', () => {
		assert.equal(displayingRunOf('min'), 'minrun');
		assert.equal(displayingRunOf('mean'), 'meanrun');
		assert.equal(displayingRunOf('median'), 'medianrun');
		assert.equal(displayingRunOf('max'), 'maxrun');
	});
});

// --- round-trip identities in both directions ---
describe('displayRunOf/displayingRunOf round-trip', () => {
	const displayRuns: DisplayRun[] = ['min', 'mean', 'median', 'max'];
	const displayingRuns: DisplayingRun[] = [
		'minrun',
		'meanrun',
		'medianrun',
		'maxrun',
	];

	test('displayRunOf(displayingRunOf(r)) === r for all DisplayRun values', () => {
		for (const r of displayRuns) {
			assert.equal(displayRunOf(displayingRunOf(r)), r);
		}
	});

	test('displayingRunOf(displayRunOf(d)) === d for all DisplayingRun values', () => {
		for (const d of displayingRuns) {
			assert.equal(displayingRunOf(displayRunOf(d)), d);
		}
	});
});
