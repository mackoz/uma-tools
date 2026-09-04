import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	addShopSkill,
	applyShopFilter,
	dependentsOf,
	isShopFilterActive,
	type LadderIndex,
	loadShopSkills,
	partitionShopSkills,
	prerequisitesOf,
	pruneUnsatisfiedPrerequisites,
	removeShopSkill,
	shopFilterDirty,
} from './shopSkillFilter.ts';

test('isShopFilterActive: non-empty', () => {
	assert.equal(isShopFilterActive([]), false);
	assert.equal(isShopFilterActive(['a']), true);
});

test('prerequisitesOf / dependentsOf / addShopSkill / removeShopSkill: the ladder', () => {
	// Fixture modelled on real group 20001 (Right-Handed): a three-rung white/gold ladder plus a
	// debuff variant that must never be swept up. 'other' is a same-named-but-different, unrelated
	// ladder (group 'g2') to make sure a group match is what gates everything, not id shape.
	const LADDER: LadderIndex = {
		demon: { group: 'g1', rate: 3 }, // Clockwise Demon (gold)
		circle: { group: 'g1', rate: 2 }, // Right-Handed ◎
		single: { group: 'g1', rate: 1 }, // Right-Handed ○
		debuff: { group: 'g1', rate: -1 }, // Right-Handed × -- must never be a prerequisite
		otherTop: { group: 'g2', rate: 2 },
		otherBase: { group: 'g2', rate: 1 },
	};
	const alwaysEligible = () => true;

	// prerequisitesOf
	assert.deepEqual(
		new Set(prerequisitesOf('demon', LADDER)),
		new Set(['circle', 'single']),
	);
	assert.deepEqual(
		prerequisitesOf('single', LADDER),
		[],
		'rate-1 id has no prerequisites',
	);
	assert.deepEqual(
		prerequisitesOf('unindexed', LADDER),
		[],
		'unindexed id -> []',
	);
	assert.deepEqual(
		prerequisitesOf('otherTop', LADDER),
		['otherBase'],
		"a different group's ladder must not leak in",
	);
	assert.ok(
		!prerequisitesOf('demon', LADDER).includes('debuff'),
		'the -1 debuff variant must never be treated as a prerequisite',
	);

	// dependentsOf -- restricted to what's actually in the shortlist
	assert.deepEqual(
		dependentsOf('single', ['single', 'circle', 'demon'], LADDER),
		['circle', 'demon'],
	);
	assert.deepEqual(
		dependentsOf('demon', ['single', 'circle', 'demon'], LADDER),
		[],
		'top rung has no dependents',
	);
	assert.deepEqual(
		dependentsOf('single', ['single'], LADDER),
		[],
		'dependents restricted to ids actually shortlisted',
	);

	// addShopSkill -- full-chain add from the top rung
	assert.deepEqual(
		addShopSkill([], 'demon', LADDER, alwaysEligible),
		['single', 'circle', 'demon'],
		'adding the top rung pulls in the whole chain below it, ascending by rate',
	);
	// no-op add at rate 1
	assert.deepEqual(
		addShopSkill([], 'single', LADDER, alwaysEligible),
		['single'],
		'rate-1 id adds nothing extra',
	);
	// already-present prerequisite isn't duplicated
	assert.deepEqual(addShopSkill(['single'], 'demon', LADDER, alwaysEligible), [
		'single',
		'circle',
		'demon',
	]);
	// ineligible prerequisite is skipped, not injected as a dead entry
	assert.deepEqual(
		addShopSkill([], 'demon', LADDER, (id) => id !== 'single'),
		['circle', 'demon'],
		'an ineligible prerequisite is left out entirely',
	);
	// re-adding an id already in the list is a no-op
	assert.deepEqual(addShopSkill(['single'], 'single', LADDER, alwaysEligible), [
		'single',
	]);
	// unindexed id round-trips untouched
	assert.deepEqual(addShopSkill([], 'unindexed', LADDER, alwaysEligible), [
		'unindexed',
	]);

	// removeShopSkill -- cascade-up removal from the bottom rung
	assert.deepEqual(
		removeShopSkill(['single', 'circle', 'demon'], 'single', LADDER),
		[],
		'removing the base cascades away everything built on top of it',
	);
	// non-cascading removal of a top rung
	assert.deepEqual(
		removeShopSkill(['single', 'circle', 'demon'], 'demon', LADDER),
		['single', 'circle'],
		'removing the top rung leaves its prerequisites alone',
	);
	// unindexed id round-trips untouched
	assert.deepEqual(
		removeShopSkill(['unindexed', 'single'], 'unindexed', LADDER),
		['single'],
	);

	// pruneUnsatisfiedPrerequisites -- repairs a shortlist assembled some other way than
	// addShopSkill (today: app.tsx's hydration path). A fully-satisfied chain is untouched;
	// an id missing any of its prerequisites is dropped, and dropping cascades (removing the
	// middle rung of a 3-rung chain must drop the top rung too, once the middle is gone).
	assert.deepEqual(
		pruneUnsatisfiedPrerequisites(['single', 'circle', 'demon'], LADDER),
		['single', 'circle', 'demon'],
		'a fully-satisfied chain is untouched',
	);
	assert.deepEqual(
		pruneUnsatisfiedPrerequisites(['circle'], LADDER),
		[],
		"circle's prerequisite (single) is missing -- circle itself is pruned",
	);
	assert.deepEqual(
		pruneUnsatisfiedPrerequisites(['circle', 'demon'], LADDER),
		[],
		"single missing -- circle is pruned, which cascades to prune demon too (demon's own " +
			'prerequisite, circle, is now gone)',
	);
	assert.deepEqual(
		pruneUnsatisfiedPrerequisites(['single', 'demon'], LADDER),
		['single'],
		"circle (demon's direct prerequisite) is missing -- demon is pruned, single stays",
	);
	assert.deepEqual(
		pruneUnsatisfiedPrerequisites(['unindexed', 'single'], LADDER),
		['unindexed', 'single'],
		'an unindexed id has no prerequisites to fail, so it is never pruned',
	);
	assert.deepEqual(pruneUnsatisfiedPrerequisites([], LADDER), []);
});

test('applyShopFilter: intersection, candidate order preserved, unreachable ids dropped', () => {
	const candidates = ['a', 'b', 'c', 'd'];
	assert.deepEqual(applyShopFilter(candidates, ['c', 'a']), ['a', 'c']);
	// Shortlist order ('z' first) must not leak into the result order.
	assert.deepEqual(applyShopFilter(candidates, ['d', 'b', 'a']), [
		'a',
		'b',
		'd',
	]);
	// A shortlisted id that isn't a chart candidate at all (not proc-able / purple / unique /
	// unreleased) is silently dropped, not an error.
	assert.deepEqual(applyShopFilter(candidates, ['a', 'zzz']), ['a']);
	assert.deepEqual(applyShopFilter(candidates, []), []);
});

test('shopFilterDirty: the case the naive tableData-comparison design got wrong', () => {
	// Inactive: dirty only if the filter was previously applied (pool has since widened back out).
	assert.equal(
		shopFilterDirty(false, ['a'], new Set(['a']), new Set(), null),
		false,
		'inactive + no prior filtered run -> not dirty',
	);
	assert.equal(
		shopFilterDirty(false, ['a'], new Set(['a']), new Set(), ['a']),
		true,
		'inactive + prior run was filtered -> dirty (pool widened)',
	);

	// Active: every shortlisted id already accounted for by the last run -> not dirty. Covers
	// both "shortlist after an unfiltered run" (lastRunCandidateIds is the whole pool) and
	// "removed a chip since the last filtered run" (fewer ids than before, all still covered).
	assert.equal(
		shopFilterDirty(
			true,
			['a', 'b'],
			new Set(['a', 'b']),
			new Set(['a', 'b', 'c']),
			['a', 'b'],
		),
		false,
		'active + every shortlisted id already evaluated last run -> not dirty',
	);

	// Active: a proc-able shortlisted id the last run never evaluated -> dirty.
	assert.equal(
		shopFilterDirty(true, ['a', 'b'], new Set(['a', 'b']), new Set(['a']), [
			'a',
		]),
		true,
		'active + a new proc-able id not in the last run -> dirty',
	);

	// Active: a shortlisted id that ISN'T proc-able at all (or is a purple/unique/hidden id) and
	// also never got evaluated -- must NOT count as dirty. This is exactly the case an earlier
	// draft (compare shortlist against tableData rows) got wrong: such an id never gets a row, so
	// that design would read this as permanently dirty no matter how many times Run is pressed.
	assert.equal(
		shopFilterDirty(true, ['a', 'nope'], new Set(['a']), new Set(['a']), ['a']),
		false,
		'active + a non-procable shortlisted id -> not dirty (it can never be evaluated)',
	);

	// Active + procable === null (pool not computed yet): nothing can be confirmed procable, so
	// nothing can register as dirty via this path either.
	assert.equal(
		shopFilterDirty(true, ['a'], null, new Set(), null),
		false,
		'active + unknown procable set -> not dirty',
	);
});

test('loadShopSkills: parsing/validation', () => {
	const known = new Set(['a', 'b', 'c']);
	const isKnown = (id: string) => known.has(id);

	assert.deepEqual(loadShopSkills(null, isKnown), []);
	assert.deepEqual(loadShopSkills('not json{{', isKnown), []);
	assert.deepEqual(
		loadShopSkills('{"a":1}', isKnown),
		[],
		'non-array JSON -> []',
	);
	assert.deepEqual(
		loadShopSkills('["a","zzz","b"]', isKnown),
		['a', 'b'],
		'unknown id dropped',
	);
	assert.deepEqual(
		loadShopSkills('["a","a","b"]', isKnown),
		['a', 'b'],
		'duplicates collapsed, first-seen order preserved',
	);
	assert.deepEqual(
		loadShopSkills('["a",1,"b"]', isKnown),
		['a', 'b'],
		'non-string entries dropped',
	);
});

test('partitionShopSkills: procable/wontProc split', () => {
	assert.deepEqual(
		partitionShopSkills(['a', 'b'], null),
		{ procable: ['a', 'b'], wontProc: [] },
		'unknown pool -> everything provisionally procable, nothing flagged',
	);
	assert.deepEqual(partitionShopSkills(['a', 'b', 'c'], new Set(['a', 'c'])), {
		procable: ['a', 'c'],
		wontProc: ['b'],
	});
	assert.deepEqual(partitionShopSkills([], new Set(['a'])), {
		procable: [],
		wontProc: [],
	});
});
