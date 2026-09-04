import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { isHistogramDataEmpty } from './histogramData.ts';

// --- isHistogramDataEmpty: Histogram's (app.tsx) render-guard predicate ---
describe('isHistogramDataEmpty', () => {
	test('missing data entirely', () => {
		// Missing data entirely -- the exact case UI-32 fixed (popoverResults returns null before a
		// popover has ever opened, or when its accumulator has zero samples).
		assert.equal(isHistogramDataEmpty(null), true);
		assert.equal(isHistogramDataEmpty(undefined), true);
		assert.equal(isHistogramDataEmpty([]), true);
		assert.equal(isHistogramDataEmpty(Float32Array.from([])), true);
	});

	test('a single finite sample', () => {
		// A single finite sample: data[0] and data[data.length-1] are the same element, so this must
		// not be misread as some kind of boundary mismatch -- one real sample is a real distribution.
		assert.equal(isHistogramDataEmpty([2.5]), false);
		assert.equal(isHistogramDataEmpty(Float32Array.from([2.5])), false);
	});

	test('all-zero data', () => {
		// All-zero data: a skill with zero measured effect still has real samples (n > 0, every one
		// exactly 0) -- verified live during UI-32's implementation to render as a single bar at 0,
		// not the "no distribution data" placeholder. Must stay classified as usable.
		assert.equal(isHistogramDataEmpty([0, 0, 0]), false);
		assert.equal(isHistogramDataEmpty(Float32Array.from([0, 0, 0])), false);
	});

	test('ordinary ascending finite data', () => {
		// Ordinary ascending finite data -- the common case.
		assert.equal(
			isHistogramDataEmpty(Float32Array.from([-1.2, 0.4, 1.1, 3.8])),
			false,
		);
	});

	test('NaN at either endpoint', () => {
		// NaN at either endpoint -- exactly what this guard exists to catch (TypedArray sort() puts
		// NaN last, so a NaN sample surfaces at data[data.length-1] once sorted; testing the front
		// endpoint too since the function checks both without assuming which end it lands on).
		assert.equal(
			isHistogramDataEmpty(Float32Array.from([Number.NaN, 1, 2])),
			true,
		);
		assert.equal(
			isHistogramDataEmpty(Float32Array.from([1, 2, Number.NaN])),
			true,
		);
		assert.equal(isHistogramDataEmpty([Number.NaN]), true);
	});

	test('interior NaN is a known, accepted limitation', () => {
		// Known, accepted limitation (see the function's own doc comment): a NaN strictly in the
		// interior of an otherwise-finite array is NOT caught by this boundary-only check. Documented
		// here as intentional behavior, not a gap to silently pass over -- both real producers of this
		// data sort before calling Histogram, which is what makes an interior NaN unreachable in
		// practice, not this function's own coverage.
		assert.equal(
			isHistogramDataEmpty(Float32Array.from([1, Number.NaN, 2])),
			false,
		);
	});

	test('Infinity is exactly as unusable as NaN', () => {
		// Infinity is exactly as unusable as NaN for a d3 linear scale domain (Math.ceil(Infinity) is
		// Infinity, not a bug, but a domain of [x, Infinity] renders nothing useful) -- Number.isFinite
		// rejects it same as NaN.
		assert.equal(
			isHistogramDataEmpty(Float32Array.from([1, Number.POSITIVE_INFINITY])),
			true,
		);
		assert.equal(
			isHistogramDataEmpty(Float32Array.from([Number.NEGATIVE_INFINITY, 1])),
			true,
		);
	});
});
