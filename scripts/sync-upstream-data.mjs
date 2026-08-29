// Catches this fork's committed game data (umas/skills/courses/icons) up to a local
// checkout of upstream (alpha123/uma-tools), by porting whatever keys upstream has
// that this fork doesn't.
//
// This is a STOPGAP, not a replacement for the real data pipeline (docs/data-pipeline.md).
// It only ports upstream's already-computed values; it can't reproduce upstream's richer
// per-outfit schema (aptitudes/awakenings/rarity/score/tags/etc — see the DROP sets below),
// and it can't extract new icons upstream hasn't extracted (this fork's own extract_resource.pl
// can't handle the current encrypted game client — see docs/data-pipeline.md).
//
// Usage:
//   node scripts/sync-upstream-data.mjs --upstream ../uma-tools-og              # dry run (default)
//   node scripts/sync-upstream-data.mjs --upstream ../uma-tools-og --no-dry-run # write changes
//
// IMPORTANT: this only ever ADDS keys that don't already exist in the fork's JSON.
// It never overwrites or deletes an existing key, even if the value differs from
// upstream's — some of those differences are deliberate fork behavior (a course-data
// scenario-scaling hack, some independently-diverged skill conditions), others are open
// questions nobody's investigated yet. Either way, silently overwriting them here would
// be a worse bug than leaving them alone.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {program} from 'commander';

program
	.requiredOption('--upstream <path>', 'path to a local alpha123/uma-tools checkout')
	.option('--engine-ref <ref>', 'git ref inside <upstream>/uma-skill-tools to read JP engine data from (upstream\'s own uma-tools checkout pins an old submodule commit — compare against the engine repo\'s own history instead)', 'origin/master')
	.option('--no-dry-run', 'actually write merged JSON and copy new icon files (default: report only)');

program.parse();
const opts = program.opts();
const dryRun = opts.dryRun !== false;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const forkRoot = path.join(dirname, '..');
const upstreamRoot = path.resolve(opts.upstream);

if (!fs.existsSync(upstreamRoot)) {
	console.error(`--upstream path does not exist: ${upstreamRoot}`);
	process.exit(1);
}

function readJSON(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readEngineJSON(relPath) {
	const out = execFileSync('git', ['-C', path.join(upstreamRoot, 'uma-skill-tools'), 'show', `${opts.engineRef}:${relPath}`], {encoding: 'utf8'});
	return JSON.parse(out);
}

// Every committed data file in this repo has its keys sorted lexicographically already
// (Perl's JSON::PP->canonical(1) does this). Preserve that, and preserve each file's
// existing indent style (some are minified, some are pretty-printed with different
// indent widths) so the diff for a sync is just the new keys, not a whole-file reformat.
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
	let out = indent == null ? JSON.stringify(sorted) : JSON.stringify(sorted, null, indent);
	if (crlf) out = out.replace(/\n/g, '\r\n');
	fs.writeFileSync(p, out + (orig.endsWith('\n') || orig.endsWith('\r\n') ? (crlf ? '\r\n' : '\n') : ''));
}

function stripDeep(v, dropKeys) {
	if (Array.isArray(v)) return v.map(x => stripDeep(x, dropKeys));
	if (v && typeof v === 'object') {
		const out = {};
		for (const [k, vv] of Object.entries(v)) {
			if (dropKeys.has(k)) continue;
			out[k] = stripDeep(vv, dropKeys);
		}
		return out;
	}
	return v;
}

// Fields upstream's generator scripts compute that this fork's don't (yet). Dropped
// so a newly-added entry matches the shape of every other entry already in the
// fork's files, and so the diverged-value report below isn't 100% false positives
// from schema alone.
const SKILL_META_DROP = new Set(['score']);
// ANCHOR: skill-data-drop-set
const SKILL_DATA_DROP = new Set(['tags', 'wisdomCheck', 'durationScaling', 'scaling']);

let totalAdded = 0;
let totalDiverged = 0;

function syncSimple(label, forkRel, upstreamObj, {transform = x => x} = {}) {
	const forkPath = path.join(forkRoot, forkRel);
	const fork = readJSON(forkPath);
	const added = [];
	const diverged = [];
	for (const [k, v] of Object.entries(upstreamObj)) {
		const transformed = transform(v);
		if (!(k in fork)) {
			added.push(k);
			if (!dryRun) fork[k] = transformed;
		} else if (JSON.stringify(fork[k]) !== JSON.stringify(transformed)) {
			diverged.push(k);
		}
	}
	report(label, added, diverged);
	if (!dryRun && added.length) writeJSON(forkPath, fork);
}

function downgradeOutfit(v) {
	return typeof v === 'string' ? v : v.epithet;
}

function downgradeUma(u) {
	const outfits = {};
	for (const [oid, ov] of Object.entries(u.outfits)) outfits[oid] = downgradeOutfit(ov);
	return {name: u.name, outfits};
}

// Umas need two kinds of merge: whole new umas, and new outfits (alt costumes) on
// umas the fork already has. The latter is easy to miss with a top-level key diff —
// it's real missing data, not schema noise, unlike almost everything else this
// script reports as "diverged."
function syncUmas(label, forkRel, upstreamObj) {
	const forkPath = path.join(forkRoot, forkRel);
	const fork = readJSON(forkPath);
	const addedUmas = [];
	const addedOutfits = [];
	for (const [uid, u] of Object.entries(upstreamObj)) {
		if (!(uid in fork)) {
			addedUmas.push(uid);
			if (!dryRun) fork[uid] = downgradeUma(u);
			continue;
		}
		for (const [oid, ov] of Object.entries(u.outfits)) {
			if (!(oid in fork[uid].outfits)) {
				addedOutfits.push(`${uid}/${oid}`);
				if (!dryRun) fork[uid].outfits[oid] = downgradeOutfit(ov);
			}
		}
	}
	console.log(`${label}: +${addedUmas.length} new uma(s), +${addedOutfits.length} new outfit(s) on existing umas`);
	if (addedUmas.length) console.log(`  new umas: ${truncate(addedUmas)}`);
	if (addedOutfits.length) console.log(`  new outfits: ${truncate(addedOutfits)}`);
	totalAdded += addedUmas.length + addedOutfits.length;
	if (!dryRun && (addedUmas.length || addedOutfits.length)) writeJSON(forkPath, fork);
}

const ICON_PREFIX = '/uma-tools/icons/chara/';

function copyIcon(basename) {
	const src = path.join(upstreamRoot, 'icons', 'chara', `${basename}.png`);
	const dst = path.join(forkRoot, 'icons', 'chara', `${basename}.png`);
	if (!fs.existsSync(src)) {
		console.warn(`  WARNING: ${basename}.png not found under upstream icons/chara/ — leaving this icons.json key unset`);
		return false;
	}
	if (!dryRun) {
		fs.mkdirSync(path.dirname(dst), {recursive: true});
		fs.copyFileSync(src, dst);
	}
	return true;
}

// icons.json entries are either a bare basename (uma's base icon) or, for outfit ids,
// an [_01, _02] pair upstream added post-fork (gray-border + normal trained-icon
// variants). This fork's code only ever renders one trained-icon variant, so new
// outfit entries are downgraded to _02 only (adopting both isn't in scope here).
function syncIcons(upstreamIcons) {
	const forkPath = path.join(forkRoot, 'icons.json');
	const fork = readJSON(forkPath);
	const added = [];
	for (const [k, v] of Object.entries(upstreamIcons)) {
		if (k in fork) continue;
		const basename = Array.isArray(v) ? (v[1] ?? v[0]) : v;
		if (copyIcon(basename)) {
			added.push(k);
			if (!dryRun) fork[k] = ICON_PREFIX + basename + '.png';
		}
	}
	console.log(`icons.json: +${added.length} new icon key(s)`);
	if (added.length) console.log(`  added: ${truncate(added)}`);
	totalAdded += added.length;
	if (!dryRun && added.length) writeJSON(forkPath, fork);
}

function truncate(arr, n = 20) {
	return arr.slice(0, n).join(', ') + (arr.length > n ? ` ... (+${arr.length - n} more)` : '');
}

function report(label, added, diverged) {
	let line = `${label}: +${added.length} new key(s)`;
	if (diverged.length) line += `, ${diverged.length} shared key(s) diverge in value (left untouched — never overwritten by this script)`;
	console.log(line);
	if (added.length) console.log(`  added: ${truncate(added)}`);
	totalAdded += added.length;
	totalDiverged += diverged.length;
}

function main() {
	console.log(`Syncing from upstream checkout: ${upstreamRoot}`);
	console.log(`Engine ref: ${opts.engineRef}`);
	console.log(dryRun ? '(dry run — pass --no-dry-run to write changes)\n' : '(WRITING changes)\n');

	console.log('-- Global (umalator-global/) --');
	syncUmas('Global umas', 'umalator-global/umas.json', readJSON(path.join(upstreamRoot, 'umalator-global/umas.json')));
	syncSimple('Global skill_meta', 'umalator-global/skill_meta.json', readJSON(path.join(upstreamRoot, 'umalator-global/skill_meta.json')), {transform: v => stripDeep(v, SKILL_META_DROP)});
	syncSimple('Global skill_data', 'umalator-global/skill_data.json', readJSON(path.join(upstreamRoot, 'umalator-global/skill_data.json')), {transform: v => stripDeep(v, SKILL_DATA_DROP)});
	syncSimple('Global course_data', 'umalator-global/course_data.json', readJSON(path.join(upstreamRoot, 'umalator-global/course_data.json')));
	syncSimple('Global tracknames', 'umalator-global/tracknames.json', readJSON(path.join(upstreamRoot, 'umalator-global/tracknames.json')));

	console.log('\n-- JP (repo root) --');
	syncUmas('JP umas', 'umas.json', readJSON(path.join(upstreamRoot, 'umas.json')));
	syncSimple('JP skill_meta', 'skill_meta.json', readJSON(path.join(upstreamRoot, 'skill_meta.json')), {transform: v => stripDeep(v, SKILL_META_DROP)});
	syncIcons(readJSON(path.join(upstreamRoot, 'icons.json')));

	console.log('\n-- JP engine data (uma-skill-tools/data/, compared against the engine repo\'s own HEAD) --');
	syncSimple('Engine skill_data', 'uma-skill-tools/data/skill_data.json', readEngineJSON('data/skill_data.json'), {transform: v => stripDeep(v, SKILL_DATA_DROP)});
	syncSimple('Engine skillnames', 'uma-skill-tools/data/skillnames.json', readEngineJSON('data/skillnames.json'));
	syncSimple('Engine course_data', 'uma-skill-tools/data/course_data.json', readEngineJSON('data/course_data.json'));
	syncSimple('Engine tracknames', 'uma-skill-tools/data/tracknames.json', readEngineJSON('data/tracknames.json'));

	console.log(`\nTotal: +${totalAdded} key(s) added, ${totalDiverged} shared key(s) diverge in value (untouched).`);
	if (dryRun) {
		console.log('Dry run — nothing written. Re-run with --no-dry-run to apply.');
	} else {
		console.log('Written. Now rebuild umalator/, umalator-global/, and skill-visualizer-global/ and commit.');
	}
}

main();
