import assert from 'node:assert/strict';
import {
	bcaMeanInterval,
	meanVariance,
	normalApproxInterval,
	quantile,
	summarizeLengths,
	wilsonInterval,
} from './statisticalAnalysis.ts';

assert.equal(quantile([0, 10], 0.5), 5);
assert.equal(quantile([], 0.5), 0);
assert.equal(quantile([3], 0.9), 3);

assert.deepEqual(bcaMeanInterval([2, 2, 2], 1000, 1), { lower: 2, upper: 2 });
assert.deepEqual(bcaMeanInterval([], 1000, 1), { lower: 0, upper: 0 });

{
	const { mean, variance } = meanVariance([1, 2, 3, 4, 5]);
	assert.equal(mean, 3);
	assert.equal(variance, 2.5); // sample variance, Bessel-corrected (n-1 = 4)
}
assert.deepEqual(meanVariance([]), { mean: 0, variance: 0 });
assert.deepEqual(meanVariance([7]), { mean: 7, variance: 0 });

{
	const iv = normalApproxInterval(1, 4, 100);
	assert.ok(iv.lower < 1 && iv.upper > 1);
	// wider z should widen the interval
	const wide = normalApproxInterval(1, 4, 100, 3.5);
	assert.ok(wide.lower < iv.lower && wide.upper > iv.upper);
}

assert.ok(
	wilsonInterval(5, 10).lower < 0.5 && wilsonInterval(5, 10).upper > 0.5,
);
assert.deepEqual(wilsonInterval(0, 0), { lower: 0, upper: 0 });

// A mostly-zero, occasionally-large-positive sample: tieRate/helpRate/conditionalMean should
// reflect the skew, and the 'bca' interval should still bracket the observed mean.
{
	const lengths = [0, 0, 0, 0, 5];
	const times = lengths.map((v) => v / 10);
	const procCounts = lengths.map((v) => (v > 0 ? 1 : 0));
	const skewed = summarizeLengths(lengths, times, procCounts, {
		ciMethod: 'bca',
		bootstrapSamples: 2000,
		seed: 42,
	});
	assert.equal(skewed.mean, 1);
	assert.equal(skewed.ciMethod, 'bca');
	assert.ok(
		skewed.meanCI.lower <= skewed.mean && skewed.meanCI.upper >= skewed.mean,
	);
	assert.equal(skewed.tieRate, 4 / 5);
	assert.equal(skewed.helpRate, 1 / 5);
	assert.equal(skewed.procRate, 1 / 5);
	assert.equal(skewed.conditionalMean, 5);
}

// The screening interval ('t') should be cheap (no bootstrap) and centered on the mean.
{
	const lengths = [-2, -1, 0, 1];
	const times = [0, 0, 0, 0];
	const procCounts = [1, 1, 1, 1];
	const screened = summarizeLengths(lengths, times, procCounts, {
		ciMethod: 't',
	});
	assert.equal(screened.ciMethod, 't');
	assert.equal(screened.p50, -0.5);
	assert.equal(screened.helpRate, 1 / 4);
	assert.equal(screened.procRate, 1);
	const mid = (screened.meanCI.lower + screened.meanCI.upper) / 2;
	assert.ok(Math.abs(mid - screened.mean) < 1e-9);
}

console.log('statisticalAnalysis tests passed');
