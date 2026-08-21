import { fromJS, Map as ImmMap } from 'immutable';

// tsconfig has no "webworker" lib, so TS resolves postMessage against Window's
// (message, targetOrigin?, transfer?) overload instead of a worker global scope's
// (message, transfer?) -- this is the single, documented cast point for that gap.
const post: (message: any, transfer?: Transferable[]) => void =
	postMessage as any;

import { HorseState } from '../components/HorseDefTypes';
import skillmeta from '../skill_meta.json';
import type { CourseData } from '../uma-skill-tools/CourseData';
import type { RaceParameters } from '../uma-skill-tools/RaceParameters';
import {
	type ChartRunTrace,
	type ComparisonBlockOutput,
	runComparison,
	runComparisonBlock,
} from './compare';

function buildHorseState(raw: any): HorseState {
	return new HorseState(raw)
		.set('skills', fromJS(raw.skills))
		.set('forcedSkillPositions', ImmMap(raw.forcedSkillPositions || {}));
}

// Replaces whatever's already equipped in `id`'s skill group (if any) with `id` itself -- the
// same "swap the candidate into its group, leave everything else the uma already owns alone"
// rule the chart has always used.
function buildCandidateSkills(uma: HorseState, id: string): HorseState {
	const groupId = (skillmeta as any)[id]?.groupId;
	let skillsToUse = uma.skills;
	if (groupId) {
		skillsToUse = skillsToUse.filter(
			(existingId: string) =>
				(skillmeta as any)[existingId]?.groupId !== groupId,
		);
	}
	return uma.set('skills', skillsToUse.set(groupId, id as any));
}

// --- Skill Chart: adaptive-round batches ---
//
// One 'chart-batch' request covers a slice of one round's candidate skill list, all sharing the
// same (blockSeed, blockSize) -- see chartLadder.ts for why a round's scenarios are a disjoint,
// reproducible block rather than an arbitrary continuation of the previous round's. Results
// stream back in small chunks (chart-batch-chunk) as they're computed, rather than one message at
// the end, so the table can populate progressively during a round instead of sitting empty for
// however long the whole batch takes.

const CHUNK_ROWS = 32;
const CHUNK_MS = 200;

interface ChartBatchRow {
	id: string;
	lengths: Float32Array;
	times: Float32Array;
	procCounts: Uint16Array;
	procPositions: Float32Array;
}

function runChartBatch(data: {
	jobId: number;
	round: number;
	batchId: number;
	blockSeed: number;
	blockSize: number;
	skillIds: string[];
	course: CourseData;
	racedef: RaceParameters;
	uma: any;
	pacer: any;
	analysisOptions: any;
}) {
	const {
		jobId,
		round,
		batchId,
		blockSeed,
		blockSize,
		skillIds,
		course,
		racedef,
		uma,
		pacer,
		analysisOptions,
	} = data;

	const uma_ = buildHorseState(uma);
	const pacer_ = pacer ? buildHorseState(pacer) : null;
	const startTime = performance.now();

	let pending: ChartBatchRow[] = [];
	let lastFlush = startTime;

	const flush = () => {
		if (pending.length === 0) return;
		const transfer: Transferable[] = [];
		for (const row of pending) {
			transfer.push(
				row.lengths.buffer,
				row.times.buffer,
				row.procCounts.buffer,
				row.procPositions.buffer,
			);
		}
		post(
			{ type: 'chart-batch-chunk', jobId, round, batchId, rows: pending },
			transfer,
		);
		pending = [];
		lastFlush = performance.now();
	};

	for (const id of skillIds) {
		try {
			const withSkill = buildCandidateSkills(uma_, id);
			const result: ComparisonBlockOutput = runComparisonBlock(
				{ seed: blockSeed, size: blockSize },
				course,
				racedef,
				uma_,
				withSkill,
				pacer_,
				{ ...analysisOptions, traceMode: 'none', trackedSkillIds: [id] },
			);
			pending.push({
				id,
				lengths: result.lengths,
				times: result.times,
				procCounts: result.procCounts,
				procPositions: result.procPositions,
			});
		} catch (e) {
			post({
				type: 'chart-error',
				jobId,
				skillId: id,
				message: e instanceof Error ? e.message : String(e),
			});
			continue;
		}

		const now = performance.now();
		if (pending.length >= CHUNK_ROWS || now - lastFlush >= CHUNK_MS) {
			flush();
		}
	}
	flush();

	post({
		type: 'chart-batch-done',
		jobId,
		round,
		batchId,
		elapsedMs: performance.now() - startTime,
		scenariosRun: skillIds.length * blockSize,
	});
}

// --- Skill Chart: on-demand detail fetch for an expanded row ---
//
// The main thread already knows, from the accumulated lengths it's received via chart-batch-chunk,
// exactly which sample indices are the min/max/closest-to-mean/median for a given skill, and which
// (blockSeed, blockSize) block each came from. Re-simulating just those few indices (deterministic,
// same seed) is cheaper and simpler than retaining or streaming full per-tick traces for every row
// up front -- see compare.ts's runComparisonBlock() and its `only` parameter.

interface DetailPick {
	label: string;
	blockSeed: number;
	blockSize: number;
	index: number;
}

function runChartDetail(data: {
	jobId: number;
	requestId: number;
	skillId: string;
	picks: DetailPick[];
	course: CourseData;
	racedef: RaceParameters;
	uma: any;
	pacer: any;
	analysisOptions: any;
}) {
	const {
		jobId,
		requestId,
		skillId,
		picks,
		course,
		racedef,
		uma,
		pacer,
		analysisOptions,
	} = data;

	const uma_ = buildHorseState(uma);
	const pacer_ = pacer ? buildHorseState(pacer) : null;
	const withSkill = buildCandidateSkills(uma_, skillId);

	// Group picks sharing a (blockSeed, blockSize) into one runComparisonBlock call -- a detail
	// fetch is at most 4 picks, almost always from the same round's block, so this is normally one
	// call, not four.
	const groups = new Map<
		string,
		{
			blockSeed: number;
			blockSize: number;
			indices: Set<number>;
			labels: Map<number, string>;
		}
	>();
	for (const pick of picks) {
		const key = `${pick.blockSeed}:${pick.blockSize}`;
		let g = groups.get(key);
		if (!g) {
			g = {
				blockSeed: pick.blockSeed,
				blockSize: pick.blockSize,
				indices: new Set(),
				labels: new Map(),
			};
			groups.set(key, g);
		}
		g.indices.add(pick.index);
		g.labels.set(pick.index, pick.label);
	}

	const runs: Record<string, ChartRunTrace> = {};
	for (const g of groups.values()) {
		const result = runComparisonBlock(
			{ seed: g.blockSeed, size: g.blockSize, only: g.indices },
			course,
			racedef,
			uma_,
			withSkill,
			pacer_,
			{ ...analysisOptions, traceMode: 'indices', trackedSkillIds: [skillId] },
		);
		result.traces?.forEach((trace, idx) => {
			const label = g.labels.get(idx);
			if (label) runs[label] = trace;
		});
	}

	post({ type: 'chart-detail', jobId, requestId, skillId, runs });
}

// --- Compare mode: unchanged from before this rewrite ---

function runCompare({
	nsamples,
	course,
	racedef,
	uma1,
	uma2,
	pacer,
	options,
}: any) {
	const uma1_ = buildHorseState(uma1);
	const uma2_ = buildHorseState(uma2);
	const pacer_ = pacer ? buildHorseState(pacer) : null;
	const compareOptions = { ...options, mode: 'compare' };
	let results: any;
	for (
		let n = Math.min(20, nsamples), mul = 6;
		n < nsamples;
		n = Math.min(n * mul, nsamples), mul = Math.max(mul - 1, 2)
	) {
		results = runComparison(
			n,
			course,
			racedef,
			uma1_,
			uma2_,
			pacer_,
			compareOptions,
		);
		post({ type: 'compare', results });
	}
	results = runComparison(
		nsamples,
		course,
		racedef,
		uma1_,
		uma2_,
		pacer_,
		compareOptions,
	);
	post({ type: 'compare', results });
	post({ type: 'compare-complete' });
}

self.addEventListener('message', (e: MessageEvent) => {
	const { msg, data } = e.data;
	switch (msg) {
		case 'chart-batch':
			runChartBatch(data);
			break;
		case 'chart-detail':
			runChartDetail(data);
			break;
		case 'compare':
			runCompare(data);
			break;
	}
});
