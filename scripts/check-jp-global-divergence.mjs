// Reports where the JP and Global datasets disagree on shared ids, and flags Global entries
// that are JP-sourced approximations (see umalator-global/unreleased.json's `provenance` map,
// written by scripts/add-staged-global-umas.mjs) whose JP source has since moved on.
//
// JP and Global are two independent datasets, not one dataset at two ages -- JP rebalances
// skills and revises course geometry on its own schedule, and Global does not inherit those
// changes automatically (see docs/data-pipeline.md's "JP and Global are independent datasets"
// section). That divergence is an expected steady state for anything Global has its own live
// values for -- this script does NOT try to reconcile it, and is deliberately NOT wired into
// `npm run verify` for that reason.
//
// The one class of divergence that IS actionable: a Global entry recorded as JP-sourced in
// provenance (ported because the uma/outfit wasn't live on Global yet -- see
// add-staged-global-umas.mjs) whose JP value has since changed. That's not "JP and Global
// disagree by design" -- it's a port going stale. NOTE: there is currently no command that fixes
// this -- add-staged-global-umas.mjs only ever adds an outfit/skill it hasn't seen before, so an
// already-staged entry is filtered out of every future run regardless of whether its JP source
// has changed (see this script's own runtime message below). --strict exits non-zero on this
// class so it's at least visible, even though nothing can act on it yet.
//
// Usage:
//   node scripts/check-jp-global-divergence.mjs            # report everything, exit 0
//   node scripts/check-jp-global-divergence.mjs --strict    # exit 1 if any provenance entry is stale

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { program } from 'commander';

program.option(
	'--strict',
	'exit non-zero if any JP-sourced Global entry has gone stale',
);

program.parse();
const opts = program.opts();

const dirname = path.dirname(fileURLToPath(import.meta.url));
const forkRoot = path.join(dirname, '..');

function readJSON(relPath) {
	return JSON.parse(fs.readFileSync(path.join(forkRoot, relPath), 'utf8'));
}

const jpSkillMeta = readJSON('skill_meta.json');
const jpSkillData = readJSON('uma-skill-tools/data/jp/skill_data.json');
const jpCourseData = readJSON('uma-skill-tools/data/jp/course_data.json');

const globalSkillMeta = readJSON('umalator-global/skill_meta.json');
const globalSkillData = readJSON('uma-skill-tools/data/global/skill_data.json');
const globalCourseData = readJSON('uma-skill-tools/data/global/course_data.json');
const unreleased = readJSON('umalator-global/unreleased.json');
const provenance = unreleased.provenance ?? {};

function diverged(a, b, id) {
	return id in a && id in b && JSON.stringify(a[id]) !== JSON.stringify(b[id]);
}

function reportDivergence(label, jp, global) {
	const shared = Object.keys(global).filter((id) => id in jp);
	const diff = shared.filter((id) => diverged(jp, global, id));
	console.log(
		`${label}: ${shared.length} shared id(s), ${diff.length} diverged`,
	);
	return { shared: shared.length, diverged: diff };
}

console.log(
	'=== JP vs Global: shared-id divergence (expected steady state) ===\n',
);
const skillDataResult = reportDivergence(
	'skill_data',
	jpSkillData,
	globalSkillData,
);
const skillMetaResult = reportDivergence(
	'skill_meta',
	jpSkillMeta,
	globalSkillMeta,
);
const courseDataResult = reportDivergence(
	'course_data',
	jpCourseData,
	globalCourseData,
);

console.log(
	'\n=== JP-sourced Global entries: staleness check (actionable) ===\n',
);
const staleEntries = [];
const provenanceIds = Object.keys(provenance);
console.log(
	`${provenanceIds.length} Global entry/entries recorded as JP-sourced.`,
);
for (const sid of provenanceIds) {
	const dataStale = diverged(jpSkillData, globalSkillData, sid);
	const metaStale = diverged(jpSkillMeta, globalSkillMeta, sid);
	if (dataStale || metaStale) {
		staleEntries.push({
			sid,
			dataStale,
			metaStale,
			jpSkillDataCommit: provenance[sid]?.jpSkillDataCommit ?? null,
		});
	}
}

if (staleEntries.length) {
	console.log(
		`\n${staleEntries.length} JP-sourced entry/entries have gone stale (JP has changed since this was ported):`,
	);
	for (const e of staleEntries) {
		const fields = [
			e.dataStale && 'skill_data',
			e.metaStale && 'skill_meta',
		].filter(Boolean);
		console.log(
			`  ${e.sid} (${fields.join(', ')}) -- ported from JP commit ${e.jpSkillDataCommit ?? 'unknown'}`,
		);
	}
	console.log(
		'\nNOTE: add-staged-global-umas.mjs only ever ADDS an outfit/skill it has not seen before -- ' +
			'an already-staged outfit is filtered out of its work list on every later run, so re-running ' +
			'it will NOT refresh these. Nothing currently re-syncs an already-staged JP-sourced entry ' +
			'when JP changes -- that refresh capability (PIPE-6) has not been built yet.',
	);
} else {
	console.log('\nNo stale JP-sourced entries.');
}

console.log(
	`\nSummary: ${skillDataResult.diverged.length}/${skillDataResult.shared} skill_data, ` +
		`${skillMetaResult.diverged.length}/${skillMetaResult.shared} skill_meta, ` +
		`${courseDataResult.diverged.length}/${courseDataResult.shared} course_data shared-id divergence ` +
		`(expected); ${staleEntries.length} stale JP-sourced entries (actionable).`,
);

if (opts.strict && staleEntries.length) {
	process.exit(1);
}
