import assert from 'node:assert/strict';
import { test } from 'vitest';
import { forbiddenPkgKeys, missingDeps } from './verify-helpers.mjs';

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
