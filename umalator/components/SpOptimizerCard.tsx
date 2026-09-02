import { h } from 'preact';
import { useEffect } from 'preact/hooks';

import {
	getSkillIcon,
	getSkillName,
	getSkillRarityClass,
} from '../../components/SkillPicker';
import type { PurchaseSet } from '../spOptimizer';

import './SpOptimizerCard.css';

// UI-16 chunk 3 (+ strip redesign, + upward detail overlay): the Skill Chart's SP-budget
// optimizer, rendered as a single compact row above BasinnChart once the shop-skills shortlist
// filter (UI-27/UI-28) is active. Deliberately one line tall: at the default results-pane height
// the earlier card layout (big per-option tiles with icon strips) left only ~3 table rows
// visible. Each option button carries only what the table can't at a glance: rank, estimated
// total gain, total SP, skill count (the full skill list is in its tooltip). The SP budget input
// lives in ShopSkillFilter.tsx's row; selecting an option drives BasinnChart's `highlighted` prop
// (app.tsx wiring) AND pops a detail overlay -- the old per-option tile content (rank, big gain,
// rarity-bordered icon strip) plus per-skill hint-discounted prices, which nothing else in the UI
// surfaces (the strip's tooltip has names only; the table has gains, not costs). The overlay is
// absolutely positioned and expands UPWARD from the strip (`bottom: calc(100% + 6px)` in the
// CSS) rather than being laid in-flow above or below it -- either in-flow placement would push
// the chart table down, and table height is sacred (see the strip's own one-row-tall rationale
// above). It covers whatever sits above the results pane while open; Escape and click-outside
// both dismiss it.
//
// Every gain number here is an ESTIMATE, not a re-simulated combination -- that caveat lives in
// the strip's ⓘ tooltip and, expanded, in the detail overlay's own footnote. optimizePurchases
// sums each shortlisted skill's own individually measured chart gain; skills interacting
// (positively or negatively) when run together is a real possibility this strip can't account
// for.
interface SpOptimizerCardProps {
	// False outside the shop-skills-filtered chart flow -- e.g. no shortlist built yet. Renders
	// only the one-line prompt in that case.
	shopFilterActive: boolean;
	// Rows in the last chart run with usable statistics AND on the shortlist (app.tsx's
	// optimizerCandidates.length) -- 0 with the filter active means "no run yet" rather than "no
	// shortlist," since an empty shortlist already makes shopFilterActive false above.
	candidateCount: number;
	// Shortlist changed since the last completed run (app.tsx's shopDirty) -- the chart's own gain
	// numbers are stale, so no option buttons render until a fresh run clears this.
	dirty: boolean;
	// Read-only here: the input lives in ShopSkillFilter.tsx's row (next to the shortlist it
	// applies to); this strip only needs the value for its zero-budget empty state.
	budget: number;
	// May be empty, or its first entry may be the empty (nothing-to-buy) set -- see render logic
	// below for how each case reads.
	options: PurchaseSet[];
	// The optimizer's DFS hit its node-visit safety ceiling and stopped early -- options are a
	// best-effort selection, not a guaranteed optimum, and the strip says so.
	truncated: boolean;
	selectedIndex: number | null;
	// Clicking the already-selected option calls this with null (toggle off).
	onSelect: (index: number | null) => void;
	// Per-skill hint-discounted SP cost, for the detail overlay's price column. Supplied by
	// app.tsx (SKILL_BASE_COST + expandedShopHints) so this component stays JSON-free.
	costOf: (id: string) => number;
}

// Exported for ShopSkillFilter.tsx, which renders the actual budget input.
export function parseBudgetInput(raw: string): number {
	if (raw === '') return 0;
	const v = parseInt(raw, 10);
	if (!Number.isFinite(v) || v < 0) return 0;
	return v;
}

// First sentence stands alone as the detail overlay's footnote; the click hint is only for the
// strip's ⓘ tooltip, where no option is necessarily selected yet -- in the overlay (which only
// exists because an option IS selected and highlighted) it would be stale advice.
const ESTIMATE_SENTENCE =
	"Estimates sum each skill's individually measured gain — combinations aren't re-simulated.";
const ESTIMATE_NOTE = `${ESTIMATE_SENTENCE} Click an option to highlight its skills in the table below.`;

function OptionButton({
	option,
	rank,
	selected,
	onClick,
}: {
	option: PurchaseSet;
	rank: number;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			class={`spOptimizerOption${selected ? ' selected' : ''}`}
			aria-pressed={selected}
			aria-expanded={selected}
			aria-controls="spOptimizerDetail"
			onClick={onClick}
			title={option.skillIds.map(getSkillName).join(', ')}
		>
			<span class="spOptimizerOptionRank">{rank}</span>
			<span class="spOptimizerOptionGain">
				+{option.totalGain.toFixed(2)} L
			</span>
			<span class="spOptimizerOptionMeta">
				{option.totalCost} SP · {option.skillIds.length} skill
				{option.skillIds.length === 1 ? '' : 's'}
			</span>
		</button>
	);
}

export function SpOptimizerCard(props: SpOptimizerCardProps) {
	// The strip's content depends on which of several mutually-exclusive states applies. Kept as a
	// single `body` slot so the title always renders regardless of state, and a separate `detail`
	// slot (only ever populated in the final `else` branch below) for the on-demand upward
	// overlay. Both are computed unconditionally, before any hook call, so the escape/click-outside
	// effect below always runs in the same position across renders -- an early return here (as the
	// old !shopFilterActive check used to do) would make that a conditional hook call once
	// shopFilterActive can toggle true/false across renders.
	let body: any = null;
	let detail: any = null;
	let detailOpen = false;

	if (!props.shopFilterActive) {
		body = (
			<span class="spOptimizerHint">
				Add skills under Shop skills to get a buy list.
			</span>
		);
	} else if (props.dirty) {
		body = (
			<span class="spOptimizerDirtyNote">
				Shop skills changed since this run — run the chart again for an
				up-to-date buy list.
			</span>
		);
	} else if (props.candidateCount === 0) {
		body = (
			<span class="spOptimizerHint">Run the chart to get a buy list.</span>
		);
	} else if (props.budget <= 0) {
		body = (
			<span class="spOptimizerHint">
				Set your SP budget in the Shop skills row above.
			</span>
		);
	} else {
		// The empty (nothing-bought) set, if present, is never itself a clickable option -- filter
		// it out entirely rather than rendering a "buy nothing" button.
		const entries = props.options
			.map((option, index) => ({ option, index }))
			.filter(({ option }) => option.skillIds.length > 0);
		if (entries.length === 0) {
			body = (
				<span class="spOptimizerHint">
					Nothing worth buying within this budget.
				</span>
			);
		} else {
			body = (
				<span class="spOptimizerOptions">
					{entries.map(({ option, index }, rank) => {
						const selected = props.selectedIndex === index;
						return (
							<OptionButton
								key={option.skillIds.join('+')}
								option={option}
								rank={rank + 1}
								selected={selected}
								onClick={() => props.onSelect(selected ? null : index)}
							/>
						);
					})}
					{props.truncated && (
						<span
							class="spOptimizerTruncated spOptimizerTip"
							tabIndex={0}
							data-tip="The search hit its safety limit before covering every combination — these options may not be the true best. A smaller shortlist or budget gives a complete answer."
							aria-label="The search hit its safety limit before covering every combination — these options may not be the true best. A smaller shortlist or budget gives a complete answer."
						>
							⚠ may be incomplete
						</span>
					)}
					<span
						class="spOptimizerInfo spOptimizerTip"
						tabIndex={0}
						data-tip={ESTIMATE_NOTE}
						aria-label={ESTIMATE_NOTE}
						role="note"
					>
						ⓘ
					</span>
				</span>
			);
		}

		// selectedIndex indexes props.options, NOT entries (entries dropped the empty set and
		// re-densified), so look the selection up by its original index rather than treating
		// selectedIndex as an entries offset -- and the rank badge is the entry's DISPLAYED
		// position (entries.findIndex + 1), which can differ from selectedIndex when the empty set
		// was filtered out ahead of it.
		const sel = entries.find((e) => e.index === props.selectedIndex);
		if (sel) {
			detailOpen = true;
			const rank =
				entries.findIndex((e) => e.index === props.selectedIndex) + 1;
			detail = (
				<div class="spOptimizerDetail" id="spOptimizerDetail">
					<div class="spOptimizerDetailHeader">
						<span class="spOptimizerOptionRank">{rank}</span>
						<span class="spOptimizerOptionGain">
							Est. +{sel.option.totalGain.toFixed(2)} lengths
						</span>
						<span class="spOptimizerOptionMeta">
							{sel.option.totalCost} SP · {sel.option.skillIds.length} skill
							{sel.option.skillIds.length === 1 ? '' : 's'}
						</span>
					</div>
					<div class="spOptimizerDetailSkills">
						{sel.option.skillIds.map((id) => (
							<div class="spOptimizerDetailSkill" key={id}>
								<img
									class={`spOptimizerDetailIcon ${getSkillRarityClass(id)}`}
									src={getSkillIcon(id)}
									loading="lazy"
								/>
								<span class="spOptimizerDetailSkillName">
									{getSkillName(id)}
								</span>
								<span class="spOptimizerDetailSkillCost">
									{props.costOf(id)} SP
								</span>
							</div>
						))}
					</div>
					<div class="spOptimizerFootnote">{ESTIMATE_SENTENCE}</div>
				</div>
			);
		}
	}

	// Disclosure semantics: the overlay covers the Shop skills row / SP budget input above while
	// open, so it needs more exits than re-clicking the selected option -- Escape and
	// click-outside both dismiss it. Gated on detailOpen (a stable boolean, not the `detail` JSX
	// itself) so the listeners are only attached while a detail is actually shown. Mirrors
	// app.tsx's existing pacemaker-combobox click-outside listener (app.tsx, near the
	// isPacemakerDropdownOpen effect) -- same "gate on open state, closest() the container" shape.
	useEffect(() => {
		if (!detailOpen) return;
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') props.onSelect(null);
		}
		function handleClickOutside(event: MouseEvent) {
			const target = event.target as HTMLElement | null;
			if (!target?.closest('.spOptimizerStrip')) {
				props.onSelect(null);
			}
		}
		document.addEventListener('keydown', handleKeyDown);
		document.addEventListener('click', handleClickOutside);
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.removeEventListener('click', handleClickOutside);
		};
	}, [detailOpen, props.onSelect]);

	return (
		<div class="spOptimizerStrip">
			<span class="spOptimizerTitle">Buy list</span>
			{body}
			{detail}
		</div>
	);
}
