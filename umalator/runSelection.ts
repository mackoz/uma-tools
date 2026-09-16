// The four-value run-selection vocabulary shared by the Compare card, the course map, the Skill
// Chart's "Showing" select, and (since UI-38) SkillProcDataDialog. `DisplayingRun` is the key into
// a result's runData map (`${DisplayRun}run`); `DisplayRun` is the shorter form used for display
// labels and derived state. `displayRunOf` is the exact, lossless inverse of the `${run}run`
// template used to build a `DisplayingRun` -- not a heuristic (see app.tsx's own comment at the
// `displayRun` derivation for why the trailing 'run' can always be sliced off safely).
export type DisplayingRun = 'minrun' | 'meanrun' | 'medianrun' | 'maxrun';
export type DisplayRun = 'min' | 'mean' | 'median' | 'max';

// The single default among the four values that `displaying`, `displayRun`, and the course map's
// chartData all fall back to when nothing has been explicitly selected yet. Consumed by app.tsx
// only -- components/ import the `DisplayingRun` type alone, never this constant, so no component
// can silently take its own default from it (that pattern is exactly what UI-38 fixed).
export const DEFAULT_DISPLAYING_RUN: DisplayingRun = 'medianrun';

export function displayRunOf(displaying: DisplayingRun | ''): DisplayRun {
	return (displaying || DEFAULT_DISPLAYING_RUN).slice(0, -3) as DisplayRun;
}
