// One-shot build + metrics check for the umalator apps.
//
//   npm run verify            build both apps, typecheck, CSS metrics; one diff line vs baseline
//   npm run verify:baseline   re-record scripts/verify-baseline.json (run on master after a merge)
//   node scripts/verify.mjs --skip-build   metrics only (fast inner loop while editing CSS)
//
// Exits non-zero if a build fails or the typecheck error count rises above the baseline.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'scripts', 'verify-baseline.json');
const writeBaseline = process.argv.includes('--baseline');
const skipBuild = process.argv.includes('--skip-build');

// tokens.css is deliberately excluded: it is the one place colors belong.
const CSS_FILES = [
	'umalator/app.css',
	'umalator/IntroText.css',
	'umalator/BasinnChart.css',
	'umalator/components/InfoModal.css',
	'umalator/components/OCRModal.css',
	'umalator/components/ResultsPane.css',
	'umalator/components/UmasTab.css',
	'umalator/ui-components/Dropdown.css',
	'umalator/ui-components/Tabs.css',
	'components/HorseDef.css',
	'components/SkillPicker.css',
	'components/SkillList.css',
	'components/Tooltip.css',
];

function shortName(file) {
	return path.basename(file, '.css');
}

// Count color literals only inside declaration values, so selectors like
// #umaPane don't register as hex colors.
function countLiterals(content) {
	let n = 0;
	for (const line of content.split('\n')) {
		const colon = line.indexOf(':');
		if (colon === -1) continue;
		const value = line.slice(colon + 1);
		n += (value.match(/\bhsla?\(|\brgba?\(|#[0-9a-fA-F]{3,8}\b/g) || []).length;
	}
	return n;
}

function collectMetrics() {
	const dark = {};
	const literals = {};
	for (const file of CSS_FILES) {
		const fp = path.join(root, file);
		if (!fs.existsSync(fp)) continue;
		const content = fs.readFileSync(fp, 'utf8');
		dark[shortName(file)] = (content.match(/^\.dark/gm) || []).length;
		literals[shortName(file)] = countLiterals(content);
	}
	return { dark, literals };
}

function build(app) {
	const r = spawnSync('node', ['build.mjs'], {
		cwd: path.join(root, app),
		encoding: 'utf8',
	});
	if (r.status !== 0) {
		console.error(`build FAILED: ${app}`);
		console.error((r.stderr || r.stdout || '').split('\n').slice(-15).join('\n'));
		return false;
	}
	return true;
}

// tsc 7.x (typescript-go) hard-caps reported diagnostics at 1000, and this
// repo's implicit-any backlog saturates that cap -- so the total is only a
// regression signal while it sits below 1000. At the cap it's rendered as
// ">=1000 (capped)" and can't fail the run.
const TSC_CAP = 1000;

function typecheckErrors() {
	const r = spawnSync('npx', ['tsc', '--noEmit'], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	return ((r.stdout || '').match(/error TS\d+/g) || []).length;
}

function sum(obj) {
	return Object.values(obj).reduce((a, b) => a + b, 0);
}

function delta(now, base) {
	if (base == null) return '';
	const d = now - base;
	if (d === 0) return '';
	return ` (${d > 0 ? '+' : ''}${d})`;
}

let buildsOk = true;
if (!skipBuild) {
	buildsOk = build('umalator') && build('umalator-global');
}
const tsc = typecheckErrors();
const { dark, literals } = collectMetrics();

if (writeBaseline) {
	fs.writeFileSync(
		baselinePath,
		JSON.stringify({ tsc, dark, literals }, null, '\t') + '\n',
	);
	console.log(
		`baseline recorded: tsc ${tsc} | .dark ${sum(dark)} | literals ${sum(literals)}`,
	);
	process.exit(0);
}

let base = null;
if (fs.existsSync(baselinePath)) {
	base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

const tscLabel =
	tsc >= TSC_CAP ? `>=${TSC_CAP} (capped)` : `${tsc}${delta(tsc, base?.tsc)}`;
const parts = [
	skipBuild ? 'builds SKIPPED' : buildsOk ? 'builds OK' : 'builds FAILED',
	`tsc ${tscLabel}`,
	`.dark ${sum(dark)}${delta(sum(dark), base ? sum(base.dark) : null)}`,
	`literals ${sum(literals)}${delta(sum(literals), base ? sum(base.literals) : null)}`,
];
console.log(parts.join(' | '));

// Per-file .dark counts: only files that are nonzero or changed vs baseline.
const details = [];
for (const [name, n] of Object.entries(dark)) {
	const b = base?.dark?.[name];
	if (n !== 0 || (b != null && b !== n)) details.push(`${name}:${n}${delta(n, b)}`);
}
if (details.length) console.log(`.dark by file: ${details.join(' ')}`);

const tscRegressed = base != null && base.tsc < TSC_CAP && tsc > base.tsc;
if (!buildsOk || tscRegressed) process.exit(1);
