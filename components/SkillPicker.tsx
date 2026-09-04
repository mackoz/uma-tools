import { ArrowDownUp, Search, X } from 'lucide-preact';
import { Fragment, h } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { getParser } from '../uma-skill-tools/ConditionParser';
import * as Matcher from '../uma-skill-tools/tools/ConditionMatcher';
import { getSkillIconSrc, matchesAnyIconType } from './SkillIcons';
import { FormattedCondition } from './SkillList';
import { matchRarity } from './SkillRarity';

import './SkillPicker.css';

import skillmeta from '../skill_meta.json';
import skilldata from '../uma-skill-tools/data/jp/skill_data.json';
import skillnames from '../uma-skill-tools/data/jp/skillnames.json';

const Parser = getParser(Matcher.mockConditions);

function C(s: string) {
	return Parser.parseAny(Parser.tokenize(s));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Exported for umalator/components/ShopSkillPanel.tsx's shortlist rows (UI-28; originally
// ShopSkillFilter.tsx's chip strip, UI-27) -- otherwise module-private, used only inside this
// file.
export function getSkillName(skillId: string): string {
	return skillnames[skillId]?.[0] || `Skill ${skillId}`;
}

export function getSkillIcon(skillId: string): string {
	// No meta entry at all (distinct from iconId "0", which getSkillIconSrc already handles via
	// the shared rarity/effect-type-aware guess in components/SkillIcons.ts -- PIPE-2 review:
	// this file previously had its own separate flat-placeholder fallback here, which showed a
	// different, unrelated icon than every other view of the same skill).
	if (!skillmeta[skillId]) return '/uma-tools/icons/10011.png';
	return getSkillIconSrc(skillId);
}

// rarity 1=white, 2=gold, 3-5=unique (purple in this app), 6=pink (evolved)
export function getSkillRarityClass(skillId: string): string {
	const skill = skilldata[skillId];
	if (!skill) return 'skill-white';
	const r = skill.rarity;
	if (r === 1) return 'skill-white';
	if (r === 2) return 'skill-gold';
	if (r >= 3 && r <= 5) return 'skill-unique';
	if (r === 6) return 'skill-pink';
	return 'skill-white';
}

// ── Condition filter setup (module-level for performance) ─────────────────────

const filterOps = Object.freeze({
	nige: [C('running_style==1')],
	senkou: [C('running_style==2')],
	sasi: [C('running_style==3')],
	oikomi: [C('running_style==4')],
	short: [C('distance_type==1')],
	mile: [C('distance_type==2')],
	medium: [C('distance_type==3')],
	long: [C('distance_type==4')],
	turf: [C('ground_type==1')],
	dirt: [C('ground_type==2')],
	phase0: [
		C('phase==0'),
		C('phase_random==0'),
		C('phase_firsthalf_random==0'),
		C('phase_laterhalf_random==0'),
	],
	phase1: [
		C('phase==1'),
		C('phase>=1'),
		C('phase_random==1'),
		C('phase_firsthalf_random==1'),
		C('phase_laterhalf_random==1'),
	],
	phase2: [
		C('phase==2'),
		C('phase>=2'),
		C('phase_random==2'),
		C('phase_firsthalf_random==2'),
		C('phase_laterhalf_random==2'),
		C('phase_firstquarter_random==2'),
		C('is_lastspurt==1'),
	],
	phase3: [
		C('phase==3'),
		C('phase_random==3'),
		C('phase_firsthalf_random==3'),
		C('phase_laterhalf_random==3'),
	],
	finalcorner: [
		C('is_finalcorner==1'),
		C('is_finalcorner_laterhalf==1'),
		C('is_finalcorner_random==1'),
	],
	finalstraight: [C('is_last_straight==1'), C('is_last_straight_onetime==1')],
});

const parsedConditions: Record<string, any[]> = {};
Object.keys(skilldata).forEach((id) => {
	parsedConditions[id] = skilldata[id].alternatives.map((ef) =>
		Parser.parse(Parser.tokenize(ef.condition)),
	);
});

const skillSearchIndex: Record<string, string> = {};
Object.keys(skilldata).forEach((id) => {
	skillSearchIndex[id] = getSkillName(id).toUpperCase();
});

function matchConditionFilter(id: string, filterKey: string): boolean {
	const ops = filterOps[filterKey];
	const conditions = parsedConditions[id];
	if (!ops || !conditions) return false;
	return ops.some((op) => conditions.some((alt) => Matcher.treeMatch(op, alt)));
}

// ── Icon type filter ──────────────────────────────────────────────────────────

// ANCHOR: skill-picker-icontype-table
const ICON_TYPE_FILTERS = [
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

const ALL_ICON_TYPES = new Set(ICON_TYPE_FILTERS);

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortOption = 'rarity' | 'alpha' | 'game';

function rarityOrder(r: number): number {
	if (r === 2) return 0;
	if (r === 1) return 1;
	if (r >= 3 && r <= 5) return 2 + (5 - r);
	if (r === 6) return 10;
	return 99;
}

function sortSkills(ids: string[], sort: SortOption): string[] {
	return [...ids].sort((a, b) => {
		if (sort === 'alpha') {
			const c = getSkillName(a).localeCompare(getSkillName(b));
			return c !== 0 ? c : a < b ? -1 : a > b ? 1 : 0;
		}
		if (sort === 'game') {
			const x = skillmeta[a]?.order ?? 99999;
			const y = skillmeta[b]?.order ?? 99999;
			if (x !== y) return x - y;
			return a.localeCompare(b);
		}
		// 'rarity': gold, white, unique (desc rarity), pink
		const ra = skilldata[a]?.rarity ?? 1;
		const rb = skilldata[b]?.rarity ?? 1;
		const oa = rarityOrder(ra),
			ob = rarityOrder(rb);
		if (oa !== ob) return oa - ob;
		return getSkillName(a).localeCompare(getSkillName(b));
	});
}

// ── SkillPickerModal ──────────────────────────────────────────────────────────

interface SkillPickerModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSelect: (skillId: string) => void;
	selectedSkills: string[];
	availableSkillIds: string[];
	// UI-27 additions, all optional and backwards-compatible -- HorseDef's own call site
	// (the only one before UI-27) passes none of these and is unaffected.
	//
	// When supplied, a selected item is no longer `disabled` -- clicking it (or Enter on it)
	// calls onDeselect instead of being a no-op, so the picker becomes usable for a "pick an
	// arbitrary set, toggle freely" flow rather than HorseDef's "equip one, keep it equipped"
	// flow. Absent, behavior is identical to before this change.
	onDeselect?: (skillId: string) => void;
	// Defaults to today's "Search skills..." placeholder.
	searchPlaceholder?: string;
	// Rendered between the filter rows and the skill list -- lets a caller (the Skill Chart's
	// shop-skill picker) show its own "show all skills" escape hatch and pool-size copy without
	// this modal needing to know anything about the chart.
	notice?: any;
	// UI-28: rendered as a sibling of .skill-picker-list, to its right, always visible while the
	// modal is open -- lets a caller (the Skill Chart's shop-skill picker) keep a running view of
	// what it has selected without this modal knowing anything about the chart. Optional and
	// backwards-compatible like the three props above; HorseDef's call site passes none of them.
	sidePanel?: any;
}

const SORT_LABELS: Record<SortOption, string> = {
	rarity: 'Rarity',
	alpha: 'A–Z',
	game: 'Game',
};

const FILTER_GROUPS = [
	{
		row: 1,
		group: 'rarity',
		label: 'Rarity',
		filters: [
			{ id: 'white', label: 'White' },
			{ id: 'gold', label: 'Gold' },
			{ id: 'unique', label: 'Unique' },
			{ id: 'inherit', label: 'Inherited' },
		],
	},
	{
		row: 1,
		group: 'strategy',
		label: 'Strategy',
		filters: [
			{ id: 'nige', label: 'Runner' },
			{ id: 'senkou', label: 'Leader' },
			{ id: 'sasi', label: 'Betweener' },
			{ id: 'oikomi', label: 'Chaser' },
		],
	},
	{
		row: 2,
		group: 'distance',
		label: 'Distance',
		filters: [
			{ id: 'short', label: 'Sprint' },
			{ id: 'mile', label: 'Mile' },
			{ id: 'medium', label: 'Medium' },
			{ id: 'long', label: 'Long' },
		],
	},
	{
		row: 2,
		group: 'surface',
		label: 'Surface',
		filters: [
			{ id: 'turf', label: 'Turf' },
			{ id: 'dirt', label: 'Dirt' },
		],
	},
	{
		row: 2,
		group: 'location',
		label: 'Location',
		filters: [
			{ id: 'phase0', label: 'Opening' },
			{ id: 'phase1', label: 'Middle' },
			{ id: 'phase2', label: 'Final' },
			{ id: 'phase3', label: 'Spurt' },
			{ id: 'finalcorner', label: 'Last ↩' },
			{ id: 'finalstraight', label: 'Last →' },
		],
	},
];

type FilterState = Record<string, string | null>;
const EMPTY_FILTERS: FilterState = {
	rarity: null,
	strategy: null,
	distance: null,
	surface: null,
	location: null,
};

export function SkillPickerModal({
	isOpen,
	onClose,
	onSelect,
	selectedSkills,
	availableSkillIds,
	onDeselect,
	searchPlaceholder,
	notice,
	sidePanel,
}: SkillPickerModalProps) {
	const [searchQuery, setSearchQuery] = useState('');
	const [sortOption, setSortOption] = useState<SortOption>('rarity');
	const [activeFilters, setActiveFilters] =
		useState<FilterState>(EMPTY_FILTERS);
	const [activeIconTypes, setActiveIconTypes] =
		useState<Set<string>>(ALL_ICON_TYPES);
	const [activeIdx, setActiveIdx] = useState(-1);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	function toggleIconType(iconType: string) {
		setActiveIconTypes((prev) => {
			if (prev.size === ICON_TYPE_FILTERS.length) {
				return new Set([iconType]);
			}
			const next = new Set(prev);
			if (next.has(iconType)) {
				next.delete(iconType);
			} else {
				next.add(iconType);
			}
			return next.size === 0 ? ALL_ICON_TYPES : next;
		});
	}

	useEffect(() => {
		if (!isOpen) {
			setSearchQuery('');
			setSortOption('rarity');
			setActiveFilters(EMPTY_FILTERS);
			setActiveIconTypes(ALL_ICON_TYPES);
			setActiveIdx(-1);
		} else {
			const t = setTimeout(() => searchInputRef.current?.focus(), 10);
			return () => clearTimeout(t);
		}
	}, [isOpen]);

	useEffect(() => {
		setActiveIdx(-1);
	}, [
		searchQuery,
		activeFilters,
		activeIconTypes,
		sortOption,
		availableSkillIds,
	]);

	const filteredIds = useMemo(() => {
		const query = searchQuery.toUpperCase();
		const iconFiltered = activeIconTypes.size < ICON_TYPE_FILTERS.length;
		const filtered = availableSkillIds.filter((id) => {
			if (
				query &&
				(!skillSearchIndex[id] || skillSearchIndex[id].indexOf(query) === -1)
			)
				return false;
			const { rarity, strategy, distance, surface, location } = activeFilters;
			if (rarity && !matchRarity(id, rarity)) return false;
			if (strategy && !matchConditionFilter(id, strategy)) return false;
			if (distance && !matchConditionFilter(id, distance)) return false;
			if (surface && !matchConditionFilter(id, surface)) return false;
			if (location && !matchConditionFilter(id, location)) return false;
			if (iconFiltered && !matchesAnyIconType(id, activeIconTypes))
				return false;
			return true;
		});
		return sortSkills(filtered, sortOption);
	}, [
		searchQuery,
		activeFilters,
		activeIconTypes,
		sortOption,
		availableSkillIds,
	]);

	useEffect(() => {
		if (!isOpen) return;
		function getCols() {
			if (!listRef.current) return 1;
			const tracks = getComputedStyle(listRef.current).gridTemplateColumns;
			return Math.max(1, tracks.split(/\s+/).filter(Boolean).length);
		}
		function handler(e: KeyboardEvent) {
			// UI-16: a shop-hint-level field's own keydown handler owns arrows/digits/Escape while
			// it's focused -- without this, this modal-wide handler would hijack ArrowUp/ArrowDown
			// (grid navigation) and Escape (closes the modal) out from under it mid-entry.
			if ((e.target as HTMLElement | null)?.closest?.('.shopSkillHint')) return;
			switch (e.key) {
				case 'ArrowDown': {
					e.preventDefault();
					const cols = getCols();
					setActiveIdx((i) =>
						i === -1
							? Math.min(0, filteredIds.length - 1)
							: i + cols < filteredIds.length
								? i + cols
								: i,
					);
					break;
				}
				case 'ArrowUp': {
					e.preventDefault();
					const cols = getCols();
					setActiveIdx((i) => (i - cols >= 0 ? i - cols : -1));
					break;
				}
				case 'ArrowRight':
					if (activeIdx >= 0) {
						e.preventDefault();
						setActiveIdx((i) => Math.min(i + 1, filteredIds.length - 1));
					}
					break;
				case 'ArrowLeft':
					if (activeIdx >= 0) {
						e.preventDefault();
						setActiveIdx((i) => Math.max(i - 1, 0));
					}
					break;
				case '`':
					e.preventDefault();
					setActiveIdx(-1);
					searchInputRef.current?.focus();
					searchInputRef.current?.select();
					break;
				case 'Enter':
					if (activeIdx >= 0 && activeIdx < filteredIds.length) {
						const id = filteredIds[activeIdx];
						if (selectedSkills.includes(id)) {
							onDeselect?.(id);
						} else {
							onSelect(id);
						}
					}
					break;
				case 'Escape':
					onClose();
					break;
			}
		}
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [
		isOpen,
		activeIdx,
		filteredIds,
		selectedSkills,
		onSelect,
		onDeselect,
		onClose,
	]);

	useEffect(() => {
		if (activeIdx < 0 || !listRef.current) return;
		const item = listRef.current.children[activeIdx] as HTMLElement;
		item?.scrollIntoView({ block: 'nearest' });
	}, [activeIdx]);

	function handleFilterClick(group: string, filter: string) {
		setActiveFilters((prev) => ({
			...prev,
			[group]: prev[group] === filter ? null : filter,
		}));
	}

	if (!isOpen) return null;

	const row1 = FILTER_GROUPS.filter((g) => g.row === 1);
	const row2 = FILTER_GROUPS.filter((g) => g.row === 2);

	const modal = (
		<div class="skill-picker-overlay" onClick={onClose}>
			<div
				class={`skill-picker-modal${sidePanel ? ' has-side-panel' : ''}`}
				onClick={(e) => e.stopPropagation()}
			>
				<div class="skill-picker-header">
					<div class="skill-picker-search">
						<Search size={14} class="skill-picker-search-icon" />
						<input
							ref={searchInputRef}
							type="text"
							placeholder={searchPlaceholder ?? 'Search skills...'}
							value={searchQuery}
							onInput={(e) =>
								setSearchQuery((e.target as HTMLInputElement).value)
							}
						/>
						<span class="skill-picker-key-hint">
							↑↓←→ navigate · ⏎ {onDeselect ? 'add/remove' : 'add'} · ` search
						</span>
					</div>
					<div class="skill-picker-sort-group">
						<span class="skill-picker-sort-label">
							<ArrowDownUp size={12} />
						</span>
						{(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
							<button
								key={opt}
								class={`skill-picker-sort-btn${sortOption === opt ? ' active' : ''}`}
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => setSortOption(opt)}
							>
								{SORT_LABELS[opt]}
							</button>
						))}
					</div>
					<button class="skill-picker-close" type="button" onClick={onClose}>
						<X size={16} />
					</button>
				</div>

				<div class="skill-picker-filters">
					<div class="filter-row">
						{row1.map((fg, i) => (
							<Fragment key={fg.group}>
								{i > 0 && <div class="filter-divider" />}
								<div class={`filter-group ${fg.group}`}>
									<div class="filter-label">{fg.label}</div>
									<div class="filter-chips">
										{fg.filters.map((f) => (
											<button
												key={f.id}
												class={`skill-filter-btn ${fg.group} ${f.id}${activeFilters[fg.group] === f.id ? ' active' : ''}`}
												type="button"
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => handleFilterClick(fg.group, f.id)}
											>
												{f.label}
											</button>
										))}
									</div>
								</div>
							</Fragment>
						))}
					</div>
					<div class="filter-row">
						{row2.map((fg, i) => (
							<Fragment key={fg.group}>
								{i > 0 && <div class="filter-divider" />}
								<div class={`filter-group ${fg.group}`}>
									<div class="filter-label">{fg.label}</div>
									<div class="filter-chips">
										{fg.filters.map((f) => (
											<button
												key={f.id}
												class={`skill-filter-btn ${fg.group} ${f.id}${activeFilters[fg.group] === f.id ? ' active' : ''}`}
												type="button"
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => handleFilterClick(fg.group, f.id)}
											>
												{f.label}
											</button>
										))}
									</div>
								</div>
							</Fragment>
						))}
					</div>
					<div class="filter-row">
						<div class="filter-group icontype">
							<div class="filter-label">Effect Type</div>
							<div class="filter-chips icontype">
								{ICON_TYPE_FILTERS.map((iconType) => (
									<button
										key={iconType}
										class={`icon-filter-btn${activeIconTypes.has(iconType) ? ' active' : ''}`}
										type="button"
										style={{
											backgroundImage: `url(/uma-tools/icons/${iconType}1.png)`,
										}}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => toggleIconType(iconType)}
									/>
								))}
							</div>
						</div>
					</div>
				</div>

				{notice}

				{/* UI-28: wraps .skill-picker-list so a caller-supplied sidePanel can render as its
				    sibling. Renders unconditionally (a layout no-op with one child) so there's a
				    single code path whether or not sidePanel is supplied. listRef stays on
				    .skill-picker-list itself, so the keyboard-cursor logic above (column count from
				    its own gridTemplateColumns, children[activeIdx], scrollIntoView) is unaffected. */}
				<div class="skill-picker-body">
					<div class="skill-picker-list" ref={listRef}>
						{filteredIds.length === 0 ? (
							<div class="skill-picker-empty">No skills found</div>
						) : (
							filteredIds.map((id, idx) => {
								const isSelected = selectedSkills.includes(id);
								// With onDeselect supplied, a selected item stays clickable (to remove
								// it) instead of being disabled -- UI-27's shop-skill picker needs
								// free toggling; HorseDef's own picker (no onDeselect) keeps today's
								// add-only, disabled-when-equipped behavior unchanged.
								const removable = isSelected && !!onDeselect;
								return (
									<button
										key={id}
										class={`skill-picker-item ${getSkillRarityClass(id)}${idx === activeIdx ? ' active' : ''}${isSelected ? ' selected' : ''}${removable ? ' removable' : ''}`}
										type="button"
										disabled={isSelected && !onDeselect}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											if (removable) onDeselect?.(id);
											else if (!isSelected) onSelect(id);
										}}
									>
										<img
											class="skill-picker-item-icon"
											src={getSkillIcon(id)}
											loading="lazy"
										/>
										<span class="skill-picker-item-name">
											{getSkillName(id)}
										</span>
										{isSelected &&
											(removable ? (
												<span
													class="skill-picker-item-remove"
													aria-label="Remove"
												>
													×
												</span>
											) : (
												<span class="skill-picker-item-check">✓</span>
											))}
									</button>
								);
							})
						)}
					</div>
					{sidePanel}
				</div>
			</div>
		</div>
	);

	return createPortal(modal, document.body);
}

// ── ExpandedSkillView ─────────────────────────────────────────────────────────
// Replaces ExpandedSkillDetails in the skill pill list with a cleaner layout.
// Preserves .expandedSkill / data-skillid / .skillDismiss so HorseDef's event
// delegation continues to work unchanged.

const EFFECT_TYPE_NAMES: Record<number, string> = {
	1: 'Speed',
	2: 'Stamina',
	3: 'Power',
	4: 'Guts',
	5: 'Wit',
	9: 'Recovery',
	21: 'Current Speed',
	22: 'Current Speed (w/ decel)',
	27: 'Target Speed',
	28: 'Lane Speed',
	31: 'Acceleration',
	37: 'Random Gold Skill',
	42: 'Duration Increase',
};

function formatEffectValue(type: number, modifier: number): string {
	const value = modifier / 10000;
	switch (type) {
		case 9:
			return `${(value * 100).toFixed(1)}%`;
		case 31:
			return `${value > 0 ? '+' : ''}${value}m/s²`;
		case 42:
			return `${value}×`;
		default:
			return value > 0 ? `+${value}` : `${value}`;
	}
}

interface ExpandedSkillViewProps {
	id: string;
	dismissable?: boolean;
	distanceFactor?: number;
	forcedPosition?: string;
	onPositionChange?: (value: string) => void;
	runData?: any;
	umaIndex?: any;
	onViewProcData?: () => void;
}

export function ExpandedSkillView({
	id,
	dismissable,
	distanceFactor,
	forcedPosition,
	onPositionChange,
	runData,
	umaIndex,
	onViewProcData,
}: ExpandedSkillViewProps) {
	const skill = skilldata[id];
	if (!skill) return null;

	return (
		<div
			class={`expandedSkill skill-expanded-view ${getSkillRarityClass(id)}`}
			data-skillid={id}
		>
			<div class="skill-expanded-header">
				<img class="skill-expanded-icon" src={getSkillIcon(id)} />
				<span class="skill-expanded-name">{getSkillName(id)}</span>
				{dismissable && <span class="skillDismiss">✕</span>}
			</div>
			<div class="skill-details" onClick={(e) => e.stopPropagation()}>
				<div class="skill-detail-row">
					<span class="skill-detail-label">ID:</span>
					<span class="skill-detail-value">{id}</span>
				</div>
				{skill.alternatives.map((alt, i) => (
					<div key={i} class="skill-alternative">
						{alt.precondition.length > 0 && (
							<div class="skill-detail-row">
								<span class="skill-detail-label">Precondition:</span>
								<div class="skill-detail-value">
									<FormattedCondition condition={alt.precondition} />
								</div>
							</div>
						)}
						<div class="skill-detail-row">
							<span class="skill-detail-label">Condition:</span>
							<div class="skill-detail-value">
								<FormattedCondition condition={alt.condition} />
							</div>
						</div>
						<div class="skill-detail-row">
							<span class="skill-detail-label">Effects:</span>
							<div class="skill-effects">
								{alt.effects.map((ef, j) => (
									<span key={j} class="skill-effect">
										<span class="effect-type">
											{EFFECT_TYPE_NAMES[ef.type] ?? `Type ${ef.type}`}
										</span>
										<span class="effect-value">
											{formatEffectValue(ef.type, ef.modifier)}
										</span>
									</span>
								))}
							</div>
						</div>
						{alt.baseDuration > 0 && (
							<div class="skill-detail-row">
								<span class="skill-detail-label">Duration:</span>
								<span class="skill-detail-value">
									{(alt.baseDuration / 10000).toFixed(2)}s base
									{distanceFactor != null &&
										` → ${(((alt.baseDuration / 10000) * distanceFactor) / 1000).toFixed(2)}s @ ${distanceFactor}m`}
								</span>
							</div>
						)}
					</div>
				))}
				{onPositionChange && (
					<div class="skill-detail-row skill-force-position">
						<span class="skill-detail-label">Force @ position (m):</span>
						<input
							type="number"
							class="force-position-input"
							placeholder="Optional"
							value={forcedPosition ?? ''}
							onInput={(e) =>
								onPositionChange((e.target as HTMLInputElement).value)
							}
							onClick={(e) => e.stopPropagation()}
							min="0"
							step="10"
						/>
					</div>
				)}
				{runData != null && umaIndex != null && onViewProcData && (
					<div class="skill-detail-row" style="margin-top: 6px;">
						<button
							class="skill-procdata-btn"
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onViewProcData();
							}}
						>
							View Proc Data
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
