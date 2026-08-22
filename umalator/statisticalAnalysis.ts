// Statistical primitives for the Skill Chart: confidence intervals, quantiles, and the
// per-skill summary shown in the table and in an expanded row's detail.
//
// The paired length-gain distribution the chart works with is generally right-skewed -- mostly
// at or near zero, with a tail on the scenarios where the tracked skill happened to activate
// usefully -- so a plain symmetric interval on the mean tends to mislocate the interval for
// exactly the skills a user is trying to evaluate. BCa (bias-corrected and accelerated) bootstrap
// correct for that, but an O(n * bootstrapSamples) resample is only worth paying for the small
// number of skills that survive the chart's adaptive round ladder (see chartLadder.ts) to a large
// sample count. Screening rounds instead use a cheap normal-approximation interval, deliberately
// widened past the usual 95% z-value, to make an early elimination decision defensible without
// bootstrapping every candidate on every round.

export interface Interval {
	lower: number;
	upper: number;
}

export function quantile(sortedValues: ArrayLike<number>, p: number): number {
	if (sortedValues.length === 0) return 0;
	const index = (sortedValues.length - 1) * Math.max(0, Math.min(1, p));
	const lower = Math.floor(index);
	const fraction = index - lower;
	const a = sortedValues[lower];
	const b = sortedValues[lower + 1] ?? a;
	return a + (b - a) * fraction;
}

// Standard 95% Wilson score interval for a binomial proportion (successes out of total). Used
// for Helps/Proc rates, which are proportions, not means -- a normal-approximation interval on a
// proportion can extend past [0, 1] near the extremes, which Wilson's doesn't.
export function wilsonInterval(
	successes: number,
	total: number,
	z = 1.959963984540054, // Phi^-1(0.975)
): Interval {
	if (total <= 0) return { lower: 0, upper: 0 };
	const p = successes / total;
	const z2 = z * z;
	const denominator = 1 + z2 / total;
	const center = (p + z2 / (2 * total)) / denominator;
	const margin =
		(z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
	return {
		lower: Math.max(0, center - margin),
		upper: Math.min(1, center + margin),
	};
}

function normalCdf(x: number): number {
	const sign = x < 0 ? -1 : 1;
	const value = Math.abs(x) / Math.sqrt(2);
	const t = 1 / (1 + 0.3275911 * value);
	const erf =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
			t +
			0.254829592) *
			t *
			Math.exp(-value * value);
	return 0.5 * (1 + sign * erf);
}

function inverseNormal(p: number): number {
	const probability = Math.max(1e-12, Math.min(1 - 1e-12, p));
	let low = -8;
	let high = 8;
	for (let i = 0; i < 70; ++i) {
		const middle = (low + high) / 2;
		if (normalCdf(middle) < probability) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
}

function seededRandom(seed: number): () => number {
	let state = seed >>> 0 || 0x9e3779b9;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x100000000;
	};
}

// Mean and (population) variance in one pass. Used both to build a display interval and, by the
// chart's round-boundary screening rule, to decide whether a skill can be eliminated yet.
export function meanVariance(values: ArrayLike<number>): {
	mean: number;
	variance: number;
} {
	const n = values.length;
	if (n === 0) return { mean: 0, variance: 0 };
	let sum = 0;
	for (let i = 0; i < n; ++i) sum += values[i];
	const mean = sum / n;
	if (n === 1) return { mean, variance: 0 };
	let sumSq = 0;
	for (let i = 0; i < n; ++i) {
		const d = values[i] - mean;
		sumSq += d * d;
	}
	return { mean, variance: sumSq / (n - 1) };
}

// A symmetric interval on the mean, mean +/- z * standard error. z defaults to the usual 95%
// two-sided value for display; the chart's screening rule (chartLadder.ts) passes a wider,
// sample-size-adjusted z when deciding whether to eliminate a skill early -- that's a screening
// bound, not a claim of 95% coverage, and is documented as such where it's used.
export function normalApproxInterval(
	mean: number,
	variance: number,
	n: number,
	z = 1.959963984540054,
): Interval {
	if (n === 0) return { lower: 0, upper: 0 };
	const se = Math.sqrt(variance / n);
	return { lower: mean - z * se, upper: mean + z * se };
}

// Bias-corrected and accelerated bootstrap interval for the mean. O(n * bootstrapSamples); only
// call this for skills that have reached their final round (see chartLadder.ts) -- screening
// rounds use normalApproxInterval instead, which is the entire reason the chart's Thorough preset
// doesn't cost 500-skills-worth of this every round.
export function bcaMeanInterval(
	values: ArrayLike<number>,
	bootstrapSamples: number,
	seed: number,
): Interval {
	const n = values.length;
	if (n === 0) return { lower: 0, upper: 0 };
	let allSame = true;
	for (let i = 1; i < n; ++i) {
		if (values[i] !== values[0]) {
			allSame = false;
			break;
		}
	}
	if (allSame) return { lower: values[0], upper: values[0] };

	const observed = meanVariance(values).mean;
	const random = seededRandom(seed);
	const B = Math.max(100, bootstrapSamples);
	const bootstraps = new Float64Array(B);
	let lessThanObserved = 0;
	for (let b = 0; b < B; ++b) {
		let total = 0;
		for (let i = 0; i < n; ++i) total += values[Math.floor(random() * n)];
		const m = total / n;
		bootstraps[b] = m;
		if (m < observed) ++lessThanObserved;
	}
	bootstraps.sort();

	const z0 = inverseNormal((lessThanObserved + 0.5) / (B + 1));
	let acceleration = 0;
	if (n > 2) {
		let total = 0;
		for (let i = 0; i < n; ++i) total += values[i];
		const jackknife = new Float64Array(n);
		for (let i = 0; i < n; ++i) jackknife[i] = (total - values[i]) / (n - 1);
		const jackMean = meanVariance(jackknife).mean;
		let numerator = 0;
		let denomSum = 0;
		for (let i = 0; i < n; ++i) {
			const d = jackMean - jackknife[i];
			numerator += d ** 3;
			denomSum += d ** 2;
		}
		const denominator = 6 * denomSum ** 1.5;
		if (denominator > 0) acceleration = numerator / denominator;
	}
	const adjusted = (alpha: number) => {
		const z = inverseNormal(alpha);
		return normalCdf(z0 + (z0 + z) / (1 - acceleration * (z0 + z)));
	};
	return {
		lower: quantile(bootstraps, adjusted(0.025)),
		upper: quantile(bootstraps, adjusted(0.975)),
	};
}

export interface SkillStatistics {
	sampleCount: number;
	mean: number;
	meanCI: Interval;
	// Which method produced meanCI -- 't' for the cheap screening-round interval, 'bca' only once
	// a skill has reached its final round. Shown as a tooltip so the two aren't confused for the
	// same kind of number.
	ciMethod: 't' | 'bca';
	timeMean: number;
	p10: number;
	p50: number;
	p90: number;
	helpRate: number;
	hurtRate: number;
	tieRate: number;
	helpCI: Interval;
	procRate: number;
	procCI: Interval;
	conditionalMean: number;
}

export function summarizeLengths(
	lengths: ArrayLike<number>,
	times: ArrayLike<number>,
	procCounts: ArrayLike<number>,
	options: {
		ciMethod: 't' | 'bca';
		bootstrapSamples?: number;
		seed?: number;
		tieThreshold?: number;
	},
): SkillStatistics {
	const n = lengths.length;
	const tieThreshold = options.tieThreshold ?? 0.01;

	const sorted = Array.from(lengths).sort((a, b) => a - b);
	const { mean, variance } = meanVariance(lengths);

	let timeSum = 0;
	for (let i = 0; i < times.length; ++i) timeSum += times[i];
	const timeMean = times.length > 0 ? timeSum / times.length : 0;

	let helps = 0;
	let hurts = 0;
	let procs = 0;
	let procLengthSum = 0;
	for (let i = 0; i < n; ++i) {
		const v = lengths[i];
		if (v > tieThreshold) helps++;
		else if (v < -tieThreshold) hurts++;
		if (procCounts[i] > 0) {
			procs++;
			procLengthSum += v;
		}
	}
	const ties = n - helps - hurts;

	const meanCI: Interval =
		options.ciMethod === 'bca'
			? bcaMeanInterval(
					lengths,
					options.bootstrapSamples ?? 2000,
					options.seed ?? 1,
				)
			: normalApproxInterval(mean, variance, n);

	return {
		sampleCount: n,
		mean,
		meanCI,
		ciMethod: options.ciMethod,
		timeMean,
		p10: quantile(sorted, 0.1),
		p50: quantile(sorted, 0.5),
		p90: quantile(sorted, 0.9),
		helpRate: n > 0 ? helps / n : 0,
		hurtRate: n > 0 ? hurts / n : 0,
		tieRate: n > 0 ? ties / n : 0,
		helpCI: wilsonInterval(helps, n),
		procRate: n > 0 ? procs / n : 0,
		procCI: wilsonInterval(procs, n),
		conditionalMean: procs > 0 ? procLengthSum / procs : 0,
	};
}
