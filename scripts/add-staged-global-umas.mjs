// Adds umas/outfits to the Global dataset that the Global client's own master.mdb already has
// staged (English text present, but make_global_uma_info.pl's `exists $meta->{$s_id}` filter
// currently drops them because they aren't live yet). See docs/adr/ for why this is worth doing
// and docs/data-pipeline.md for where this fits relative to the real .pl-based pipeline.
//
// This does NOT replace that pipeline or scripts/sync-upstream-data.mjs -- it's a third, narrower
// source: JP already has full mechanics for these umas (skill_meta.json / skill_data.json), and
// the *English* text for them already exists in the Global master.mdb, ahead of make_global_uma_info.pl
// choosing to expose it. This script ports both into umalator-global/, gated by a hand-maintained
// release-order table (scripts/data/global-release-order.json) since neither source carries a
// real "not released yet" ordering.
//
// Usage:
//   node scripts/add-staged-global-umas.mjs                      # dry run (default), up to 2023-03-29
//   node scripts/add-staged-global-umas.mjs --until 2023-07-31    # dry run, wider cut
//   node scripts/add-staged-global-umas.mjs --no-dry-run          # write changes
//
// IMPORTANT: like sync-upstream-data.mjs, this only ever ADDS keys that don't already exist.
// It never overwrites an existing umalator-global/ entry.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { program } from 'commander';

program
	.option('--mdb <path>', 'path to the Global client master.mdb', 'master.mdb')
	.option(
		'--until <date>',
		'JP implementation-date cutoff (inclusive), YYYY-MM-DD',
		'2023-03-29',
	)
	.option('--no-dry-run', 'actually write merged JSON (default: report only)');

program.parse();
const opts = program.opts();
const dryRun = opts.dryRun !== false;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const forkRoot = path.join(dirname, '..');
const mdbPath = path.resolve(opts.mdb);

if (!fs.existsSync(mdbPath)) {
	console.error(`--mdb path does not exist: ${mdbPath}`);
	process.exit(1);
}

function readJSON(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Same format-preserving writer as sync-upstream-data.mjs: every committed data file here has
// lexicographically sorted keys (Perl's JSON::PP->canonical(1)); preserve indent style and
// trailing-newline/CRLF-ness per file so a diff is just the new keys, not a reformat.
function detectIndent(text) {
	const m = text.match(/^\{\r?\n(\s+)"/);
	if (!m) return null;
	return m[1].includes('\t') ? '\t' : m[1].length;
}

function writeJSON(p, obj) {
	const orig = fs.readFileSync(p, 'utf8');
	const indent = detectIndent(orig);
	const crlf = orig.includes('\r\n');
	const sorted = {};
	for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
	let out =
		indent == null
			? JSON.stringify(sorted)
			: JSON.stringify(sorted, null, indent);
	if (crlf) out = out.replace(/\n/g, '\r\n');
	fs.writeFileSync(
		p,
		out +
			(orig.endsWith('\n') || orig.endsWith('\r\n')
				? crlf
					? '\r\n'
					: '\n'
				: ''),
	);
}

function queryMdb(sql) {
	const out = execFileSync('sqlite3', [mdbPath, sql], { encoding: 'utf8' });
	const rows = {};
	for (const line of out.split('\n')) {
		if (!line) continue;
		const i = line.indexOf('|');
		rows[line.slice(0, i)] = line.slice(i + 1);
	}
	return rows;
}

// Same arithmetic as components/HorseDef.tsx's uniqueSkillForUma() / make_global_uma_info.pl's
// unique_skill_for_outfit() -- the unique skill id is derived from the outfit id, never looked up.
function uniqueSkillForOutfit(oid) {
	const i = +oid.slice(1, -2),
		v = +oid.slice(-2);
	return String(100000 + 10000 * (v - 1) + i * 10 + 1);
}

function main() {
	console.log(`Reading staged text from: ${mdbPath}`);
	console.log(`Cutoff (JP implementation date, inclusive): ${opts.until}`);
	console.log(
		dryRun
			? '(dry run -- pass --no-dry-run to write changes)\n'
			: '(WRITING changes)\n',
	);

	const releaseOrder = readJSON(
		path.join(dirname, 'data/global-release-order.json'),
	);
	const epithets = queryMdb(
		'SELECT [index], text FROM text_data WHERE category=5;',
	);
	const charNames = queryMdb(
		'SELECT [index], text FROM text_data WHERE category=6;',
	);

	const umasPath = path.join(forkRoot, 'umalator-global/umas.json');
	const skillMetaPath = path.join(forkRoot, 'umalator-global/skill_meta.json');
	const skillDataPath = path.join(forkRoot, 'umalator-global/skill_data.json');
	const skillNamesPath = path.join(forkRoot, 'umalator-global/skillnames.json');
	const jpSkillMeta = readJSON(path.join(forkRoot, 'skill_meta.json'));
	const jpSkillData = readJSON(
		path.join(forkRoot, 'uma-skill-tools/data/skill_data.json'),
	);

	const globalUmas = readJSON(umasPath);
	const globalSkillMeta = readJSON(skillMetaPath);
	const globalSkillData = readJSON(skillDataPath);
	const globalSkillNames = readJSON(skillNamesPath);

	const alreadyPresent = new Set();
	for (const u of Object.values(globalUmas))
		for (const oid of Object.keys(u.outfits)) alreadyPresent.add(oid);

	const outfitIds = Object.keys(releaseOrder)
		.filter((k) => k !== '_comment')
		.filter((oid) => releaseOrder[oid] <= opts.until)
		.filter((oid) => !alreadyPresent.has(oid))
		.sort(
			(a, b) =>
				releaseOrder[a].localeCompare(releaseOrder[b]) || a.localeCompare(b),
		);

	const newChars = [];
	const newOutfits = [];
	const skippedNoText = [];
	const skippedNoMechanics = [];

	for (const oid of outfitIds) {
		const cid = oid.slice(0, 4);
		const epithet = epithets[oid];
		const charName = globalUmas[cid]?.name?.[1] ?? charNames[cid];
		if (epithet == null || charName == null) {
			skippedNoText.push(oid);
			continue;
		}

		const sid = uniqueSkillForOutfit(oid);
		if (
			!(sid in jpSkillMeta) ||
			!(sid in jpSkillData) ||
			!(sid in globalSkillNames)
		) {
			skippedNoMechanics.push(`${oid} (sid ${sid})`);
			continue;
		}

		if (!(cid in globalUmas)) {
			globalUmas[cid] = { name: ['', charName], outfits: { [oid]: epithet } };
			newChars.push(`${oid} ${charName}`);
		} else {
			globalUmas[cid].outfits[oid] = epithet;
			newOutfits.push(`${oid} ${charName}`);
		}
		globalSkillMeta[sid] = jpSkillMeta[sid];
		globalSkillData[sid] = jpSkillData[sid];
	}

	console.log(`New characters: +${newChars.length}`);
	newChars.forEach((s) => {
		console.log(`  ${s}`);
	});
	console.log(`New outfits on existing Global umas: +${newOutfits.length}`);
	newOutfits.forEach((s) => {
		console.log(`  ${s}`);
	});
	if (skippedNoText.length) {
		console.log(
			`\nSKIPPED (no English text in master.mdb for this outfit): ${skippedNoText.join(', ')}`,
		);
	}
	if (skippedNoMechanics.length) {
		console.log(
			`\nSKIPPED (unique skill missing from JP skill_meta/skill_data, or from Global skillnames): ${skippedNoMechanics.join(', ')}`,
		);
	}

	// unreleased.json is fully recomputed each run from umas.json ∩ the release-order table,
	// rather than accumulated -- so it self-heals if umas.json is ever hand-edited or a future
	// sync/generator run adds one of these outfits by a different path.
	const unreleasedOutfits = Object.keys(releaseOrder)
		.filter((k) => k !== '_comment')
		.filter((oid) => oid in (globalUmas[oid.slice(0, 4)]?.outfits ?? {}));
	unreleasedOutfits.sort();
	const unreleasedSkills = unreleasedOutfits.map(uniqueSkillForOutfit);
	const unreleasedJson = {
		outfits: unreleasedOutfits,
		skills: unreleasedSkills,
	};

	console.log(
		`\numalator-global/unreleased.json will list ${unreleasedOutfits.length} outfit(s) total (including any from prior runs).`,
	);

	if (!dryRun) {
		if (newChars.length || newOutfits.length) {
			writeJSON(umasPath, globalUmas);
			writeJSON(skillMetaPath, globalSkillMeta);
			writeJSON(skillDataPath, globalSkillData);
		}
		fs.writeFileSync(
			path.join(forkRoot, 'umalator-global/unreleased.json'),
			`${JSON.stringify(unreleasedJson, null, '\t')}\n`,
		);
		console.log(
			'\nWritten. Now rebuild umalator/ and umalator-global/ and commit.',
		);
	} else {
		console.log(
			'\nDry run -- nothing written. Re-run with --no-dry-run to apply.',
		);
	}
}

main();
