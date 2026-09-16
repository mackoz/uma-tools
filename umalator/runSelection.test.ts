import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { DEFAULT_DISPLAYING_RUN, displayRunOf } from './runSelection.ts';

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
