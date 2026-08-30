import assert from 'node:assert/strict';
import {
	applyShopFilter,
	isShopFilterActive,
	loadShopSkills,
	partitionShopSkills,
	shopFilterDirty,
} from './shopSkillFilter.ts';

// --- isShopFilterActive: enabled AND non-empty ---
{
	assert.equal(isShopFilterActive(false, ['a']), false);
	assert.equal(isShopFilterActive(true, []), false);
	assert.equal(isShopFilterActive(true, ['a']), true);
}

// --- applyShopFilter: intersection, candidate order preserved, unreachable ids dropped ---
{
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
}

// --- shopFilterDirty: the case the naive tableData-comparison design got wrong ---
{
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
}

// --- loadShopSkills: parsing/validation ---
{
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
}

// --- partitionShopSkills: procable/wontProc split ---
{
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
}

console.log('shopSkillFilter tests passed');
