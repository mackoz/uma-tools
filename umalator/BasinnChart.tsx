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
import { getParser } from '../uma-skill-tools/ConditionParser';
import type { CourseData } from '../uma-skill-tools/CourseData';
import type { RaceParameters } from '../uma-skill-tools/RaceParameters';
import {
	buildBaseStats,
	buildSkillData,
	Perspective,
} from '../uma-skill-tools/RaceSolverBuilder';
import { Region, RegionList } from '../uma-skill-tools/Region';
import type { ChartRow } from './chartLadder';

import './BasinnChart.css';

import icons from '../icons.json';
import skillmeta from '../skill_meta.json';
import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillnames from '../uma-skill-tools/data/skillnames.json';
import umas from '../umas.json';

export function isPurpleSkill(id) {
	const iconId = skillmeta[id].iconId;
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

function umaForUniqueSkill(skillId: string): string | null {
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

export function getActivateableSkills(
	skills: string[],
	horse: HorseState,
	course: CourseData,
	racedef: RaceParameters,
) {
	const parser = getParser();
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

function rowTooltip(row: ChartRow): string {
	const status = STATUS_LABEL[row.status] ?? row.status;
	const reason = row.eliminationReason
		? REASON_LABEL[row.eliminationReason]
		: null;
	return `${row.n} samples — ${status}${reason ? `: ${reason}` : ''}`;
}

function SkillNameCell(props) {
	const { id, showUmaIcons = false } = props;

	if (showUmaIcons) {
		const umaId = umaForUniqueSkill(id);
		if (umaId && icons[umaId]) {
			return (
				<div class="chartSkillName">
					<img src={icons[umaId]} />
					<span>
						<Text id={`skillnames.${id}`} />
					</span>
				</div>
			);
		}
	}

	return (
		<div class="chartSkillName">
			<img src={`/uma-tools/icons/${skillmeta[id].iconId}.png`} />
			<span>
				<Text id={`skillnames.${id}`} />
			</span>
		</div>
	);
}

function headerLabel(text: string, title: string) {
	return (c) => (
		<span title={title} onClick={c.header.column.getToggleSortingHandler()}>
			{text}
		</span>
	);
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
				header: () => <span>Skill</span>,
				accessorKey: 'id',
				cell: (info) => (
					<SkillNameCell
						id={info.getValue()}
						showUmaIcons={props.showUmaIcons}
					/>
				),
				sortingFn: (a, b, _) =>
					skillnames[a.getValue('id')] < skillnames[b.getValue('id')] ? -1 : 1,
			},
			{
				header: headerLabel(
					'Gain (95% CI)',
					'Expected length gain vs. the baseline uma, with a confidence interval on that mean',
				),
				id: 'mean',
				accessorFn: (row: ChartRow) =>
					row.statistics?.mean ?? Number.NEGATIVE_INFINITY,
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
		[props.showUmaIcons],
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
						const muted =
							rowData.status === 'screened' ||
							rowData.status === 'inert' ||
							rowData.status === 'pending';
						return (
							<Fragment key={row.id}>
								<tr
									data-skillid={id}
									class={`${isExpanded ? 'expanded' : ''} ${muted ? 'basinnChartMuted' : ''}`}
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
