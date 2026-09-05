// Pure helpers behind two scripts/verify.mjs stages (PIPE-56). Extracted so the
// logic is unit-testable independently of the stage wiring (fs reads, process
// exit codes, console output) -- see scripts/verify-helpers.test.mjs.

// A stray `npm install` inside a worktree was once observed to normalize the
// *parent* uma-tools package.json -- injecting `description` (scraped from the
// README), `directories`, `keywords`, and, most dangerously, `"type":
// "commonjs"`, which can change module resolution for .js files repo-wide. The
// exact triggering invocation was never pinned down (see PIPE-56's ticket,
// "Update 2026-09-05" -- a real npm uninstall/install cycle during PIPE-52
// left package.json clean), so this is a tripwire rather than a fix for a
// known cause: none of these three keys is present in either package.json
// today, so "absent" is the whole baseline, and it fires whenever/however one
// reappears.
export const FORBIDDEN_PKG_KEYS = ['type', 'directories', 'keywords'];

// Returns the offending key names present on pkgJson, out of FORBIDDEN_PKG_KEYS.
export function forbiddenPkgKeys(pkgJson) {
	return FORBIDDEN_PKG_KEYS.filter((key) => Object.hasOwn(pkgJson, key));
}

// Returns the names of dependencies (dependencies + devDependencies) declared
// in pkgJson but absent from installedNames (an iterable of package names
// actually present in node_modules -- scoped packages given as "@scope/name").
// Deliberately does not shell out to `npm ls`: this repo's .npmrc sets
// legacy-peer-deps for umadle's Preact 8 peer against this repo's Preact 10,
// and `npm ls --all` exits 1 on that pre-existing peer conflict even when
// every declared dependency is actually installed correctly (confirmed
// 2026-09-05 while implementing this ticket -- `npm ls preact --all` reports
// ELSPROBLEMS and exits 1 purely from the "invalid: ^8.0.0" peer mismatch, with
// nothing actually missing). A directory-existence check sidesteps that noise
// entirely.
export function missingDeps(pkgJson, installedNames) {
	const installed = new Set(installedNames);
	const declared = {
		...(pkgJson.dependencies || {}),
		...(pkgJson.devDependencies || {}),
	};
	return Object.keys(declared).filter((name) => !installed.has(name));
}
