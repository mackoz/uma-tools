// The four-value run-selection vocabulary shared by the Compare card, the course map, the Skill
// Chart's "Showing" select, and SkillProcDataDialog. `DisplayingRun` is the key into a result's
// runData map (`${DisplayRun}run`); `DisplayRun` is the shorter form used for display labels and
// derived state. `displayRunOf` is the exact, lossless inverse of the `${run}run` template used to
// build a `DisplayingRun` -- not a heuristic (see app.tsx's own comment at the `displayRun`
// derivation for why the trailing 'run' can always be sliced off safely).
export type DisplayingRun = 'minrun' | 'meanrun' | 'medianrun' | 'maxrun';
export type DisplayRun = 'min' | 'mean' | 'median' | 'max';

// The single default among the four values that `displaying`, `displayRun`, and the course map's
// chartData all fall back to when nothing has been explicitly selected yet. Consumed by app.tsx
// only -- components/ import the `DisplayingRun` type alone, never this constant, so no component
// can silently take its own default from it (see UI-38).
export const DEFAULT_DISPLAYING_RUN: DisplayingRun = 'medianrun';

// Takes an already-valid `DisplayingRun` -- callers that may still hold the empty-string "nothing
// selected yet" sentinel resolve it to `DEFAULT_DISPLAYING_RUN` themselves before calling in (see
// app.tsx's `displayRun` derivation), so this function stays a pure, total inverse of the
// `${run}run` template with no embedded default of its own.
export function displayRunOf(displaying: DisplayingRun): DisplayRun {
	return displaying.slice(0, -3) as DisplayRun;
}
