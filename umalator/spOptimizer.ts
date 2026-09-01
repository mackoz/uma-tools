// Pure logic for the Skill Chart's SP-budget optimizer (UI-16): given a shortlist of candidate
// skills with per-skill "gain" scores (from the chart's own evaluation), a shop hint-level map,
// per-skill SP costs, and an SP budget, picks the purchase set(s) that maximize total gain without
// exceeding budget -- honoring the shop's upgrade-ladder structure (a gold rung can't be bought
// without its white prerequisite) and the shop's own hint discounts.
//
// Kept import-free (no Preact, no CSS, no JSON) so it's plain-node testable, matching
// shopSkillFilter.ts/chartLadder.ts/statisticalAnalysis.ts. umalator/app.tsx owns the JSON/DOM
// side (skill costs, persisted hint levels, the chart's per-skill gain numbers) and passes plain
// values in here.

import type { LadderIndex } from './shopSkillFilter';

// Shop hint-level discount table, indexed by hint level 0-5 (0 = no hint, 5 = max hint).
export const HINT_DISCOUNT: readonly number[] = [0, 0.1, 0.2, 0.3, 0.35, 0.4];

// SP cost of a skill after its hint discount. Levels outside 0-5 (or fractional) are clamped to
// the nearest valid integer level before looking up the discount.
export function discountedCost(baseCost: number, hintLevel: number): number {
	const level = Math.min(5, Math.max(0, Math.round(hintLevel)));
	return Math.round(baseCost * (1 - HINT_DISCOUNT[level]));
}

// Persisted/known hint levels, keyed by skill id. An id absent from this map is hint level 0.
export type HintLevels = { [skillId: string]: number };

// Base (pre-discount) SP cost, keyed by skill id.
export type CostLookup = { [skillId: string]: number };

// One shortlisted skill's chart-measured gain, the optimizer's objective input.
export interface OptimizerCandidate {
	id: string;
	gain: number;
}

// One selectable purchase: every rung actually bought (including gain-less ladder prerequisites),
// its total discounted SP cost, and its total gain (the sum of each bought ladder's terminal
// rung's gain -- see optimizePurchases for why gains never sum within a single ladder).
export interface PurchaseSet {
	skillIds: string[];
	totalCost: number;
	totalGain: number;
}

export interface OptimizerInput {
	candidates: OptimizerCandidate[];
	hints: HintLevels;
	ladder: LadderIndex;
	costs: CostLookup;
	// Rungs already bought on a prior run: free (cost 0) and never offered as a tier's terminal
	// rung (you can't "buy" what you already own), but still counted as satisfying a higher
	// rung's prerequisite chain.
	owned?: Set<string>;
	budget: number;
	// How many diverse purchase sets to return. Default 3.
	topK?: number;
}

// Defensive ceiling on DFS node visits (one visit per group-choice made), so a pathological input
// (many groups, each with several tiers) degrades to "best effort within the ceiling" rather than
// hanging or throwing. At the documented scale (<=4 choices/group, ~10 groups) full enumeration is
// far below this.
const NODE_CEILING = 2_000_000;

interface Tier {
	// Every rung bought if this tier is chosen (prerequisites first, ascending by rate, then the
	// terminal rung itself).
	skillIds: string[];
	cost: number;
	gain: number;
}

interface Group {
	// "buy nothing" is implicit and not stored as a Tier; every other reachable tier for this
	// group, unordered.
	tiers: Tier[];
	maxTierGain: number; // max(0, ...tiers.map(gain)), 0 if no tiers survive step 3's gain>0 filter
}

// Builds the per-group tier list described in the class doc above (step 1-3 of the algorithm):
// group the candidates by ladder group (an id absent from `ladder` is its own singleton group),
// find every rung of that group anywhere in `ladder`, and for each candidate rung construct the
// tier that buys it and every lower-rate rung in its group not already owned. Groups are returned
// in first-encounter order over `candidates` (drives the deterministic skillIds ordering in
// optimizePurchases' output).
function buildGroups(input: OptimizerInput): Group[] {
	const { candidates, hints, ladder, costs, owned } = input;
	const isOwned = (id: string) => owned?.has(id) ?? false;

	// group key -> every rung of that ladder group known to exist (from `ladder` itself), sorted
	// ascending by rate. A candidate id absent from `ladder` gets a synthetic singleton group keyed
	// by its own id, so it can never collide with a real group.
	const groupRungs = new Map<string, string[]>();
	for (const id in ladder) {
		const g = ladder[id].group;
		const list = groupRungs.get(g);
		if (list) list.push(id);
		else groupRungs.set(g, [id]);
	}
	for (const rungs of groupRungs.values()) {
		rungs.sort((a, b) => ladder[a].rate - ladder[b].rate);
	}

	const cost = (id: string) => discountedCost(costs[id] ?? 0, hints[id] ?? 0);

	const groupOrder: string[] = [];
	const candidatesByGroup = new Map<string, OptimizerCandidate[]>();

	for (const c of candidates) {
		const rung = ladder[c.id];
		const key = rung ? `g:${rung.group}` : `s:${c.id}`;
		if (!candidatesByGroup.has(key)) {
			candidatesByGroup.set(key, []);
			groupOrder.push(key);
		}
		candidatesByGroup.get(key)?.push(c);
	}

	const groups: Group[] = [];
	for (const key of groupOrder) {
		const groupCandidates = candidatesByGroup.get(key) ?? [];
		const tiers: Tier[] = [];
		for (const c of groupCandidates) {
			if (isOwned(c.id)) continue; // owned rungs are never terminal tiers
			if (c.gain <= 0) continue; // step 3: drop non-positive-gain tiers
			const rung = ladder[c.id];
			let rungsToBuy: string[];
			if (rung) {
				const allRungs = groupRungs.get(rung.group) ?? [c.id];
				rungsToBuy = allRungs.filter(
					(id) => ladder[id].rate <= rung.rate && !isOwned(id),
				);
			} else {
				rungsToBuy = [c.id];
			}
			const totalCost = rungsToBuy.reduce((sum, id) => sum + cost(id), 0);
			tiers.push({ skillIds: rungsToBuy, cost: totalCost, gain: c.gain });
		}
		const maxTierGain = tiers.reduce((m, t) => Math.max(m, t.gain), 0);
		groups.push({ tiers, maxTierGain });
	}
	return groups;
}

// Symmetric difference size of two skillId sets (as arrays).
function symmetricDiffSize(a: string[], b: string[]): number {
	const setA = new Set(a);
	const setB = new Set(b);
	let diff = 0;
	for (const id of setA) if (!setB.has(id)) diff++;
	for (const id of setB) if (!setA.has(id)) diff++;
	return diff;
}

// See the module comment and the calling plan's algorithm spec for the full design. Summary:
// group candidates into upgrade ladders, enumerate every budget-feasible combination of "buy one
// tier (or nothing) per group" via DFS (bounded only by budget and a defensive node ceiling -- no
// cross-tier dominance pruning, since a dominated tier can still be the correct #2/#3 pick under
// the diversity rule below), then post-select up to topK results ordered by (totalGain desc,
// totalCost asc) such that every accepted result differs from every other accepted result by at
// least 2 skillIds (a single one-skill swap is fine; a strict superset that only adds one skill is
// not diverse enough and is skipped in favor of the next-best option that does qualify).
export function optimizePurchases(input: OptimizerInput): PurchaseSet[] {
	const topK = input.topK ?? 3;
	const groups = buildGroups(input);

	// DFS walks groups ordered by descending max tier gain (a stable, meaningful order -- doesn't
	// affect correctness since this DFS enumerates ALL budget-feasible combinations rather than
	// pruning by a gain bound; see the module doc for why a gain-based (kthBestGain) prune is
	// unsound for a topK>1, diversity-selecting post-pass).
	const orderedGroups = groups
		.map((g, idx) => ({ g, idx }))
		.sort((a, b) => b.g.maxTierGain - a.g.maxTierGain);

	const results: { skillIds: string[]; cost: number; gain: number }[] = [];
	let nodeVisits = 0;
	let ceilingHit = false;

	function dfs(
		i: number,
		runningCost: number,
		runningGain: number,
		chosenIds: string[][],
	) {
		if (ceilingHit) return;
		nodeVisits++;
		if (nodeVisits > NODE_CEILING) {
			ceilingHit = true;
			return;
		}
		if (i === orderedGroups.length) {
			results.push({
				skillIds: ([] as string[]).concat(...chosenIds),
				cost: runningCost,
				gain: runningGain,
			});
			return;
		}
		if (runningCost > input.budget) return;
		const { tiers } = orderedGroups[i].g;
		// "buy nothing" branch
		dfs(i + 1, runningCost, runningGain, chosenIds);
		if (ceilingHit) return;
		for (const tier of tiers) {
			const newCost = runningCost + tier.cost;
			if (newCost > input.budget) continue;
			chosenIds.push(tier.skillIds);
			dfs(i + 1, newCost, runningGain + tier.gain, chosenIds);
			chosenIds.pop();
			if (ceilingHit) return;
		}
	}

	dfs(0, 0, 0, []);

	// dfs walked orderedGroups (sorted by descending max tier gain), not candidate-encounter order,
	// so restore the spec's required skillIds ordering (step 7: candidate-encounter group order,
	// ascending by rate within a group) as a post-pass keyed off each rung's original group index.
	const originalIndexOf = new Map<string, number>();
	groups.forEach((g, origIdx) => {
		for (const t of g.tiers)
			for (const id of t.skillIds) originalIndexOf.set(id, origIdx);
	});
	for (const r of results) {
		r.skillIds.sort((a, b) => {
			const ga = originalIndexOf.get(a) ?? -1;
			const gb = originalIndexOf.get(b) ?? -1;
			if (ga !== gb) return ga - gb;
			const ra = input.ladder[a]?.rate ?? 0;
			const rb = input.ladder[b]?.rate ?? 0;
			return ra - rb;
		});
	}

	// Post-select: sort by (gain desc, cost asc), then greedily accept results whose symmetric
	// difference from every already-accepted result is >= 2, until topK are held. The empty set is
	// always a valid candidate (gain 0, cost 0) and is included in `results` via the all-"buy
	// nothing" DFS path, so no separate seeding step is needed -- but guarantee it's present in
	// case every group is unreachable within budget (shouldn't happen given "buy nothing" is always
	// explored first, but keep the invariant explicit).
	if (!results.some((r) => r.skillIds.length === 0)) {
		results.push({ skillIds: [], cost: 0, gain: 0 });
	}
	results.sort((a, b) => {
		if (a.gain !== b.gain) return b.gain - a.gain;
		return a.cost - b.cost;
	});

	const accepted: PurchaseSet[] = [];
	for (const r of results) {
		if (accepted.length >= topK) break;
		const diverseFromAll = accepted.every(
			(acc) => symmetricDiffSize(acc.skillIds, r.skillIds) >= 2,
		);
		if (accepted.length === 0 || diverseFromAll) {
			accepted.push({
				skillIds: r.skillIds,
				totalCost: r.cost,
				totalGain: r.gain,
			});
		}
	}
	return accepted;
}

// Parses a persisted shop-hint-level map. On any parse failure, or if the top-level value isn't a
// plain object, returns {}. Kept entries: string keys whose value is a finite number, clamped to
// an integer in [0, 5]. A clamped-to-0 entry is kept explicitly rather than dropped -- harmless
// (absent and 0 behave identically everywhere else in this module) and keeps this function a
// straightforward per-entry map/filter rather than adding a second "was it originally 0" branch.
export function loadShopSkillHints(raw: string | null): HintLevels {
	if (raw == null) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return {};
	}
	const result: HintLevels = {};
	for (const key in parsed as Record<string, unknown>) {
		const value = (parsed as Record<string, unknown>)[key];
		if (typeof value !== 'number' || !Number.isFinite(value)) continue;
		result[key] = Math.min(5, Math.max(0, Math.round(value)));
	}
	return result;
}

// Restricts `hints` to just the ids in `keepIds`. Returns the SAME object reference when nothing
// would actually be dropped, so callers can use reference equality to bail out of a useEffect
// rather than re-running on a value-equal-but-newly-allocated object every render.
export function pruneHints(hints: HintLevels, keepIds: string[]): HintLevels {
	const keep = new Set(keepIds);
	let anyDropped = false;
	for (const id in hints) {
		if (!keep.has(id)) {
			anyDropped = true;
			break;
		}
	}
	if (!anyDropped) return hints;
	const result: HintLevels = {};
	for (const id in hints) {
		if (keep.has(id)) result[id] = hints[id];
	}
	return result;
}
