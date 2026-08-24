// One-shot build + metrics check for the umalator apps.
//
//   npm run verify            build both apps, typecheck, CSS metrics, browser smoke, docs; one diff line vs baseline
//   npm run verify:baseline   re-record scripts/verify-baseline.json (run on master after a merge)
//   node scripts/verify.mjs --skip-build   metrics only (fast inner loop while editing CSS)
//   node scripts/verify.mjs --skip-smoke   skip the browser smoke stage
//
// The smoke stage runs scripts/smoke.mjs (Playwright chromium against the
// umalator-global dev server, light + dark); it reports SKIPPED when playwright
// isn't installed. The docs stage runs a strict build of the optional local
// docs site under plans/ and is skipped when absent.
//
// Exits non-zero if a build fails, the typecheck error count rises above the
// baseline, the smoke fails, or the docs build fails.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'scripts', 'verify-baseline.json');
const writeBaseline = process.argv.includes('--baseline');
const skipBuild = process.argv.includes('--skip-build');
const skipSmoke = process.argv.includes('--skip-smoke');

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

// Browser smoke (scripts/smoke.mjs owns the dev-server lifecycle). Exit code 2
// means playwright/chromium isn't installed -- report SKIPPED, don't fail.
function runSmoke() {
	const r = spawnSync('node', ['scripts/smoke.mjs'], {
		cwd: root,
		encoding: 'utf8',
		timeout: 180_000,
	});
	if (r.status === 0) return { label: 'smoke OK', ok: true };
	if (r.status === 2) return { label: 'smoke SKIPPED (not installed)', ok: true };
	const report = path.join(root, 'scripts', 'smoke-artifacts', 'smoke-report.json');
	let count = '?';
	try {
		count = JSON.parse(fs.readFileSync(report, 'utf8')).checks.filter(c => !c.ok).length;
	} catch {}
	console.error((r.stdout || '').split('\n').slice(-5).join('\n'));
	return { label: `smoke FAILED (${count}) -> scripts/smoke-artifacts/smoke-report.json`, ok: false };
}

// Optional local docs site: strict-build it when present, skip silently when not.
function runDocs() {
	const mkdocsBin = path.join(root, 'plans', '.venv', 'bin', 'mkdocs');
	if (!fs.existsSync(path.join(root, 'plans', 'mkdocs.yml')) || !fs.existsSync(mkdocsBin)) {
		return { label: 'docs -', ok: true };
	}
	const r = spawnSync(mkdocsBin, ['build', '--strict'], {
		cwd: path.join(root, 'plans'),
		encoding: 'utf8',
	});
	if (r.status === 0) return { label: 'docs OK', ok: true };
	console.error((r.stderr || r.stdout || '').split('\n').slice(-10).join('\n'));
	return { label: 'docs FAILED', ok: false };
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

const smoke = skipSmoke ? { label: 'smoke -', ok: true } : runSmoke();
const docs = runDocs();

const tscLabel =
	tsc >= TSC_CAP ? `>=${TSC_CAP} (capped)` : `${tsc}${delta(tsc, base?.tsc)}`;
const parts = [
	skipBuild ? 'builds SKIPPED' : buildsOk ? 'builds OK' : 'builds FAILED',
	`tsc ${tscLabel}`,
	`.dark ${sum(dark)}${delta(sum(dark), base ? sum(base.dark) : null)}`,
	`literals ${sum(literals)}${delta(sum(literals), base ? sum(base.literals) : null)}`,
	smoke.label,
	docs.label,
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
if (!buildsOk || tscRegressed || !smoke.ok || !docs.ok) process.exit(1);
