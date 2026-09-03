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
//
// UI-33: also hosts findBestValue, the chart-wide "which single skill gives the most length per
// SP spent" badge computation -- a different question from optimizePurchases' budget-constrained
// knapsack, but built on the same discountedCost/ladder-chain-cost primitives.

import { type LadderIndex, prerequisitesOf } from './shopSkillFilter.ts';

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

// UI-33: the Skill Chart's "Best value" badge -- the single candidate with the highest
// length-gain-per-SP ratio, chart-wide (not shortlist-scoped like optimizePurchases above).
export interface BestValue {
	id: string;
	gain: number;
	cost: number; // full chain cost-to-reach (self + unowned cheaper rungs), discounted
	chainIds: string[]; // unowned prerequisite rungs included in cost (empty for a singleton/white)
	ratio: number; // gain / cost, lengths per SP
}

// Picks the candidate with the best length-per-SP ratio, or null if none qualify.
//
// The caller is expected to have already dropped muted (screened/inert/pending) rows before this
// runs -- unlike optimizePurchases, this scans the whole chart (~500+ rows, not a small
// shortlist), so an early-round noisy mean must not win an unprompted "best in the whole chart"
// claim.
//
// A candidate with gain <= 0 is skipped outright. Cost is the FULL chain cost to reach the skill:
// its own discounted cost plus every unowned cheaper rung in its ladder group (prerequisitesOf,
// excludes the rung itself), matching optimizePurchases/buildGroups' chain-cost semantics -- a
// gold (◎) rung can't be bought without its white prerequisite, so the badge's "SP spent" number
// has to include that prerequisite's cost too, not just the gold rung's own price. A candidate
// with cost <= 0 is also skipped: 13 rarity<3 JP skills (and some Global ones) have baseCost: 0 in
// skill_meta.json, which would otherwise divide by zero or produce an infinite/undefined ratio --
// excluding them (no badge, rather than an infinite-ratio "best") is the deliberate call here, not
// an oversight.
//
// Ties break by (ratio desc, cost asc, id asc) so the result is deterministic across re-renders.
export function findBestValue(
	candidates: OptimizerCandidate[],
	hints: HintLevels,
	ladder: LadderIndex,
	costs: CostLookup,
	owned: Set<string>,
): BestValue | null {
	let best: BestValue | null = null;
	for (const candidate of candidates) {
		if (candidate.gain <= 0) continue;
		const chainIds = prerequisitesOf(candidate.id, ladder).filter(
			(id) => !owned.has(id),
		);
		const ownCost = discountedCost(
			costs[candidate.id] ?? 0,
			hints[candidate.id] ?? 0,
		);
		const chainCost = chainIds.reduce(
			(sum, id) => sum + discountedCost(costs[id] ?? 0, hints[id] ?? 0),
			0,
		);
		const cost = ownCost + chainCost;
		if (cost <= 0) continue;
		const ratio = candidate.gain / cost;
		const isBetter =
			best === null ||
			ratio > best.ratio ||
			(ratio === best.ratio &&
				(cost < best.cost || (cost === best.cost && candidate.id < best.id)));
		if (isBetter) {
			best = { id: candidate.id, gain: candidate.gain, cost, chainIds, ratio };
		}
	}
	return best;
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

export interface OptimizerResult {
	options: PurchaseSet[];
	// True when the DFS hit NODE_CEILING and stopped early -- `options` is then a best-effort
	// selection over what was enumerated, not a guaranteed optimum. Callers should say so.
	truncated: boolean;
}

// Defensive ceiling on DFS node visits (one visit per group-choice made), so a pathological input
// (many groups, each with several tiers) degrades to "best effort within the ceiling" rather than
// hanging or throwing. This IS reachable at real (if extreme) scale -- ~25 singleton-group
// shortlist skills with a budget big enough to afford most combinations is 2^25 leaves -- which is
// why hitting it is surfaced as `truncated` on the result (the Buy list card shows a note) rather
// than silently returning a possibly-non-optimal top-K as if it were complete.
const NODE_CEILING = 20_000_000;

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
				// Deliberately re-derives the rung chain from `ladder` rather than reusing
				// shopSkillFilter.ts's prerequisitesOf: this needs the INCLUSIVE chain (the terminal
				// rung itself), the isOwned filter, and the prebuilt groupRungs index, so the reuse
				// would be a wrapper, not a simplification. The `rate >= 1` guard mirrors
				// prerequisitesOf's own: inert for app.tsx's SKILL_LADDER (which never contains
				// rate < 1), but this function accepts an arbitrary LadderIndex.
				const allRungs = groupRungs.get(rung.group) ?? [c.id];
				rungsToBuy = allRungs.filter(
					(id) =>
						ladder[id].rate >= 1 &&
						ladder[id].rate <= rung.rate &&
						!isOwned(id),
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
export function optimizePurchases(input: OptimizerInput): OptimizerResult {
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
	return { options: accepted, truncated: ceilingHit };
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

// UI-16 follow-up (shared ○/◎ hints): a hint is earned per-SKILL in game, not per-rung -- it
// discounts both a ○ rung and its ◎ upgrade. Gold rungs (and any rung of a different rarity) get
// their own hint. Cluster key: `${groupId}:${rarity}` when both are known for an id (same ladder
// group AND same rarity -- verified zero-collision on both datasets, see the ADR amendment and
// docs/statistical-analysis.md); an id absent from the ladder or the rarity lookup keeps its own
// id as its cluster key, so it never accidentally collides with a real `group:rarity` pair (all
// ids and groupIds are all-digit, so a bare id can never contain the ':' a cluster key requires).
export type HintClusters = { [skillId: string]: string };

export function buildHintClusters(
	ladder: LadderIndex,
	rarities: { [id: string]: number },
): HintClusters {
	const clusters: HintClusters = {};
	const ids = new Set<string>([
		...Object.keys(ladder),
		...Object.keys(rarities),
	]);
	for (const id of ids) {
		const rung = ladder[id];
		const rarity = rarities[id];
		clusters[id] =
			rung != null && rarity != null ? `${rung.group}:${rarity}` : id;
	}
	return clusters;
}

// Expands a cluster-keyed hint map (what's actually persisted/edited) into a per-id map for
// optimizePurchases, which still charges every rung independently via `hints[id] ?? 0`
// (buildGroups above). Iterates `clusterHints` (not `clusters`) so a key with no cluster members
// still survives. Note the ids this fallback actually serves: non-ladder skills with a known
// rarity (e.g. shop-eligible rarity-6 pinks) ARE indexed by buildHintClusters as self-keyed
// singletons and go through the normal members path -- the fallback branch exists for a stored
// hint keyed by an id buildHintClusters never saw at all (e.g. a stale localStorage entry for a
// skill since removed from the data). Silently dropping such a key would lose a user's hint.
export function expandHints(
	clusterHints: HintLevels,
	clusters: HintClusters,
): HintLevels {
	const membersOf = new Map<string, string[]>();
	for (const id in clusters) {
		const key = clusters[id];
		const list = membersOf.get(key);
		if (list) list.push(id);
		else membersOf.set(key, [id]);
	}
	const out: HintLevels = {};
	for (const key in clusterHints) {
		const level = clusterHints[key];
		const members = membersOf.get(key);
		if (members && members.length > 0) {
			for (const id of members) out[id] = level;
		} else {
			// Bare key with no cluster membership -- an id buildHintClusters never indexed (see the
			// doc comment above). The key itself IS the skill id here.
			out[key] = level;
		}
	}
	return out;
}

// Migrates/normalizes a persisted hint map from the old per-id scheme to the new cluster-keyed
// one, and is idempotent so it's safe to run on already-migrated data too: each key k maps to
// clusters[k] ?? k (an already-cluster key -- one containing ':' -- is never itself a value in
// `clusters`, since no id or groupId ever contains ':', so it passes straight through
// unmodified). On collision (two old per-id keys landing on the same cluster, e.g. a ○/◎ pair
// that both had their own stored hint) the max level wins, matching how a player only ever earns
// the higher of the levels they'd have entered separately.
export function remapHintKeys(
	hints: HintLevels,
	clusters: HintClusters,
): HintLevels {
	const out: HintLevels = {};
	for (const key in hints) {
		const mapped = clusters[key] ?? key;
		out[mapped] =
			mapped in out ? Math.max(out[mapped], hints[key]) : hints[key];
	}
	return out;
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
