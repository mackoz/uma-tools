import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	forbiddenPkgKeys,
	lockfileVersions,
	missingDeps,
	staleDeps,
} from './verify-helpers.mjs';

test('forbiddenPkgKeys: no offending keys -> empty', () => {
	assert.deepEqual(
		forbiddenPkgKeys({ name: 'uma-tools', version: '0.0.1' }),
		[],
	);
});

test('forbiddenPkgKeys: detects "type"', () => {
	assert.deepEqual(forbiddenPkgKeys({ type: 'commonjs' }), ['type']);
});

test('forbiddenPkgKeys: detects "directories"', () => {
	assert.deepEqual(forbiddenPkgKeys({ directories: {} }), ['directories']);
});

test('forbiddenPkgKeys: detects "keywords"', () => {
	assert.deepEqual(forbiddenPkgKeys({ keywords: [] }), ['keywords']);
});

test('forbiddenPkgKeys: detects all three at once, in declared order', () => {
	assert.deepEqual(
		forbiddenPkgKeys({ keywords: [], type: 'commonjs', directories: {} }),
		['type', 'directories', 'keywords'],
	);
});

test('missingDeps: all deps present -> empty', () => {
	const pkg = {
		dependencies: { preact: '^10.18.1' },
		devDependencies: { vitest: '^5.0.0' },
	};
	assert.deepEqual(missingDeps(pkg, ['preact', 'vitest']), []);
});

test('missingDeps: a missing dependency is detected', () => {
	const pkg = { dependencies: { preact: '^10.18.1', d3: '^7.9.0' } };
	assert.deepEqual(missingDeps(pkg, ['preact']), ['d3']);
});

test('missingDeps: a missing devDependency is detected', () => {
	const pkg = { devDependencies: { vitest: '^5.0.0', typescript: '^7.0.2' } };
	assert.deepEqual(missingDeps(pkg, ['typescript']), ['vitest']);
});

test('missingDeps: scoped package names are matched exactly', () => {
	const pkg = { dependencies: { '@floating-ui/dom': '^1.7.2' } };
	assert.deepEqual(missingDeps(pkg, ['@floating-ui/dom']), []);
	assert.deepEqual(missingDeps(pkg, []), ['@floating-ui/dom']);
});

test('missingDeps: an absent node_modules (empty installedNames) reports every declared dep', () => {
	const pkg = {
		dependencies: { preact: '^10.18.1' },
		devDependencies: { vitest: '^5.0.0' },
	};
	assert.deepEqual(missingDeps(pkg, []), ['preact', 'vitest']);
});

test('missingDeps: pkgJson with neither dependencies nor devDependencies -> empty', () => {
	assert.deepEqual(missingDeps({}, ['preact']), []);
});

test('staleDeps: matching versions -> no report', () => {
	const pkg = { dependencies: { preact: '^10.18.1' } };
	assert.deepEqual(
		staleDeps(pkg, { preact: '10.29.8' }, { preact: '10.29.8' }),
		[],
	);
});

test('staleDeps: a mismatched version is reported with old/new', () => {
	const pkg = { devDependencies: { typescript: '^7.0.2' } };
	assert.deepEqual(
		staleDeps(pkg, { typescript: '4.7.4' }, { typescript: '7.0.2' }),
		[{ name: 'typescript', installed: '4.7.4', resolved: '7.0.2' }],
	);
});

test("staleDeps: a dependency missing from installedVersions is skipped (missingDeps' job, not this one's)", () => {
	const pkg = { dependencies: { d3: '^7.9.0' } };
	assert.deepEqual(staleDeps(pkg, {}, { d3: '7.9.0' }), []);
});

test('staleDeps: a dependency absent from lockfileVersions is skipped here (caller reports it separately)', () => {
	const pkg = { dependencies: { d3: '^7.9.0' } };
	assert.deepEqual(staleDeps(pkg, { d3: '7.9.0' }, {}), []);
});

test('staleDeps: the unassert-cli shape -- a git-source dependency with no semver range at all, compared correctly against its lockfile-resolved version', () => {
	// Mirrors the parent package.json's real declaration:
	// "unassert-cli": "github:unassert-js/unassert-cli" -- no leading digit,
	// no semver range, nothing a major-version parse could work with. The
	// lockfile still resolves it to a real version ("1.0.0"), and staleDeps
	// only ever compares installed-vs-resolved strings, so it needs no
	// special case for this shape at all.
	const pkg = {
		dependencies: { 'unassert-cli': 'github:unassert-js/unassert-cli' },
	};
	assert.deepEqual(
		staleDeps(pkg, { 'unassert-cli': '1.0.0' }, { 'unassert-cli': '1.0.0' }),
		[],
	);
	assert.deepEqual(
		staleDeps(pkg, { 'unassert-cli': '0.9.0' }, { 'unassert-cli': '1.0.0' }),
		[{ name: 'unassert-cli', installed: '0.9.0', resolved: '1.0.0' }],
	);
});

test('lockfileVersions: reads resolved versions for declared deps, stripping the node_modules/ prefix', () => {
	const pkg = {
		dependencies: { preact: '^10.18.1' },
		devDependencies: { vitest: '^5.0.0' },
	};
	const lockJson = {
		packages: {
			'node_modules/preact': { version: '10.29.8' },
			'node_modules/vitest': { version: '5.0.0' },
			'node_modules/unrelated': { version: '1.0.0' },
		},
	};
	assert.deepEqual(lockfileVersions(pkg, lockJson), {
		preact: '10.29.8',
		vitest: '5.0.0',
	});
});

test('lockfileVersions: scoped packages keyed as node_modules/@scope/name', () => {
	const pkg = { dependencies: { '@floating-ui/dom': '^1.7.2' } };
	const lockJson = {
		packages: { 'node_modules/@floating-ui/dom': { version: '1.7.2' } },
	};
	assert.deepEqual(lockfileVersions(pkg, lockJson), {
		'@floating-ui/dom': '1.7.2',
	});
});

test('lockfileVersions: a declared dependency absent from the lockfile is simply absent from the result, not thrown', () => {
	const pkg = { dependencies: { ghost: '^1.0.0' } };
	assert.deepEqual(lockfileVersions(pkg, { packages: {} }), {});
});

test('lockfileVersions: the unassert-cli shape -- a git-source declared value still resolves via its lockfile entry', () => {
	const pkg = {
		dependencies: { 'unassert-cli': 'github:unassert-js/unassert-cli' },
	};
	const lockJson = {
		packages: {
			'node_modules/unassert-cli': {
				version: '1.0.0',
				resolved:
					'git+ssh://git@github.com/unassert-js/unassert-cli.git#40d2a9284a7a7c5c42c3088410cc483cfaa4e47a',
			},
		},
	};
	assert.deepEqual(lockfileVersions(pkg, lockJson), {
		'unassert-cli': '1.0.0',
	});
});
