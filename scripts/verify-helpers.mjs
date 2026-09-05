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

// PIPE-60: missingDeps (above) only ever asked "does the directory exist" --
// it says nothing about whether the directory holds the version package.json
// actually declares. That gap let PIPE-53's engine TypeScript bump (4.7.4 ->
// 7.0.2, @types/node ^18 -> ^24) land while the main checkout's install
// stayed on the old versions, with `deps OK` reported the whole time --
// nothing here, or in missingDeps, opens an installed package's own
// package.json to read its version. staleDeps closes that gap, but is kept
// as its own function rather than folded into missingDeps: "absent" and
// "present but wrong" are different failure classes with different messages,
// and missingDeps's existing tests/behavior should not need to change to add
// this.
//
// Compares against package-lock.json's resolved version, not the declared
// semver range -- deliberately, not for lack of trying the range-based
// alternative. No semver-capable library exists anywhere in this repo's
// dependency tree (confirmed 2026-09-05: absent from both node_modules
// trees), so a real range-satisfaction check would mean adding one -- a new
// dependency to fix a dependency-freshness checker is circular. A
// major-version-only parse of the declared range was also considered and
// rejected: it breaks on `unassert-cli`, a git-source dependency
// (`"github:unassert-js/unassert-cli"`) with no semver range and no leading
// digit to parse, which resolves cleanly to "1.0.0" in package-lock.json --
// exactly the case that must not be silently skipped. Lockfile comparison
// answers a stronger question than either alternative: not "is some version
// in range installed" but "does the install match what running `npm install`
// right now would actually produce."
//
// installedVersions and lockfileVersions are both name -> version maps
// (scoped packages keyed as "@scope/name", matching how they're declared in
// package.json and how package-lock.json's "packages" keys them --
// "node_modules/@scope/name"). Returns one entry per declared dependency that
// is present in both maps but whose versions disagree -- a dependency
// missing from installedVersions is missingDeps's job, not this one's, and a
// dependency present in node_modules but absent from lockfileVersions is
// reported separately by the caller (see verify.mjs's runDepsFreshness) since
// it's a distinct, also-report-worthy shape: a healthy repo should never have
// an installed package the lockfile doesn't know about at all.
export function staleDeps(pkgJson, installedVersions, lockfileVersions) {
	const declared = {
		...(pkgJson.dependencies || {}),
		...(pkgJson.devDependencies || {}),
	};
	const stale = [];
	for (const name of Object.keys(declared)) {
		const installed = installedVersions[name];
		const resolved = lockfileVersions[name];
		if (installed === undefined || resolved === undefined) continue;
		if (installed !== resolved) {
			stale.push({ name, installed, resolved });
		}
	}
	return stale;
}

// Reads package-lock.json's resolved versions for exactly the dependencies
// pkgJson declares, keyed the same way installedVersions is (see
// listInstalledVersions in verify.mjs) -- "@scope/name" for scoped packages.
// lockJson is the parsed package-lock.json; its v2+ "packages" map keys
// entries as "node_modules/<name>" (scoped packages included verbatim, e.g.
// "node_modules/@floating-ui/dom"), so stripping that fixed prefix recovers
// the same name shape used elsewhere. A declared dependency with no matching
// "packages" entry is simply absent from the returned map -- the caller
// reports that as its own case rather than this function guessing or
// throwing.
export function lockfileVersions(pkgJson, lockJson) {
	const declared = {
		...(pkgJson.dependencies || {}),
		...(pkgJson.devDependencies || {}),
	};
	const packages = (lockJson && lockJson.packages) || {};
	const versions = {};
	for (const name of Object.keys(declared)) {
		const entry = packages[`node_modules/${name}`];
		if (entry && typeof entry.version === 'string') {
			versions[name] = entry.version;
		}
	}
	return versions;
}
