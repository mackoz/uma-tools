import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'repo-env.sh');

// Parses the `export NAME="value"\n...` lines --print emits into a plain object.
function parsePrint(output) {
	const vars = {};
	for (const line of output.trim().split('\n')) {
		if (!line) continue;
		const match = line.match(/^export (\w+)=(.*)$/);
		assert.ok(match, `line did not look like an export statement: ${line}`);
		const [, name, quoted] = match;
		// Values come out `printf %q`-quoted (bash's own shell-safe quoting) --
		// unquote via bash itself rather than reimplementing %q's escaping rules.
		vars[name] = execFileSync('bash', ['-c', `printf '%s' ${quoted}`], {
			encoding: 'utf8',
		});
	}
	return vars;
}

// Runs the script in a fresh bash subshell with a scrubbed environment, so a
// developer's own UMA_* overrides on the host machine can't leak into the test.
function runScrubbed(args, extraEnv = {}) {
	return execFileSync('bash', [scriptPath, ...args], {
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			...extraEnv,
		},
	});
}

// A checkout without the private plans repo (CI, a fresh clone) is a supported
// configuration: the script still derives and prints UMA_PLANS_REPO, and --check
// reports it -- and only it -- as missing. The two tests below branch on whether the
// derived plans path exists so they hold in both environments.
function plansPresent(vars) {
	return fs.existsSync(path.join(vars.UMA_PLANS_REPO, '.git'));
}

function isWorkTree(repoPath) {
	try {
		return (
			execFileSync(
				'git',
				['-C', repoPath, 'rev-parse', '--is-inside-work-tree'],
				{
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'ignore'],
				},
			).trim() === 'true'
		);
	} catch {
		return false;
	}
}

test('repo-env.sh --print emits three absolute exports; code and engine are git work trees', () => {
	const output = runScrubbed(['--print']);
	const vars = parsePrint(output);
	assert.deepEqual(Object.keys(vars).sort(), [
		'UMA_CODE_REPO',
		'UMA_ENGINE_REPO',
		'UMA_PLANS_REPO',
	]);
	for (const [name, repoPath] of Object.entries(vars)) {
		assert.ok(path.isAbsolute(repoPath), `${name} should be an absolute path`);
	}
	assert.ok(
		isWorkTree(vars.UMA_CODE_REPO),
		'UMA_CODE_REPO should be a git work tree',
	);
	assert.ok(
		isWorkTree(vars.UMA_ENGINE_REPO),
		'UMA_ENGINE_REPO should be a git work tree',
	);
	assert.ok(vars.UMA_ENGINE_REPO.endsWith(`${path.sep}uma-skill-tools`));
	if (plansPresent(vars)) {
		assert.ok(
			isWorkTree(vars.UMA_PLANS_REPO),
			'UMA_PLANS_REPO should be a git work tree',
		);
	} else {
		assert.ok(
			vars.UMA_PLANS_REPO.endsWith(`${path.sep}uma-tools-plans`),
			'without a plans checkout the derivation should fall back to the sibling-directory name',
		);
	}
});

test('repo-env.sh --check exits 0 with all three checkouts, or names only UMA_PLANS_REPO without one', () => {
	const vars = parsePrint(runScrubbed(['--print']));
	if (plansPresent(vars)) {
		assert.doesNotThrow(() => runScrubbed(['--check']));
		return;
	}
	assert.throws(
		() => runScrubbed(['--check']),
		(err) => {
			assert.equal(err.status, 1);
			const stderr = err.stderr.toString();
			assert.match(stderr, /UMA_PLANS_REPO \(.*\) is not a git work tree/);
			assert.doesNotMatch(stderr, /UMA_CODE_REPO|UMA_ENGINE_REPO/);
			return true;
		},
	);
});

test('a pre-set UMA_PLANS_REPO env var wins over the derivation', () => {
	const output = runScrubbed(['--print'], { UMA_PLANS_REPO: '/nonexistent' });
	const vars = parsePrint(output);
	assert.equal(vars.UMA_PLANS_REPO, '/nonexistent');
});

test('--check reports a pre-set UMA_PLANS_REPO that is not a git work tree', () => {
	assert.throws(
		() => runScrubbed(['--check'], { UMA_PLANS_REPO: '/nonexistent' }),
		(err) => {
			assert.equal(err.status, 1);
			assert.match(
				err.stderr.toString(),
				/UMA_PLANS_REPO \(\/nonexistent\) is not a git work tree/,
			);
			return true;
		},
	);
});
