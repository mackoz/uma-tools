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
//   node scripts/add-staged-global-umas.mjs --refresh-staged-meta --no-dry-run
//                                                                 # see the dedicated section below
//
// UI-28's --refresh-staged-meta mode (HP-6 extended it to also cover skill_data.json -- see
// below): closes (for one specific, narrow case) the gap this file's header used to describe as
// fully open -- "an already-staged entry is filtered out of every future run regardless of
// whether its JP source has changed" (see check-jp-global-divergence.mjs for where that gap is
// still detected but NOT fixed by this mode; see it below for what actually is). Motivating case:
// regenerating umalator-global/skill_meta.json and/or uma-skill-tools/data/global/skill_data.json
// straight from master.mdb (e.g. to add a new field like groupRate, or a full skill_data.json
// regen such as HP-6's) necessarily drops every staged-unreleased entry this script previously
// layered on top, since master.mdb itself has no idea those umas/skills are being staged early --
// the regeneration is correct in isolation, but leaves the 45-46 staged ids
// (umalator-global/unreleased.json's `.skills`) with no skill_meta and/or skill_data at all, which
// crashes SkillSet() (umalator/app.tsx) for any uma behind the "Show Unreleased Umas" toggle.
// Re-running this script in its normal mode does NOT fix that: normal mode's outfitIds list is
// filtered by `!alreadyPresent.has(oid)` against umas.json, which neither regeneration touches, so
// every staged outfit reads as "already added" and the normal scan finds nothing to do.
//
// --refresh-staged-meta instead walks umalator-global/unreleased.json's existing `.skills` list
// directly and re-copies each one from *current* JP skill_meta/skill_data -- but independently per
// file: a sid's skill_meta is restored only if it's absent from globalSkillMeta right now, and
// (as of HP-6) its skill_data is restored only if it's absent from globalSkillData right now.
// They're checked separately rather than requiring both to be missing because the two files can
// be regenerated on different schedules -- update.bat happens to regenerate both together today,
// but nothing here assumes that stays true. A sid the regeneration left in place in a given file
// is treated as newly Global-authoritative *for that file*, not merely still-staged, and is
// deliberately left untouched there even though it's also listed as provenance 'jp' from an
// earlier run (concrete case: sid 100991, present in a from-scratch regeneration of both
// skill_meta.json and skill_data.json because it independently satisfies master.mdb's own
// `is_general_skill=1 OR rarity>=3`, even though the uma/outfit it belongs to hasn't released --
// verified for skill_data.json specifically as part of HP-6's own acceptance check). This is
// deliberately a narrower, more conservative rule than setJpSourced's normal
// priorJpSourced-permits-overwrite guard (used by the outfit-scan and inherited-twin sweep below)
// -- that guard would happily let this mode clobber sid 100991's now-authoritative Global values
// with a JP approximation, since it WAS priorJpSourced. Restore-if-missing, not refresh-if-stale.
//
// IMPORTANT: like sync-upstream-data.mjs, this only ever ADDS keys that don't already exist.
// It never overwrites an existing umalator-global/ entry -- enforced two ways: the outfitIds
// list below is pre-filtered to outfits not already in globalUmas (so in normal operation the
// write sites never even see an existing sid), and an explicit guard at each write site refuses
// to overwrite an existing globalSkillData/globalSkillMeta entry unless it was already JP-sourced
// (see unreleased.json's `provenance` map) or --force is passed. The guard exists so a future
// refactor of the outfit-filtering logic can't silently reopen the ability to clobber
// Global-authoritative data with JP values.
//
// This guard is scoped to this script's own closure -- sync-upstream-data.mjs enforces its own,
// independent add-only guarantee on the same files rather than sharing this one (PIPE-2 review,
// round 3). Both are correct today; PIPE-7 (already tracking readJSON/boilerplate duplication
// across these scripts) is the natural place to extract a shared guard alongside that dedup,
// rather than one more independently-drifting copy.
//
// provenance (in umalator-global/unreleased.json) records which skill ids are JP-sourced
// approximations rather than Global-authoritative -- i.e. mechanics ported from JP because the
// uma/outfit isn't live on Global yet, not verified against Global's own master.mdb. It's the
// signal scripts/check-jp-global-divergence.mjs uses to flag a JP-sourced entry whose JP source
// has since moved on. NOTE: provenance is only tracked for currently-*unreleased* skills (see
// PIPE-6) -- once an outfit is promoted to live by the real pipeline (make_global_uma_info.pl),
// its provenance marker is lost even though the ported skill_data/skill_meta values are still,
// in fact, unverified against Global's own data until someone regenerates them for real.

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
	.option('--no-dry-run', 'actually write merged JSON (default: report only)')
	.option(
		'--force',
		'allow overwriting a Global-authoritative skill_meta/skill_data entry (normally refused)',
	)
	.option(
		'--refresh-staged-meta',
		'restore skill_meta/skill_data for already-staged skills a fresh skill_meta.json and/or ' +
			'skill_data.json regeneration dropped (UI-28, extended HP-6) -- runs standalone, ignores ' +
			'--until and the outfit scan; see the file header for exactly what it does and does not fix',
	);

program.parse();
const opts = program.opts();
const dryRun = opts.dryRun !== false;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const forkRoot = path.join(dirname, '..');
const mdbPath = path.resolve(opts.mdb);

// --refresh-staged-meta never reads master.mdb (see its own section in main()) -- don't require
// --mdb to point at a real file for that mode.
if (!opts.refreshStagedMeta && !fs.existsSync(mdbPath)) {
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

function commitAndPushInSubmodule(
	submodulePath,
	relFiles,
	message,
	{ dryRun },
) {
	if (dryRun) {
		console.log(
			`\n(dry run — would commit in ${submodulePath}: ${relFiles.join(', ')})`,
		);
		return;
	}
	try {
		execFileSync('git', ['-C', submodulePath, 'add', ...relFiles], {
			stdio: 'inherit',
		});
		execFileSync('git', ['-C', submodulePath, 'commit', '-m', message], {
			stdio: 'inherit',
		});
		execFileSync('git', ['-C', submodulePath, 'push'], { stdio: 'inherit' });
		console.log(
			`\nCommitted and pushed in ${submodulePath}. Now bump uma-tools' gitlink and commit here too.`,
		);
	} catch (err) {
		// Most likely cause: the submodule is checked out at a detached HEAD (the normal state
		// after `git submodule update`), which makes `git push` fail immediately with "You are not
		// currently on a branch". Don't let that crash the whole script -- umas.json/skill_meta.json/
		// unreleased.json were already written to disk successfully by the caller; only this
		// submodule commit step failed, and the user needs clear instructions to finish it by hand.
		console.error(
			`\nFailed to commit/push in the uma-skill-tools submodule automatically: ${err.message}`,
		);
		console.error(
			`Manual recovery: cd ${submodulePath} && git add ${relFiles.join(' ')} && git commit -m "${message}" && git push`,
		);
		console.error(
			'(the submodule is likely on a detached HEAD -- checkout a branch there first if needed)',
		);
	}
}

// Best-effort: the submodule commit this run's JP mechanics came from, recorded in provenance
// so a later divergence check can tell whether a JP-sourced Global entry is still current. null
// if uma-skill-tools isn't a git checkout for some reason (e.g. a stripped CI archive) -- that's
// a degraded-but-not-fatal case, so this doesn't throw.
function jpDataVersion() {
	try {
		return execFileSync(
			'git',
			['-C', path.join(forkRoot, 'uma-skill-tools'), 'rev-parse', 'HEAD'],
			{ encoding: 'utf8' },
		).trim();
	} catch {
		return null;
	}
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

// The inherited variant of a unique is a genuinely separate skill row (different baseDuration,
// modifiers, baseCost, iconId -- not derivable, must be copied), keyed by swapping the base
// unique's leading '1' for '9'. Verified against the Global client's own master.mdb:
// skill_data.unique_skill_id_1 on every '9...' row points back at its base unique, with zero
// exceptions in that table.
function inheritedSkillForUnique(sid) {
	return '9' + sid.slice(1);
}

function main() {
	const skillMetaPath = path.join(forkRoot, 'umalator-global/skill_meta.json');
	const skillDataPath = path.join(
		forkRoot,
		'uma-skill-tools/data/global/skill_data.json',
	);
	const skillNamesPath = path.join(
		forkRoot,
		'uma-skill-tools/data/global/skillnames.json',
	);
	const jpSkillMeta = readJSON(path.join(forkRoot, 'skill_meta.json'));
	const jpSkillData = readJSON(
		path.join(forkRoot, 'uma-skill-tools/data/jp/skill_data.json'),
	);
	const globalSkillMeta = readJSON(skillMetaPath);
	const globalSkillData = readJSON(skillDataPath);
	const globalSkillNames = readJSON(skillNamesPath);
	const unreleasedPath = path.join(forkRoot, 'umalator-global/unreleased.json');
	const priorUnreleased = fs.existsSync(unreleasedPath)
		? readJSON(unreleasedPath)
		: {};

	if (opts.refreshStagedMeta) {
		// See the file-header comment for the full rationale and the 100991-style edge case this
		// deliberately does NOT touch. Standalone mode: doesn't read master.mdb, doesn't touch
		// umas.json, doesn't re-derive unreleasedOutfits/unreleasedSkills -- unreleased.json's own
		// `.skills` list is exactly what a regeneration needs restored, and umas.json (the only
		// other input that list depends on) is untouched by either a skill_meta.json or
		// skill_data.json regeneration.
		//
		// skill_meta.json and skill_data.json are each checked independently, per sid: as of HP-6,
		// both files can genuinely be missing a staged id after a regeneration (skill_data.json
		// moved into the pipeline HP-6 touches -- see the file header for the full history of why
		// this used to check skill_meta.json only). `sid in globalSkillMeta` / `sid in
		// globalSkillData` are each the real signal of "did *this* regeneration drop this id from
		// *this* file" -- checked separately so a sid missing from only one of the two files (e.g.
		// a run where only one was regenerated) gets restored only where it's actually missing,
		// never re-copied on top of a file that already has it.
		console.log(
			dryRun
				? '(dry run -- pass --no-dry-run to write changes)\n'
				: '(WRITING changes)\n',
		);
		const jpVersion = jpDataVersion();
		const staged = priorUnreleased.skills ?? [];
		const restoredMeta = [];
		const restoredData = [];
		const alreadyPresentMeta = [];
		const alreadyPresentData = [];
		const missingFromJpMeta = [];
		const missingFromJpData = [];
		for (const sid of staged) {
			if (sid in globalSkillMeta) {
				alreadyPresentMeta.push(sid);
			} else if (!(sid in jpSkillMeta)) {
				missingFromJpMeta.push(sid);
			} else {
				globalSkillMeta[sid] = jpSkillMeta[sid];
				restoredMeta.push(sid);
			}

			if (sid in globalSkillData) {
				alreadyPresentData.push(sid);
			} else if (!(sid in jpSkillData)) {
				missingFromJpData.push(sid);
			} else {
				globalSkillData[sid] = jpSkillData[sid];
				restoredData.push(sid);
			}
		}
		// Union of both, for provenance bookkeeping and the write-gate below -- a sid restored in
		// only one of the two files still needs its provenance's jpSkillDataCommit refreshed.
		const restored = [...new Set([...restoredMeta, ...restoredData])].sort();
		console.log(`Restored to skill_meta.json: +${restoredMeta.length}`);
		restoredMeta.forEach((s) => {
			console.log(`  ${s}`);
		});
		console.log(`Restored to skill_data.json: +${restoredData.length}`);
		restoredData.forEach((s) => {
			console.log(`  ${s}`);
		});
		if (alreadyPresentMeta.length) {
			console.log(
				`\nSKIPPED skill_meta.json (already present -- now Global-authoritative, not merely ` +
					`still-staged): ${alreadyPresentMeta.join(', ')}`,
			);
		}
		if (alreadyPresentData.length) {
			console.log(
				`\nSKIPPED skill_data.json (already present -- now Global-authoritative, not merely ` +
					`still-staged): ${alreadyPresentData.join(', ')}`,
			);
		}
		if (missingFromJpMeta.length) {
			console.log(
				`\nSKIPPED skill_meta.json (missing from current JP skill_meta -- can't restore): ${missingFromJpMeta.join(', ')}`,
			);
		}
		if (missingFromJpData.length) {
			console.log(
				`\nSKIPPED skill_data.json (missing from current JP skill_data -- can't restore): ${missingFromJpData.join(', ')}`,
			);
		}
		// provenance's jpSkillDataCommit is refreshed to the current submodule commit for every sid
		// restored to either file -- everything else in unreleased.json (outfits/skills lists,
		// other provenance entries) is left exactly as it was; this mode never recomputes them.
		if (restored.length) {
			const provenance = { ...(priorUnreleased.provenance ?? {}) };
			for (const sid of restored) {
				provenance[sid] = { source: 'jp', jpSkillDataCommit: jpVersion };
			}
			if (!dryRun) {
				if (restoredMeta.length) writeJSON(skillMetaPath, globalSkillMeta);
				if (restoredData.length) writeJSON(skillDataPath, globalSkillData);
				fs.writeFileSync(
					unreleasedPath,
					`${JSON.stringify({ ...priorUnreleased, provenance }, null, '\t')}\n`,
				);
				// skill_data.json lives in the uma-skill-tools submodule -- writing it to disk isn't
				// enough to actually publish the change (see docs/data-pipeline.md's PIPE-42 note),
				// same two-repo commit the normal outfit-scan path below already does.
				if (restoredData.length) {
					commitAndPushInSubmodule(
						path.join(forkRoot, 'uma-skill-tools'),
						['data/global/skill_data.json'],
						'Restore staged unreleased-uma skill data dropped by regeneration',
						{ dryRun },
					);
				}
				console.log(
					'\nWritten. Now rebuild umalator/ and umalator-global/ and commit.',
				);
			} else {
				console.log(
					'\nDry run -- nothing written. Re-run with --no-dry-run to apply.',
				);
			}
		} else if (!dryRun) {
			console.log('\nNothing to restore -- no files written.');
		}
		return;
	}

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
	const globalUmas = readJSON(umasPath);

	// Provenance recorded by a *previous* run (if any) -- a sid already marked JP-sourced here is
	// safe to refresh from this run's JP data; anything else already present is Global-authoritative
	// and must not be touched. See the file-header comment for why this guard exists in addition to
	// the outfit-presence filtering below.
	const priorJpSourced = new Set(Object.keys(priorUnreleased.provenance ?? {}));
	const jpVersion = jpDataVersion();
	const provenance = {};
	const blockedOverwrites = [];

	// Refuses to clobber a Global-authoritative entry; records provenance for anything it does
	// write. Returns whether the write happened, so callers can skip the sibling meta/data write
	// (and any bookkeeping) on refusal instead of leaving the two files inconsistent.
	function setJpSourced(sid) {
		const exists = sid in globalSkillData || sid in globalSkillMeta;
		if (exists && !priorJpSourced.has(sid) && !opts.force) {
			blockedOverwrites.push(sid);
			return false;
		}
		globalSkillMeta[sid] = jpSkillMeta[sid];
		globalSkillData[sid] = jpSkillData[sid];
		provenance[sid] = { source: 'jp', jpSkillDataCommit: jpVersion };
		return true;
	}

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

		// Write the skill mechanics first -- an outfit whose unique skill got refused isn't worth
		// adding (it would be selectable in the roster with no working skill data behind it).
		if (!setJpSourced(sid)) continue;

		if (!(cid in globalUmas)) {
			globalUmas[cid] = { name: ['', charName], outfits: { [oid]: epithet } };
			newChars.push(`${oid} ${charName}`);
		} else {
			globalUmas[cid].outfits[oid] = epithet;
			newOutfits.push(`${oid} ${charName}`);
		}
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
	if (blockedOverwrites.length) {
		console.log(
			`\nREFUSED (already a Global-authoritative skill_meta/skill_data entry, not JP-sourced -- ` +
				`pass --force to override): ${blockedOverwrites.join(', ')}`,
		);
	}

	// Inherited-twin sweep: every base unique this script is tracking as JP-sourced (this run's
	// new ones included) should also have its '9...' inherited variant, or it silently can't be
	// selected on another uma in the skill picker (Object.keys(skill_data.json) is the picker's
	// entire candidate universe -- see components/HorseDef.tsx's nonUniqueSkills). Sweeping every
	// JP-sourced base unique rather than just this run's outfits makes this idempotent and
	// self-healing: it also backfills any pre-existing gap left by an earlier run.
	//
	// Scoped to priorJpSourced/provenance rather than every sid in globalSkillData (PIPE-2
	// review, round 3): sweeping unconditionally would silently write JP-sourced mechanics for an
	// already-live, Global-authoritative uma's inherited twin too, if it ever happened to be
	// missing one -- bypassing the "Show Unreleased Umas" toggle entirely, since that gate is
	// populated only from releaseOrder-tracked outfits below and a live uma's base sid was never
	// one of those. Scoping to known-JP-sourced bases also fixes a second gap for free: those are
	// exactly the sids the unreleasedSkills backfill loop below already re-derives provenance for
	// on every run, so a self-healed twin's provenance can no longer silently disappear the way
	// an unconditionally-swept one's would once this run's fresh `provenance` object above is
	// discarded. A base sid promoted from staged-JP to Global-live is correctly excluded too --
	// its own provenance was already dropped from priorJpSourced by the separate, already-
	// documented PIPE-6 limitation (see this file's header comment), so this doesn't reopen that
	// gap, only closes the new one.
	const newInherited = [];
	const skippedInheritedNoMechanics = [];
	for (const sid of Object.keys(globalSkillData)) {
		if (sid[0] !== '1' || sid.length !== 6) continue;
		if (!priorJpSourced.has(sid) && !(sid in provenance)) continue;
		const inh = inheritedSkillForUnique(sid);
		if (inh in globalSkillData) continue;
		if (
			!(inh in jpSkillMeta) ||
			!(inh in jpSkillData) ||
			!(inh in globalSkillNames)
		) {
			skippedInheritedNoMechanics.push(`${inh} (base ${sid})`);
			continue;
		}
		if (!setJpSourced(inh)) continue;
		newInherited.push(`${inh} (base ${sid})`);
	}
	console.log(`\nNew inherited-unique twins: +${newInherited.length}`);
	newInherited.forEach((s) => {
		console.log(`  ${s}`);
	});
	if (skippedInheritedNoMechanics.length) {
		console.log(
			`\nSKIPPED inherited twin (missing from JP skill_meta/skill_data, or from Global skillnames): ${skippedInheritedNoMechanics.join(', ')}`,
		);
	}

	// Sentinel audit: warn if any outfit already in the Global roster belongs to a character
	// master.mdb marks as unreleased (chara_data.start_date == the 2524608000 / 2050-01-01
	// sentinel) but that the release-order table doesn't cover -- i.e. a roster entry that's
	// visible regardless of the "Show Unreleased Umas" toggle despite not actually being live.
	// This is exactly the class of bug that let Hokko Tarumae (109901) go unflagged; catching it
	// here means it can't recur silently.
	const sentinelChars = new Set(
		Object.keys(
			queryMdb('SELECT id FROM chara_data WHERE start_date=2524608000;'),
		),
	);
	const unflagged = [];
	for (const [cid, u] of Object.entries(globalUmas)) {
		if (!sentinelChars.has(cid)) continue;
		for (const oid of Object.keys(u.outfits)) {
			if (!(oid in releaseOrder)) unflagged.push(`${oid} ${u.name[1]}`);
		}
	}
	if (unflagged.length) {
		console.log(
			`\nWARNING: roster outfit(s) belong to a master.mdb-unreleased character but aren't in ` +
				`scripts/data/global-release-order.json, so they're visible regardless of the toggle: ${unflagged.join(', ')}`,
		);
	}

	// unreleased.json is fully recomputed each run from umas.json ∩ the release-order table,
	// rather than accumulated -- so it self-heals if umas.json is ever hand-edited or a future
	// sync/generator run adds one of these outfits by a different path.
	const unreleasedOutfits = Object.keys(releaseOrder)
		.filter((k) => k !== '_comment')
		.filter((oid) => oid in (globalUmas[oid.slice(0, 4)]?.outfits ?? {}));
	unreleasedOutfits.sort();
	// Both the base unique and its inherited twin need to be hidden together, or the toggle would
	// leave the inherited half selectable while the uma itself stays hidden from the picker.
	const unreleasedSkills = unreleasedOutfits.flatMap((oid) => {
		const sid = uniqueSkillForOutfit(oid);
		return [sid, inheritedSkillForUnique(sid)];
	});
	unreleasedSkills.sort();
	// provenance so far only has entries this run actually wrote; every unreleased skill is
	// JP-sourced by construction of this pipeline (there's no other path that stages one), so
	// backfill anything untouched this run from the prior file's record, falling back to an
	// unknown-version marker for a skill staged before provenance tracking existed.
	for (const sid of unreleasedSkills) {
		if (!(sid in provenance)) {
			provenance[sid] = priorUnreleased.provenance?.[sid] ?? {
				source: 'jp',
				jpSkillDataCommit: null,
			};
		}
	}
	const unreleasedJson = {
		outfits: unreleasedOutfits,
		skills: unreleasedSkills,
		provenance,
	};

	console.log(
		`\numalator-global/unreleased.json will list ${unreleasedOutfits.length} outfit(s) total (including any from prior runs).`,
	);

	if (!dryRun) {
		if (newChars.length || newOutfits.length) {
			writeJSON(umasPath, globalUmas);
		}
		if (newChars.length || newOutfits.length || newInherited.length) {
			writeJSON(skillMetaPath, globalSkillMeta);
			writeJSON(skillDataPath, globalSkillData);
		}
		fs.writeFileSync(
			path.join(forkRoot, 'umalator-global/unreleased.json'),
			`${JSON.stringify(unreleasedJson, null, '\t')}\n`,
		);
		// Submodule commit/push happens last, after every local file has already been written --
		// a failure here (e.g. detached HEAD, see commitAndPushInSubmodule's own catch) must never
		// leave unreleased.json stale relative to umas.json/skill_meta.json/skill_data.json.
		if (newChars.length || newOutfits.length || newInherited.length) {
			commitAndPushInSubmodule(
				path.join(forkRoot, 'uma-skill-tools'),
				['data/global/skill_data.json'],
				'Add staged unreleased-uma skill data',
				{ dryRun },
			);
		}
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
