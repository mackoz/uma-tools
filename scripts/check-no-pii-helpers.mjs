// Pure helpers behind scripts/check-no-pii.mjs (PIPE-67), kept separate from the CLI
// (git plumbing, exit codes, stderr output) so the actual matching logic is unit-testable
// without shelling out to git -- see scripts/check-no-pii.test.mjs.

// Generic, tracked patterns -- deliberately not personal (no name, no home path, no
// email): those live only in an untracked per-user file (see check-no-pii.mjs's
// loadPersonalPatterns). The user segment excludes `<`, so placeholder notation in docs
// and in these patterns' own display names (`/Users/<user>/...`) is not a hit -- only a
// concrete account name is. Motivated by the 2026-09-02 history scrub: the public repos
// were clean, but uma-tools-plans had 12 tracked tickets carrying the account holder's
// home path in ticket prose, with nothing stopping the next one.
export const GENERIC_PII_PATTERNS = [
	{ name: 'macOS home path (/Users/<user>/...)', regex: /\/Users\/[^/\s<]+\// },
	{ name: 'Linux home path (/home/<user>/...)', regex: /\/home\/[^/\s<]+\// },
	{
		name: 'sanitized Claude transcript directory (-Users-<user>-github-...)',
		regex: /-Users-[A-Za-z0-9.-]+-github-/,
	},
];

// Parses `git diff --cached -U0 -- <files>` output into one entry per added line:
// { file, line, text }. `line` is the 1-based line number in the *new* (staged) version
// of the file, computed from each hunk's `@@ -a,b +c,d @@` header rather than counted
// from the top of the file, since -U0 output contains only changed lines, not context.
// Deleted lines (a leading `-`, other than the `--- a/<path>` file marker) don't consume
// a new-file line number and are otherwise ignored -- only additions can introduce PII
// nobody removed.
export function parseDiffAddedLines(diffText) {
	const result = [];
	let currentFile = null;
	let newLineNum = 0;
	for (const line of diffText.split('\n')) {
		if (line.startsWith('+++ ')) {
			const rawPath = line.slice(4).trim();
			currentFile =
				rawPath === '/dev/null' ? null : rawPath.replace(/^b\//, '');
			continue;
		}
		if (line.startsWith('@@')) {
			const match = line.match(/\+(\d+)/);
			newLineNum = match ? Number.parseInt(match[1], 10) : 0;
			continue;
		}
		if (line.startsWith('+') && currentFile) {
			result.push({ file: currentFile, line: newLineNum, text: line.slice(1) });
			newLineNum++;
		}
	}
	return result;
}

// The tripwire's own source and tests necessarily contain the pattern text and
// `/Users/example/...` fixtures, so they are exempt from their own check -- otherwise every
// edit to them needs `--no-verify`, which is exactly the habit the hook exists to prevent.
// Matched on the repo-relative path git reports, from any directory depth.
export const SELF_EXEMPT_FILES = /(^|\/)check-no-pii(-helpers|\.test)?\.mjs$/;
export function isSelfExempt(file) {
	return SELF_EXEMPT_FILES.test(file);
}

// Parses the per-user pattern file's contents (one regex per line, `#` comments and
// blank lines skipped) into the same `{ name, regex }` shape as GENERIC_PII_PATTERNS.
export function parsePersonalPatterns(fileContent) {
	const patterns = [];
	for (const rawLine of fileContent.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		patterns.push({
			name: `personal pattern (${line})`,
			regex: new RegExp(line),
		});
	}
	return patterns;
}

// Checks every added line against every pattern; returns one { file, line, name } entry
// per match (a line matching two patterns yields two entries). Each pattern's regex is
// rebuilt without a `g` flag before testing, so a caller passing a shared global regex
// across multiple calls can't get stale-lastIndex false negatives.
export function findPii(addedLines, patterns) {
	const hits = [];
	for (const { file, line, text } of addedLines) {
		for (const { name, regex } of patterns) {
			const re = new RegExp(regex.source, regex.flags.replace('g', ''));
			if (re.test(text)) {
				hits.push({ file, line, name });
			}
		}
	}
	return hits;
}
