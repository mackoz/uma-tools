#!/usr/bin/env node
// Pre-commit PII tripwire (PIPE-67): refuses a commit whose staged *added* lines match
// a macOS/Linux home path, a sanitized Claude transcript directory name, or any pattern
// from an untracked per-user file. Motivated by the 2026-09-02 history scrub -- see
// scripts/check-no-pii-helpers.mjs for the generic patterns and the matching logic.
//
//   node scripts/check-no-pii.mjs <file> [<file> ...]   # lint-staged passes staged files
//
// Exits 0 with no output when given no files, or when nothing staged matches. Exits 1 and
// prints one `file:line: <pattern name>` line per hit otherwise. Skips package-lock.json
// (its content is machine-generated, not prose someone wrote) and the tripwire's own
// source/tests (see isSelfExempt in the helpers) -- binary files are skipped
// automatically, since git's `--- a/X`/`+++ b/X` markers for them carry no `@@` hunk and
// so contribute no added lines to check.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	findPii,
	GENERIC_PII_PATTERNS,
	isSelfExempt,
	parseDiffAddedLines,
	parsePersonalPatterns,
} from './check-no-pii-helpers.mjs';

function loadPersonalPatterns() {
	const configDir =
		process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
	const patternFile = path.join(configDir, 'uma-tools', 'pii-patterns');
	if (!fs.existsSync(patternFile)) return [];
	return parsePersonalPatterns(fs.readFileSync(patternFile, 'utf8'));
}

export function run(argv) {
	const files = argv.filter(
		(f) => path.basename(f) !== 'package-lock.json' && !isSelfExempt(f),
	);
	if (files.length === 0) {
		return 0;
	}

	const diff = execFileSync(
		'git',
		['diff', '--cached', '-U0', '--', ...files],
		{
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	const addedLines = parseDiffAddedLines(diff);
	const patterns = [...GENERIC_PII_PATTERNS, ...loadPersonalPatterns()];
	const hits = findPii(addedLines, patterns);

	if (hits.length === 0) {
		return 0;
	}

	for (const hit of hits) {
		console.error(`${hit.file}:${hit.line}: ${hit.name}`);
	}
	console.error('');
	console.error(
		'pre-commit: staged added line(s) above look like a personal path or identifier (PIPE-67). ' +
			'Use $UMA_CODE_REPO/$UMA_ENGINE_REPO/$UMA_PLANS_REPO or a ~-relative path instead, ' +
			'or commit anyway with --no-verify if this is a false positive.',
	);
	return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = run(process.argv.slice(2));
}
