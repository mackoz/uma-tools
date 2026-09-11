import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import {
	findPii,
	GENERIC_PII_PATTERNS,
	isSelfExempt,
	parseDiffAddedLines,
	parsePersonalPatterns,
} from './check-no-pii-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, 'check-no-pii.mjs');

test('findPii: flags a macOS home path in an added line', () => {
	const hits = findPii(
		[
			{
				file: 'notes.md',
				line: 5,
				text: 'see /Users/alice/github/uma-tools/foo.pl',
			},
		],
		GENERIC_PII_PATTERNS,
	);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].file, 'notes.md');
	assert.equal(hits[0].line, 5);
	assert.match(hits[0].name, /macOS home path/);
});

test('findPii: placeholder notation /Users/<user>/ is not a hit', () => {
	const hits = findPii(
		[
			{
				file: 'CLAUDE.md',
				line: 1,
				text: 'looks like `/Users/<user>/...` or `/home/<user>/...`',
			},
			{
				file: 'notes.md',
				line: 2,
				text: 'the regex /\\/Users\\/[^/\\s<]+\\// itself',
			},
		],
		GENERIC_PII_PATTERNS,
	);
	assert.equal(hits.length, 0);
});

test('isSelfExempt: the tripwire source, helpers and test are exempt; nothing else is', () => {
	assert.equal(isSelfExempt('scripts/check-no-pii.mjs'), true);
	assert.equal(isSelfExempt('scripts/check-no-pii-helpers.mjs'), true);
	assert.equal(isSelfExempt('scripts/check-no-pii.test.mjs'), true);
	assert.equal(isSelfExempt('check-no-pii.mjs'), true);
	assert.equal(isSelfExempt('scripts/check-no-pii-notes.md'), false);
	assert.equal(isSelfExempt('umalator/app.tsx'), false);
});

test('findPii: flags a Linux home path', () => {
	const hits = findPii(
		[{ file: 'notes.md', line: 1, text: '/home/bob/uma-tools' }],
		GENERIC_PII_PATTERNS,
	);
	assert.equal(hits.length, 1);
	assert.match(hits[0].name, /Linux home path/);
});

test('findPii: flags a sanitized transcript directory name', () => {
	const hits = findPii(
		[
			{
				file: 'notes.md',
				line: 1,
				text: '~/.claude/projects/-Users-alice-github-uma-tools/',
			},
		],
		GENERIC_PII_PATTERNS,
	);
	assert.equal(hits.length, 1);
	assert.match(hits[0].name, /transcript directory/);
});

test('findPii: a clean line matches nothing', () => {
	const hits = findPii(
		[{ file: 'notes.md', line: 1, text: 'use $UMA_CODE_REPO/foo.pl instead' }],
		GENERIC_PII_PATTERNS,
	);
	assert.deepEqual(hits, []);
});

test('findPii: /Users/example/ (the documented placeholder) still matches -- it is generic, not an allowlist', () => {
	const hits = findPii(
		[{ file: 'notes.md', line: 1, text: '/Users/example/secret' }],
		GENERIC_PII_PATTERNS,
	);
	assert.equal(hits.length, 1);
});

test('findPii: a line matching two patterns yields two hits', () => {
	const patterns = [
		{ name: 'a', regex: /foo/ },
		{ name: 'b', regex: /bar/ },
	];
	const hits = findPii([{ file: 'x', line: 1, text: 'foobar' }], patterns);
	assert.equal(hits.length, 2);
});

test('parsePersonalPatterns: skips blank lines and # comments', () => {
	const patterns = parsePersonalPatterns(
		'# a comment\n\nalice\n  # indented comment\nbob@example\\.com\n',
	);
	assert.equal(patterns.length, 2);
	assert.ok(patterns[0].regex.test('alice'));
	assert.ok(patterns[1].regex.test('bob@example.com'));
});

test('parseDiffAddedLines: extracts only added lines with correct new-file line numbers', () => {
	const diff = [
		'diff --git a/notes.md b/notes.md',
		'index 1111111..2222222 100644',
		'--- a/notes.md',
		'+++ b/notes.md',
		'@@ -2,2 +2,3 @@',
		'-old second line',
		'+new second line',
		'+new third line',
		' kept fourth line is not shown under -U0, this is illustrative only',
	].join('\n');
	// -U0 never emits an unchanged context line, so the illustrative last line above
	// (leading space) would never really appear -- included only to prove it's ignored.
	const added = parseDiffAddedLines(diff);
	assert.deepEqual(added, [
		{ file: 'notes.md', line: 2, text: 'new second line' },
		{ file: 'notes.md', line: 3, text: 'new third line' },
	]);
});

test('parseDiffAddedLines: a binary file diff contributes no added lines', () => {
	const diff = [
		'diff --git a/x.png b/x.png',
		'Binary files a/x.png and b/x.png differ',
	].join('\n');
	assert.deepEqual(parseDiffAddedLines(diff), []);
});

test('parseDiffAddedLines: multiple files in one diff are tracked independently', () => {
	const diff = [
		'diff --git a/a.md b/a.md',
		'+++ b/a.md',
		'@@ -0,0 +1 @@',
		'+line in a',
		'diff --git a/b.md b/b.md',
		'+++ b/b.md',
		'@@ -0,0 +1 @@',
		'+line in b',
	].join('\n');
	const added = parseDiffAddedLines(diff);
	assert.deepEqual(added, [
		{ file: 'a.md', line: 1, text: 'line in a' },
		{ file: 'b.md', line: 1, text: 'line in b' },
	]);
});

// --- CLI integration: a real scratch git repo, run via `node check-no-pii.mjs`.

function makeScratchRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-no-pii-test-'));
	execFileSync('git', ['init', '-q'], { cwd: dir });
	execFileSync('git', ['config', 'user.email', 'test@example.com'], {
		cwd: dir,
	});
	execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
	return dir;
}

test('CLI: exits 0 given no file arguments', () => {
	const dir = makeScratchRepo();
	const output = execFileSync('node', [cliPath], {
		cwd: dir,
		encoding: 'utf8',
	});
	assert.equal(output, '');
});

test('CLI: exits 0 on a clean staged addition', () => {
	const dir = makeScratchRepo();
	fs.writeFileSync(path.join(dir, 'notes.md'), 'nothing sensitive here\n');
	execFileSync('git', ['add', 'notes.md'], { cwd: dir });
	assert.doesNotThrow(() =>
		execFileSync('node', [cliPath, 'notes.md'], { cwd: dir, encoding: 'utf8' }),
	);
});

test('CLI: exits 1 and names the file:line on a staged home path', () => {
	const dir = makeScratchRepo();
	fs.writeFileSync(path.join(dir, 'notes.md'), 'see /Users/example/secret\n');
	execFileSync('git', ['add', 'notes.md'], { cwd: dir });
	assert.throws(
		() =>
			execFileSync('node', [cliPath, 'notes.md'], {
				cwd: dir,
				encoding: 'utf8',
			}),
		(err) => {
			assert.equal(err.status, 1);
			assert.match(err.stderr.toString(), /notes\.md:1: .*macOS home path/);
			return true;
		},
	);
});

test('CLI: skips package-lock.json even if it contains a matching string', () => {
	const dir = makeScratchRepo();
	fs.writeFileSync(
		path.join(dir, 'package-lock.json'),
		'{"resolved": "/Users/example/x"}\n',
	);
	execFileSync('git', ['add', 'package-lock.json'], { cwd: dir });
	assert.doesNotThrow(() =>
		execFileSync('node', [cliPath, 'package-lock.json'], {
			cwd: dir,
			encoding: 'utf8',
		}),
	);
});
