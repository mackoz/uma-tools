import { h } from 'preact';

import { getSkillName } from '../../components/SkillPicker';
import type { PurchaseSet } from '../spOptimizer';

import './SpOptimizerCard.css';

// UI-16 chunk 3 (+ strip redesign): the Skill Chart's SP-budget optimizer, rendered as a single
// compact row above BasinnChart once the shop-skills shortlist filter (UI-27/UI-28) is active.
// Deliberately one line tall: at the default results-pane height the earlier card layout (big
// per-option tiles with icon strips) left only ~3 table rows visible, and the icon strips
// duplicated what selecting an option already shows better -- the highlighted rows in the table
// itself. Each option button carries only what the table can't: rank, estimated total gain,
// total SP, skill count (the full skill list is in its tooltip). The SP budget input lives in
// ShopSkillFilter.tsx's row; selecting an option drives BasinnChart's `highlighted` prop
// (app.tsx wiring).
//
// Every gain number here is an ESTIMATE, not a re-simulated combination -- that caveat lives in
// the strip's ⓘ tooltip. optimizePurchases sums each shortlisted skill's own individually
// measured chart gain; skills interacting (positively or negatively) when run together is a real
// possibility this strip can't account for.
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
}

// Exported for ShopSkillFilter.tsx, which renders the actual budget input.
export function parseBudgetInput(raw: string): number {
	if (raw === '') return 0;
	const v = parseInt(raw, 10);
	if (!Number.isFinite(v) || v < 0) return 0;
	return v;
}

const ESTIMATE_NOTE =
	"Estimates sum each skill's individually measured gain — combinations aren't re-simulated. " +
	'Click an option to highlight its skills in the table below.';

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
	if (!props.shopFilterActive) {
		return (
			<div class="spOptimizerStrip">
				<span class="spOptimizerTitle">Buy list</span>
				<span class="spOptimizerHint">
					Add skills under Shop skills to get a buy list.
				</span>
			</div>
		);
	}

	// The strip's content depends on which of several mutually-exclusive states applies. Kept as a
	// single `body` slot so the title always renders once shopFilterActive is true.
	let body: any = null;
	if (props.dirty) {
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
							class="spOptimizerTruncated"
							title="The search hit its safety limit before covering every combination — these options may not be the true best. A smaller shortlist or budget gives a complete answer."
						>
							⚠ may be incomplete
						</span>
					)}
					<span
						class="spOptimizerInfo"
						title={ESTIMATE_NOTE}
						aria-label={ESTIMATE_NOTE}
						role="note"
					>
						ⓘ
					</span>
				</span>
			);
		}
	}

	return (
		<div class="spOptimizerStrip">
			<span class="spOptimizerTitle">Buy list</span>
			{body}
		</div>
	);
}
