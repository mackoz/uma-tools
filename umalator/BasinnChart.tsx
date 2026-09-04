import {
	createSortedRowModel,
	flexRender,
	rowSortingFeature,
	type SortingState,
	sortFns,
	tableFeatures,
	useTable,
} from '@tanstack/preact-table';
import { Fragment, h } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import type { HorseState } from '../components/HorseDef';
import { getSkillIconSrc } from '../components/SkillIcons';
import { getParser } from '../uma-skill-tools/ConditionParser';
import type { CourseData } from '../uma-skill-tools/CourseData';
import type { RaceParameters } from '../uma-skill-tools/RaceParameters';
import {
	buildBaseStats,
	buildSkillData,
	conditionsWithActivateCountsAsRandom,
	Perspective,
} from '../uma-skill-tools/RaceSolverBuilder';
import { Region, RegionList } from '../uma-skill-tools/Region';
import type { ChartRow } from './chartLadder';

import './BasinnChart.css';

import icons from '../icons.json';
import skillmeta from '../skill_meta.json';
import skilldata from '../uma-skill-tools/data/jp/skill_data.json';
import skillnames from '../uma-skill-tools/data/jp/skillnames.json';
import umas from '../umas.json';

export function isPurpleSkill(id) {
	// Deliberately the raw skillmeta[id].iconId, not the resolved (guessed) icon from
	// components/SkillIcons.ts -- PIPE-2 review, round 2, same reasoning as
	// HorseDefTypes.ts's isDebuffSkill: this is a semantic classification and the resolved id is
	// only a display guess. Verified a no-op today -- none of the 136 zero-icon skills resolve
	// to a "...4" icon. See UI-19 for keying this off effect data instead.
	//
	// Guards the same skilldata/skillmeta id-drift gap components/SkillPicker.tsx:37's
	// getSkillIcon already guards (UI-27 review): app.tsx's computeChartSkillPool now calls this
	// on the full candidate pool ahead of getActivateableSkills's try/catch, so it can no longer
	// rely on that try/catch having already filtered out an id present in skill_data.json but
	// missing from skill_meta.json. Returning false (not purple) is the safe default -- if the id
	// isn't a real activateable skill, getActivateableSkills's own try/catch downstream still
	// excludes it.
	const meta = skillmeta[id];
	if (!meta) return false;
	const iconId = meta.iconId;
	return iconId[iconId.length - 1] == '4';
}

// Kept for anything that wants to identify a recovery-only skill (e.g. a future icon filter) --
// it's no longer used to exclude skills from the Skill Chart's candidate list. The chart now
// requests `mode: 'compare'` in both analysis models (see app.tsx's buildChartOptions), which
// gives it a real HP policy instead of the no-op one an omitted `mode` produced before, so
// recovery skills have a real HP budget to act on and are worth ranking like anything else.
export function isHpOnlySkill(id: string): boolean {
	const skill = skilldata[id];
	if (!skill) return false;
	// Recovery = type 9; keep skills that have any non-Recovery effect (e.g. TargetSpeed)
	return skill.alternatives.every((alt: any) =>
		alt.effects.every((ef: any) => ef.type === 9),
	);
}

// UI-34: true for a skill whose trigger requires a *different* skill to have already activated
// (activate_count_*/is_activate_any_skill -- see conditionsWithActivateCountsAsRandom above and
// ADR-0010 in uma-skill-tools). Course Chart equips each candidate with only its own native
// unique, so these conditions can never be satisfied literally -- withActivateCountsAsRandom()
// models them instead, at varying fidelity (see ConditionalBadge's tooltip). Purely a display
// classification -- doesn't affect which skills get simulated, only whether the row gets the
// Conditional badge below.
//
// Checks every() alternative, not some(): buildSkillData (RaceSolverBuilder.ts) only ever skips
// a later alternative in favor of an earlier one that already placed a trigger -- it falls
// through to a later, ungated alternative whenever an earlier gated one's own region comes up
// empty for an unrelated reason (e.g. JP's 101051, whose gated alt0 also requires
// distance_type==3 and so is skipped -- and its ungated alt1 placed instead -- on every other
// course type). A some() check would badge that row as modeled even on courses where the
// activated trigger isn't gated at all; every() only badges a row when there's no ungated
// alternative for the engine to fall back to.
export function hasModeledActivationGate(id: string): boolean {
	const skill = (skilldata as any)[id];
	if (!skill) return false;
	return skill.alternatives.every((alt: any) =>
		/activate_count_\w+|is_activate_any_skill/.test(alt.condition),
	);
}

export function umaForUniqueSkill(skillId: string): string | null {
	const sid = parseInt(skillId, 10);
	if (sid < 100000 || sid >= 200000) return null;

	const remainder = sid - 100001;
	if (remainder < 0) return null;

	const i = Math.floor(remainder / 10) % 1000;
	const v = Math.floor(remainder / 10 / 1000) + 1;

	const umaId = i.toString().padStart(3, '0');
	const baseUmaId = `1${umaId}`;
	const outfitId = `${baseUmaId}${v.toString().padStart(2, '0')}`;

	if (umas[baseUmaId]?.outfits[outfitId]) {
		return outfitId;
	}

	return null;
}

// UI-34: built once at module load, like RaceSolverBuilder.ts's own acrParser -- Course Chart's
// getActivateableSkills call site (app.tsx) passes this so its candidate prefilter agrees with
// what runComparisonBlock() will actually simulate (buildCourseChartOptions's
// activateCountsAsRandom flag). Skill Chart/Uma Chart don't import this -- they keep the default
// parser via getActivateableSkills's own default param below.
export const acrParser = getParser(conditionsWithActivateCountsAsRandom);

export function getActivateableSkills(
	skills: string[],
	horse: HorseState,
	course: CourseData,
	racedef: RaceParameters,
	parser: { parse: any; tokenize: any } = getParser(),
) {
	const h2 = buildBaseStats(horse, horse.mood);
	const wholeCourse = new RegionList();
	wholeCourse.push(new Region(0, course.distance));
	return skills.filter((id) => {
		let sd: any;
		try {
			sd = buildSkillData(
				h2,
				racedef,
				course,
				wholeCourse,
				parser,
				id,
				Perspective.Any,
			);
		} catch (_) {
			return false;
		}
		return sd.some(
			(trigger) =>
				trigger.regions.length > 0 && trigger.regions[0].start < 9999,
		);
	});
}

function formatLengths(v: number): string {
	const s = v.toFixed(2).replace('-0.00', '0.00');
	return `${(v > 0 ? '+' : '') + s} L`;
}

function formatInterval(row: ChartRow): string {
	if (!row.statistics) return '—';
	const { mean, meanCI } = row.statistics;
	return `${formatLengths(mean)} (${meanCI.lower.toFixed(2)}–${meanCI.upper.toFixed(2)})`;
}

function formatRange(row: ChartRow): string {
	if (!row.statistics) return '—';
	const { p10, p90 } = row.statistics;
	return `${p10.toFixed(1)} – ${p90.toFixed(1)}`;
}

function formatPercent(v: number | undefined): string {
	if (v == null) return '—';
	return `${(v * 100).toFixed(0)}%`;
}

const STATUS_LABEL: Record<string, string> = {
	pending: 'Waiting to run',
	refining: 'Still sampling',
	screened: 'Screened out early',
	inert: 'Never activated in testing',
	final: 'Finished sampling',
};

const REASON_LABEL: Record<string, string> = {
	ci: 'below the current top candidates, with enough samples to trust that',
	budget: 'round capacity reached; kept the more promising candidates instead',
	converged: 'estimate was already precise enough to stop early',
	inert: 'never had any effect or activation across every sample so far',
};

// Rows the ladder stopped evaluating early (or hasn't reached yet) -- rendered dimmed, and sunk
// below every surviving row in the default Gain sort (see the `mean` column's accessorFn).
// UI-33: exported so app.tsx can reuse the same muted definition when building the chart-wide
// "Best value" badge candidate pool (a muted row's mean must never win that unprompted claim).
export function isMutedRow(row: ChartRow): boolean {
	return (
		row.status === 'screened' ||
		row.status === 'inert' ||
		row.status === 'pending'
	);
}

// Sink offset for muted rows in the Gain column's sort value: far larger than any real gain
// (lengths are single digits) but finite, so muted rows still order by their own means below
// every surviving row, with null-statistics rows (-Infinity) last of all.
const MUTED_SORT_PENALTY = 1e6;

function rowTooltip(row: ChartRow): string {
	const status = STATUS_LABEL[row.status] ?? row.status;
	const reason = row.eliminationReason
		? REASON_LABEL[row.eliminationReason]
		: null;
	return `${row.n} samples — ${status}${reason ? `: ${reason}` : ''}`;
}

// UI-33: renders after the name span in both branches below. A plain <span>, not a <button> --
// the tooltip is decorative detail on an already-identified row, not a control -- but still
// keyboard-reachable (tabIndex=0) and screen-reader-labeled (aria-label mirrors data-tip) so the
// numbers aren't hover-only, matching SpOptimizerCard.css's .spOptimizerTip precedent.
function BestValueBadge(props: { tooltip: string }) {
	return (
		<span
			class="basinnChartBestValueBadge"
			data-tip={props.tooltip}
			tabIndex={0}
			aria-label={props.tooltip}
		>
			Best value
		</span>
	);
}

// UI-34: renders alongside BestValueBadge above (same shape -- focusable, keyboard/screen-reader
// accessible span, not a button) whenever hasModeledActivationGate(id) is true and the caller
// opted in via showConditionalBadge. Distinct color token from BestValueBadge (see
// BasinnChart.css) so it reads as a caveat, not a commendation.
function ConditionalBadge() {
	const tooltip =
		'This unique only triggers after other skills have activated. With one skill equipped ' +
		"that can't happen, so the chart models the trigger point instead — treat the gain as " +
		'approximate. Click the icon for the full condition.';
	return (
		<span
			class="basinnChartConditionalBadge"
			data-tip={tooltip}
			tabIndex={0}
			aria-label={tooltip}
		>
			Conditional
		</span>
	);
}

function SkillNameCell(props) {
	const {
		id,
		showUmaIcons = false,
		showOutfitEpithet = false,
		showUmaName = false,
		isBestValue = false,
		bestValueTooltip = '',
		showConditionalBadge = false,
	} = props;
	const isConditional = showConditionalBadge && hasModeledActivationGate(id);

	if (showUmaIcons) {
		const outfitId = umaForUniqueSkill(id);
		if (outfitId && icons[outfitId]) {
			// Distinguishes two outfits of the same character (Course Chart's candidate pool is
			// one row per outfit, not per character) -- umas.json keys the epithet/name by outfit
			// under the base character id, which is the outfitId's own first 4 characters. Cast
			// like umaForUniqueSkill() above does for the same umas object -- a plain `string` id
			// can't index its exact-literal inferred type.
			const umasById = umas as {
				[key: string]: { name: string[]; outfits: { [key: string]: string } };
			};
			const baseUmaId = outfitId.slice(0, 4);
			const epithet = showOutfitEpithet
				? umasById[baseUmaId]?.outfits[outfitId]
				: null;
			// Every candidate Course Chart can actually show has a non-empty name[1] (checked
			// against both umas.json files) -- the `?.` here is defensive for the icon-resolves-
			// but-umas-entry-somehow-missing case, not a real fallback this pool exercises. JP rows
			// end up mixed-script (JP epithet, English name) -- matches HorseDef.tsx's own
			// uma-picker suggestion list, not a new inconsistency.
			const umaName = showUmaName ? umasById[baseUmaId]?.name[1] : null;
			return (
				<div class="chartSkillName">
					<img src={icons[outfitId]} />
					<span>
						{umaName ? (
							<Fragment>
								{epithet && (
									<span class="chartSkillOutfitEpithet">{epithet} </span>
								)}
								{umaName}
							</Fragment>
						) : (
							<Fragment>
								<Text id={`skillnames.${id}`} />
								{epithet && (
									<span class="chartSkillOutfitEpithet"> {epithet}</span>
								)}
							</Fragment>
						)}
					</span>
					{isBestValue && <BestValueBadge tooltip={bestValueTooltip} />}
					{isConditional && <ConditionalBadge />}
				</div>
			);
		}
	}

	return (
		<div class="chartSkillName">
			<img src={getSkillIconSrc(id)} />
			<span>
				<Text id={`skillnames.${id}`} />
			</span>
			{isBestValue && <BestValueBadge tooltip={bestValueTooltip} />}
			{isConditional && <ConditionalBadge />}
		</div>
	);
}

// Course Chart's own sort key for the Skill/Uma column: when showUmaName is set, sort by the
// resolved uma's English name instead of the skill name, so the column stays consistent with what
// it visibly displays (see SkillNameCell above). A single per-row key rather than a whole-
// comparator branch, so the two id-spaces (uma name vs. skill name) never mix mid-comparison and
// the ordering stays a valid total order. Falls back to the existing skillnames[id] sort if a
// candidate somehow doesn't resolve to a named uma -- not a live case for Course Chart's actual
// candidate pool (see the comment in SkillNameCell), but keeps this total regardless.
function skillSortKey(id: string, showUmaName: boolean): string {
	if (showUmaName) {
		const outfitId = umaForUniqueSkill(id);
		const umasById = umas as { [key: string]: { name: string[] } };
		const name = outfitId && umasById[outfitId.slice(0, 4)]?.name?.[1];
		if (name) return name;
	}
	return String(skillnames[id]);
}

// Only supplies the label text and its descriptive tooltip -- the click-to-sort handler lives on
// the shared .columnHeader div in the <thead> render below, not here, so every column is sortable
// by construction instead of each column definition needing to remember to wire it up itself.
function headerLabel(text: string, title: string) {
	return () => <span title={title}>{text}</span>;
}

export function BasinnChart(props) {
	const [expanded, setExpanded] = useState('');
	const clickTimeoutRef = useRef(null);
	const lastClickRef = useRef({ id: '', time: 0 });

	function toggleExpand(skillId) {
		if (expanded === skillId) {
			setExpanded('');
			props.onSelectionChange('');
		} else {
			setExpanded(skillId);
			props.onSelectionChange(skillId);
		}
	}

	const columns = useMemo(
		() => [
			{
				header: props.showUmaName
					? headerLabel('Uma', 'Sort alphabetically by Uma name')
					: headerLabel('Skill', 'Sort alphabetically by skill name'),
				accessorKey: 'id',
				cell: (info) => (
					<SkillNameCell
						id={info.getValue()}
						showUmaIcons={props.showUmaIcons}
						showOutfitEpithet={props.showOutfitEpithet}
						showUmaName={props.showUmaName}
						isBestValue={info.getValue() === props.bestValueId}
						bestValueTooltip={props.bestValueTooltip}
						showConditionalBadge={props.showConditionalBadge}
					/>
				),
				// This vendored table-core fork renamed the standard TanStack `sortingFn` column-def
				// property to `sortFn` (see vendor/table-core/features/row-sorting) -- the old name was
				// silently ignored, falling back to the default sort (by raw id), not skill name.
				sortFn: (a, b, _) =>
					skillSortKey(a.getValue('id'), props.showUmaName) <
					skillSortKey(b.getValue('id'), props.showUmaName)
						? -1
						: 1,
			},
			{
				header: headerLabel(
					'Gain (95% CI)',
					'Expected length gain vs. the baseline uma, with a confidence interval on that mean',
				),
				id: 'mean',
				// Muted rows (screened/inert/pending -- see isMutedRow) sort as if their gain were
				// MUTED_SORT_PENALTY lower, so the default Gain-descending view shows every surviving
				// row first and the eliminated noise (0.00 L, n=64) sinks below it instead of
				// occupying the few rows visible at the default pane height. Only this column gets
				// the treatment -- sorting by Helps/Proc/n is untouched.
				accessorFn: (row: ChartRow) => {
					const mean = row.statistics?.mean ?? Number.NEGATIVE_INFINITY;
					if (mean === Number.NEGATIVE_INFINITY) return mean;
					return isMutedRow(row) ? mean - MUTED_SORT_PENALTY : mean;
				},
				cell: (info) => formatInterval(info.row.original),
				sortDescFirst: true,
			},
			{
				header: headerLabel(
					'Typical P10–P90',
					'Middle 80% of modeled race outcomes -- how much individual races vary, not the precision of the mean',
				),
				id: 'p50',
				accessorFn: (row: ChartRow) =>
					row.statistics?.p50 ?? Number.NEGATIVE_INFINITY,
				cell: (info) => formatRange(info.row.original),
				sortDescFirst: true,
			},
			{
				header: headerLabel(
					'Helps',
					'Share of races with a meaningful positive length gain',
				),
				id: 'helpRate',
				accessorFn: (row: ChartRow) => row.statistics?.helpRate,
				cell: (info) => formatPercent(info.getValue()),
				sortDescFirst: true,
			},
			{
				header: headerLabel(
					'Proc',
					'Share of races where this skill activated at least once',
				),
				id: 'procRate',
				accessorFn: (row: ChartRow) => row.statistics?.procRate,
				cell: (info) => formatPercent(info.getValue()),
				sortDescFirst: true,
			},
			{
				header: headerLabel(
					'n',
					'Cumulative paired samples this row has been evaluated on -- see the row tooltip for why sampling stopped',
				),
				id: 'n',
				accessorFn: (row: ChartRow) => row.n,
				cell: (info) => info.getValue(),
				sortDescFirst: true,
			},
		],
		[
			props.showUmaIcons,
			props.showOutfitEpithet,
			props.showUmaName,
			props.bestValueId,
			props.bestValueTooltip,
			props.showConditionalBadge,
		],
	);

	const [sorting, setSorting] = useState<SortingState>([
		{ id: 'mean', desc: true },
	]);

	const table = useTable({
		_features: tableFeatures({ rowSortingFeature }),
		_rowModels: { sortedRowModel: createSortedRowModel(sortFns) },
		columns,
		data: props.data,
		onSortingChange: setSorting,
		enableSortingRemoval: false,
		state: { sorting },
	});

	function handleClick(e) {
		const tr = e.target.closest('tr');
		if (tr == null) return;
		e.stopPropagation();
		const id = tr.dataset.skillid;
		if (e.target.tagName == 'IMG') {
			props.onInfoClick(id);
			return;
		}

		const now = Date.now();
		const isDoubleClick =
			lastClickRef.current.id === id && now - lastClickRef.current.time < 300;

		if (clickTimeoutRef.current) {
			clearTimeout(clickTimeoutRef.current);
			clickTimeoutRef.current = null;
			if (!isDoubleClick) {
				toggleExpand(id);
			}
			return;
		}

		lastClickRef.current = { id, time: now };
		clickTimeoutRef.current = setTimeout(() => {
			clickTimeoutRef.current = null;
			if (
				lastClickRef.current.id === id &&
				Date.now() - lastClickRef.current.time >= 300
			) {
				toggleExpand(id);
			}
		}, 300);
	}

	function handleDblClick(e) {
		if (clickTimeoutRef.current) {
			clearTimeout(clickTimeoutRef.current);
			clickTimeoutRef.current = null;
		}
		const tr = e.target.closest('tr');
		if (tr == null) return;
		e.stopPropagation();
		e.preventDefault();
		const id = tr.dataset.skillid;
		if (e.target.tagName == 'IMG') {
			return;
		}
		if (expanded === id) {
			return;
		}
		lastClickRef.current = { id: '', time: 0 };
		props.onDblClickRow(id);
	}

	return (
		<div class={`basinnChartWrapper${props.dirty ? ' dirty' : ''}`}>
			<table class="basinnChart">
				<thead>
					{table.getHeaderGroups().map((headerGroup) => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<th key={header.id} colSpan={header.colSpan}>
									{!header.isPlaceholder && (
										<div
											class={`columnHeader ${
												{
													asc: 'basinnChartSortedAsc',
													desc: 'basinnChartSortedDesc',
													false: '',
												}[header.column.getIsSorted()]
											}`}
											title={
												header.column.getCanSort() &&
												{
													asc: 'Sort ascending',
													desc: 'Sort descending',
													false: 'Clear sort',
												}[header.column.getNextSortingOrder()]
											}
											onClick={
												header.column.getCanSort()
													? header.column.getToggleSortingHandler()
													: undefined
											}
										>
											{flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)}
										</div>
									)}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody onClick={handleClick} onDblClick={handleDblClick}>
					{table.getRowModel().rows.map((row) => {
						const id = row.getValue('id');
						const isExpanded = expanded === id;
						const rowData: ChartRow = row.original;
						const muted = isMutedRow(rowData);
						return (
							<Fragment key={row.id}>
								<tr
									data-skillid={id}
									class={`${isExpanded ? 'expanded' : ''} ${muted ? 'basinnChartMuted' : ''}${props.highlighted.has(id) ? ' basinnChartHighlighted' : ''}`}
									style={props.hidden.has(id) && 'display:none'}
									title={rowTooltip(rowData)}
								>
									{row.getAllCells().map((cell) => (
										<td key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</td>
									))}
								</tr>
								{isExpanded &&
									rowData &&
									rowData.status !== 'pending' &&
									props.expandedContent && (
										<tr class="expanded-content-row" data-skillid={id}>
											<td colSpan={row.getAllCells().length}>
												{props.expandedContent(id, props.courseDistance)}
											</td>
										</tr>
									)}
							</Fragment>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
