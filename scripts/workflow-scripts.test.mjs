// Offline tests for the five PIPE-67 workflow scripts (scripts/repo-status.sh,
// scripts/commit-push.sh, scripts/pr-status.sh, scripts/sync-main.sh,
// scripts/dev-serve.sh). No network: pr-status.sh is covered only by --help (it needs
// `gh` + a real GitHub connection for anything else, per the ticket's own scope).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPTS = [
	'repo-status.sh',
	'commit-push.sh',
	'pr-status.sh',
	'sync-main.sh',
	'dev-serve.sh',
];

function scriptPath(name) {
	return path.join(__dirname, name);
}

function run(name, args, env = {}) {
	return execFileSync('bash', [scriptPath(name), ...args], {
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});
}

function runExpectFailure(name, args, env = {}) {
	try {
		run(name, args, env);
		throw new Error(`expected ${name} ${args.join(' ')} to exit non-zero`);
	} catch (err) {
		if (err.status === undefined) throw err;
		return err;
	}
}

for (const name of SCRIPTS) {
	test(`${name} --help exits 0 and mentions --dry-run`, () => {
		const output = run(name, ['--help']);
		assert.match(output, /--dry-run/);
	});
}

test('repo-status.sh --dry-run runs and prints three slot lines', () => {
	const output = run('repo-status.sh', ['--dry-run']);
	assert.match(output, /^code:/m);
	assert.match(output, /^engine:/m);
	assert.match(output, /^plans:/m);
});

// A scratch git repo under os.tmpdir() with a bare remote, a `main` default
// branch, and a `feature` branch checked out and pushed -- close enough to a
// real repo for commit-push.sh/sync-main.sh's own git plumbing (status,
// rev-list, branch --merged, for-each-ref) to behave the same way it would
// against a real one.
function makeScratchRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-workflow-scratch-'));
	const remote = `${dir}-remote.git`;
	execFileSync('git', ['init', '-q', '--bare', remote]);
	execFileSync('git', ['init', '-q', '-b', 'main', dir]);
	const git = (...args) =>
		execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('remote', 'add', 'origin', remote);
	fs.writeFileSync(path.join(dir, 'file.txt'), 'hello\n');
	git('add', 'file.txt');
	git('commit', '-q', '-m', 'init');
	git('push', '-q', '-u', 'origin', 'main');
	git('checkout', '-q', '-b', 'feature');
	git('push', '-q', '-u', 'origin', 'feature');
	return { dir, remote, git };
}

const scratchRepos = [];
afterEach(() => {
	while (scratchRepos.length > 0) {
		const { dir, remote } = scratchRepos.pop();
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(remote, { recursive: true, force: true });
	}
});

test('commit-push.sh --dry-run on a scratch repo prints add/commit/push and leaves it uncommitted', () => {
	const repo = makeScratchRepo();
	scratchRepos.push(repo);
	fs.appendFileSync(path.join(repo.dir, 'file.txt'), 'world\n');

	const output = run(
		'commit-push.sh',
		['--repo', 'plans', '-m', 'test commit', '--dry-run', '--', 'file.txt'],
		{ UMA_PLANS_REPO: repo.dir },
	);
	assert.match(output, /\[dry-run\] git -C .* add -- file\.txt/);
	assert.match(output, /\[dry-run\] git -C .* commit -m "test commit"/);
	assert.match(output, /\[dry-run\] git -C .* push/);

	const status = repo.git('status', '--porcelain');
	assert.match(
		status,
		/file\.txt/,
		'the modification should still be unstaged/uncommitted',
	);
	const log = repo.git('log', '--oneline');
	assert.equal(
		log.trim().split('\n').length,
		1,
		'no new commit should have been created',
	);
});

test('commit-push.sh refuses the default branch without --allow-default', () => {
	const repo = makeScratchRepo();
	scratchRepos.push(repo);
	repo.git('checkout', '-q', 'main');
	fs.appendFileSync(path.join(repo.dir, 'file.txt'), 'world\n');

	const err = runExpectFailure(
		'commit-push.sh',
		['--repo', 'plans', '-m', 'x', '--dry-run', '--', 'file.txt'],
		{ UMA_PLANS_REPO: repo.dir },
	);
	assert.match(err.stderr.toString(), /default branch/);
});

test('commit-push.sh refuses an empty pathspec', () => {
	const repo = makeScratchRepo();
	scratchRepos.push(repo);

	const err = runExpectFailure(
		'commit-push.sh',
		['--repo', 'plans', '-m', 'x', '--dry-run', '--'],
		{ UMA_PLANS_REPO: repo.dir },
	);
	assert.match(err.stderr.toString(), /empty pathspec/);
});

test('sync-main.sh --dry-run --repo plans prints the planned checkout/pull and does not change branch', () => {
	const repo = makeScratchRepo();
	scratchRepos.push(repo);

	const output = run('sync-main.sh', ['--dry-run', '--repo', 'plans'], {
		UMA_PLANS_REPO: repo.dir,
	});
	assert.match(output, /\[dry-run\] plans: git -C .* checkout main/);
	assert.match(output, /\[dry-run\] plans: git -C .* pull --ff-only/);

	assert.equal(repo.git('branch', '--show-current').trim(), 'feature');
});

test('dev-serve.sh status --port 65530 reports not running and exits 0', () => {
	const output = run('dev-serve.sh', ['status', '--port', '65530']);
	assert.match(output, /pid_alive=no/);
	assert.match(output, /port_answering=no/);
});

test('dev-serve.sh stop --port 65530 reports no pidfile and exits 0 without error', () => {
	const output = run('dev-serve.sh', ['stop', '--port', '65530']);
	assert.match(output, /not started by this script/);
});
