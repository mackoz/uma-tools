// Whether `data` is fit to feed into Histogram's d3 scales. True (unusable) for a missing or
// empty array, or one whose endpoints aren't finite -- `Histogram` (app.tsx) derives its
// x-domain from data[0]/data[data.length-1] (UI-32), and a NaN there (TypedArray sort() puts
// NaN last) would poison the domain via Math.ceil(NaN). Doesn't scan every element: both current
// producers (popoverResults, applyDetailToSelection in app.tsx) sort before handing data to
// Histogram, so a NaN anywhere in a non-empty, sorted array surfaces at one of the two ends this
// checks -- an interior-only NaN in an unsorted array would slip past this, which is a known,
// accepted limitation rather than a guarantee this function makes.
export function isHistogramDataEmpty(
	data: ArrayLike<number> | null | undefined,
): boolean {
	return (
		data == null ||
		data.length === 0 ||
		!Number.isFinite(data[0]) ||
		!Number.isFinite(data[data.length - 1])
	);
}
