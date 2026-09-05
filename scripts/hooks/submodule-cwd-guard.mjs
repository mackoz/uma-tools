#!/usr/bin/env node
// Claude Code hook: guards against a Bash tool call's cwd having drifted into
// the uma-skill-tools submodule, where parent-repo-scoped commands (npm
// test/run, wq.py, scripts/*) would silently target the wrong repo.
//
// Modes (first CLI arg):
//   --pre   PreToolUse: denies (exit 2) parent-scoped commands while cwd is
//           inside the submodule.
//   --post  PostToolUse: emits an additionalContext warning while cwd is
//           inside the submodule.
//
// Fails open on any error (parse, IO, unexpected throw) — this guard must
// never brick Bash.

import fs from 'node:fs';
import path from 'node:path';

const DENY_PATTERNS = [
	/^\s*npm\s+(test|run)\b/,
	/(?<![\w\-/])plans\/scripts\/wq\.py/,
	/^\s*uv\s+run\s+plans\//,
	/^\s*node\s+scripts\//,
	/^\s*scripts\//,
];

function isInsideSubmodule(cwd) {
	let dir = path.resolve(cwd);
	while (true) {
		if (
			path.basename(dir) === 'uma-skill-tools' &&
			fs.existsSync(path.join(dir, '.git'))
		) {
			return true;
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return false;
}

function readStdin() {
	return fs.readFileSync(0, 'utf8');
}

function main() {
	const mode = process.argv[2];

	const raw = readStdin();
	const input = JSON.parse(raw);
	const cwd = input.cwd;
	const command = input.tool_input && input.tool_input.command;

	if (typeof cwd !== 'string' || typeof command !== 'string') {
		process.exit(0);
	}

	if (!isInsideSubmodule(cwd)) {
		process.exit(0);
	}

	if (mode === '--pre') {
		if (DENY_PATTERNS.some((re) => re.test(command))) {
			process.stderr.write(
				`BLOCKED: cwd (${cwd}) is inside the uma-skill-tools submodule; this command targets the parent uma-tools repo. cd back to the repo root first, or use absolute paths / git -C. If you genuinely meant the engine's own suite, run it as \`npm --prefix <absolute path to uma-skill-tools> test\` — the explicit form passes this guard.\n`,
			);
			process.exit(2);
		}
		process.exit(0);
	}

	if (mode === '--post') {
		const output = {
			hookSpecificOutput: {
				hookEventName: 'PostToolUse',
				additionalContext:
					'⚠ cwd is inside the uma-skill-tools submodule, not the uma-tools repo root — relative paths and npm/wq/scripts commands will target the wrong repo. cd back or use absolute paths / git -C.',
			},
		};
		process.stdout.write(JSON.stringify(output));
		process.exit(0);
	}

	process.exit(0);
}

try {
	main();
} catch {
	process.exit(0);
}
