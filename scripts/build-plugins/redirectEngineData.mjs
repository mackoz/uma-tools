import path from 'node:path';

const JP_MARKER = `${path.sep}data${path.sep}jp${path.sep}`;
const GLOBAL_MARKER = `${path.sep}data${path.sep}global${path.sep}`;

// Pure function: given an import specifier and the absolute path of the file
// importing it, returns the absolute path to redirect to if the specifier
// resolves through data/jp/, or null if it doesn't match at all. Depth-agnostic
// by construction -- resolves to an absolute path first, then does a plain
// substring swap, so it doesn't matter how many `../` segments the specifier had.
export function redirectEngineDataPath(importSpecifier, importerAbsolutePath) {
	const resolved = path.resolve(
		path.dirname(importerAbsolutePath),
		importSpecifier,
	);
	if (!resolved.includes(JP_MARKER)) return null;
	return resolved.replace(JP_MARKER, GLOBAL_MARKER);
}

// esbuild plugin factory. Both umalator-global/build.mjs and
// skill-visualizer-global/build.mjs call this identically -- the whole point of
// factoring it out is that there is exactly one place this logic can drift.
export function redirectEngineData() {
	return {
		name: 'redirectEngineData',
		setup(build) {
			build.onResolve({ filter: /data\/jp\// }, (args) => {
				const redirected = redirectEngineDataPath(args.path, args.importer);
				return redirected ? { path: redirected } : undefined;
			});
		},
	};
}
