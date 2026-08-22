import { computePosition, flip } from '@floating-ui/dom';
import * as d3 from 'd3';
import { Map as ImmMap, Set as ImmSet, Record } from 'immutable';
import {
	Camera,
	Clipboard,
	Copy,
	Download,
	RotateCcw,
	Save,
	Settings,
	Trash2,
	TriangleAlert,
	Upload,
} from 'lucide-preact';
import { Fragment, h, render } from 'preact';
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useReducer,
	useRef,
	useState,
} from 'preact/hooks';
import { IntlProvider, Text } from 'preact-i18n';
import { HorseDef, horseDefTabs, isGeneralSkill } from '../components/HorseDef';
import { HorseState, SkillSet } from '../components/HorseDefTypes';
import {
	Language,
	LanguageSelect,
	useLanguageSelect,
} from '../components/Language';
import {
	RaceTrack,
	RegionDisplayType,
	TrackSelect,
} from '../components/RaceTrack';
import {
	ExpandedSkillDetails,
	STRINGS_en as SKILL_STRINGS_en,
} from '../components/SkillList';
import skillmeta from '../skill_meta.json';
import { TRACKNAMES_en, TRACKNAMES_ja } from '../strings/common';
import { type CourseData, CourseHelpers } from '../uma-skill-tools/CourseData';
import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillnames from '../uma-skill-tools/data/skillnames.json';
import type { GameHpPolicy } from '../uma-skill-tools/HpPolicy';
import {
	Grade,
	GroundCondition,
	type Mood,
	type RaceParameters,
	Season,
	Time,
	Weather,
} from '../uma-skill-tools/RaceParameters';
import { PosKeepMode, RaceState } from '../uma-skill-tools/RaceSolver';
import { deriveSeed } from '../uma-skill-tools/Random';
import umas from '../umas.json';
import {
	BasinnChart,
	getActivateableSkills,
	isPurpleSkill,
} from './BasinnChart';
import {
	type AnalysisPresetName,
	CHART_LADDERS,
	type ChartRow,
	candidateFromAccumulator,
	type EliminationReason,
	evaluateRound,
	type LadderPreset,
	type RoundCandidate,
	roundBlockSeed,
	SkillAccumulator,
	type SkillStatus,
} from './chartLadder';
import type { ChartRunTrace } from './compare';
import { InfoModal } from './components/InfoModal';
import { OCRModal } from './components/OCRModal';
import { type CompareResults, ResultsPane } from './components/ResultsPane';
import { LIMITATIONS } from './components/simNotes';
import { UmasTab, UmasTabProps } from './components/UmasTab';
import { IntroText } from './IntroText';
import { type DecodedUma, decodeRoster } from './rosterDecoder';
import { summarizeLengths } from './statisticalAnalysis';
import {
	copyHorseToClipboard,
	deleteHorseSlot,
	downloadHorseJson,
	getSavedSlotNames,
	importHorseJson,
	loadHorseSlot,
	pasteHorseFromClipboard,
	saveHorseSlot,
	type UmaState,
} from './storage';
import { initTelemetry, postEvent } from './telemetry';
import { Dropdown } from './ui-components/Dropdown';
import { createWorkerPool, type WorkerPool } from './workerPool';

import './app.css';
import './components/OCRModal.css';

// A detail-fetch response's runs are keyed by label ('minrun' etc), each a ChartRunTrace -- but
// treated as loosely as the rest of this component treats runData, since it flows straight into
// the same untyped `runData` shape Compare mode already uses (see updateResultsState).
type ChartRunTraceLike = ChartRunTrace;

interface OutstandingBatch {
	skillIds: string[];
	// 'round' batches are part of the ladder's normal round lifecycle and drive finishRound()
	// once the round's queue and every outstanding 'round' batch are empty. 'refine' batches (see
	// refineSkill) are a one-off top-up for a single already-finalized row and must not trigger
	// that round-completion logic.
	kind: 'round' | 'refine';
}

// Everything a running (or just-finished) Skill Chart needs, held in a ref (see chartRunRef)
// because it's mutated many times per second while results stream in -- see the pool message
// handler below. Stays populated after the ladder finishes (isSimulationRunning going false does
// not clear it) so a finished chart's rows can still be expanded (requestChartDetail) or refined
// (refineSkill); only starting a new run (doBasinnChart) or an explicit Stop replaces it.
interface ChartRunState {
	jobId: number;
	preset: LadderPreset;
	course: CourseData;
	racedef: RaceParameters;
	uma: any;
	pacer: any;
	analysisOptions: any;
	baseSeed: number;
	roundIndex: number;
	// Skills entering the CURRENT round; fixed at the start of the round, used by finishRound()
	// to know exactly which candidates evaluateRound() should judge (not every skill ever seen --
	// those already screened/inert/final in an earlier round must not be re-evaluated).
	roundParticipants: string[];
	queue: string[]; // roundParticipants not yet dispatched this round
	completedThisRound: number;
	outstanding: Map<number, OutstandingBatch>;
	nextBatchId: number;
	accumulators: Map<string, SkillAccumulator>;
	// Cached final ChartRow for any skill whose status has stopped changing (screened/inert/final)
	// -- see finalizeRow().
	finalizedRows: Map<string, ChartRow>;
	// How many Refine top-ups each skill has received, keyed by skill id -- each refine draws a
	// fresh block at ladder-round-index (preset.rounds.length + this count), so repeated refines
	// of the same skill never reuse a scenario block.
	refineCounts: Map<string, number>;
}

// Worst-case total paired-scenario count for a chart run at this preset and starting skill count
// -- the pool only shrinks (via each round's cap), so this is an upper bound, not a prediction;
// actual runs are usually well under it once the CI-elimination rule (chartLadder.ts) also prunes
// skills a round's cap alone wouldn't have. Used only for the pre-run runtime estimate.
function estimateWorstCaseScenarios(
	preset: LadderPreset,
	skillCount: number,
): number {
	let total = 0;
	let pool = skillCount;
	let prevN = 0;
	for (const round of preset.rounds) {
		const blockSize = round.n - prevN;
		total += pool * blockSize;
		pool = Number.isFinite(round.cap) ? Math.min(pool, round.cap) : pool;
		prevN = round.n;
	}
	return total;
}

function formatEstimatedRuntime(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return '?';
	const s = ms / 1000;
	if (s < 60) return `${Math.max(1, Math.round(s))}s`;
	return `${Math.round(s / 60)}m`;
}

const DEFAULT_SAMPLES = 500;
const DEFAULT_SEED = 2615953739;

const MOBILE_BREAKPOINT = 768;

function useMobile() {
	const [isMobile, setIsMobile] = useState(
		() =>
			typeof window !== 'undefined' &&
			window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches,
	);
	useEffect(() => {
		const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
		const handler = () => setIsMobile(mq.matches);
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, []);
	return isMobile;
}

class RaceParams extends Record({
	mood: 2 as Mood,
	ground: GroundCondition.Good,
	weather: Weather.Sunny,
	season: Season.Spring,
	time: Time.Midday,
	grade: Grade.G1,
}) {}

enum EventType {
	CM,
	LOH,
}

const presets = (
	CC_GLOBAL
		? [
				// ids 19-24: dates are estimated (upstream's own list doesn't reach these yet) - course/conditions
				// come from JP's original 2022-2023 debut run of each cup (Global's 2nd zodiac lap replays JP's
				// historical back-catalog, not JP's current rotation)
				{
					id: 24,
					type: EventType.CM,
					name: 'Aries Cup 2',
					date: '2026-12-29' /* estimated date */,
					courseId: 10811,
					season: Season.Spring,
					ground: GroundCondition.Firm,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 23,
					type: EventType.CM,
					name: 'Pisces Cup 2',
					date: '2026-12-08' /* estimated date */,
					courseId: 10504,
					season: Season.Spring,
					ground: GroundCondition.Firm,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 22,
					type: EventType.CM,
					name: 'Aquarius Cup 2',
					date: '2026-11-17' /* estimated date */,
					courseId: 10611,
					season: Season.Winter,
					ground: GroundCondition.Soft,
					weather: Weather.Snowy,
					time: Time.Midday,
				},
				{
					id: 21,
					type: EventType.CM,
					name: 'Capricorn Cup 2',
					date: '2026-10-27' /* estimated date */,
					courseId: 10701,
					season: Season.Winter,
					ground: GroundCondition.Firm,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 20,
					type: EventType.CM,
					name: 'Sagittarius Cup 2',
					date: '2026-10-06' /* estimated date */,
					courseId: 10506,
					season: Season.Winter,
					ground: GroundCondition.Good,
					weather: Weather.Cloudy,
					time: Time.Midday,
				},
				{
					id: 19,
					type: EventType.CM,
					name: 'Scorpio Cup 2',
					date: '2026-09-15' /* estimated date */,
					courseId: 10808,
					season: Season.Autumn,
					ground: GroundCondition.Firm,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 18,
					type: EventType.CM,
					name: 'Libra Cup 2',
					date: '2026-08-25',
					courseId: 10903,
					season: Season.Autumn,
					ground: GroundCondition.Good,
					weather: Weather.Cloudy,
					time: Time.Midday,
				},
				{
					id: 17,
					type: EventType.CM,
					name: 'Virgo Cup 2',
					date: '2026-08-05',
					courseId: 11103,
					season: Season.Autumn,
					ground: GroundCondition.Yielding,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 16,
					type: EventType.CM,
					name: 'Leo Cup 2',
					date: '2026-07-25',
					courseId: 10501,
					season: Season.Summer,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 15,
					type: EventType.CM,
					name: 'Cancer Cup 2',
					date: '2026-06-24',
					courseId: 10906,
					season: Season.Summer,
					ground: GroundCondition.Yielding,
					weather: Weather.Cloudy,
					time: Time.Midday,
				},
				{
					id: 14,
					type: EventType.CM,
					name: 'Gemini Cup 2',
					date: '2026-06-04',
					courseId: 10602,
					season: Season.Spring,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 13,
					type: EventType.CM,
					name: 'Taurus Cup 2',
					date: '2026-05-10',
					courseId: 10606,
					season: Season.Spring,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 12,
					type: EventType.CM,
					name: 'Aries Cup',
					date: '2026-04-23',
					courseId: 10504,
					season: Season.Spring,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 11,
					type: EventType.CM,
					name: 'Pisces Cup',
					date: '2026-03',
					courseId: 10914,
					season: Season.Spring,
					ground: GroundCondition.Heavy,
					weather: Weather.Rainy,
					time: Time.Midday,
				},
				{
					id: 10,
					type: EventType.CM,
					name: 'Aquarius Cup',
					date: '2026-02',
					courseId: 10611,
					season: Season.Winter,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 9,
					type: EventType.CM,
					name: 'Capricorn Cup',
					date: '2026-02',
					courseId: 10701,
					season: Season.Winter,
					ground: GroundCondition.Soft,
					weather: Weather.Snowy,
					time: Time.Midday,
				},
				{
					id: 8,
					type: EventType.CM,
					name: 'Sagittarius Cup',
					date: '2026-01',
					courseId: 10506,
					season: Season.Winter,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 7,
					type: EventType.CM,
					name: 'Scorpio Cup',
					date: '2026-01',
					courseId: 10604,
					season: Season.Autumn,
					ground: GroundCondition.Soft,
					weather: Weather.Rainy,
					time: Time.Midday,
				},
				{
					id: 6,
					type: EventType.CM,
					name: 'Libra Cup',
					date: '2025-12',
					courseId: 10810,
					season: Season.Autumn,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 5,
					type: EventType.CM,
					name: 'Virgo Cup',
					date: '2025-11-20',
					courseId: 10903,
					season: Season.Autumn,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 4,
					type: EventType.CM,
					name: 'Leo Cup',
					date: '2025-10-30',
					courseId: 10906,
					season: Season.Summer,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 3,
					type: EventType.CM,
					name: 'Cancer Cup',
					date: '2025-10-07',
					courseId: 10602,
					season: Season.Summer,
					ground: GroundCondition.Yielding,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 2,
					type: EventType.CM,
					name: 'Gemini Cup',
					date: '2025-09',
					courseId: 10811,
					season: Season.Spring,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					id: 1,
					type: EventType.CM,
					name: 'Taurus Cup',
					date: '2025-08',
					courseId: 10606,
					season: Season.Spring,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
			]
		: [
				{
					type: EventType.LOH,
					date: '2026-02',
					courseId: 10602,
					season: Season.Winter,
					time: Time.Midday,
				},
				{
					type: EventType.CM,
					date: '2026-01',
					courseId: 10506,
					season: Season.Winter,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					type: EventType.CM,
					date: '2025-12-21',
					courseId: 10903,
					season: Season.Winter,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					type: EventType.LOH,
					date: '2025-11',
					courseId: 11502,
					season: Season.Autumn,
					time: Time.Midday,
				},
				{
					type: EventType.CM,
					date: '2025-10',
					courseId: 10302,
					season: Season.Autumn,
					ground: GroundCondition.Good,
					weather: Weather.Cloudy,
					time: Time.Midday,
				},
				{
					type: EventType.CM,
					date: '2025-09-22',
					courseId: 10807,
					season: Season.Autumn,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					time: Time.Midday,
				},
				{
					type: EventType.LOH,
					date: '2025-08',
					courseId: 10105,
					season: Season.Summer,
					Time: Time.Midday,
				},
				{
					type: EventType.CM,
					date: '2025-07-25',
					courseId: 10906,
					ground: GroundCondition.Yielding,
					weather: Weather.Cloudy,
					season: Season.Summer,
					time: Time.Midday,
				},
				{
					type: EventType.CM,
					date: '2025-06-21',
					courseId: 10606,
					ground: GroundCondition.Good,
					weather: Weather.Sunny,
					season: Season.Spring,
					time: Time.Midday,
				},
			]
)
	.map((def) => ({
		id: def.id,
		name: def.name,
		type: def.type,
		date: new Date(def.date),
		courseId: def.courseId,
		racedef: new RaceParams({
			mood: 2 as Mood,
			ground: def.type == EventType.CM ? def.ground : GroundCondition.Good,
			weather: def.type == EventType.CM ? def.weather : Weather.Sunny,
			season: def.season,
			time: def.time,
			grade: Grade.G1,
		}),
	}))
	.sort((a, b) => +b.date - +a.date);

const DEFAULT_PRESET =
	presets[
		Math.max(
			presets.findIndex(
				(
					(now) => (p) =>
						new Date(p.date.getFullYear(), p.date.getUTCMonth() + 1, 0) < now
				)(new Date()),
			) - 1,
			0,
		)
	];
const DEFAULT_COURSE_ID = DEFAULT_PRESET.courseId;

const UI_ja = Object.freeze({
	stats: Object.freeze([
		'なし',
		'スピード',
		'スタミナ',
		'パワー',
		'根性',
		'賢さ',
	]),
	joiner: '、',
});

const UI_en = Object.freeze({
	stats: Object.freeze(['None', 'Speed', 'Stamina', 'Power', 'Guts', 'Wisdom']),
	joiner: ', ',
});

const UI_global = Object.freeze({
	stats: Object.freeze(['None', 'Speed', 'Stamina', 'Power', 'Guts', 'Wit']),
	joiner: ', ',
});

function id(x) {
	return x;
}

function formatTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	const secondsStr = remainingSeconds.toFixed(3).padStart(6, '0');
	return `${minutes}:${secondsStr}`;
}

function binSearch(a: number[], x: number) {
	let lo = 0,
		hi = a.length - 1;
	if (x < a[0]) return 0;
	if (x > a[hi]) return hi - 1;
	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2);
		if (x < a[mid]) {
			hi = mid - 1;
		} else if (x > a[mid]) {
			lo = mid + 1;
		} else {
			return mid;
		}
	}
	return Math.abs(a[lo] - x) < Math.abs(a[hi] - x) ? lo : hi;
}

function TimeOfDaySelect(props) {
	function click(e) {
		e.stopPropagation();
		if (!('timeofday' in e.target.dataset)) return;
		props.set(+e.target.dataset.timeofday);
	}
	// + 2 because for some reason the icons are 00-02 (noon/evening/night) but the enum values are 1-4 (morning(?) noon evening night)
	return (
		<div class="timeofdaySelect" onClick={click}>
			{Array(3)
				.fill(0)
				.map((_, i) => (
					<img
						src={`/uma-tools/icons/utx_ico_timezone_0${i}.png`}
						title={SKILL_STRINGS_en.skilldetails.time[i + 2]}
						class={i + 2 == props.value ? 'selected' : ''}
						data-timeofday={i + 2}
					/>
				))}
		</div>
	);
}

function GroundSelect(props) {
	if (CC_GLOBAL) {
		return (
			<select
				class="groundSelect"
				value={props.value}
				onInput={(e) => props.set(+e.currentTarget.value)}
			>
				<option value="1">Firm</option>
				<option value="2">Good</option>
				<option value="3">Soft</option>
				<option value="4">Heavy</option>
			</select>
		);
	}
	return (
		<select
			class="groundSelect"
			value={props.value}
			onInput={(e) => props.set(+e.currentTarget.value)}
		>
			<option value="1">良</option>
			<option value="2">稍重</option>
			<option value="3">重</option>
			<option value="4">不良</option>
		</select>
	);
}

function WeatherSelect(props) {
	function click(e) {
		e.stopPropagation();
		if (!('weather' in e.target.dataset)) return;
		props.set(+e.target.dataset.weather);
	}
	return (
		<div class="weatherSelect" onClick={click}>
			{Array(4)
				.fill(0)
				.map((_, i) => (
					<img
						src={`/uma-tools/icons/utx_ico_weather_0${i}.png`}
						title={SKILL_STRINGS_en.skilldetails.weather[i + 1]}
						class={i + 1 == props.value ? 'selected' : ''}
						data-weather={i + 1}
					/>
				))}
		</div>
	);
}

function SeasonSelect(props) {
	function click(e) {
		e.stopPropagation();
		if (!('season' in e.target.dataset)) return;
		props.set(+e.target.dataset.season);
	}
	return (
		<div class="seasonSelect" onClick={click}>
			{Array(
				4 + +!CC_GLOBAL /* global doenst have late spring for some reason */,
			)
				.fill(0)
				.map((_, i) => (
					<img
						src={`/uma-tools/icons${CC_GLOBAL ? '/global' : ''}/utx_txt_season_0${i}.png`}
						title={SKILL_STRINGS_en.skilldetails.season[i + 1]}
						class={i + 1 == props.value ? 'selected' : ''}
						data-season={i + 1}
					/>
				))}
		</div>
	);
}

function Histogram(props) {
	const { data, width, height } = props;
	const axes = useRef(null);
	const xH = 20;
	const yW = 40;

	const x = d3
		.scaleLinear()
		.domain(
			data[0] == 0 && data[data.length - 1] == 0
				? [-1, 1]
				: [Math.min(0, Math.floor(data[0])), Math.ceil(data[data.length - 1])],
		)
		.range([yW, width - yW]);
	const bucketize = d3
		.bin()
		.value(id)
		.domain(x.domain())
		.thresholds(x.ticks(30));
	const buckets = bucketize(data);
	const y = d3
		.scaleLinear()
		.domain([0, d3.max(buckets, (b) => b.length)])
		.range([height - xH, xH]);

	useEffect(() => {
		const g = d3.select(axes.current);
		g.selectAll('*').remove();
		g.append('g')
			.attr('transform', `translate(0,${height - xH})`)
			.call(d3.axisBottom(x));
		g.append('g').attr('transform', `translate(${yW},0)`).call(d3.axisLeft(y));
	}, [data, width, height]);

	const rects = buckets.map((b, i) => (
		<rect
			key={i}
			fill="#2a77c5"
			stroke="black"
			x={x(b.x0)}
			y={y(b.length)}
			width={x(b.x1) - x(b.x0)}
			height={height - xH - y(b.length)}
		/>
	));
	return (
		<svg id="histogram" width={width} height={height}>
			<g>{rects}</g>
			<g ref={axes}></g>
		</svg>
	);
}

function BarChart(props) {
	const {
		width,
		height,
		bins,
		xScale,
		yScale,
		phaseBackgrounds,
		xAxisTicks,
		yAxisTicks,
		yTickValues,
		yAxisFormat,
		barColor,
	} = props;
	const axes = useRef(null);
	const gridLines = useRef(null);
	const xH = 20;
	const yW = 40;
	const chartWidth = width - yW - 5;
	const chartHeight = height - xH - 5;

	useEffect(() => {
		if (!axes.current || !gridLines.current) return;
		const axesG = d3.select(axes.current);
		axesG.selectAll('*').remove();
		const xAxis = d3.axisBottom(xScale).ticks(xAxisTicks);
		const yAxis = d3.axisLeft(yScale);
		if (yTickValues) {
			yAxis.tickValues(yTickValues);
		} else {
			yAxis.ticks(yAxisTicks);
		}
		if (yAxisFormat) {
			yAxis.tickFormat(yAxisFormat);
		}

		const xAxisG = axesG
			.append('g')
			.attr('transform', `translate(0,${chartHeight})`)
			.call(xAxis);
		const yAxisG = axesG
			.append('g')
			.attr('transform', `translate(0,0)`)
			.call(yAxis);

		const gridG = d3.select(gridLines.current);
		gridG.selectAll('*').remove();

		xScale.ticks(xAxisTicks).forEach((tickValue) => {
			gridG
				.append('line')
				.attr('class', 'grid-line')
				.attr('x1', xScale(tickValue))
				.attr('x2', xScale(tickValue))
				.attr('y1', 0)
				.attr('y2', chartHeight)
				.attr('stroke', 'rgba(128, 128, 128, 0.3)')
				.attr('stroke-width', 0.5);
		});

		const finalYTickValues = yTickValues || yScale.ticks(yAxisTicks);
		finalYTickValues.forEach((tickValue) => {
			gridG
				.append('line')
				.attr('class', 'grid-line')
				.attr('x1', 0)
				.attr('x2', chartWidth)
				.attr('y1', yScale(tickValue))
				.attr('y2', yScale(tickValue))
				.attr('stroke', 'rgba(128, 128, 128, 0.3)')
				.attr('stroke-width', 0.5);
		});
	}, [
		xScale,
		yScale,
		chartHeight,
		chartWidth,
		xAxisTicks,
		yAxisTicks,
		yTickValues,
		yAxisFormat,
	]);

	const rects = bins.map((bin, i) => {
		const barHeight = chartHeight - yScale(bin.value);
		const binWidth = xScale(bin.end) - xScale(bin.start);
		const barWidth = Math.max(3, binWidth * 1.5);
		const barX = xScale(bin.start) + (binWidth - barWidth) / 2;
		return (
			<rect
				key={i}
				fill={barColor || '#2a77c5'}
				stroke="none"
				x={barX}
				y={yScale(bin.value)}
				width={barWidth}
				height={barHeight}
			/>
		);
	});

	return (
		<div class="barChart" style={`width: ${width}px; height: ${height}px;`}>
			<svg width={width} height={height} style="overflow: visible;">
				<g transform={`translate(${yW},5)`}>
					{phaseBackgrounds &&
						phaseBackgrounds.map((phase, i) => (
							<rect
								key={i}
								x={xScale(phase.start)}
								y={0}
								width={xScale(phase.end) - xScale(phase.start)}
								height={chartHeight}
								fill={phase.color}
							/>
						))}
					<g ref={gridLines}></g>
					{rects}
					<g ref={axes}></g>
				</g>
			</svg>
		</div>
	);
}

export function LengthDifferenceChart(props) {
	const { skillId, runData, courseDistance, umaIndex = 1 } = props;
	const width = 300;
	const height = 150;

	if (!skillId || !runData) {
		return null;
	}

	if (
		!runData.allruns ||
		!runData.allruns.skBasinn ||
		!Array.isArray(runData.allruns.skBasinn)
	) {
		return null;
	}

	const allActivations: Array<[number, number]> = [];

	const skBasinnToProcess =
		runData.allruns.skBasinn.length > umaIndex
			? [runData.allruns.skBasinn[umaIndex]]
			: runData.allruns.skBasinn;

	skBasinnToProcess.forEach((skBasinnMap: any) => {
		if (!skBasinnMap) return;
		let activations = null;
		if (
			skBasinnMap instanceof Map ||
			(typeof skBasinnMap.has === 'function' &&
				typeof skBasinnMap.get === 'function')
		) {
			if (skBasinnMap.has(skillId)) {
				activations = skBasinnMap.get(skillId);
			}
		} else if (typeof skBasinnMap === 'object' && skillId in skBasinnMap) {
			activations = skBasinnMap[skillId];
		}
		if (activations && Array.isArray(activations)) {
			activations.forEach((activation: any) => {
				if (
					Array.isArray(activation) &&
					activation.length === 2 &&
					typeof activation[0] === 'number' &&
					typeof activation[1] === 'number'
				) {
					allActivations.push([activation[0], activation[1]]);
				}
			});
		}
	});

	if (allActivations.length === 0) {
		return null;
	}

	const binSize = 10;
	const maxDistance = Math.ceil(courseDistance / binSize) * binSize;
	const bins = [];
	for (let i = 0; i < maxDistance; i += binSize) {
		bins.push({
			start: i,
			end: i + binSize,
			maxBasinn: umaIndex === 0 ? Infinity : 0,
		});
	}

	allActivations.forEach(([activationPos, basinn]) => {
		const isBeneficial = umaIndex === 0 ? basinn < 0 : basinn > 0;
		if (isBeneficial) {
			const binIndex = Math.floor(activationPos / binSize);
			if (binIndex >= 0 && binIndex < bins.length) {
				if (umaIndex === 0) {
					bins[binIndex].maxBasinn = Math.min(bins[binIndex].maxBasinn, basinn);
				} else {
					bins[binIndex].maxBasinn = Math.max(bins[binIndex].maxBasinn, basinn);
				}
			}
		}
	});

	bins.forEach((bin) => {
		if (umaIndex === 0) {
			bin.value = bin.maxBasinn === Infinity ? 0 : Math.abs(bin.maxBasinn);
		} else {
			bin.value = bin.maxBasinn;
		}
	});

	const maxValue = Math.max(...bins.map((b) => b.value), 0);
	if (maxValue === 0) {
		return null;
	}

	const x = d3
		.scaleLinear()
		.domain([0, maxDistance])
		.range([0, width - 40 - 5]);
	const y = d3
		.scaleLinear()
		.domain([0, maxValue])
		.range([height - 20 - 5, 0]);

	const baseTicks = y.ticks(5);
	const threshold = Math.max(maxValue * 0.02, 0.05);
	const yTickValues = baseTicks.filter(
		(tick) => Math.abs(tick - maxValue) >= threshold,
	);
	if (!yTickValues.some((tick) => Math.abs(tick - maxValue) < 0.01)) {
		yTickValues.push(maxValue);
		yTickValues.sort((a, b) => a - b);
	}

	const phase0End = CourseHelpers.phaseStart(courseDistance, 1);
	const phase1End = CourseHelpers.phaseStart(courseDistance, 2);
	const phase2End = CourseHelpers.phaseStart(courseDistance, 3);

	const phaseBackgrounds = [
		{ start: 0, end: phase0End, color: 'rgba(173, 216, 230, 0.3)' },
		{ start: phase0End, end: phase1End, color: 'rgba(144, 238, 144, 0.3)' },
		{
			start: phase1End,
			end: courseDistance,
			color: 'rgba(255, 182, 193, 0.3)',
		},
	];

	return (
		<BarChart
			width={width}
			height={height}
			bins={bins}
			xScale={x}
			yScale={y}
			phaseBackgrounds={phaseBackgrounds}
			xAxisTicks={Math.min(6, Math.floor(maxDistance / 200))}
			yAxisTicks={5}
			yTickValues={yTickValues}
			yAxisFormat={(d, i, ticks) => {
				const isMaxTick = ticks && i === ticks.length - 1;
				if (isMaxTick || Math.abs(d - maxValue) < 0.001) {
					return `${maxValue.toFixed(2)}L`;
				}
				return `${d.toFixed(1)}L`;
			}}
			barColor="#2a77c5"
		/>
	);
}

function getSkillPositionsFromRun(
	skillId: string,
	selectedRun: any,
): { positions: Array<[number, number]>; umaIndex: number } | null {
	if (!selectedRun?.sk) return null;

	for (let i = 0; i < selectedRun.sk.length; i++) {
		const skMap = selectedRun.sk[i];
		if (!skMap) continue;

		let positions = null;
		if (
			skMap instanceof Map ||
			(typeof skMap.has === 'function' && typeof skMap.get === 'function')
		) {
			if (skMap.has(skillId)) {
				positions = skMap.get(skillId);
			}
		} else if (typeof skMap === 'object' && skillId in skMap) {
			positions = skMap[skillId];
		}

		if (positions && Array.isArray(positions) && positions.length > 0) {
			return { positions, umaIndex: i };
		}
	}
	return null;
}

function interpolateValue(
	value: number,
	valueArray: number[],
	resultArray: number[],
): number {
	if (valueArray.length === 0 || resultArray.length === 0)
		return resultArray[0] || 0;
	if (value <= valueArray[0]) return resultArray[0];
	if (value >= valueArray[valueArray.length - 1])
		return resultArray[resultArray.length - 1];

	for (let i = 0; i < valueArray.length - 1; i++) {
		if (valueArray[i] <= value && value <= valueArray[i + 1]) {
			const v1 = valueArray[i];
			const v2 = valueArray[i + 1];
			const r1 = resultArray[i];
			const r2 = resultArray[i + 1];
			if (v2 === v1) return r1;
			return r1 + ((r2 - r1) * (value - v1)) / (v2 - v1);
		}
	}
	return resultArray[resultArray.length - 1];
}

function calculatePhaseBackgrounds(
	courseDistance: number,
	positionData: Array<[number, number]>,
	minTime: number,
	maxTime: number,
): Array<{ start: number; end: number; color: string }> {
	if (!courseDistance || positionData.length === 0) return [];

	const phaseEndDistances = [
		CourseHelpers.phaseStart(courseDistance, 1),
		CourseHelpers.phaseStart(courseDistance, 2),
		CourseHelpers.phaseStart(courseDistance, 3),
	];

	const positions = positionData.map(([_, pos]) => pos);
	const times = positionData.map(([time, _]) => time);

	const phaseEndTimes = phaseEndDistances.map((dist) =>
		interpolateValue(dist, positions, times),
	);

	const phaseColors = [
		'rgba(173, 216, 230, 0.3)',
		'rgba(144, 238, 144, 0.3)',
		'rgba(255, 182, 193, 0.3)',
		'rgba(255, 182, 193, 0.3)',
	];

	const backgrounds: Array<{ start: number; end: number; color: string }> = [];
	const phaseStarts = [Math.max(minTime, 0), ...phaseEndTimes];
	const phaseEnds = [...phaseEndTimes, maxTime];

	for (let i = 0; i < phaseStarts.length; i++) {
		const start = Math.max(minTime, phaseStarts[i]);
		const end = Math.min(maxTime, phaseEnds[i]);
		if (end > start) {
			backgrounds.push({
				start,
				end,
				color: phaseColors[i],
			});
		}
	}

	return backgrounds;
}

export function VelocityChart(props) {
	const { skillId, runData, courseDistance, displaying, umaIndex = 1 } = props;
	const width = 400;
	const height = 200;
	const margin = { top: 5, right: 5, bottom: 20, left: 40 };
	const chartWidth = width - margin.left - margin.right;
	const chartHeight = height - margin.top - margin.bottom;
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const axesRef = useRef(null);

	const TIME_WINDOW_PADDING = 10;
	const Y_MIN_VELOCITY = 18;
	const TICK_EPSILON = 0.01;
	const VELOCITY_CONVERGENCE_THRESHOLD = 0.02;

	if (!skillId || !runData || !displaying) {
		return null;
	}

	const selectedRun = runData[displaying];
	if (
		!selectedRun?.t ||
		!selectedRun?.v ||
		!selectedRun?.p ||
		!selectedRun?.sk
	) {
		return null;
	}

	if (
		!selectedRun.t[0] ||
		!selectedRun.v[0] ||
		!selectedRun.p[0] ||
		!selectedRun.t[1] ||
		!selectedRun.v[1] ||
		!selectedRun.p[1]
	) {
		return null;
	}

	const skillData = getSkillPositionsFromRun(skillId, selectedRun);
	if (!skillData || skillData.positions.length === 0) {
		return null;
	}

	const uma1Times = selectedRun.t[0];
	const uma1Velocities = selectedRun.v[0];
	const uma1Positions = selectedRun.p[0];

	const uma2Times = selectedRun.t[1];
	const uma2Velocities = selectedRun.v[1];
	const uma2Positions = selectedRun.p[1];

	if (
		!uma1Times ||
		!uma1Velocities ||
		!uma1Positions ||
		uma1Times.length === 0 ||
		!uma2Times ||
		!uma2Velocities ||
		!uma2Positions ||
		uma2Times.length === 0
	) {
		return null;
	}

	const skillUmaIndex = skillData.umaIndex;
	const { positions: skillPositions } = skillData;
	const [startPos, endPos] = skillPositions[0];

	const skillUmaTimes = skillUmaIndex === 0 ? uma1Times : uma2Times;
	const skillUmaPositions = skillUmaIndex === 0 ? uma1Positions : uma2Positions;
	const otherUmaTimes = skillUmaIndex === 0 ? uma2Times : uma1Times;
	const otherUmaVelocities =
		skillUmaIndex === 0 ? uma2Velocities : uma1Velocities;
	const otherUmaPositions = skillUmaIndex === 0 ? uma2Positions : uma1Positions;

	const startTime = interpolateValue(
		startPos,
		skillUmaPositions,
		skillUmaTimes,
	);
	const endTime = interpolateValue(endPos, skillUmaPositions, skillUmaTimes);

	const timeWindowStart = Math.max(0, startTime - TIME_WINDOW_PADDING);
	const timeWindowEnd = endTime + TIME_WINDOW_PADDING;

	const skillUmaVelocityData: Array<[number, number]> = [];
	const otherUmaVelocityData: Array<[number, number]> = [];
	const positionData: Array<[number, number]> = [];

	for (let i = 0; i < skillUmaTimes.length; i++) {
		const t = skillUmaTimes[i];
		if (t >= timeWindowStart && t <= timeWindowEnd) {
			const velocities = skillUmaIndex === 0 ? uma1Velocities : uma2Velocities;
			skillUmaVelocityData.push([t, velocities[i]]);
			positionData.push([t, skillUmaPositions[i]]);
		}
	}

	for (let i = 0; i < otherUmaTimes.length; i++) {
		const t = otherUmaTimes[i];
		if (t >= timeWindowStart && t <= timeWindowEnd) {
			otherUmaVelocityData.push([t, otherUmaVelocities[i]]);
		}
	}

	if (skillUmaVelocityData.length === 0 || otherUmaVelocityData.length === 0) {
		return null;
	}

	const minTime = timeWindowStart;
	const maxTime = timeWindowEnd;

	const allVelocities = [
		...skillUmaVelocityData.map((d) => d[1]),
		...otherUmaVelocityData.map((d) => d[1]),
	];
	const minVelocity = Math.min(...allVelocities);
	const maxVelocity = Math.max(...allVelocities);

	const maxVelocityEntireRace = Math.max(
		Math.max(...uma1Velocities),
		Math.max(...uma2Velocities),
	);
	const maxVelocityRoundedUp = Math.ceil(maxVelocityEntireRace) + 1;

	const yMin = Math.min(Y_MIN_VELOCITY, minVelocity);
	const yMax = Math.max(Y_MIN_VELOCITY, maxVelocityRoundedUp);

	const x = d3.scaleLinear().domain([minTime, maxTime]).range([0, chartWidth]);
	const y = d3.scaleLinear().domain([yMin, yMax]).range([chartHeight, 0]);

	const phaseBackgrounds = calculatePhaseBackgrounds(
		courseDistance,
		positionData,
		minTime,
		maxTime,
	);

	const line = d3
		.line<[number, number]>()
		.x((d) => x(d[0]))
		.y((d) => y(d[1]))
		.curve(d3.curveMonotoneX);

	const otherUmaPathData = line(otherUmaVelocityData);

	let convergenceTime = maxTime;
	for (let i = 0; i < otherUmaTimes.length; i++) {
		const t = otherUmaTimes[i];
		if (t >= endTime) {
			const otherVel = otherUmaVelocities[i];
			const skillVel = (skillUmaIndex === 0 ? uma1Velocities : uma2Velocities)[
				i
			];
			if (Math.abs(skillVel - otherVel) <= VELOCITY_CONVERGENCE_THRESHOLD) {
				convergenceTime = t;
				break;
			}
		}
	}

	const skillUmaVelocityDataFiltered: Array<[number, number]> = [];
	for (let i = 0; i < skillUmaVelocityData.length; i++) {
		const [t, v] = skillUmaVelocityData[i];
		if (t >= startTime && t <= Math.min(convergenceTime, timeWindowEnd)) {
			skillUmaVelocityDataFiltered.push([t, v]);
		}
	}

	const skillUmaPathData =
		skillUmaVelocityDataFiltered.length > 0
			? line(skillUmaVelocityDataFiltered)
			: null;

	useEffect(() => {
		if (!canvasRef.current) return;

		const canvas = canvasRef.current;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);

		ctx.save();
		ctx.translate(margin.left, margin.top);

		phaseBackgrounds.forEach((phase) => {
			ctx.fillStyle = phase.color;
			ctx.fillRect(
				x(phase.start),
				0,
				x(phase.end) - x(phase.start),
				chartHeight,
			);
		});

		const suggestedTicks = y.ticks(5);
		const step =
			suggestedTicks.length > 1 ? suggestedTicks[1] - suggestedTicks[0] : 1;
		const startTick = Math.floor(yMin / step) * step;

		const yTickValues: number[] = [];
		for (let v = startTick; v <= maxVelocityRoundedUp; v += step) {
			if (v >= yMin) {
				yTickValues.push(v);
			}
		}

		if (
			!yTickValues.some(
				(tick) => Math.abs(tick - maxVelocityRoundedUp) < TICK_EPSILON,
			)
		) {
			yTickValues.push(maxVelocityRoundedUp);
		}
		yTickValues.sort((a, b) => a - b);

		ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
		ctx.lineWidth = 0.5;

		yTickValues.forEach((tickValue) => {
			const yPos = y(tickValue);
			ctx.beginPath();
			ctx.moveTo(0, yPos);
			ctx.lineTo(chartWidth, yPos);
			ctx.stroke();
		});

		x.ticks(5).forEach((tickValue) => {
			const xPos = x(tickValue);
			ctx.beginPath();
			ctx.moveTo(xPos, 0);
			ctx.lineTo(xPos, chartHeight);
			ctx.stroke();
		});

		if (otherUmaPathData && otherUmaVelocityData.length > 0) {
			ctx.strokeStyle = '#2a77c5';
			ctx.lineWidth = 2;
			ctx.beginPath();
			otherUmaVelocityData.forEach((d, i) => {
				const roundedTime = Number(d[0].toFixed(2));
				const roundedVelocity = Number(d[1].toFixed(2));
				if (i === 0) {
					ctx.moveTo(x(roundedTime), y(roundedVelocity));
				} else {
					ctx.lineTo(x(roundedTime), y(roundedVelocity));
				}
			});
			ctx.stroke();
		}

		if (skillUmaPathData && skillUmaVelocityDataFiltered.length > 0) {
			ctx.strokeStyle = '#ff69b4';
			ctx.lineWidth = 2;
			ctx.beginPath();
			skillUmaVelocityDataFiltered.forEach((d, i) => {
				const roundedTime = Number(d[0].toFixed(2));
				const roundedVelocity = Number(d[1].toFixed(2));
				if (i === 0) {
					ctx.moveTo(x(roundedTime), y(roundedVelocity));
				} else {
					ctx.lineTo(x(roundedTime), y(roundedVelocity));
				}
			});
			ctx.stroke();
		}

		ctx.restore();
	}, [
		x,
		y,
		chartWidth,
		chartHeight,
		yMin,
		maxVelocityRoundedUp,
		phaseBackgrounds,
		skillUmaVelocityDataFiltered,
		otherUmaVelocityData,
		width,
		height,
		margin,
	]);

	useEffect(() => {
		if (!axesRef.current) return;

		const axesG = d3.select(axesRef.current);
		axesG.selectAll('*').remove();

		const suggestedTicks = y.ticks(5);
		const step =
			suggestedTicks.length > 1 ? suggestedTicks[1] - suggestedTicks[0] : 1;
		const startTick = Math.floor(yMin / step) * step;

		const yTickValues: number[] = [];
		for (let v = startTick; v <= maxVelocityRoundedUp; v += step) {
			if (v >= yMin) {
				yTickValues.push(v);
			}
		}

		if (
			!yTickValues.some(
				(tick) => Math.abs(tick - maxVelocityRoundedUp) < TICK_EPSILON,
			)
		) {
			yTickValues.push(maxVelocityRoundedUp);
		}
		yTickValues.sort((a, b) => a - b);

		const xAxis = d3
			.axisBottom(x)
			.ticks(5)
			.tickFormat((d) => `${d}s`);
		const yAxis = d3
			.axisLeft(y)
			.tickValues(yTickValues)
			.tickFormat((d) => `${Number(d).toFixed(1)}m/s`);

		axesG
			.append('g')
			.attr('transform', `translate(${margin.left},${height - margin.bottom})`)
			.call(xAxis);
		axesG
			.append('g')
			.attr('transform', `translate(${margin.left},${margin.top})`)
			.call(yAxis);
	}, [
		x,
		y,
		chartWidth,
		chartHeight,
		yMin,
		maxVelocityRoundedUp,
		width,
		height,
		margin,
	]);

	return (
		<div
			class="velocityChart"
			style={`width: ${width}px; height: ${height}px; position: relative; overflow: visible;`}
		>
			<canvas
				ref={canvasRef}
				width={width}
				height={height}
				style="position: absolute; top: 0; left: 0;"
			/>
			<svg
				width={width + margin.left}
				height={height}
				style="position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible;"
			>
				<g ref={axesRef}></g>
			</svg>
		</div>
	);
}

export function ActivationFrequencyChart(props) {
	const { skillId, runData, courseDistance, umaIndex = 1 } = props;
	const width = 300;
	const height = 50;
	const yW = 40;
	const chartWidth = width - yW - 5;
	const chartHeight = height - 20 - 5;

	if (!skillId || !runData) {
		return null;
	}

	const activations = [];
	if (
		!runData.allruns ||
		!runData.allruns.sk ||
		!Array.isArray(runData.allruns.sk)
	) {
		return null;
	}

	const skToProcess =
		runData.allruns.sk.length > umaIndex
			? [runData.allruns.sk[umaIndex]]
			: runData.allruns.sk;

	skToProcess.forEach((skMap: any) => {
		if (!skMap) return;
		let positions = null;
		if (
			skMap instanceof Map ||
			(typeof skMap.has === 'function' && typeof skMap.get === 'function')
		) {
			if (skMap.has(skillId)) {
				positions = skMap.get(skillId);
			}
		} else if (typeof skMap === 'object' && skillId in skMap) {
			positions = skMap[skillId];
		}
		if (positions && Array.isArray(positions)) {
			positions.forEach((pos: any) => {
				if (typeof pos === 'number') {
					activations.push(pos);
				}
			});
		}
	});

	if (activations.length === 0) {
		return null;
	}

	const binSize = 10;
	const maxDistance = Math.ceil(courseDistance / binSize) * binSize;
	const bins = [];
	for (let i = 0; i < maxDistance; i += binSize) {
		bins.push({ start: i, end: i + binSize, count: 0 });
	}

	activations.forEach((pos) => {
		const binIndex = Math.floor(pos / binSize);
		if (binIndex >= 0 && binIndex < bins.length) {
			bins[binIndex].count++;
		}
	});

	const maxCount = Math.max(...bins.map((b) => b.count));
	const totalActivations = activations.length;

	const phase0End = CourseHelpers.phaseStart(courseDistance, 1);
	const phase1End = CourseHelpers.phaseStart(courseDistance, 2);
	const phase2End = CourseHelpers.phaseStart(courseDistance, 3);

	const phaseBackgrounds = [
		{ start: 0, end: phase0End, color: 'rgba(173, 216, 230, 0.3)' },
		{ start: phase0End, end: phase1End, color: 'rgba(144, 238, 144, 0.3)' },
		{
			start: phase1End,
			end: courseDistance,
			color: 'rgba(255, 182, 193, 0.3)',
		},
	];

	const chartBins = bins.map((bin) => ({ ...bin, value: bin.count }));
	const xScale = d3
		.scaleLinear()
		.domain([0, maxDistance])
		.range([0, chartWidth]);
	const yScale = d3
		.scaleLinear()
		.domain([0, maxCount > 0 ? maxCount : 1])
		.range([chartHeight, 0]);

	const yTickValues = [0, maxCount > 0 ? maxCount : 1];

	return (
		<div class="activationFrequencyChart">
			<BarChart
				width={width}
				height={height}
				bins={chartBins}
				xScale={xScale}
				yScale={yScale}
				phaseBackgrounds={phaseBackgrounds}
				xAxisTicks={Math.min(6, Math.floor(maxDistance / 200))}
				yAxisTicks={2}
				yTickValues={yTickValues}
				yAxisFormat={(d, i, ticks) => {
					if (i === 0 || i === ticks.length - 1) {
						return `${Math.round((d / totalActivations) * 100)}%`;
					}
					return '';
				}}
				barColor="#2a77c5"
			/>
		</div>
	);
}

function BasinnChartPopover(props) {
	const popover = useRef(null);
	useEffect(() => {
		if (popover.current == null) return;
		// bit nasty
		const anchor = document.querySelector(
			`.basinnChart tr[data-skillid="${props.skillid}"] img`,
		);
		computePosition(anchor, popover.current, {
			placement: 'bottom-start',
			middleware: [flip()],
		}).then(({ x, y }) => {
			popover.current.style.transform = `translate(${x}px,${y}px)`;
			popover.current.style.visibility = 'visible';
		});
		popover.current.focus();
	}, [popover.current, props.skillid]);
	return (
		<div
			class="basinnChartPopover"
			tabindex="1000"
			style="visibility:hidden"
			ref={popover}
		>
			<ExpandedSkillDetails
				id={props.skillid}
				distanceFactor={props.courseDistance}
				dismissable={false}
			/>
			<Histogram width={500} height={333} data={props.results} />
		</div>
	);
}

function VelocityLines(props) {
	const axes = useRef(null);
	const data = props.data;
	const x = d3
		.scaleLinear()
		.domain([0, props.courseDistance])
		.range([0, props.width]);
	const y =
		data &&
		d3
			.scaleLinear()
			.domain([0, d3.max(data.v, (v) => d3.max(v))])
			.range([props.height, 0]);
	const hpY =
		data &&
		d3
			.scaleLinear()
			.domain([0, d3.max(data.hp, (hp) => d3.max(hp))])
			.range([props.height, 0]);

	const pacemakerY =
		data &&
		data.pacerGap &&
		(() => {
			const allValues = data.pacerGap.flatMap((gap) =>
				gap.filter((d) => d !== undefined),
			);
			if (allValues.length === 0) return null;
			const maxValue = d3.max(allValues);
			const bottom60Percent = props.height * 0.6;
			const domainMax = Math.max(maxValue, 10);
			return d3
				.scaleLinear()
				.domain([0, domainMax])
				.range([props.height, bottom60Percent]);
		})();

	const laneY =
		data &&
		data.currentLane &&
		props.horseLane &&
		(() => {
			const gateCount = 9;
			const maxLane = Math.max(gateCount + 1, 11) * props.horseLane;
			const bottom50Percent = props.height * 0.5;
			return d3
				.scaleLinear()
				.domain([0, maxLane])
				.range([props.height, bottom50Percent]);
		})();

	useEffect(() => {
		if (axes.current == null) return;
		const g = d3.select(axes.current);
		g.selectAll('*').remove();
		g.append('g')
			.attr('transform', `translate(${props.xOffset},${props.height + 5})`)
			.call(d3.axisBottom(x));
		if (data) {
			g.append('g')
				.attr('transform', `translate(${props.xOffset},4)`)
				.call(d3.axisLeft(y));
		}
	}, [props.data, props.courseDistance, props.width, props.height]);
	const colors = ['#2a77c5', '#c52a2a'];
	const hpColors = ['#688aab', '#ab6868'];
	const laneColors = ['#87ceeb', '#ff0000'];
	const pacemakerColors = ['#22c55e', '#a855f7', '#ec4899'];
	return (
		<Fragment>
			<g transform={`translate(${props.xOffset},5)`}>
				{data &&
					data.v
						.map((v, i) => (
							<path
								fill="none"
								stroke={colors[i]}
								stroke-width="2.5"
								d={d3
									.line()
									.x((j) => x(data.p[i][j]))
									.y((j) => y(v[j]))(data.p[i].map((_, j) => j))}
							/>
						))
						.concat(
							props.showHp
								? data.hp.map((hp, i) => (
										<path
											fill="none"
											stroke={hpColors[i]}
											stroke-width="2.5"
											d={d3
												.line()
												.x((j) => x(data.p[i][j]))
												.y((j) => hpY(hp[j]))(data.p[i].map((_, j) => j))}
										/>
									))
								: [],
						)
						.concat(
							props.showLanes && data.currentLane && laneY
								? data.currentLane.map((lanes, i) => (
										<path
											fill="none"
											stroke={laneColors[i]}
											stroke-width="2.5"
											d={d3
												.line()
												.x((j) => x(data.p[i][j]))
												.y((j) => laneY(lanes[j]))(data.p[i].map((_, j) => j))}
										/>
									))
								: [],
						)
						.concat(
							props.showPoskeepGap && data.pacerGap && pacemakerY
								? data.pacerGap
										.map((gap, i) => {
											const validPoints = data.p[i]
												.map((_, j) => ({ x: j, gap: gap[j] }))
												.filter((p) => p.gap !== undefined && p.gap >= 0);
											if (validPoints.length === 0) return null;

											return (
												<path
													key={i}
													fill="none"
													stroke={colors[i]}
													stroke-width="2"
													stroke-dasharray="5,5"
													d={d3
														.line()
														.x((j) => x(data.p[i][j]))
														.y((j) => pacemakerY(gap[j]))(
														validPoints.map((p) => p.x),
													)}
												/>
											);
										})
										.filter(Boolean)
								: [],
						)
						.concat(
							props.showVirtualPacemaker && data.pacerV && data.pacerP
								? (() => {
										const pacemakerLines = [];
										for (
											let pacemakerIndex = 0;
											pacemakerIndex < 3;
											pacemakerIndex++
										) {
											if (
												props.selectedPacemakers &&
												props.selectedPacemakers[pacemakerIndex] &&
												data.pacerV &&
												data.pacerV[pacemakerIndex] &&
												data.pacerP &&
												data.pacerP[pacemakerIndex]
											) {
												const pacerV = data.pacerV[pacemakerIndex];
												const pacerP = data.pacerP[pacemakerIndex];
												const validPoints = pacerP
													.map((_, j) => ({
														x: j,
														vel: pacerV[j],
														pos: pacerP[j],
													}))
													.filter(
														(p) => p.vel !== undefined && p.pos !== undefined,
													);
												if (validPoints.length > 0) {
													pacemakerLines.push(
														<path
															key={`vp-${pacemakerIndex}`}
															fill="none"
															stroke={pacemakerColors[pacemakerIndex]}
															stroke-width="2.5"
															d={d3
																.line()
																.x((j) => x(pacerP[j]))
																.y((j) => y(pacerV[j]))(
																validPoints.map((p) => p.x),
															)}
														/>,
													);
												}
											}
										}
										return pacemakerLines;
									})()
								: [],
						)}
			</g>
			<g ref={axes} />
		</Fragment>
	);
}

function ResultsTable(props) {
	const { caption, color, chartData, idx, runData } = props;

	return (
		<table>
			<caption style={`color:${color}`}>{caption}</caption>
			<tbody>
				<tr>
					<th>Time to finish</th>
					<td>
						{formatTime(chartData.t[idx][chartData.t[idx].length - 1] * 1.18)}
					</td>
				</tr>
				<tr>
					<th>Start delay</th>
					<td>{chartData.sdly[idx].toFixed(4) + ' s'}</td>
				</tr>
				<tr>
					<th>Top speed</th>
					<td>
						{chartData.v[idx].reduce((a, b) => Math.max(a, b), 0).toFixed(2) +
							' m/s'}
					</td>
				</tr>
				{runData?.allruns?.rushed && (
					<tr>
						<th>Rushed frequency</th>
						<td>
							{runData.allruns.rushed[idx].frequency > 0
								? `${runData.allruns.rushed[idx].frequency.toFixed(1)}% (${runData.allruns.rushed[idx].mean.toFixed(1)}m)`
								: '0%'}
						</td>
					</tr>
				)}
				{runData?.allruns?.leadCompetition && (
					<tr>
						<th>Spot Struggle frequency</th>
						<td>
							{runData.allruns.leadCompetition[idx].frequency > 0
								? `${runData.allruns.leadCompetition[idx].frequency.toFixed(1)}%`
								: '0%'}
						</td>
					</tr>
				)}
				{runData?.allruns?.competeFight && (
					<tr>
						<th>Dueling frequency</th>
						<td>
							{runData.allruns.competeFight[idx].frequency > 0
								? `${runData.allruns.competeFight[idx].frequency.toFixed(1)}%`
								: '0%'}
						</td>
					</tr>
				)}
			</tbody>
			{chartData.sk[idx].size > 0 && (
				<tbody>
					{Array.from(chartData.sk[idx].entries()).map(([id, ars]) =>
						ars.flatMap((pos) => (
							<tr>
								<th>{skillnames[id][0]}</th>
								<td>
									{pos[1] == -1
										? `${pos[0].toFixed(2)} m`
										: `${pos[0].toFixed(2)} m – ${pos[1].toFixed(2)} m`}
								</td>
							</tr>
						)),
					)}
				</tbody>
			)}
		</table>
	);
}

const NO_SHOW = Object.freeze([
	'10011',
	'10012',
	'10016',
	'10021',
	'10022',
	'10026',
	'10031',
	'10032',
	'10036',
	'10041',
	'10042',
	'10046',
	'10051',
	'10052',
	'10056',
	'10061',
	'10062',
	'10066',
	'40011',
	'20061',
	'20062',
	'20066',
]);

const ORDER_RANGE_FOR_STRATEGY = Object.freeze({
	Nige: [1, 1],
	Senkou: [2, 4],
	Sasi: [5, 9],
	Oikomi: [5, 9],
	Oonige: [1, 1],
});

function racedefToParams(
	{ mood, ground, weather, season, time, grade }: RaceParams,
	includeOrder?: string,
): RaceParameters {
	return {
		mood,
		groundCondition: ground,
		weather,
		season,
		time,
		grade,
		popularity: 1,
		skillId: '',
		orderRange:
			includeOrder != null ? ORDER_RANGE_FOR_STRATEGY[includeOrder] : null,
		numUmas: 9,
	};
}

async function serialize(
	courseId: number,
	nsamples: number,
	seed: number,
	posKeepMode: PosKeepMode,
	racedef: RaceParams,
	uma1: HorseState,
	uma2: HorseState,
	pacer: HorseState,
	showVirtualPacemakerOnGraph: boolean,
	pacemakerCount: number,
	selectedPacemakers: boolean[],
	showLanes: boolean,
	witVarianceSettings: {
		syncRng: boolean;
		skillWisdomCheck: boolean;
		rushedKakari: boolean;
	},
	competeFight: boolean,
	leadCompetition: boolean,
	duelingRates: {
		runaway: number;
		frontRunner: number;
		paceChaser: number;
		lateSurger: number;
		endCloser: number;
	},
	graphToggles: {
		showHp: boolean;
		showPoskeepGap: boolean;
		showLabels: boolean;
	},
) {
	const json = JSON.stringify({
		courseId,
		nsamples,
		seed,
		posKeepMode,
		racedef: racedef.toJS(),
		uma1: uma1.set('skills', Array.from(uma1.skills.values())).toJS(),
		uma2: uma2.set('skills', Array.from(uma2.skills.values())).toJS(),
		pacer: pacer.set('skills', Array.from(pacer.skills.values())).toJS(),
		witVarianceSettings,
		showVirtualPacemakerOnGraph,
		pacemakerCount,
		selectedPacemakers,
		showLanes,
		competeFight,
		leadCompetition,
		duelingRates,
		graphToggles,
	});
	const enc = new TextEncoder();
	const stringStream = new ReadableStream({
		start(controller) {
			controller.enqueue(enc.encode(json));
			controller.close();
		},
	});
	const zipped = stringStream.pipeThrough(new CompressionStream('gzip'));
	const reader = zipped.getReader();
	let buf = new Uint8Array();
	for (;;) {
		const result = await reader.read();
		if (result.done) {
			return encodeURIComponent(btoa(String.fromCharCode(...buf)));
		} else {
			buf = new Uint8Array([...buf, ...result.value]);
		}
	}
}

async function deserialize(hash) {
	const zipped = atob(decodeURIComponent(hash));
	const buf = new Uint8Array(zipped.split('').map((c) => c.charCodeAt(0)));
	const stringStream = new ReadableStream({
		start(controller) {
			controller.enqueue(buf);
			controller.close();
		},
	});
	const unzipped = stringStream.pipeThrough(new DecompressionStream('gzip'));
	const reader = unzipped.getReader();
	const decoder = new TextDecoder();
	let json = '';
	for (;;) {
		const result = await reader.read();
		if (result.done) {
			try {
				const o = JSON.parse(json);
				return {
					courseId: o.courseId,
					nsamples: o.nsamples,
					seed: o.seed || DEFAULT_SEED, // field added later, could be undefined when loading state from existing links
					posKeepMode:
						o.posKeepMode != null
							? o.posKeepMode
							: o.usePosKeep
								? PosKeepMode.Approximate
								: PosKeepMode.None, // backward compatibility
					racedef: new RaceParams(o.racedef),
					uma1: new HorseState(o.uma1)
						.set('skills', SkillSet(o.uma1.skills))
						.set(
							'forcedSkillPositions',
							ImmMap(o.uma1.forcedSkillPositions || {}),
						),
					uma2: new HorseState(o.uma2)
						.set('skills', SkillSet(o.uma2.skills))
						.set(
							'forcedSkillPositions',
							ImmMap(o.uma2.forcedSkillPositions || {}),
						),
					pacer: o.pacer
						? new HorseState(o.pacer)
								.set('skills', SkillSet(o.pacer.skills || []))
								.set(
									'forcedSkillPositions',
									ImmMap(o.pacer.forcedSkillPositions || {}),
								)
						: new HorseState({ strategy: 'Nige' }),
					witVarianceSettings: o.witVarianceSettings || {
						syncRng: false,
						skillWisdomCheck: true,
						rushedKakari: true,
					},
					showVirtualPacemakerOnGraph:
						o.showVirtualPacemakerOnGraph != null
							? o.showVirtualPacemakerOnGraph
							: false,
					pacemakerCount: o.pacemakerCount != null ? o.pacemakerCount : 1,
					selectedPacemakers:
						o.selectedPacemakers != null
							? o.selectedPacemakers
							: [false, false, false],
					showLanes: o.showLanes != null ? o.showLanes : false,
					competeFight: o.competeFight != null ? o.competeFight : true,
					leadCompetition: o.leadCompetition != null ? o.leadCompetition : true,
					duelingRates: o.duelingRates || {
						runaway: 10,
						frontRunner: 20,
						paceChaser: 30,
						lateSurger: 35,
						endCloser: 35,
					},
					graphToggles: o.graphToggles || {
						showHp: false,
						showPoskeepGap: true,
						showLabels: true,
					},
				};
			} catch (_) {
				return {
					courseId: DEFAULT_COURSE_ID,
					nsamples: DEFAULT_SAMPLES,
					seed: DEFAULT_SEED,
					posKeepMode: PosKeepMode.Approximate,
					racedef: new RaceParams(),
					uma1: new HorseState(),
					uma2: new HorseState(),
					pacer: new HorseState({ strategy: 'Nige' }),
					witVarianceSettings: {
						syncRng: false,
						skillWisdomCheck: true,
						rushedKakari: true,
					},
					showVirtualPacemakerOnGraph: false,
					pacemakerCount: 1,
					selectedPacemakers: [false, false, false],
					showLanes: false,
					competeFight: true,
					leadCompetition: true,
					duelingRates: {
						runaway: 10,
						frontRunner: 20,
						paceChaser: 30,
						lateSurger: 35,
						endCloser: 35,
					},
					graphToggles: {
						showHp: false,
						showPoskeepGap: true,
						showLabels: true,
					},
				};
			}
		} else {
			json += decoder.decode(result.value);
		}
	}
}

async function saveToLocalStorage(
	courseId: number,
	nsamples: number,
	seed: number,
	posKeepMode: PosKeepMode,
	racedef: RaceParams,
	uma1: HorseState,
	uma2: HorseState,
	pacer: HorseState,
	showVirtualPacemakerOnGraph: boolean,
	pacemakerCount: number,
	selectedPacemakers: boolean[],
	showLanes: boolean,
	witVarianceSettings: {
		syncRng: boolean;
		skillWisdomCheck: boolean;
		rushedKakari: boolean;
	},
	competeFight: boolean,
	leadCompetition: boolean,
	duelingRates: {
		runaway: number;
		frontRunner: number;
		paceChaser: number;
		lateSurger: number;
		endCloser: number;
	},
	graphToggles: {
		showHp: boolean;
		showPoskeepGap: boolean;
		showLabels: boolean;
	},
) {
	try {
		const hash = await serialize(
			courseId,
			nsamples,
			seed,
			posKeepMode,
			racedef,
			uma1,
			uma2,
			pacer,
			showVirtualPacemakerOnGraph,
			pacemakerCount,
			selectedPacemakers,
			showLanes,
			witVarianceSettings,
			competeFight,
			leadCompetition,
			duelingRates,
			graphToggles,
		);
		localStorage.setItem('umalator-settings', hash);
	} catch (error) {
		console.warn('Failed to save settings to localStorage:', error);
	}
}

async function loadFromLocalStorage() {
	try {
		const hash = localStorage.getItem('umalator-settings');
		if (hash) {
			return await deserialize(hash);
		}
	} catch (error) {
		console.warn('Failed to load settings from localStorage:', error);
	}
	return null;
}

const EMPTY_RESULTS_STATE = {
	courseId: DEFAULT_COURSE_ID,
	results: [],
	runData: null,
	chartData: null,
	displaying: '',
	spurtInfo: null,
	staminaStats: null,
	firstUmaStats: null,
};
function updateResultsState(
	state: typeof EMPTY_RESULTS_STATE,
	o:
		| number
		| string
		| {
				results: any;
				runData: any;
				spurtInfo?: any;
				staminaStats?: any;
				firstUmaStats?: any;
		  },
) {
	if (typeof o == 'number') {
		return {
			courseId: o,
			results: [],
			runData: null,
			chartData: null,
			displaying: '',
			spurtInfo: null,
			staminaStats: null,
			firstUmaStats: null,
		};
	} else if (typeof o == 'string') {
		postEvent('setChartData', { display: o });
		return {
			courseId: state.courseId,
			results: state.results,
			runData: state.runData,
			chartData: state.runData != null ? state.runData[o] : null,
			displaying: o,
			spurtInfo: state.spurtInfo,
			staminaStats: state.staminaStats,
			firstUmaStats: state.firstUmaStats,
		};
	} else {
		return {
			courseId: state.courseId,
			results: o.results,
			runData: o.runData,
			chartData: o.runData[state.displaying || 'meanrun'],
			displaying: state.displaying || 'meanrun',
			spurtInfo: o.spurtInfo || null,
			staminaStats: o.staminaStats || null,
			firstUmaStats: o.firstUmaStats || null,
		};
	}
}

function RacePresets(props) {
	const id = useId();
	const selectedIdx = presets.findIndex(
		(p) => p.courseId == props.courseId && p.racedef.equals(props.racedef),
	);
	return (
		<select
			id={id}
			onChange={(e) => {
				const i = +e.currentTarget.value;
				i > -1 && props.set(presets[i].courseId, presets[i].racedef);
			}}
		>
			<option value="-1"></option>
			{presets.map((p, i) => (
				<option value={i} selected={i == selectedIdx}>
					{'CM ' + p.id + ' - ' + p.name}
				</option>
			))}
		</select>
	);
}

const baseSkillsToTest = Object.keys(skilldata).filter((id) =>
	isGeneralSkill(id),
);

enum Mode {
	Compare,
	Chart,
	UniquesChart,
}

const CHART_ICON_TYPE_FILTERS = [
	'1001',
	'1002',
	'1003',
	'1004',
	'1005',
	'1006',
	'4001',
	'2002',
	'2001',
	'2004',
	'2005',
	'2006',
	'2009',
	'3001',
	'3002',
	'3004',
	'3005',
	'3007',
] as const;

const CHART_ICON_ID_PREFIXES: { [key: string]: string[] } = {
	'1001': ['1001'],
	'1002': ['1002', '2018'],
	'1003': ['1003'],
	'1004': ['1004'],
	'1005': ['1005'],
	'1006': ['1006'],
	'2002': ['2002', '2011', '2028'],
	'2001': [
		'2001',
		'2010',
		'2014',
		'2015',
		'2016',
		'2019',
		'2021',
		'2022',
		'2024',
		'2026',
		'2029',
		'2031',
		'2032',
		'2033',
	],
	'2004': ['2004', '2012', '2017', '2020', '2025', '2027', '2030'],
	'2005': ['2005', '2013'],
	'2006': ['2006'],
	'2009': ['2009'],
	'3001': ['3001'],
	'3002': ['3002'],
	'3004': ['3004'],
	'3005': ['3005'],
	'3007': ['3007'],
	'4001': ['4001'],
};

function matchChartIconType(skillId: string, iconType: string): boolean {
	const meta = (skillmeta as any)[skillId];
	if (!meta?.iconId) return false;
	return (
		CHART_ICON_ID_PREFIXES[iconType]?.some((p: string) =>
			meta.iconId.startsWith(p),
		) ?? false
	);
}

enum UiStateMsg {
	SetModeCompare,
	SetModeChart,
	SetModeUniquesChart,
	SetCurrentIdx0,
	SetCurrentIdx1,
	SetCurrentIdx2,
	ToggleExpand,
}

const DEFAULT_UI_STATE = { mode: Mode.Compare, currentIdx: 0, expanded: false };

function nextUiState(state: typeof DEFAULT_UI_STATE, msg: UiStateMsg) {
	switch (msg) {
		case UiStateMsg.SetModeCompare:
			return { ...state, mode: Mode.Compare };
		case UiStateMsg.SetModeChart:
			return { ...state, mode: Mode.Chart, currentIdx: 0, expanded: false };
		case UiStateMsg.SetModeUniquesChart:
			return {
				...state,
				mode: Mode.UniquesChart,
				currentIdx: 0,
				expanded: false,
			};
		case UiStateMsg.SetCurrentIdx0:
			return { ...state, currentIdx: 0 };
		case UiStateMsg.SetCurrentIdx1:
			return { ...state, currentIdx: 1 };
		case UiStateMsg.SetCurrentIdx2:
			return { ...state, currentIdx: 2 };
		case UiStateMsg.ToggleExpand:
			return { ...state, expanded: !state.expanded };
	}
}

function StatsTable({ caption, captionColor, rows }) {
	const formatValue = (value, label) => {
		if (value == null) return 'N/A';
		if (label === 'Velocity') {
			return value.toFixed(3) + ' m/s';
		}
		return value.toFixed(2) + ' m';
	};

	return (
		<table
			style={{ borderCollapse: 'collapse', marginTop: '0', width: '100%' }}
		>
			<caption
				style={{
					fontWeight: 'bold',
					marginBottom: '8px',
					marginTop: '10px',
					color: captionColor,
				}}
			>
				{caption}
			</caption>
			<thead>
				<tr>
					<th
						style={{
							border: '1px solid #ccc',
							padding: '8px',
							textAlign: 'center',
						}}
					></th>
					<th
						style={{
							border: '1px solid #ccc',
							padding: '8px',
							textAlign: 'center',
						}}
					>
						Count
					</th>
					<th
						style={{
							border: '1px solid #ccc',
							padding: '8px',
							textAlign: 'center',
						}}
					>
						Min
					</th>
					<th
						style={{
							border: '1px solid #ccc',
							padding: '8px',
							textAlign: 'center',
						}}
					>
						Max
					</th>
					<th
						style={{
							border: '1px solid #ccc',
							padding: '8px',
							textAlign: 'center',
						}}
					>
						Mean
					</th>
					<th
						style={{
							border: '1px solid #ccc',
							padding: '8px',
							textAlign: 'center',
						}}
					>
						Median
					</th>
				</tr>
			</thead>
			<tbody>
				{rows.map(({ label, stats }) => (
					<tr key={label}>
						<th
							style={{
								border: '1px solid #ccc',
								padding: '8px',
								textAlign: 'left',
							}}
						>
							{label}
						</th>
						<td
							style={{
								border: '1px solid #ccc',
								padding: '8px',
								textAlign: 'center',
							}}
						>
							{stats.count != null ? stats.count : 0}
						</td>
						<td
							style={{
								border: '1px solid #ccc',
								padding: '8px',
								textAlign: 'center',
							}}
						>
							{formatValue(stats.min, label)}
						</td>
						<td
							style={{
								border: '1px solid #ccc',
								padding: '8px',
								textAlign: 'center',
							}}
						>
							{formatValue(stats.max, label)}
						</td>
						<td
							style={{
								border: '1px solid #ccc',
								padding: '8px',
								textAlign: 'center',
							}}
						>
							{formatValue(stats.mean, label)}
						</td>
						<td
							style={{
								border: '1px solid #ccc',
								padding: '8px',
								textAlign: 'center',
							}}
						>
							{formatValue(stats.median, label)}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function horseStateToUmaState(state: HorseState): UmaState {
	return {
		outfitId: state.outfitId,
		speed: state.speed,
		stamina: state.stamina,
		power: state.power,
		guts: state.guts,
		wisdom: state.wisdom,
		strategy: state.strategy,
		distanceAptitude: state.distanceAptitude,
		surfaceAptitude: state.surfaceAptitude,
		strategyAptitude: state.strategyAptitude,
		mood: state.mood,
		skills: Array.from(state.skills.values()),
		forcedSkillPositions: state.forcedSkillPositions.toJS() as {
			[key: string]: number;
		},
	};
}

function umaStateToHorseState(uma: UmaState): HorseState {
	return new HorseState({
		outfitId: uma.outfitId,
		speed: uma.speed,
		stamina: uma.stamina,
		power: uma.power,
		guts: uma.guts,
		wisdom: uma.wisdom,
		strategy: uma.strategy,
		distanceAptitude: uma.distanceAptitude,
		surfaceAptitude: uma.surfaceAptitude,
		strategyAptitude: uma.strategyAptitude,
		mood: uma.mood as Mood,
		skills: SkillSet(uma.skills),
		forcedSkillPositions: ImmMap(uma.forcedSkillPositions),
	});
}

function decodedUmaToUmaState(uma: DecodedUma): UmaState {
	const aptToLetter = (v: number): string =>
		(['G', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'S'] as const)[
			Math.max(0, Math.min(9, v))
		];

	const strategies = [
		{ key: 'apt_nige' as const, strat: 'Nige' as const },
		{ key: 'apt_senko' as const, strat: 'Senkou' as const },
		{ key: 'apt_sashi' as const, strat: 'Sasi' as const },
		{ key: 'apt_oikomi' as const, strat: 'Oikomi' as const },
	];
	const bestStrat = strategies.reduce((best, curr) =>
		uma[curr.key] >= uma[best.key] ? curr : best,
	);
	const bestDistApt = Math.max(
		uma.apt_short,
		uma.apt_mile,
		uma.apt_middle,
		uma.apt_long,
	);
	const bestSurfApt = Math.max(uma.apt_turf, uma.apt_dirt);

	return {
		outfitId: String(uma.card_id),
		speed: uma.speed,
		stamina: uma.stamina,
		power: uma.power,
		guts: uma.guts,
		wisdom: uma.wisdom,
		strategy: bestStrat.strat,
		distanceAptitude: aptToLetter(bestDistApt),
		surfaceAptitude: aptToLetter(bestSurfApt),
		strategyAptitude: aptToLetter(uma[bestStrat.key]),
		mood: 2,
		// some skill ids (e.g. Carnival Bonus 1000011-1000014, and ~330 others - inherited-unique
		// variants, scenario "hero"/"enthusiast" bonus skills, etc.) are named in skillnames.json but
		// were never given a skill_meta.json entry. SkillSet() indexes skillmeta[id].groupId
		// unconditionally, so any of these reaching it crashes the import - drop them here instead.
		skills: uma.skills
			.filter((s) => skillmeta[s.id] !== undefined)
			.map((s) => String(s.id)),
		forcedSkillPositions: {},
	};
}

function ImportDialog({
	onClose,
	onImport,
}: {
	onClose: () => void;
	onImport: (s: HorseState) => void;
}) {
	const [b64Input, setB64Input] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function handleB64Import() {
		if (!b64Input.trim()) return;
		setError('');
		setLoading(true);
		try {
			const umas = await decodeRoster(b64Input.trim());
			if (!umas || umas.length === 0) {
				setError('Could not decode — check the code and try again.');
				return;
			}
			onImport(umaStateToHorseState(decodedUmaToUmaState(umas[0])));
			onClose();
		} catch (e: any) {
			setError('Decode failed: ' + (e?.message ?? 'Unknown error'));
		} finally {
			setLoading(false);
		}
	}

	async function handleJsonFile() {
		const uma = await importHorseJson();
		if (uma) {
			onImport(umaStateToHorseState({ ...uma, mood: 2 }));
			onClose();
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleB64Import();
	}

	return (
		<div
			class="saveLoadOverlay"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				class="saveLoadModal"
				style="width:420px;max-width:92vw"
				onKeyDown={handleKeyDown}
			>
				<h3 class="saveLoadModalTitle">Import Uma</h3>
				<p style="margin:4px 0 10px;font-size:13px;color:var(--muted,#6b7280)">
					Paste a single-uma export code from{' '}
					<a
						href="https://uma.guide/roster-viewer/"
						target="_blank"
						rel="noopener"
						style="color:hsl(215 70% 50%)"
					>
						uma.guide/roster-viewer
					</a>
					, or browse for a JSON file.
				</p>
				<textarea
					style="width:100%;box-sizing:border-box;height:72px;padding:8px 10px;font-size:12px;font-family:monospace;resize:vertical;border:1px solid var(--border,#e5e7eb);border-radius:6px;background:var(--input-bg,#fff);color:var(--fg,#111827);outline:none"
					placeholder="e.g. ARlXmWBdob…"
					value={b64Input}
					onInput={(e) => {
						setB64Input((e.target as HTMLTextAreaElement).value);
						setError('');
					}}
					autoFocus
				/>
				{error && (
					<p style="margin:6px 0 0;font-size:12px;color:hsl(0 70% 45%)">
						{error}
					</p>
				)}
				<div class="saveLoadModalActions" style="margin-top:14px">
					<button class="saveLoadBtnSecondary" onClick={onClose}>
						Cancel
					</button>
					<button class="saveLoadBtnSecondary" onClick={handleJsonFile}>
						Browse JSON…
					</button>
					<button
						class="saveLoadBtnPrimary"
						onClick={handleB64Import}
						disabled={loading || !b64Input.trim()}
					>
						{loading ? 'Importing…' : 'Import'}
					</button>
				</div>
			</div>
		</div>
	);
}

function HorseSaveLoadActions({
	state,
	setState,
	onReset,
}: {
	state: HorseState;
	setState: (s: HorseState) => void;
	onReset?: () => void;
}) {
	const [savedSlots, setSavedSlots] = useState(() => getSavedSlotNames());
	const [isOCRModalOpen, setIsOCRModalOpen] = useState(false);
	const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
	const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
	const [saveModalName, setSaveModalName] = useState('');
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
	const [deleteSlotName, setDeleteSlotName] = useState('');
	const [copyFeedback, setCopyFeedback] = useState(false);

	function refreshSlots() {
		setSavedSlots(getSavedSlotNames());
	}

	function handleSaveNew() {
		const uma = state.outfitId
			? (umas as any)[state.outfitId.slice(0, 4)]?.name?.[1]
			: null;
		setSaveModalName(uma || 'Horse');
		setIsSaveModalOpen(true);
	}

	function handleSaveConfirm() {
		const name = saveModalName.trim();
		if (!name) return;
		saveHorseSlot(name, horseStateToUmaState(state));
		refreshSlots();
		setIsSaveModalOpen(false);
	}

	function handleSaveOverwrite(name: string) {
		saveHorseSlot(name, horseStateToUmaState(state));
		refreshSlots();
	}

	async function handleDownloadJson() {
		downloadHorseJson(horseStateToUmaState(state));
	}

	async function handleCopyToClipboard() {
		const ok = await copyHorseToClipboard(horseStateToUmaState(state));
		if (ok) {
			setCopyFeedback(true);
			setTimeout(() => setCopyFeedback(false), 1500);
		}
	}

	function handleImportJson() {
		setIsImportDialogOpen(true);
	}

	async function handlePasteFromClipboard() {
		const uma = await pasteHorseFromClipboard();
		if (uma) setState(umaStateToHorseState(uma));
	}

	function handleDeleteSlot(name: string) {
		setDeleteSlotName(name);
		setIsDeleteModalOpen(true);
	}

	function handleDeleteConfirm() {
		deleteHorseSlot(deleteSlotName);
		refreshSlots();
		setIsDeleteModalOpen(false);
	}

	const saveMenuItems = [
		{
			label: 'Save as new...',
			icon: h(Save, { size: 14 }),
			onClick: handleSaveNew,
		},
		{
			label: 'Download JSON',
			icon: h(Download, { size: 14 }),
			onClick: handleDownloadJson,
		},
		{
			label: copyFeedback ? 'Copied!' : 'Copy to clipboard',
			icon: h(Copy, { size: 14 }),
			onClick: handleCopyToClipboard,
		},
		...(savedSlots.length > 0
			? [
					{ divider: true },
					{ label: 'Overwrite existing:', disabled: true },
					...savedSlots.slice(0, 5).map((name) => ({
						label: name,
						onClick: () => handleSaveOverwrite(name),
					})),
				]
			: []),
	];

	const loadMenuItems = [
		{
			label: 'Import JSON/B64...',
			icon: h(Upload, { size: 14 }),
			onClick: handleImportJson,
		},
		{
			label: 'Paste from clipboard',
			icon: h(Clipboard, { size: 14 }),
			onClick: handlePasteFromClipboard,
		},
		{
			label: 'Import from screenshot (OCR)',
			icon: h(Camera, { size: 14 }),
			onClick: () => setIsOCRModalOpen(true),
		},
		...(savedSlots.length > 0
			? [
					{ divider: true },
					{ label: 'Saved builds:', disabled: true },
					...savedSlots.map((name) => ({
						label: name,
						onClick: () => {
							const uma = loadHorseSlot(name);
							if (uma) setState(umaStateToHorseState(uma));
						},
						suffix: h(
							'button',
							{
								class: 'dropdownDeleteBtn',
								title: 'Delete',
								onMouseDown: (e: MouseEvent) => e.stopPropagation(),
								onClick: (e: MouseEvent) => {
									e.stopPropagation();
									handleDeleteSlot(name);
								},
							},
							h(Trash2, { size: 12 }),
						),
					})),
				]
			: []),
	];

	return (
		<>
			<Dropdown
				trigger={h(
					'button',
					{ class: 'horseActionBtn', title: 'Save' },
					h(Save, { size: 16 }),
				)}
				items={saveMenuItems}
			/>
			<Dropdown
				trigger={h(
					'button',
					{ class: 'horseActionBtn', title: 'Load' },
					h(Upload, { size: 16 }),
				)}
				items={loadMenuItems}
			/>
			{onReset && (
				<button class="horseActionBtn" title="Reset this uma" onClick={onReset}>
					{h(RotateCcw, { size: 16 })}
				</button>
			)}
			<OCRModal
				isOpen={isOCRModalOpen}
				onClose={() => setIsOCRModalOpen(false)}
				onConfirm={(uma) => setState(umaStateToHorseState(uma))}
			/>
			{isImportDialogOpen && (
				<ImportDialog
					onClose={() => setIsImportDialogOpen(false)}
					onImport={(s) => setState(s)}
				/>
			)}
			{isSaveModalOpen && (
				<div
					class="saveLoadOverlay"
					onClick={(e) => {
						if (e.target === e.currentTarget) setIsSaveModalOpen(false);
					}}
				>
					<div class="saveLoadModal">
						<h2 class="saveLoadModalTitle">Save Build</h2>
						<label class="saveLoadInputLabel">Build Name</label>
						<input
							type="text"
							class="saveLoadInput"
							value={saveModalName}
							onInput={(e) => setSaveModalName(e.currentTarget.value)}
							onKeyDown={(e) => e.key === 'Enter' && handleSaveConfirm()}
							autoFocus
						/>
						<div class="saveLoadModalActions">
							<button
								class="saveLoadBtnSecondary"
								onClick={() => setIsSaveModalOpen(false)}
							>
								Cancel
							</button>
							<button class="saveLoadBtnPrimary" onClick={handleSaveConfirm}>
								Save
							</button>
						</div>
					</div>
				</div>
			)}
			{isDeleteModalOpen && (
				<div
					class="saveLoadOverlay"
					onClick={(e) => {
						if (e.target === e.currentTarget) setIsDeleteModalOpen(false);
					}}
				>
					<div class="saveLoadModal">
						<h2 class="saveLoadModalTitle">Delete Build</h2>
						<p class="saveLoadDeleteText">
							Are you sure you want to delete "<strong>{deleteSlotName}</strong>
							"?
						</p>
						<div class="saveLoadModalActions">
							<button
								class="saveLoadBtnSecondary"
								onClick={() => setIsDeleteModalOpen(false)}
							>
								Cancel
							</button>
							<button class="saveLoadBtnDanger" onClick={handleDeleteConfirm}>
								Delete
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}

function App(props) {
	//const [language, setLanguage] = useLanguageSelect();
	const [darkMode, setDarkMode] = useState(() => {
		const stored = localStorage.getItem('theme');
		if (stored) return stored === 'dark';
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	});

	useEffect(() => {
		document.documentElement.classList.toggle('dark', darkMode);
		localStorage.setItem('theme', darkMode ? 'dark' : 'light');
	}, [darkMode]);
	const [activeTab, setActiveTab] = useState<'umalator' | 'umas'>('umalator');
	const [leftPanel, setLeftPanel] = useState<'uma' | 'settings'>('uma');
	const isMobile = useMobile();
	const [mobileDialogOpen, setMobileDialogOpen] = useState<
		null | 'uma' | 'settings'
	>(null);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const [racedef, setRaceDef] = useState(() => DEFAULT_PRESET.racedef);
	const [nsamples, setSamples] = useState(DEFAULT_SAMPLES);
	const [seed, setSeed] = useState(DEFAULT_SEED);
	const [runOnceCounter, setRunOnceCounter] = useState(0);
	const [isSimulationRunning, setIsSimulationRunning] = useState(false);
	const [simulationError, setSimulationError] = useState('');
	const [displayRun, setDisplayRun] = useState<
		'mean' | 'median' | 'min' | 'max'
	>('median');
	// round/totalRounds drive the "Run (round/total)" label; pct is this round's completion
	// fraction (skills whose batch has finished / total skills entering this round).
	const [simulationProgress, setSimulationProgress] = useState<{
		round: number;
		totalRounds: number;
		pct: number;
	} | null>(null);
	const [posKeepMode, setPosKeepModeRaw] = useState(PosKeepMode.Approximate);
	const [analysisMode, setAnalysisMode] = useState<'controlled' | 'full'>(
		() => {
			try {
				const v = localStorage.getItem('skill-analysis-mode');
				if (v === 'controlled' || v === 'full') return v;
			} catch {}
			return 'controlled';
		},
	);
	useEffect(() => {
		try {
			localStorage.setItem('skill-analysis-mode', analysisMode);
		} catch {}
	}, [analysisMode]);
	const [analysisPreset, setAnalysisPreset] = useState<AnalysisPresetName>(
		() => {
			try {
				const v = localStorage.getItem('skill-analysis-preset');
				if (v === 'quick' || v === 'balanced' || v === 'thorough') return v;
			} catch {}
			return 'balanced';
		},
	);
	useEffect(() => {
		try {
			localStorage.setItem('skill-analysis-preset', analysisPreset);
		} catch {}
	}, [analysisPreset]);
	const [showHp, toggleShowHp] = useReducer((b, _) => !b, false);
	const [showLanes, toggleShowLanes] = useReducer((b, _) => !b, false);
	const [showPoskeepGap, toggleShowPoskeepGap] = useReducer((b, _) => !b, true);
	const [showLabels, toggleShowLabels] = useReducer((b, _) => !b, true);

	// Wrapper to handle mode changes and reset tab if needed
	function setPosKeepMode(mode: PosKeepMode) {
		setPosKeepModeRaw(mode);
		// If switching away from Virtual mode while on the pacemaker tab (index 2), switch back to uma1
		if (mode !== PosKeepMode.Virtual && currentIdx === 2) {
			updateUiState(UiStateMsg.SetCurrentIdx0);
		}
	}

	const [activeChartIconTypes, setActiveChartIconTypes] = useState<Set<string>>(
		() => {
			try {
				const saved = localStorage.getItem('chartIconFilter');
				if (saved) {
					const parsed: string[] = JSON.parse(saved);
					const valid = parsed.filter((t) =>
						(CHART_ICON_TYPE_FILTERS as readonly string[]).includes(t),
					);
					if (valid.length > 0) return new Set(valid);
				}
			} catch {}
			return new Set(
				CHART_ICON_TYPE_FILTERS.filter((t) => t !== '2002' && t !== '2005'),
			);
		},
	);

	useEffect(() => {
		localStorage.setItem(
			'chartIconFilter',
			JSON.stringify(Array.from(activeChartIconTypes)),
		);
	}, [activeChartIconTypes]);
	const [lastRunChartIconTypes, setLastRunChartIconTypes] = useState<
		Set<string>
	>(new Set());

	// Hides the ~250 9xxxxx inherited-unique skills from the Chart-mode candidate pool -- real
	// (rarity 4/5) uniques never enter the pool at all (isGeneralSkill already excludes them), so
	// this is the only "unique" filter that actually does anything. A dedicated localStorage key,
	// matching skill-analysis-mode/-preset and chartIconFilter's own convention: a candidate-pool
	// work-scoping knob, not part of the race definition, so it doesn't ride in the umalator-settings
	// share-link blob.
	const [hideInheritedUniques, setHideInheritedUniques] = useState<boolean>(
		() => localStorage.getItem('chartHideUniques') === 'true',
	);

	useEffect(() => {
		localStorage.setItem('chartHideUniques', String(hideInheritedUniques));
	}, [hideInheritedUniques]);
	const [lastRunHideInheritedUniques, setLastRunHideInheritedUniques] =
		useState(false);

	function toggleChartIconType(iconType: string) {
		setActiveChartIconTypes((prev) => {
			if (prev.has(iconType) && prev.size === 1) return prev;
			const next = new Set(prev);
			if (next.has(iconType)) {
				next.delete(iconType);
			} else {
				next.add(iconType);
			}
			return next;
		});
	}

	// Drag-to-resize splitter between #topPane (mode tabs/run bar/race track/control panel) and the
	// skill chart table below it. topPaneHeight === null means "unset, behave exactly like before this
	// feature existed" — the layout stays fully auto until the user actually drags the handle.
	const topPaneRef = useRef<HTMLDivElement>(null);
	const [topPaneHeight, setTopPaneHeight] = useState<number | null>(() => {
		const v = parseInt(
			localStorage.getItem('umalator-toppane-height') ?? '',
			10,
		);
		return Number.isFinite(v) && v > 0 ? v : null;
	});
	useEffect(() => {
		if (topPaneHeight == null)
			localStorage.removeItem('umalator-toppane-height');
		else localStorage.setItem('umalator-toppane-height', String(topPaneHeight));
	}, [topPaneHeight]);

	const SPLITTER_MIN_TOP = 120; // keeps #modeTabs + #runBar visible
	const SPLITTER_MIN_CHART = 200; // always leave a usable table

	function onSplitterDown(e: PointerEvent) {
		const pane = topPaneRef.current,
			main = pane?.parentElement;
		if (!pane || !main) return;
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		const startY = e.clientY,
			startH = pane.getBoundingClientRect().height;
		const maxH = main.clientHeight - SPLITTER_MIN_CHART;
		const move = (ev: PointerEvent) =>
			setTopPaneHeight(
				Math.max(
					SPLITTER_MIN_TOP,
					Math.min(maxH, startH + (ev.clientY - startY)),
				),
			);
		const up = (ev: PointerEvent) => {
			handle.releasePointerCapture(ev.pointerId);
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			document.body.classList.remove('splitterDragging');
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
		document.body.classList.add('splitterDragging');
	}

	const [syncRng, toggleSyncRng] = useReducer((b, _) => !b, false);
	const [skillWisdomCheck, toggleSkillWisdomCheck] = useReducer(
		(b, _) => !b,
		true,
	);
	const [rushedKakari, toggleRushedKakari] = useReducer((b, _) => !b, true);
	const [competeFight, setCompeteFight] = useState(false);
	const [leadCompetition, setLeadCompetition] = useState(true);
	const [duelingConfigOpen, setDuelingConfigOpen] = useState(false);
	// A nullable union rather than a boolean so a future "Bugs" panel is a one-line
	// addition (`| 'bugs'`) instead of a second parallel state variable.
	const [overlayPanel, setOverlayPanel] = useState<null | 'limitations'>(null);
	const [duelingRates, setDuelingRates] = useState({
		runaway: 10,
		frontRunner: 20,
		paceChaser: 30,
		lateSurger: 35,
		endCloser: 35,
	});
	const [hpDeathPositionTab, setHpDeathPositionTab] = useState(0);
	const [showVirtualPacemakerOnGraph, toggleShowVirtualPacemakerOnGraph] =
		useReducer((b, _) => !b, false);
	const [pacemakerCount, setPacemakerCount] = useState(1);
	const [selectedPacemakerIndices, setSelectedPacemakerIndices] = useState([]); // Array of selected pacemaker indices (0, 1, 2), empty means none selected
	const [isPacemakerDropdownOpen, setIsPacemakerDropdownOpen] = useState(false);

	function handlePacemakerCountChange(newCount: number) {
		setPacemakerCount(newCount);
		const newSelection = selectedPacemakerIndices.filter(
			(index) => index < newCount,
		);
		setSelectedPacemakerIndices(newSelection);
	}

	function handlePacemakerSelectionChange(selectedIndices: number[]) {
		setSelectedPacemakerIndices(selectedIndices);
	}

	function togglePacemakerSelection(index: number) {
		const newSelection = [...selectedPacemakerIndices];
		const existingIndex = newSelection.indexOf(index);
		if (existingIndex > -1) {
			newSelection.splice(existingIndex, 1);
		} else {
			newSelection.push(index);
		}

		setSelectedPacemakerIndices(newSelection);
	}

	function getSelectedPacemakers(): boolean[] {
		const result = [false, false, false];

		selectedPacemakerIndices.forEach((index) => {
			if (index >= 0 && index < 3) {
				result[index] = true;
			}
		});

		return result;
	}

	function handleSyncRngToggle() {
		toggleSyncRng(null);
	}

	function handleSkillWisdomCheckToggle() {
		toggleSkillWisdomCheck(null);
	}

	function handleRushedKakariToggle() {
		toggleRushedKakari(null);
	}

	function autoSaveSettings() {
		saveToLocalStorage(
			courseId,
			nsamples,
			seed,
			posKeepMode,
			racedef,
			uma1,
			uma2,
			pacer,
			showVirtualPacemakerOnGraph,
			pacemakerCount,
			getSelectedPacemakers(),
			showLanes,
			{
				syncRng,
				skillWisdomCheck,
				rushedKakari,
			},
			competeFight,
			leadCompetition,
			duelingRates,
			{ showHp, showPoskeepGap, showLabels },
		);
	}

	function resetUmas() {
		setUma1(new HorseState());
		setUma2(new HorseState());
		if (posKeepMode === PosKeepMode.Virtual) {
			setPacer(new HorseState({ strategy: 'Nige' }));
		}
	}

	function resetAllUmas() {
		setUma1(new HorseState());
		setUma2(new HorseState());
		setPacer(new HorseState({ strategy: 'Nige' }));
	}

	const [
		{
			courseId,
			results,
			runData,
			chartData,
			displaying,
			spurtInfo,
			staminaStats,
			firstUmaStats,
		},
		setSimState,
	] = useReducer(updateResultsState, EMPTY_RESULTS_STATE);
	const setCourseId = setSimState;
	const setResults = setSimState;
	const setChartData = setSimState;

	// tableData is purely a rendered view of chartRunRef.current -- see refreshTableRowsNow(). It's
	// still a useState (not a ref) because BasinnChart needs to re-render when it changes.
	const [tableData, setTableData] = useState<Map<string, ChartRow>>(new Map());
	const selectedSkillIdRef = useRef('');

	const [popoverSkill, setPopoverSkill] = useState('');

	function racesetter(prop) {
		return (value) => setRaceDef(racedef.set(prop, value));
	}

	const course = useMemo(() => CourseHelpers.getCourse(courseId), [courseId]);

	const [uma1, setUma1] = useState(() => new HorseState());
	const [uma2, setUma2] = useState(() => new HorseState());
	const [pacer, setPacer] = useState(
		() => new HorseState({ strategy: 'Nige' }),
	);

	const [lastRunChartUma, setLastRunChartUma] = useState(uma1);
	const [lastRunChartCourseId, setLastRunChartCourseId] = useState(courseId);

	const [{ mode, currentIdx, expanded }, updateUiState] = useReducer(
		nextUiState,
		DEFAULT_UI_STATE,
	);
	function toggleExpand(e: Event) {
		e.stopPropagation();
		postEvent('toggleExpand', { expand: !expanded });
		updateUiState(UiStateMsg.ToggleExpand);
	}

	// --- Skill Chart coordinator state ---
	// chartRunRef holds every piece of mutable state a chart run needs: which round it's on, the
	// pull queue for the round in progress, each candidate's accumulated samples, and each
	// candidate's most recent evaluateRound() decision. It's a ref (not React state) because it's
	// mutated many times per second while a chart streams in -- see workerPool.ts's message
	// handler below, which drives all of this imperatively and only touches React state
	// (setTableData/setSimulationProgress/setIsSimulationRunning) when there's something new to
	// actually render.
	const chartRunRef = useRef<ChartRunState | null>(null);
	const jobIdRef = useRef(0);
	const msPerScenarioRef = useRef(5); // adaptive batch-size estimate, refined from chart-batch-done
	const refreshScheduledRef = useRef(false);
	const detailRequestIdRef = useRef(0);
	const detailCacheRef = useRef<Map<string, Record<string, ChartRunTraceLike>>>(
		new Map(),
	);

	const poolRef = useRef<WorkerPool | null>(null);
	if (poolRef.current == null) {
		poolRef.current = createWorkerPool(4, './simulator.worker.js');
	}
	useEffect(() => () => poolRef.current?.dispose(), []);

	// Re-registered every render (no dependency array) so the handler always closes over the
	// latest setResults/setTableData/etc -- cheap (it just reassigns a callback reference inside
	// the pool, see workerPool.ts) and avoids the staleness that made the old inline
	// useMemo-in-.map() worker handler unable to see fresh state without a ref.
	useEffect(() => {
		const pool = poolRef.current;
		if (!pool) return;
		pool.setHandler((workerIndex, data) => {
			switch (data.type) {
				case 'compare':
					setResults(data.results);
					break;
				case 'compare-complete':
					setIsSimulationRunning(false);
					setSimulationProgress(null);
					break;
				case 'chart-batch-chunk': {
					const run = chartRunRef.current;
					if (!run || data.jobId !== run.jobId) break;
					const blockSeed = roundBlockSeed(run.baseSeed, data.round);
					const blockSize = blockSizeForRound(run, data.round);
					for (const row of data.rows) {
						let acc = run.accumulators.get(row.id);
						if (!acc) {
							acc = new SkillAccumulator(row.id);
							run.accumulators.set(row.id, acc);
						}
						acc.addBlock(row, { blockSeed, blockSize });
					}
					scheduleTableRefresh();
					break;
				}
				case 'chart-batch-done': {
					const run = chartRunRef.current;
					if (!run || data.jobId !== run.jobId) break;
					const batch = run.outstanding.get(data.batchId);
					if (!batch) break;
					run.outstanding.delete(data.batchId);

					if (batch.kind === 'refine') {
						// One-off top-up for an already-finalized row: recompute its cached
						// statistics with the extra samples and stop, independent of the ladder's
						// own round/queue bookkeeping.
						finalizeRow(run, batch.skillIds[0], 'final', null);
						scheduleTableRefresh();
						if (run.outstanding.size === 0) setIsSimulationRunning(false);
						break;
					}

					run.completedThisRound += batch.skillIds.length;
					if (data.scenariosRun > 0 && data.elapsedMs > 0) {
						const sample = data.elapsedMs / data.scenariosRun;
						msPerScenarioRef.current =
							msPerScenarioRef.current * 0.7 + sample * 0.3;
					}
					updateSimulationProgress(run);
					if (run.queue.length > 0) {
						dispatchNextBatch(workerIndex);
					} else if (run.outstanding.size === 0) {
						finishRound(run);
					}
					break;
				}
				case 'chart-error': {
					const run = chartRunRef.current;
					if (!run || data.jobId !== run.jobId) break;
					console.warn(
						`Skill Chart: ${data.skillId} failed to simulate: ${data.message}`,
					);
					if (!run.accumulators.has(data.skillId)) {
						run.accumulators.set(
							data.skillId,
							new SkillAccumulator(data.skillId),
						);
					}
					break;
				}
				case 'chart-detail': {
					if (data.requestId !== detailRequestIdRef.current) break; // superseded
					const run = chartRunRef.current;
					if (!run || data.jobId !== run.jobId) break;
					detailCacheRef.current.set(data.skillId, data.runs);
					if (detailCacheRef.current.size > 8) {
						const oldestKey = detailCacheRef.current.keys().next().value;
						if (oldestKey !== undefined)
							detailCacheRef.current.delete(oldestKey);
					}
					if (selectedSkillIdRef.current === data.skillId) {
						applyDetailToSelection(data.skillId, data.runs);
					}
					break;
				}
			}
		});
	});

	function scheduleTableRefresh() {
		if (refreshScheduledRef.current) return;
		refreshScheduledRef.current = true;
		requestAnimationFrame(() => {
			refreshScheduledRef.current = false;
			const run = chartRunRef.current;
			if (run) refreshTableRowsNow(run);
		});
	}

	function refreshTableRowsNow(run: ChartRunState) {
		const next = new Map<string, ChartRow>();
		for (const [id, acc] of run.accumulators) {
			const cached = run.finalizedRows.get(id);
			if (cached) {
				next.set(id, cached);
				continue;
			}
			const statistics =
				acc.n > 0
					? summarizeLengths(acc.lengths(), acc.times(), acc.procCounts(), {
							ciMethod: 't',
						})
					: null;
			next.set(id, {
				id,
				n: acc.n,
				statistics,
				status: acc.n > 0 ? 'refining' : 'pending',
				eliminationReason: null,
			});
		}
		setTableData(next);
	}

	// Computes and caches a row's statistics once its status stops changing (screened/inert/final)
	// -- called once per skill per terminal transition, so a skill that finalizes early in a long
	// chart run doesn't pay for a fresh BCa bootstrap (or even just a fresh sort) on every
	// subsequent rAF-throttled refresh while other, still-active skills keep streaming in.
	function finalizeRow(
		run: ChartRunState,
		id: string,
		status: SkillStatus,
		eliminationReason: EliminationReason,
	): ChartRow {
		const acc = run.accumulators.get(id)!;
		const ciMethod = status === 'final' ? 'bca' : 't';
		const statistics = summarizeLengths(
			acc.lengths(),
			acc.times(),
			acc.procCounts(),
			{
				ciMethod,
				bootstrapSamples: run.preset.bootstrapSamples,
				seed: deriveSeed(run.baseSeed, id),
			},
		);
		const row: ChartRow = {
			id,
			n: acc.n,
			statistics,
			status,
			eliminationReason,
		};
		run.finalizedRows.set(id, row);
		return row;
	}

	function updateSimulationProgress(run: ChartRunState) {
		setSimulationProgress({
			round: run.roundIndex + 1,
			totalRounds: run.preset.rounds.length,
			pct:
				run.roundParticipants.length > 0
					? run.completedThisRound / run.roundParticipants.length
					: 0,
		});
	}

	// Block size for a given round index, including "virtual" rounds past the end of the ladder --
	// Refine (refineSkill) draws one more block the same size as the ladder's own last round, at
	// a round index beyond preset.rounds.length, so it gets a fresh disjoint seed
	// (roundBlockSeed is a pure function of round index, no bounds check needed) without
	// colliding with any real ladder round.
	function blockSizeForRound(run: ChartRunState, roundIndex: number): number {
		const rounds = run.preset.rounds;
		if (roundIndex < rounds.length) {
			const prevN = roundIndex > 0 ? rounds[roundIndex - 1].n : 0;
			return rounds[roundIndex].n - prevN;
		}
		return rounds[rounds.length - 1].n;
	}

	function dispatchNextBatch(workerIndex: number) {
		const run = chartRunRef.current;
		const pool = poolRef.current;
		if (!run || !pool || run.queue.length === 0) return;
		const blockSize = blockSizeForRound(run, run.roundIndex);
		const batchSize = Math.max(
			1,
			Math.min(
				32,
				Math.round(1500 / Math.max(1, blockSize * msPerScenarioRef.current)),
			),
		);
		const skillIds = run.queue.splice(0, batchSize);
		const batchId = run.nextBatchId++;
		run.outstanding.set(batchId, { skillIds, kind: 'round' });
		pool.post(workerIndex, {
			msg: 'chart-batch',
			data: {
				jobId: run.jobId,
				round: run.roundIndex,
				batchId,
				blockSeed: roundBlockSeed(run.baseSeed, run.roundIndex),
				blockSize,
				skillIds,
				course: run.course,
				racedef: run.racedef,
				uma: run.uma,
				pacer: run.pacer,
				analysisOptions: run.analysisOptions,
			},
		});
	}

	function finishRound(run: ChartRunState) {
		const candidates: RoundCandidate[] = run.roundParticipants.map((id) =>
			candidateFromAccumulator(run.accumulators.get(id)!),
		);
		const round = run.preset.rounds[run.roundIndex];
		const isLastRound = run.roundIndex === run.preset.rounds.length - 1;
		const decisions = evaluateRound(candidates, round, run.preset, isLastRound);

		const survivors: string[] = [];
		for (const d of decisions) {
			if (d.status === 'refining') {
				survivors.push(d.id);
			} else {
				finalizeRow(run, d.id, d.status, d.eliminationReason);
			}
		}
		refreshTableRowsNow(run);

		if (survivors.length > 0 && run.roundIndex + 1 < run.preset.rounds.length) {
			run.roundIndex += 1;
			run.roundParticipants = survivors;
			run.queue = survivors.slice();
			run.completedThisRound = 0;
			const pool = poolRef.current;
			if (pool) for (let w = 0; w < pool.size; ++w) dispatchNextBatch(w);
			updateSimulationProgress(run);
		} else {
			// Ladder complete (or nothing survived to continue it). The run's data -- accumulators,
			// course/racedef/uma, etc -- stays in chartRunRef so finished rows can still be
			// expanded (requestChartDetail) or refined (refineSkill); only a new run or an
			// explicit Stop replaces it.
			setIsSimulationRunning(false);
			setSimulationProgress(null);
		}
	}

	function stopChart() {
		poolRef.current?.cancelAll();
		setIsSimulationRunning(false);
		setSimulationProgress(null);
	}

	// Fetches the 4 sample traces (min/max/closest-to-mean/median length gain) an expanded row's
	// velocity chart needs, re-simulating just those specific scenarios rather than retaining or
	// streaming a trace for every row up front -- see compare.ts's runComparisonBlock() and
	// SkillAccumulator.resolveIndex().
	function requestChartDetail(skillId: string) {
		const run = chartRunRef.current;
		const cached = detailCacheRef.current.get(skillId);
		if (cached) {
			applyDetailToSelection(skillId, cached);
		}
		if (!run) return;
		const acc = run.accumulators.get(skillId);
		if (!acc || acc.n === 0) return;

		const lengths = acc.lengths();
		let minIdx = 0,
			maxIdx = 0;
		for (let i = 1; i < lengths.length; ++i) {
			if (lengths[i] < lengths[minIdx]) minIdx = i;
			if (lengths[i] > lengths[maxIdx]) maxIdx = i;
		}
		const { mean } = acc.meanVariance();
		let meanIdx = 0,
			bestMeanDiff = Infinity;
		for (let i = 0; i < lengths.length; ++i) {
			const d = Math.abs(lengths[i] - mean);
			if (d < bestMeanDiff) {
				bestMeanDiff = d;
				meanIdx = i;
			}
		}
		const order = Array.from(lengths.keys()).sort(
			(a, b) => lengths[a] - lengths[b],
		);
		const medianIdx = order[Math.floor(order.length / 2)];

		const picks = (
			[
				['minrun', minIdx],
				['maxrun', maxIdx],
				['meanrun', meanIdx],
				['medianrun', medianIdx],
			] as const
		)
			.map(([label, idx]) => {
				const resolved = acc.resolveIndex(idx);
				return resolved ? { label, ...resolved } : null;
			})
			.filter(
				(
					p,
				): p is {
					label: string;
					blockSeed: number;
					blockSize: number;
					index: number;
				} => p != null,
			);
		if (picks.length === 0) return;

		const requestId = ++detailRequestIdRef.current;
		poolRef.current?.post(0, {
			msg: 'chart-detail',
			data: {
				jobId: run.jobId,
				requestId,
				skillId,
				picks,
				course: run.course,
				racedef: run.racedef,
				uma: run.uma,
				pacer: run.pacer,
				analysisOptions: run.analysisOptions,
			},
		});
	}

	// The two activation-position bar charts (LengthDifferenceChart, ActivationFrequencyChart) are
	// pure functions of (activation position, that scenario's length gain) pairs, which the main
	// thread already has in full from every chart-batch-chunk -- no fetch needed, unlike the
	// velocity chart's full per-tick trace. Synthesizes the same `allruns` shape compare.ts's
	// runComparison() used to build directly, so neither chart component needed to change.
	function synthesizeAllRuns(acc: SkillAccumulator) {
		const lengths = acc.lengths();
		const procCounts = acc.procCounts();
		const procPositions = acc.procPositions();
		const positions: number[] = [];
		const pairs: Array<[number, number]> = [];
		let posIdx = 0;
		for (let i = 0; i < lengths.length; ++i) {
			for (let c = 0; c < procCounts[i]; ++c, ++posIdx) {
				const pos = procPositions[posIdx];
				positions.push(pos);
				pairs.push([pos, lengths[i]]);
			}
		}
		return {
			sk: [new Map(), new Map([[acc.id, positions]])],
			skBasinn: [new Map(), new Map([[acc.id, pairs]])],
			totalRuns: acc.n,
		};
	}

	// Feeds a fetched detail response into the same results/runData/chartData state Compare mode
	// uses, so a selected chart row drives the RaceTrack graphic (VelocityLines, skill-activation
	// regions) exactly like a Compare-mode result already does.
	function applyDetailToSelection(
		skillId: string,
		runs: Record<string, ChartRunTraceLike>,
	) {
		const run = chartRunRef.current;
		const acc = run?.accumulators.get(skillId);
		if (!acc) return;
		setResults({
			results: Array.from(acc.lengths()),
			runData: {
				minrun: runs.minrun ?? null,
				maxrun: runs.maxrun ?? null,
				meanrun: runs.meanrun ?? null,
				medianrun: runs.medianrun ?? null,
				allruns: synthesizeAllRuns(acc),
			},
		});
	}

	function loadState() {
		if (window.location.hash) {
			deserialize(window.location.hash.slice(1)).then((o) => {
				setCourseId(o.courseId);
				setSamples(o.nsamples);
				setSeed(o.seed);
				setPosKeepModeRaw(o.posKeepMode);
				setRaceDef(o.racedef);
				setUma1(o.uma1);
				setUma2(o.uma2);
				setPacer(o.pacer);
				setPacemakerCount(o.pacemakerCount);
				setSelectedPacemakerIndices(
					o.selectedPacemakers
						? o.selectedPacemakers
								.map((selected, index) => (selected ? index : -1))
								.filter((index) => index !== -1)
						: [],
				);

				if (
					o.showVirtualPacemakerOnGraph !== undefined &&
					o.showVirtualPacemakerOnGraph !== showVirtualPacemakerOnGraph
				) {
					toggleShowVirtualPacemakerOnGraph(null);
				}

				if (o.showLanes !== undefined && o.showLanes !== showLanes) {
					toggleShowLanes(null);
				}

				if (o.witVarianceSettings) {
					const settings = o.witVarianceSettings;
					if (settings.syncRng !== undefined && settings.syncRng !== syncRng)
						toggleSyncRng(null);
					if (
						settings.skillWisdomCheck !== undefined &&
						settings.skillWisdomCheck !== skillWisdomCheck
					)
						toggleSkillWisdomCheck(null);
					if (
						settings.rushedKakari !== undefined &&
						settings.rushedKakari !== rushedKakari
					)
						toggleRushedKakari(null);
				}

				if (o.competeFight !== undefined) {
					setCompeteFight(o.competeFight);
				}
				if (o.leadCompetition !== undefined) {
					setLeadCompetition(o.leadCompetition);
				}
				if (o.duelingRates) {
					setDuelingRates(o.duelingRates);
				}
				if (o.graphToggles) {
					if (o.graphToggles.showHp !== showHp) toggleShowHp(null);
					if (
						o.graphToggles.showPoskeepGap !== undefined &&
						o.graphToggles.showPoskeepGap !== showPoskeepGap
					)
						toggleShowPoskeepGap(null);
					if (
						o.graphToggles.showLabels !== undefined &&
						o.graphToggles.showLabels !== showLabels
					)
						toggleShowLabels(null);
				}
			});
		} else {
			loadFromLocalStorage().then((o) => {
				if (o) {
					setCourseId(o.courseId);
					setSamples(o.nsamples);
					setSeed(o.seed);
					setPosKeepModeRaw(o.posKeepMode);
					setRaceDef(o.racedef);
					setUma1(o.uma1);
					setUma2(o.uma2);
					setPacer(o.pacer);
					setPacemakerCount(o.pacemakerCount);
					setSelectedPacemakerIndices(
						o.selectedPacemakers
							? o.selectedPacemakers
									.map((selected, index) => (selected ? index : -1))
									.filter((index) => index !== -1)
							: [],
					);

					if (
						o.showVirtualPacemakerOnGraph !== undefined &&
						o.showVirtualPacemakerOnGraph !== showVirtualPacemakerOnGraph
					) {
						toggleShowVirtualPacemakerOnGraph(null);
					}

					if (o.showLanes !== undefined && o.showLanes !== showLanes) {
						toggleShowLanes(null);
					}

					if (o.witVarianceSettings) {
						const settings = o.witVarianceSettings;
						if (settings.syncRng !== undefined && settings.syncRng !== syncRng)
							toggleSyncRng(null);
						if (
							settings.skillWisdomCheck !== undefined &&
							settings.skillWisdomCheck !== skillWisdomCheck
						)
							toggleSkillWisdomCheck(null);
						if (
							settings.rushedKakari !== undefined &&
							settings.rushedKakari !== rushedKakari
						)
							toggleRushedKakari(null);
					}

					if (o.competeFight !== undefined) {
						setCompeteFight(o.competeFight);
					}
					if (o.leadCompetition !== undefined) {
						setLeadCompetition(o.leadCompetition);
					}
					if (o.duelingRates) {
						setDuelingRates(o.duelingRates);
					}
					if (o.graphToggles) {
						if (o.graphToggles.showHp !== showHp) toggleShowHp(null);
						if (
							o.graphToggles.showPoskeepGap !== undefined &&
							o.graphToggles.showPoskeepGap !== showPoskeepGap
						)
							toggleShowPoskeepGap(null);
						if (
							o.graphToggles.showLabels !== undefined &&
							o.graphToggles.showLabels !== showLabels
						)
							toggleShowLabels(null);
					}
				}
			});
		}
	}

	useEffect(() => {
		loadState();
		window.addEventListener('hashchange', loadState);
	}, []);

	// Auto-save settings whenever they change
	useEffect(() => {
		autoSaveSettings();
	}, [
		courseId,
		nsamples,
		seed,
		posKeepMode,
		racedef,
		uma1,
		uma2,
		pacer,
		syncRng,
		skillWisdomCheck,
		rushedKakari,
		showVirtualPacemakerOnGraph,
		pacemakerCount,
		selectedPacemakerIndices,
		competeFight,
		leadCompetition,
		duelingRates,
		showHp,
		showPoskeepGap,
		showLabels,
	]);

	useEffect(() => {
		const shouldShow =
			posKeepMode === PosKeepMode.Virtual &&
			selectedPacemakerIndices.length > 0;
		if (shouldShow !== showVirtualPacemakerOnGraph) {
			if (shouldShow && !showVirtualPacemakerOnGraph) {
				toggleShowVirtualPacemakerOnGraph(null);
			} else if (!shouldShow && showVirtualPacemakerOnGraph) {
				toggleShowVirtualPacemakerOnGraph(null);
			}
		}
	}, [posKeepMode, selectedPacemakerIndices.length]);

	function copyStateUrl(e) {
		e.preventDefault();
		serialize(
			courseId,
			nsamples,
			seed,
			posKeepMode,
			racedef,
			uma1,
			uma2,
			pacer,
			showVirtualPacemakerOnGraph,
			pacemakerCount,
			getSelectedPacemakers(),
			showLanes,
			{
				syncRng,
				skillWisdomCheck,
				rushedKakari,
			},
			competeFight,
			leadCompetition,
			duelingRates,
			{ showHp, showPoskeepGap, showLabels },
		).then((hash) => {
			const url =
				window.location.protocol +
				'//' +
				window.location.host +
				window.location.pathname;
			window.navigator.clipboard.writeText(url + '#' + hash);
		});
	}

	function copyUmaToRight() {
		postEvent('copyUma', { direction: 'to-right' });
		setUma2(uma1);
	}

	function copyUmaToLeft() {
		postEvent('copyUma', { direction: 'to-left' });
		setUma1(uma2);
	}

	function swapUmas() {
		postEvent('copyUma', { direction: 'swap' });
		setUma1(uma2);
		setUma2(uma1);
	}

	const strings = {
		skillnames: {},
		tracknames: TRACKNAMES_en,
		ui: CC_GLOBAL ? UI_global : UI_en,
	};
	const langid = +(props.lang == 'en');
	Object.keys(skillnames).forEach((id) => {
		strings.skillnames[id] = skillnames[id][langid];
	});

	function doComparison() {
		postEvent('doComparison', {});
		setSimulationError('');
		setIsSimulationRunning(true);
		setSimulationProgress(null);
		poolRef.current?.post(0, {
			msg: 'compare',
			data: {
				nsamples,
				course,
				racedef: racedefToParams(racedef),
				uma1: uma1.toJS(),
				uma2: uma2.toJS(),
				pacer: pacer.toJS(),
				options: {
					seed,
					posKeepMode,
					pacemakerCount:
						posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates,
				},
			},
		});
	}

	function doRunOnce() {
		postEvent('doRunOnce', {});
		setSimulationError('');
		setIsSimulationRunning(true);
		const effectiveSeed = seed + runOnceCounter;
		setRunOnceCounter((prev) => prev + 1);
		poolRef.current?.post(0, {
			msg: 'compare',
			data: {
				nsamples: 1,
				course,
				racedef: racedefToParams(racedef),
				uma1: uma1.toJS(),
				uma2: uma2.toJS(),
				pacer: pacer.toJS(),
				options: {
					seed: effectiveSeed,
					posKeepMode,
					pacemakerCount:
						posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates,
				},
			},
		});
	}

	function getUniqueSkills() {
		return Object.keys(skilldata).filter((id) => {
			const skill = skilldata[id];
			return skill.rarity >= 4 && id.startsWith('1');
		});
	}

	function removeUniqueSkills(uma) {
		const uniqueSkills = getUniqueSkills();
		const filteredSkills = uma.skills.filter(
			(skillId) => !uniqueSkills.includes(skillId),
		);
		return uma.set('skills', filteredSkills);
	}

	// The chart's two models differ only in the multi-uma jostling flags and position keeping.
	// Both request `mode: 'compare'` -- that's what gives the chart a real HP policy
	// (RaceSolverBuilder.ts gates GameHpPolicy on exactly this string) instead of the no-op policy
	// a chart run got by omission before this rewrite, and it's why HP-only (recovery) skills no
	// longer need to be excluded from the candidate list: they now have a real HP budget to act on
	// in either model. Wisdom checks follow the user's own Settings toggle (skillWisdomCheck) in
	// both models rather than being forced off, so Expected gain reflects this uma's actual proc
	// chance and the Proc column shows the rate driving it.
	function buildChartOptions(analysisMode: 'controlled' | 'full') {
		const isFull = analysisMode === 'full';
		return {
			seed,
			mode: 'compare',
			skillWisdomCheck,
			posKeepMode: isFull ? posKeepMode : PosKeepMode.Approximate,
			pacemakerCount:
				isFull && posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
			rushedKakari: isFull ? rushedKakari : false,
			competeFight: isFull ? competeFight : false,
			leadCompetition: isFull ? leadCompetition : false,
			duelingRates: isFull ? duelingRates : undefined,
			laneMovement: false, // not exposed as a user setting anywhere in this app yet
			syncRng: true, // paired scenarios are always synced; not a Chart-mode setting
		};
	}

	function doBasinnChart() {
		postEvent('doBasinnChart', {});
		setLastRunChartUma(uma1);
		setLastRunChartCourseId(courseId);
		setSimulationError('');
		poolRef.current?.cancelAll();

		const params = racedefToParams(racedef, uma1.strategy);

		let skills: string[];
		let uma: any;
		if (mode === Mode.UniquesChart) {
			const uniqueSkills = getUniqueSkills();
			skills = getActivateableSkills(uniqueSkills, uma1, course, params);
			const umaWithoutUniques = removeUniqueSkills(uma1);
			uma = umaWithoutUniques.toJS();
		} else {
			skills = getActivateableSkills(
				baseSkillsToTest.filter((id) => {
					return !(
						(
							(id[0] == '9' && uma1.skills.includes('1' + id.slice(1))) || // reject inherited uniques if we already have the regular version
							(id == '92111091' && uma1.skills.includes('111091'))
						) // reject rhein kraft pink inherited unique on her (not covered by the above check since the ID is different)
					);
				}),
				uma1,
				course,
				params,
			);

			uma = uma1.toJS();
		}

		skills = skills.filter((id) => !isPurpleSkill(id));

		if (mode === Mode.Chart && hideInheritedUniques) {
			skills = skills.filter((id) => !id.startsWith('9'));
		}

		if (
			mode === Mode.Chart &&
			activeChartIconTypes.size < CHART_ICON_TYPE_FILTERS.length
		) {
			skills = skills.filter((id) =>
				CHART_ICON_TYPE_FILTERS.some(
					(t) => activeChartIconTypes.has(t) && matchChartIconType(id, t),
				),
			);
		}
		setLastRunChartIconTypes(new Set(activeChartIconTypes));
		setLastRunHideInheritedUniques(hideInheritedUniques);

		const preset = CHART_LADDERS[analysisPreset];
		const jobId = ++jobIdRef.current;
		const run: ChartRunState = {
			jobId,
			preset,
			course,
			racedef: params,
			uma,
			pacer: pacer.toJS(),
			analysisOptions: buildChartOptions(analysisMode),
			baseSeed: seed,
			roundIndex: 0,
			roundParticipants: skills.slice(),
			queue: skills.slice(),
			completedThisRound: 0,
			outstanding: new Map(),
			nextBatchId: 0,
			accumulators: new Map(),
			finalizedRows: new Map(),
			refineCounts: new Map(),
		};
		chartRunRef.current = run;
		detailCacheRef.current.clear();
		setTableData(new Map());
		setIsSimulationRunning(true);
		updateSimulationProgress(run);

		const pool = poolRef.current;
		if (pool) {
			for (let w = 0; w < pool.size; ++w) dispatchNextBatch(w);
		}
	}

	const [selectedSkillId, setSelectedSkillId] = useState('');
	// Safety net for any future caller of setSelectedSkillId that doesn't also update
	// selectedSkillIdRef synchronously the way basinnChartSelection does.
	useEffect(() => {
		selectedSkillIdRef.current = selectedSkillId;
	}, [selectedSkillId]);

	function basinnChartSelection(skillId: string) {
		// selectedSkillIdRef is also updated here, synchronously, not only through the
		// effect below that mirrors selectedSkillId into it: a detail fetch's worker round trip
		// (re-simulating 4 scenarios) is fast enough to have the chart-detail response's
		// selectedSkillIdRef comparison run before Preact has committed the setSelectedSkillId
		// update and flushed that effect, which silently dropped the response as "for a
		// different row" even though it was for this one.
		if (skillId && tableData.has(skillId)) {
			selectedSkillIdRef.current = skillId;
			setSelectedSkillId(skillId);
			requestChartDetail(skillId);
		} else {
			selectedSkillIdRef.current = '';
			setSelectedSkillId('');
		}
	}

	function refineSkill(skillId: string) {
		const run = chartRunRef.current;
		if (!run || isSimulationRunning) return;
		const acc = run.accumulators.get(skillId);
		if (!acc) return;
		// One extra block of the ladder's final round size, appended past wherever the ladder
		// left this skill -- reusing the same accumulator (and its provenance tracking) instead
		// of a bespoke merge path. The "round index" used for the block seed is one past the
		// preset's own rounds, keyed by how many refine blocks this skill has already received, so
		// repeated refines keep drawing fresh, disjoint scenario blocks.
		const refineRoundIndex =
			run.preset.rounds.length + (run.refineCounts.get(skillId) ?? 0);
		run.refineCounts.set(skillId, (run.refineCounts.get(skillId) ?? 0) + 1);
		const blockSize = blockSizeForRound(run, refineRoundIndex);
		const blockSeed = roundBlockSeed(run.baseSeed, refineRoundIndex);
		const batchId = run.nextBatchId++;
		run.outstanding.set(batchId, { skillIds: [skillId], kind: 'refine' });
		setIsSimulationRunning(true);
		poolRef.current?.post(0, {
			msg: 'chart-batch',
			data: {
				jobId: run.jobId,
				round: refineRoundIndex,
				batchId,
				blockSeed,
				blockSize,
				skillIds: [skillId],
				course: run.course,
				racedef: run.racedef,
				uma: run.uma,
				pacer: run.pacer,
				analysisOptions: run.analysisOptions,
			},
		});
	}

	function addSkillFromTable(skillId) {
		postEvent('addSkillFromTable', { skillId });
		setUma1(
			uma1.set('skills', uma1.skills.set(skillmeta[skillId].groupId, skillId)),
		);
	}

	function showPopover(skillId) {
		postEvent('showPopover', { skillId });
		setPopoverSkill(skillId);
	}

	useEffect(() => {
		document.body.addEventListener('click', () => {
			setPopoverSkill('');
		});
	}, []);

	useEffect(() => {
		function handleClickOutside(event) {
			if (
				isPacemakerDropdownOpen &&
				!event.target.closest('.pacemaker-combobox')
			) {
				setIsPacemakerDropdownOpen(false);
			}
		}

		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [isPacemakerDropdownOpen]);

	function rtMouseMove(pos) {
		if (chartData == null) return;
		document.getElementById('rtMouseOverBox').style.display = 'block';
		const x = pos * course.distance;
		const i0 = binSearch(chartData.p[0], x),
			i1 = binSearch(chartData.p[1], x);

		// Ensure indices are within bounds
		const safeI0 = Math.max(0, Math.min(i0, chartData.v[0].length - 1));
		const safeI1 = Math.max(0, Math.min(i1, chartData.v[1].length - 1));

		const hp0 =
			chartData.hp?.[0]?.[safeI0] != null
				? chartData.hp[0][safeI0].toFixed(0)
				: 'N/A';
		const hp1 =
			chartData.hp?.[1]?.[safeI1] != null
				? chartData.hp[1][safeI1].toFixed(0)
				: 'N/A';

		document.getElementById('rtV1').textContent =
			`${chartData.v[0][safeI0].toFixed(2)} m/s  t=${chartData.t[0][safeI0].toFixed(2)} s  (${hp0} hp remaining)`;
		document.getElementById('rtV2').textContent =
			`${chartData.v[1][safeI1].toFixed(2)} m/s  t=${chartData.t[1][safeI1].toFixed(2)} s  (${hp1} hp remaining)`;
	}

	function rtMouseLeave() {
		document.getElementById('rtMouseOverBox').style.display = 'none';
	}

	function handleSkillDrag(skillId, umaIndex, newStart, newEnd) {
		// Update the forced skill position for the appropriate horse
		if (umaIndex === 0) {
			setUma1(
				uma1.set(
					'forcedSkillPositions',
					uma1.forcedSkillPositions.set(skillId, newStart),
				),
			);
		} else if (umaIndex === 1) {
			setUma2(
				uma2.set(
					'forcedSkillPositions',
					uma2.forcedSkillPositions.set(skillId, newStart),
				),
			);
		} else if (umaIndex === 2) {
			setPacer(
				pacer.set(
					'forcedSkillPositions',
					pacer.forcedSkillPositions.set(skillId, newStart),
				),
			);
		}
	}

	const mid = Math.floor(results.length / 2);
	const median =
		results.length % 2 == 0
			? (results[mid - 1] + results[mid]) / 2
			: results[mid];
	const mean = results.reduce((a, b) => a + b, 0) / results.length;

	const colors = [
		{ stroke: '#2a77c5', fill: 'rgba(42, 119, 197, 0.5)' },
		{ stroke: '#c52a2a', fill: 'rgba(197, 42, 42, 0.5)' },
	];
	const skillActivations =
		chartData == null
			? []
			: chartData.sk.flatMap((a, i) => {
					return Array.from(a.keys()).flatMap((id) => {
						if (NO_SHOW.indexOf(skillmeta[id].iconId) > -1) return [];
						else
							return a.get(id).map((ar) => ({
								type: RegionDisplayType.Textbox,
								color: colors[i],
								text: skillnames[id][0],
								skillId: id,
								umaIndex: i,
								regions: [
									{ start: ar[0], end: ar[1] != -1 ? ar[1] : ar[0] + 100 },
								],
							}));
					});
				});

	const rushedColors = [
		{ stroke: 'rgb(42, 119, 197)', fill: 'rgba(42, 119, 197, 0.8)' }, // Blue for Uma 1
		{ stroke: 'rgb(197, 42, 42)', fill: 'rgba(197, 42, 42, 0.8)' }, // Red for Uma 2
	];
	const rushedIndicators =
		chartData == null
			? []
			: (chartData.rushed || [[], []]).flatMap((rushArray, i) => {
					return rushArray.map((ar) => ({
						type: RegionDisplayType.Textbox,
						color: rushedColors[i],
						text: 'Rushed',
						regions: [{ start: ar[0], end: ar[1] }],
					}));
				});

	const posKeepColors = [
		{ stroke: 'rgb(42, 119, 197)', fill: 'rgba(42, 119, 197, 0.6)' },
		{ stroke: 'rgb(197, 42, 42)', fill: 'rgba(197, 42, 42, 0.6)' },
	];

	const posKeepData =
		chartData == null
			? []
			: (chartData.posKeep || [[], []]).flatMap((posKeepArray, i) => {
					return posKeepArray.map((ar) => {
						const stateName =
							ar[2] === 1
								? 'PU'
								: ar[2] === 2
									? 'PDM'
									: ar[2] === 3
										? 'SU'
										: ar[2] === 4
											? 'O'
											: 'Unknown';
						return {
							umaIndex: i,
							text: stateName,
							color: posKeepColors[i],
							start: ar[0],
							end: ar[1],
							duration: ar[1] - ar[0],
						};
					});
				});

	const virtualPacemakerPosKeepData =
		showVirtualPacemakerOnGraph &&
		posKeepMode === PosKeepMode.Virtual &&
		chartData &&
		chartData.pacerPosKeep
			? (() => {
					const pacemakerPosKeepData = [];
					const pacemakerColors = [
						{ stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.6)' }, // Green
						{ stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.6)' }, // Purple
						{ stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.6)' }, // Pink
					];

					for (let pacemakerIndex = 0; pacemakerIndex < 3; pacemakerIndex++) {
						if (
							selectedPacemakerIndices.includes(pacemakerIndex) &&
							chartData.pacerPosKeep &&
							chartData.pacerPosKeep[pacemakerIndex]
						) {
							const pacerPosKeepArray = chartData.pacerPosKeep[pacemakerIndex];
							pacerPosKeepArray.forEach((ar) => {
								const stateName =
									ar[2] === 1
										? 'PU'
										: ar[2] === 2
											? 'PDM'
											: ar[2] === 3
												? 'SU'
												: ar[2] === 4
													? 'O'
													: 'Unknown';
								pacemakerPosKeepData.push({
									umaIndex: 2 + pacemakerIndex,
									text: stateName,
									color: pacemakerColors[pacemakerIndex],
									start: ar[0],
									end: ar[1],
									duration: ar[1] - ar[0],
								});
							});
						}
					}
					return pacemakerPosKeepData;
				})()
			: [];

	const competeFightData =
		chartData == null
			? []
			: (chartData.competeFight || [[], []]).flatMap((competeFightArray, i) => {
					if (!competeFightArray || competeFightArray.length === 0) return [];
					const start = competeFightArray[0];
					const end = competeFightArray[1];
					return [
						{
							umaIndex: i,
							text: 'Duel',
							color: posKeepColors[i],
							start: start,
							end: end,
							duration: end - start,
						},
					];
				});

	const leadCompetitionData =
		chartData == null
			? []
			: (chartData.leadCompetition || [[], []]).flatMap(
					(leadCompetitionArray, i) => {
						if (!leadCompetitionArray || leadCompetitionArray.length === 0)
							return [];
						const start = leadCompetitionArray[0];
						const end = leadCompetitionArray[1];
						return [
							{
								umaIndex: i,
								text: 'SS',
								color: posKeepColors[i],
								start: start,
								end: end,
								duration: end - start,
							},
						];
					},
				);

	const virtualPacemakerLeadCompetitionData =
		showVirtualPacemakerOnGraph &&
		posKeepMode === PosKeepMode.Virtual &&
		chartData &&
		chartData.pacerLeadCompetition
			? (() => {
					const pacemakerLeadCompetitionData = [];
					const pacemakerColors = [
						{ stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.6)' },
						{ stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.6)' },
						{ stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.6)' },
					];

					for (let pacemakerIndex = 0; pacemakerIndex < 3; pacemakerIndex++) {
						if (
							selectedPacemakerIndices.includes(pacemakerIndex) &&
							chartData.pacerLeadCompetition &&
							chartData.pacerLeadCompetition[pacemakerIndex] &&
							chartData.pacerLeadCompetition[pacemakerIndex].length > 0
						) {
							const leadCompetitionArray =
								chartData.pacerLeadCompetition[pacemakerIndex];
							const start = leadCompetitionArray[0];
							const end = leadCompetitionArray[1];
							pacemakerLeadCompetitionData.push({
								umaIndex: 2 + pacemakerIndex,
								text: 'SS',
								color: pacemakerColors[pacemakerIndex],
								start: start,
								end: end,
								duration: end - start,
							});
						}
					}
					return pacemakerLeadCompetitionData;
				})()
			: [];

	const downhillData =
		chartData == null
			? []
			: (chartData.downhillActivations || [[], []]).flatMap(
					(downhillArray, i) => {
						return downhillArray.map((ar) => ({
							umaIndex: i,
							text: 'DH',
							color: posKeepColors[i],
							start: ar[0],
							end: ar[1],
							duration: ar[1] - ar[0],
						}));
					},
				);

	const posKeepLabels = [];

	const tempLabels = [
		...posKeepData,
		...virtualPacemakerPosKeepData,
		...competeFightData,
		...leadCompetitionData,
		...virtualPacemakerLeadCompetitionData,
		...downhillData,
	].map((posKeep) => ({
		...posKeep,
		x: (posKeep.start / course.distance) * 960,
		width: (posKeep.duration / course.distance) * 960,
		yOffset: 0,
	}));

	tempLabels.sort((a, b) => a.x - b.x);

	for (let i = 0; i < tempLabels.length; i++) {
		const currentLabel = tempLabels[i];
		let maxYOffset = 40;

		for (let j = 0; j < i; j++) {
			const prevLabel = tempLabels[j];

			// Check if labels overlap horizontally
			const padding = 0; // Add padding to prevent labels from being too close
			const overlap = !(
				currentLabel.x + currentLabel.width + padding < prevLabel.x ||
				currentLabel.x > prevLabel.x + prevLabel.width + padding
			);

			if (overlap) {
				// Labels overlap, need to offset vertically
				maxYOffset = Math.max(maxYOffset, prevLabel.yOffset + 15);
			}
		}

		currentLabel.yOffset = maxYOffset;
		posKeepLabels.push(currentLabel);
	}

	const umaTabs = (
		<Fragment>
			<div class="umaTabBar">
				<div
					class={`umaTabItem ${currentIdx == 0 ? 'selected' : ''}`}
					onClick={() => updateUiState(UiStateMsg.SetCurrentIdx0)}
				>
					Uma 1
				</div>
				{mode == Mode.Compare && (
					<div
						class={`umaTabItem ${currentIdx == 1 ? 'selected' : ''}`}
						onClick={() => updateUiState(UiStateMsg.SetCurrentIdx1)}
					>
						Uma 2
					</div>
				)}
				{posKeepMode == PosKeepMode.Virtual && mode == Mode.Compare && (
					<div
						class={`umaTabItem ${currentIdx == 2 ? 'selected' : ''}`}
						onClick={() => updateUiState(UiStateMsg.SetCurrentIdx2)}
					>
						Pacemaker
					</div>
				)}
				{mode == Mode.Compare && (
					<button
						class="horseActionBtn"
						title="Reset all umas"
						onClick={resetAllUmas}
					>
						{h(Trash2, { size: 16 })}
					</button>
				)}
			</div>
		</Fragment>
	);

	// Unlike the old per-row embedded runData, an expanded chart row now sources everything itself
	// from chartRunRef/detailCacheRef rather than being handed data by BasinnChart -- the bar
	// charts render instantly from data already in memory (synthesizeAllRuns), and only the
	// velocity chart waits on a fetch (requestChartDetail, dispatched from basinnChartSelection
	// when the row was expanded).
	const createExpandedContent = useCallback(
		(skillId: string, courseDistance: number) => {
			const acc = chartRunRef.current?.accumulators.get(skillId);
			const row = tableData.get(skillId);
			if (!acc || !row) return null;

			const stats = row.statistics;
			const helpRate = stats ? stats.helpRate * 100 : 0;
			const hurtRate = stats ? stats.hurtRate * 100 : 0;
			const tieRate = stats ? stats.tieRate * 100 : 0;
			const barChartRunData = { allruns: synthesizeAllRuns(acc) };
			const detail = detailCacheRef.current.get(skillId);
			const currentDisplaying = displaying || 'meanrun';
			const baseCost = (skillmeta as any)[skillId]?.baseCost;

			return (
				<div style="position: relative;">
					<div style={`margin-bottom: 8px; width: 300px;`}>
						<div
							style={`font-size: 9px; margin-bottom: 2px; display: flex; align-items: center; gap: 8px;`}
						>
							<span>
								Total samples: {acc.n} ({acc.procTotal} skill procs)
							</span>
							<button
								class="runAdditionalSamples"
								onClick={(e) => {
									e.stopPropagation();
									refineSkill(skillId);
								}}
								disabled={isSimulationRunning}
							>
								{isSimulationRunning ? 'Simulation running…' : 'Refine'}
							</button>
						</div>
						<div style={`font-size: 9px; margin-bottom: 2px;`}>
							Helps: {helpRate.toFixed(1)}% · Ties: {tieRate.toFixed(1)}% ·
							Hurts: {hurtRate.toFixed(1)}%
						</div>
						<div
							style={`display: flex; width: 100%; height: 8px; border: 1px solid #ccc; overflow: hidden;`}
						>
							<div
								style={`width: ${helpRate}%; background-color: #4caf50; height: 100%;`}
							></div>
							<div
								style={`width: ${Math.max(0, 100 - helpRate - hurtRate)}%; background-color: #999; height: 100%;`}
							></div>
							<div
								style={`width: ${hurtRate}%; background-color: #f44336; height: 100%;`}
							></div>
						</div>
						{stats && (
							<table
								class="expandedStatsTable"
								style="font-size: 9px; margin-top: 6px; width: 100%;"
							>
								<tbody>
									<tr>
										<th>Time saved</th>
										<td>{stats.timeMean.toFixed(3)} s</td>
									</tr>
									<tr>
										<th>SP</th>
										<td>{baseCost ?? '—'}</td>
									</tr>
									<tr>
										<th>L / SP</th>
										<td>
											{baseCost ? (stats.mean / baseCost).toFixed(4) : '—'}
										</td>
									</tr>
									<tr>
										<th>Conditional gain (when it procs)</th>
										<td>{stats.conditionalMean.toFixed(2)} L</td>
									</tr>
									<tr>
										<th>Helps interval</th>
										<td>
											{(stats.helpCI.lower * 100).toFixed(1)}–
											{(stats.helpCI.upper * 100).toFixed(1)}%
										</td>
									</tr>
									<tr>
										<th>Proc interval</th>
										<td>
											{(stats.procCI.lower * 100).toFixed(1)}–
											{(stats.procCI.upper * 100).toFixed(1)}%
										</td>
									</tr>
								</tbody>
							</table>
						)}
					</div>
					<div style={`display: flex; gap: 20px; align-items: flex-start;`}>
						<div>
							<LengthDifferenceChart
								skillId={skillId}
								runData={barChartRunData}
								courseDistance={courseDistance}
								umaIndex={1}
							/>
							<ActivationFrequencyChart
								skillId={skillId}
								runData={barChartRunData}
								courseDistance={courseDistance}
								umaIndex={1}
							/>
						</div>
						{detail ? (
							<div>
								<div style="font-size: 9px; margin-bottom: 2px; display: flex; justify-content: flex-end; gap: 4px; align-items: center;">
									<label for={`displaying-${skillId}`}>Showing</label>
									<select
										id={`displaying-${skillId}`}
										value={currentDisplaying}
										onInput={(e) => setChartData(e.currentTarget.value)}
									>
										<option value="minrun">Min</option>
										<option value="meanrun">Mean (closest to)</option>
										<option value="medianrun">Median</option>
										<option value="maxrun">Max</option>
									</select>
								</div>
								<VelocityChart
									skillId={skillId}
									runData={detail}
									courseDistance={courseDistance}
									displaying={currentDisplaying}
									umaIndex={1}
								/>
							</div>
						) : (
							<div style="width:400px;height:200px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#888;">
								Loading velocity chart…
							</div>
						)}
					</div>
					<div style="position: absolute; bottom: 0; right: 0; font-size: 9px; font-style: italic; padding: 4px;">
						(yes these graphs are copied from utools &gt;-&lt;)
					</div>
				</div>
			);
		},
		[tableData, isSimulationRunning, displaying],
	);

	const compareResults: CompareResults | null =
		results.length > 0 && runData && staminaStats && firstUmaStats
			? { results, runData, staminaStats, firstUmaStats }
			: null;

	function handleDisplayRunChange(run: 'mean' | 'median' | 'min' | 'max') {
		setDisplayRun(run);
		setChartData(`${run}run`);
	}

	let resultsPane: any;
	if (mode == Mode.Compare) {
		const showIntroOnCompare = compareResults === null && !isSimulationRunning;
		resultsPane = (
			<div id="resultsPaneWrapper">
				{showIntroOnCompare ? (
					<div id="resultsPane">
						<IntroText />
					</div>
				) : (
					<ResultsPane
						results={compareResults}
						isRunning={isSimulationRunning}
						displayRun={displayRun}
						onDisplayRunChange={handleDisplayRunChange}
					/>
				)}
			</div>
		);
	} else if (
		(mode == Mode.Chart || mode == Mode.UniquesChart) &&
		tableData.size > 0
	) {
		const iconTypesDirty =
			mode == Mode.Chart &&
			CHART_ICON_TYPE_FILTERS.some(
				(t) => activeChartIconTypes.has(t) && !lastRunChartIconTypes.has(t),
			);
		const hideUniquesDirty =
			mode == Mode.Chart &&
			hideInheritedUniques !== lastRunHideInheritedUniques;
		const dirty =
			!uma1.equals(lastRunChartUma) ||
			courseId !== lastRunChartCourseId ||
			iconTypesDirty ||
			hideUniquesDirty;
		const hiddenByIconFilter =
			mode == Mode.Chart &&
			activeChartIconTypes.size < CHART_ICON_TYPE_FILTERS.length
				? new Set(
						Array.from(tableData.keys()).filter(
							(id) =>
								!CHART_ICON_TYPE_FILTERS.some(
									(t) =>
										activeChartIconTypes.has(t) && matchChartIconType(id, t),
								),
						),
					)
				: new Set<string>();
		const hiddenByUniqueFilter =
			mode == Mode.Chart && hideInheritedUniques
				? new Set(
						Array.from(tableData.keys()).filter((id) => id.startsWith('9')),
					)
				: new Set<string>();
		resultsPane = (
			<div id="resultsPaneWrapper">
				<div id="resultsPane" class="mode-chart">
					<div class="basinnChartWrapperWrapper">
						<BasinnChart
							data={Array.from(tableData.values())}
							dirty={dirty}
							hidden={
								mode == Mode.Chart
									? new Set([
											...uma1.skills,
											...hiddenByIconFilter,
											...hiddenByUniqueFilter,
										])
									: new Set()
							}
							onSelectionChange={basinnChartSelection}
							onDblClickRow={addSkillFromTable}
							onInfoClick={showPopover}
							showUmaIcons={mode == Mode.UniquesChart}
							courseDistance={course.distance}
							expandedContent={createExpandedContent}
						/>
						<button
							class={`basinnChartRefresh${dirty ? '' : ' hidden'}`}
							onClick={doBasinnChart}
							disabled={isSimulationRunning}
						>
							⟲
						</button>
						<div class={`basinnChartRefreshText${dirty ? '' : ' hidden'}`}>
							Uma skills have changed, refresh is required
						</div>
					</div>
				</div>
			</div>
		);
	} else {
		resultsPane = null;
	}

	const umaPaneInner = (
		<>
			<div class={!expanded && currentIdx == 0 ? 'selected' : ''}>
				<HorseDef
					key={uma1.outfitId}
					state={uma1}
					setState={setUma1}
					courseDistance={course.distance}
					tabstart={() => 4}
					onResetAll={resetAllUmas}
					runData={mode == Mode.Compare ? runData : null}
					umaIndex={mode == Mode.Compare ? 0 : null}
					headerActions={
						<HorseSaveLoadActions
							state={uma1}
							setState={setUma1}
							onReset={() => setUma1(new HorseState())}
						/>
					}
				>
					{expanded ? 'Uma 1' : umaTabs}
				</HorseDef>
			</div>
			{expanded && (
				<div id="copyUmaButtons">
					<div
						id="copyUmaToRight"
						title="Copy uma 1 to uma 2"
						onClick={copyUmaToRight}
					/>
					<div
						id="copyUmaToLeft"
						title="Copy uma 2 to uma 1"
						onClick={copyUmaToLeft}
					/>
					<div id="swapUmas" title="Swap umas" onClick={swapUmas}>
						⮂
					</div>
				</div>
			)}
			{mode == Mode.Compare && (
				<div class={!expanded && currentIdx == 1 ? 'selected' : ''}>
					<HorseDef
						key={uma2.outfitId}
						state={uma2}
						setState={setUma2}
						courseDistance={course.distance}
						tabstart={() => 4 + horseDefTabs()}
						onResetAll={resetAllUmas}
						runData={runData}
						umaIndex={1}
						headerActions={
							<HorseSaveLoadActions
								state={uma2}
								setState={setUma2}
								onReset={() => setUma2(new HorseState())}
							/>
						}
					>
						{expanded ? 'Uma 2' : umaTabs}
					</HorseDef>
				</div>
			)}
			{posKeepMode == PosKeepMode.Virtual && mode == Mode.Compare && (
				<div class={!expanded && currentIdx == 2 ? 'selected' : ''}>
					<HorseDef
						key={pacer.outfitId}
						state={pacer}
						setState={setPacer}
						courseDistance={course.distance}
						tabstart={() => 4 + (mode == Mode.Compare ? 2 : 1) * horseDefTabs()}
						onResetAll={resetAllUmas}
						headerActions={
							<HorseSaveLoadActions
								state={pacer}
								setState={setPacer}
								onReset={() => setPacer(new HorseState({ strategy: 'Nige' }))}
							/>
						}
					>
						{expanded ? 'Pacemaker' : umaTabs}
					</HorseDef>
				</div>
			)}
			{expanded && (
				<div id="closeUmaOverlay" title="Close panel" onClick={toggleExpand}>
					✕
				</div>
			)}
		</>
	);

	const settingsPaneInner = (
		<>
			<h3>Settings</h3>
			{mode == Mode.Compare && (
				<div class="settingsCard">
					<h4>Position Keep</h4>
					<select
						id="poskeepmode"
						value={posKeepMode}
						onInput={(e) => setPosKeepMode(+e.currentTarget.value)}
					>
						<option value={PosKeepMode.None}>None</option>
						<option value={PosKeepMode.Approximate}>Approximate</option>
						<option value={PosKeepMode.Virtual}>Virtual Pacemaker</option>
					</select>
					{posKeepMode == PosKeepMode.Approximate && (
						<div id="pacemakerIndicator">
							<span>Using default pacemaker</span>
						</div>
					)}
					{posKeepMode == PosKeepMode.Virtual && (
						<div id="pacemakerIndicator">
							<div>
								<label>Show Pacemakers:</label>
								<div className="pacemaker-combobox">
									<button
										className="pacemaker-combobox-button"
										onClick={() =>
											setIsPacemakerDropdownOpen(!isPacemakerDropdownOpen)
										}
									>
										{selectedPacemakerIndices.length === 0
											? 'None'
											: selectedPacemakerIndices.length === 1
												? `Pacemaker ${selectedPacemakerIndices[0] + 1}`
												: selectedPacemakerIndices.length === pacemakerCount
													? 'All Pacemakers'
													: `${selectedPacemakerIndices.length} Pacemakers`}
										<span className="pacemaker-combobox-arrow">▼</span>
									</button>
									{isPacemakerDropdownOpen && (
										<div className="pacemaker-combobox-dropdown">
											{[...Array(pacemakerCount)].map((_, index) => (
												<label
													key={index}
													className="pacemaker-combobox-option"
												>
													<input
														type="checkbox"
														checked={selectedPacemakerIndices.includes(index)}
														onChange={() => togglePacemakerSelection(index)}
													/>
													<span
														style={{
															color:
																index === 0
																	? '#22c55e'
																	: index === 1
																		? '#a855f7'
																		: '#ec4899',
														}}
													>
														Pacemaker {index + 1}
													</span>
												</label>
											))}
										</div>
									)}
								</div>
							</div>
							<div id="pacemakerCountControl">
								<label for="pacemakercount">
									Number of pacemakers: {pacemakerCount}
								</label>
								<input
									type="range"
									id="pacemakercount"
									min="1"
									max="3"
									value={pacemakerCount}
									onInput={(e) =>
										handlePacemakerCountChange(+e.currentTarget.value)
									}
								/>
							</div>
						</div>
					)}
				</div>
			)}
			{mode == Mode.Compare && (
				<div class="settingsCard">
					<h4>Simulation</h4>
					<div class="settingsToggleRow">
						<span>Sync RNG</span>
						<label class="toggleSwitch">
							<input
								type="checkbox"
								checked={syncRng}
								onClick={handleSyncRngToggle}
							/>
							<span class="toggleTrack"></span>
						</label>
					</div>
					<div class="settingsToggleRow">
						<span>Skill Wit Check</span>
						<label class="toggleSwitch">
							<input
								type="checkbox"
								checked={skillWisdomCheck}
								onClick={handleSkillWisdomCheckToggle}
							/>
							<span class="toggleTrack"></span>
						</label>
					</div>
					<div class="settingsToggleRow">
						<span>Rushed / Kakari</span>
						<label class="toggleSwitch">
							<input
								type="checkbox"
								checked={rushedKakari}
								onClick={handleRushedKakariToggle}
							/>
							<span class="toggleTrack"></span>
						</label>
					</div>
					<div class="settingsToggleRow">
						<span>Spot Struggle</span>
						<label class="toggleSwitch">
							<input
								type="checkbox"
								checked={leadCompetition}
								onClick={() => setLeadCompetition(!leadCompetition)}
							/>
							<span class="toggleTrack"></span>
						</label>
					</div>
					<div class="settingsToggleRow">
						<span>Dueling</span>
						<div style="display:flex;align-items:center;gap:8px;">
							<label class="toggleSwitch">
								<input
									type="checkbox"
									checked={competeFight}
									onClick={() => setCompeteFight(!competeFight)}
								/>
								<span class="toggleTrack"></span>
							</label>
							<button
								type="button"
								onClick={() => setDuelingConfigOpen(true)}
								class="settingsSmallBtn"
								title="Configure dueling rates"
							>
								<Settings size={14} />
							</button>
						</div>
					</div>
				</div>
			)}
			{(mode == Mode.Chart || mode == Mode.UniquesChart) && (
				<div class="settingsCard">
					<h4>Simulation</h4>
					<div class="settingsToggleRow">
						<span>Skill Wit Check</span>
						<label class="toggleSwitch">
							<input
								type="checkbox"
								checked={skillWisdomCheck}
								onClick={handleSkillWisdomCheckToggle}
							/>
							<span class="toggleTrack"></span>
						</label>
					</div>
				</div>
			)}
			<button class="settingsCopyBtn" onClick={copyStateUrl}>
				Copy Link
			</button>
		</>
	);

	return (
		<Language.Provider value={props.lang}>
			<IntlProvider definition={strings}>
				<nav id="navBar">
					<div id="navTabs">
						<div
							class={`navTab ${activeTab === 'umalator' ? 'selected' : ''}`}
							onClick={() => setActiveTab('umalator')}
						>
							Umalator
						</div>
						<div
							class={`navTab ${activeTab === 'umas' ? 'selected' : ''}`}
							onClick={() => setActiveTab('umas')}
						>
							Umas
						</div>
					</div>
					<button
						id="themeToggle"
						onClick={() => setDarkMode((d) => !d)}
						title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
					>
						{darkMode ? (
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<circle cx="12" cy="12" r="5" />
								<line x1="12" y1="1" x2="12" y2="3" />
								<line x1="12" y1="21" x2="12" y2="23" />
								<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
								<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
								<line x1="1" y1="12" x2="3" y2="12" />
								<line x1="21" y1="12" x2="23" y2="12" />
								<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
								<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
							</svg>
						) : (
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
							</svg>
						)}
					</button>
				</nav>
				<div
					id="umasPane"
					style={{ display: activeTab === 'umas' ? 'flex' : 'none' }}
				>
					<UmasTab
						onLoadUma1={(decoded) => {
							setUma1(umaStateToHorseState(decodedUmaToUmaState(decoded)));
							setActiveTab('umalator');
						}}
						onLoadUma2={(decoded) => {
							setUma2(umaStateToHorseState(decodedUmaToUmaState(decoded)));
							setActiveTab('umalator');
						}}
						onExport={(decoded) => {
							navigator.clipboard.writeText(
								JSON.stringify(decodedUmaToUmaState(decoded), null, 2),
							);
						}}
					/>
				</div>
				{activeTab === 'umalator' && (
					<>
						{!isMobile && (
							<div id="iconSidebar">
								<button
									class={`sidebarIcon ${leftPanel === 'uma' ? 'active' : ''}`}
									onClick={() => setLeftPanel('uma')}
									title="Uma"
								>
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
										<circle cx="12" cy="7" r="4" />
									</svg>
								</button>
								<button
									class={`sidebarIcon ${leftPanel === 'settings' ? 'active' : ''}`}
									onClick={() => setLeftPanel('settings')}
									title="Settings"
								>
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<circle cx="12" cy="12" r="3" />
										<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
									</svg>
								</button>
								<button
									class={`sidebarIcon ${overlayPanel === 'limitations' ? 'active' : ''}`}
									onClick={() =>
										setOverlayPanel(
											overlayPanel === 'limitations' ? null : 'limitations',
										)
									}
									title="Limitations"
								>
									<TriangleAlert size={20} />
								</button>
							</div>
						)}
						<div id="mainContent">
							<div
								id="topPane"
								ref={topPaneRef}
								class={`${chartData ? 'hasResults' : ''} ${(mode == Mode.Chart || mode == Mode.UniquesChart) && !isMobile && topPaneHeight != null ? 'chart-split' : ''}`}
								style={
									(mode == Mode.Chart || mode == Mode.UniquesChart) &&
									!isMobile &&
									topPaneHeight != null
										? { height: topPaneHeight + 'px' }
										: undefined
								}
							>
								<div id="modeTabs">
									<div
										class={`modeTab ${mode == Mode.Compare ? 'selected' : ''}`}
										onClick={() => updateUiState(UiStateMsg.SetModeCompare)}
									>
										Compare
									</div>
									<div
										class={`modeTab ${mode == Mode.Chart ? 'selected' : ''}`}
										onClick={() => updateUiState(UiStateMsg.SetModeChart)}
									>
										Skill Chart
									</div>
									<div
										class={`modeTab ${mode == Mode.UniquesChart ? 'selected' : ''}`}
										onClick={() =>
											updateUiState(UiStateMsg.SetModeUniquesChart)
										}
									>
										Uma Chart
									</div>
								</div>
								<div id="runBar">
									{mode == Mode.Compare ? (
										<button
											id="run"
											onClick={doComparison}
											tabindex={1}
											disabled={isSimulationRunning}
										>
											COMPARE
										</button>
									) : (
										<button
											id="run"
											onClick={doBasinnChart}
											tabindex={1}
											disabled={isSimulationRunning}
										>
											{simulationProgress
												? `Run (${simulationProgress.round}/${simulationProgress.totalRounds} · ${Math.round(simulationProgress.pct * 100)}%)`
												: 'RUN'}
										</button>
									)}
									{mode == Mode.Compare && (
										<button
											id="runOnce"
											onClick={doRunOnce}
											tabindex={1}
											disabled={isSimulationRunning}
										>
											Run Once
										</button>
									)}
									{(mode == Mode.Chart || mode == Mode.UniquesChart) &&
										isSimulationRunning && (
											<button id="stopChart" onClick={stopChart} tabindex={1}>
												Stop
											</button>
										)}
									{mode == Mode.Compare && (
										<div class="runBarGroup">
											<label for="nsamples">Samples</label>
											<input
												type="number"
												id="nsamples"
												min="1"
												max="10000"
												value={nsamples}
												onInput={(e) => setSamples(+e.currentTarget.value)}
											/>
										</div>
									)}
									<div class="runBarGroup">
										<label for="seed">Seed</label>
										<div id="seedWrapper">
											<input
												type="number"
												id="seed"
												value={seed}
												onInput={(e) => {
													setSeed(+e.currentTarget.value);
													setRunOnceCounter(0);
												}}
											/>
											<button
												title="Randomize seed"
												onClick={() => {
													setSeed(Math.floor(Math.random() * (-1 >>> 0)) >>> 0);
													setRunOnceCounter(0);
												}}
											>
												🎲
											</button>
										</div>
									</div>
									{simulationError && (
										<div class="runBarError">{simulationError}</div>
									)}
								</div>
								<div class="racetrackRow">
									<RaceTrack
										courseid={courseId}
										width={960}
										height={240}
										xOffset={20}
										yOffset={15}
										yExtra={20}
										mouseMove={rtMouseMove}
										mouseLeave={rtMouseLeave}
										onSkillDrag={handleSkillDrag}
										regions={[...skillActivations, ...rushedIndicators]}
										posKeepLabels={showLabels ? posKeepLabels : []}
										uma1={uma1}
										uma2={uma2}
										pacer={pacer}
										controls={
											<div class="racetrackControls">
												<label>
													<input
														type="checkbox"
														checked={showHp}
														onClick={toggleShowHp}
													/>{' '}
													Show HP
												</label>
												<label>
													<input
														type="checkbox"
														checked={showPoskeepGap}
														onClick={toggleShowPoskeepGap}
													/>{' '}
													Show Poskeep Gap
												</label>
												<label>
													<input
														type="checkbox"
														checked={showLabels}
														onClick={toggleShowLabels}
													/>{' '}
													Show Labels
												</label>
											</div>
										}
									>
										<VelocityLines
											data={chartData}
											courseDistance={course.distance}
											width={960}
											height={250}
											xOffset={20}
											showHp={showHp}
											showPoskeepGap={showPoskeepGap}
											showLanes={mode == Mode.Compare ? showLanes : false}
											horseLane={course.horseLane}
											showVirtualPacemaker={
												showVirtualPacemakerOnGraph &&
												posKeepMode === PosKeepMode.Virtual
											}
											selectedPacemakers={getSelectedPacemakers()}
										/>

										<g id="rtMouseOverBox" style="display:none">
											<text
												id="rtV1"
												x="25"
												y="10"
												fill="#2a77c5"
												font-size="10px"
											></text>
											<text
												id="rtV2"
												x="25"
												y="20"
												fill="#c52a2a"
												font-size="10px"
											></text>
											<text
												id="rtVp"
												x="25"
												y="30"
												fill="#22c55e"
												font-size="10px"
											></text>
											<text
												id="pd1"
												x="25"
												y="10"
												fill="#2a77c5"
												font-size="10px"
											></text>
											<text
												id="pd2"
												x="25"
												y="20"
												fill="#c52a2a"
												font-size="10px"
											></text>
										</g>
									</RaceTrack>
								</div>
								<div class="controlPanel">
									<div class="controlPanelFields">
										<div class="controlPanelField">
											<span class="controlPanelLabel">Preset</span>
											<RacePresets
												courseId={courseId}
												racedef={racedef}
												set={(courseId, racedef) => {
													setCourseId(courseId);
													setRaceDef(racedef);
												}}
											/>
										</div>
										<div class="controlPanelField">
											<span class="controlPanelLabel">Track</span>
											<TrackSelect
												key={courseId}
												courseid={courseId}
												setCourseid={setCourseId}
												tabindex={2}
											/>
										</div>
										<div class="controlPanelField">
											<span class="controlPanelLabel">Time of Day</span>
											<TimeOfDaySelect
												value={racedef.time}
												set={racesetter('time')}
											/>
										</div>
										<div class="controlPanelField">
											<span class="controlPanelLabel">Ground</span>
											<GroundSelect
												value={racedef.ground}
												set={racesetter('ground')}
											/>
										</div>
										<div class="controlPanelField">
											<span class="controlPanelLabel">Weather</span>
											<WeatherSelect
												value={racedef.weather}
												set={racesetter('weather')}
											/>
										</div>
										<div class="controlPanelField">
											<span class="controlPanelLabel">Season</span>
											<SeasonSelect
												value={racedef.season}
												set={racesetter('season')}
											/>
										</div>
									</div>
								</div>
							</div>
							{(mode == Mode.Chart || mode == Mode.UniquesChart) && (
								<div id="chartRunSettings">
									<label>
										Model{' '}
										<select
											value={analysisMode}
											onInput={(e) =>
												setAnalysisMode(
													e.currentTarget.value as 'controlled' | 'full',
												)
											}
											disabled={isSimulationRunning}
										>
											<option value="controlled">Controlled</option>
											<option value="full">Full race</option>
										</select>
									</label>
									<label>
										Preset{' '}
										<select
											value={analysisPreset}
											onInput={(e) =>
												setAnalysisPreset(
													e.currentTarget.value as AnalysisPresetName,
												)
											}
											disabled={isSimulationRunning}
										>
											<option value="quick">Quick</option>
											<option value="balanced">Balanced</option>
											<option value="thorough">Thorough</option>
										</select>
									</label>
									{!isSimulationRunning && chartRunRef.current && (
										<span class="chartRunEstimate">
											~
											{formatEstimatedRuntime(
												(estimateWorstCaseScenarios(
													CHART_LADDERS[analysisPreset],
													chartRunRef.current.roundParticipants.length ||
														tableData.size,
												) *
													msPerScenarioRef.current) /
													(poolRef.current?.size || 4),
											)}{' '}
											for a fresh run at this preset
										</span>
									)}
								</div>
							)}
							{mode == Mode.Chart && (
								<div id="chartIconFilter">
									{CHART_ICON_TYPE_FILTERS.map((iconType) => (
										<button
											key={iconType}
											class={`chart-icon-filter-btn${activeChartIconTypes.has(iconType) ? ' active' : ''}`}
											type="button"
											style={{
												backgroundImage: `url(/uma-tools/icons/${iconType}1.png)`,
											}}
											onClick={() => toggleChartIconType(iconType)}
											disabled={isSimulationRunning}
										/>
									))}
									<div
										class="settingsToggleRow"
										style={{ marginLeft: '12px', padding: '0' }}
									>
										<span>Hide Inherited Uniques</span>
										<label class="toggleSwitch">
											<input
												type="checkbox"
												checked={hideInheritedUniques}
												onClick={() => setHideInheritedUniques((v) => !v)}
												disabled={isSimulationRunning}
											/>
											<span class="toggleTrack"></span>
										</label>
									</div>
									<span class="chartHoverHint" style={{ marginLeft: '12px' }}>
										Hover a column heading for what it means
									</span>
								</div>
							)}
							{(mode == Mode.Chart || mode == Mode.UniquesChart) &&
								!isMobile &&
								resultsPane != null && (
									<div
										id="chartSplitter"
										onPointerDown={onSplitterDown}
										onDblClick={() => setTopPaneHeight(null)}
										title="Drag to resize · double-click to reset"
									/>
								)}
							{resultsPane}
						</div>
						{expanded && !isMobile && <div id="umaPane" />}
						{!isMobile && leftPanel === 'uma' && (
							<div id={expanded ? 'umaOverlay' : 'umaPane'}>{umaPaneInner}</div>
						)}
						{!isMobile && leftPanel === 'settings' && (
							<div id="settingsPane">{settingsPaneInner}</div>
						)}
						{isMobile && (
							<>
								<div id="mobileBottomBar">
									<button
										type="button"
										class={`mobileBottomBarBtn ${mobileDialogOpen === 'uma' ? 'active' : ''}`}
										onClick={() =>
											setMobileDialogOpen(
												mobileDialogOpen === 'uma' ? null : 'uma',
											)
										}
										title="Umas"
									>
										<svg
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
											<circle cx="12" cy="7" r="4" />
										</svg>
										<span>Umas</span>
									</button>
									<button
										type="button"
										class={`mobileBottomBarBtn ${mobileDialogOpen === 'settings' ? 'active' : ''}`}
										onClick={() =>
											setMobileDialogOpen(
												mobileDialogOpen === 'settings' ? null : 'settings',
											)
										}
										title="Settings"
									>
										<svg
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<circle cx="12" cy="12" r="3" />
											<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
										</svg>
										<span>Settings</span>
									</button>
									<button
										type="button"
										class={`mobileBottomBarBtn ${overlayPanel === 'limitations' ? 'active' : ''}`}
										onClick={() =>
											setOverlayPanel(
												overlayPanel === 'limitations' ? null : 'limitations',
											)
										}
										title="Limitations"
									>
										<TriangleAlert size={20} />
										<span>Limits</span>
									</button>
								</div>
								{(mobileDialogOpen === 'uma' ||
									mobileDialogOpen === 'settings') && (
									<div
										class="mobileDialogOverlay"
										onClick={() => setMobileDialogOpen(null)}
									>
										<div
											class="mobileDialog"
											onClick={(e: MouseEvent) => e.stopPropagation()}
										>
											<button
												type="button"
												class="mobileDialogClose"
												onClick={() => setMobileDialogOpen(null)}
												title="Close"
											>
												✕
											</button>
											<div
												class={`mobileDialogContent ${mobileDialogOpen === 'uma' ? 'mobileDialogContent--uma' : ''}`}
											>
												{mobileDialogOpen === 'uma'
													? umaPaneInner
													: settingsPaneInner}
											</div>
										</div>
									</div>
								)}
							</>
						)}
						{popoverSkill && (
							<BasinnChartPopover
								skillid={popoverSkill}
								results={tableData.get(popoverSkill).results}
								courseDistance={course.distance}
							/>
						)}
						{overlayPanel === 'limitations' && (
							<InfoModal
								title="Simulator limitations"
								intro="The simulator implements nearly all relevant game mechanics, with the following known approximations and gaps:"
								entries={LIMITATIONS}
								outro="By and large it should be highly accurate -- it has been battle-tested on the JP server for several years."
								onClose={() => setOverlayPanel(null)}
							/>
						)}
						{duelingConfigOpen && (
							<div
								class="duelingOverlay"
								onClick={(e) => {
									if (e.target === e.currentTarget) setDuelingConfigOpen(false);
								}}
							>
								<div class="duelingModal">
									<h2>Dueling Configuration</h2>
									<div class="duelingSliders">
										<div>
											<label>Runaway: {duelingRates.runaway}%</label>
											<input
												type="range"
												min="0"
												max="100"
												value={duelingRates.runaway}
												onInput={(e) =>
													setDuelingRates({
														...duelingRates,
														runaway: parseInt(e.target.value),
													})
												}
											/>
										</div>
										<div>
											<label>Front Runner: {duelingRates.frontRunner}%</label>
											<input
												type="range"
												min="0"
												max="100"
												value={duelingRates.frontRunner}
												onInput={(e) =>
													setDuelingRates({
														...duelingRates,
														frontRunner: parseInt(e.target.value),
													})
												}
											/>
										</div>
										<div>
											<label>Pace Chaser: {duelingRates.paceChaser}%</label>
											<input
												type="range"
												min="0"
												max="100"
												value={duelingRates.paceChaser}
												onInput={(e) =>
													setDuelingRates({
														...duelingRates,
														paceChaser: parseInt(e.target.value),
													})
												}
											/>
										</div>
										<div>
											<label>Late Surger: {duelingRates.lateSurger}%</label>
											<input
												type="range"
												min="0"
												max="100"
												value={duelingRates.lateSurger}
												onInput={(e) =>
													setDuelingRates({
														...duelingRates,
														lateSurger: parseInt(e.target.value),
													})
												}
											/>
										</div>
										<div>
											<label>End Closer: {duelingRates.endCloser}%</label>
											<input
												type="range"
												min="0"
												max="100"
												value={duelingRates.endCloser}
												onInput={(e) =>
													setDuelingRates({
														...duelingRates,
														endCloser: parseInt(e.target.value),
													})
												}
											/>
										</div>
										<div class="duelingWarning">
											<p>
												These are estimate %'s extracted from in-game race data,
												your actual dueling rate will vary based CM-by-CM based
												on overall lobby compositions.
											</p>
										</div>
									</div>
									<div class="duelingActions">
										<button onClick={() => setDuelingConfigOpen(false)}>
											Close
										</button>
									</div>
								</div>
							</div>
						)}
					</>
				)}
			</IntlProvider>
		</Language.Provider>
	);
}

initTelemetry();
render(<App lang="en-ja" />, document.getElementById('app'));
