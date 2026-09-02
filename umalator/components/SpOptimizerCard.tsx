import { h } from 'preact';

import {
	getSkillIcon,
	getSkillName,
	getSkillRarityClass,
} from '../../components/SkillPicker';
import type { PurchaseSet } from '../spOptimizer';

import './SpOptimizerCard.css';

// UI-16 chunk 3: the Skill Chart's SP-budget optimizer card. Renders in the app's main results
// pane, next to BasinnChart, once the shop-skills shortlist filter (UI-27/UI-28) is active --
// lets the user set an SP budget and pick from up to spOptimizer.ts's optimizePurchases' topK
// diverse purchase sets. Selecting one drives BasinnChart's `highlighted` prop (app.tsx wiring),
// so the chart rows for that purchase light up below.
//
// Every gain number this card shows is an ESTIMATE, not a re-simulated combination -- see the
// footnote rendered with the options themselves. optimizePurchases sums each shortlisted skill's
// own individually-measured chart gain; skills interacting (positively or negatively) when run
// together is a real possibility this card can't account for.
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
	budget: number;
	onBudgetChange: (sp: number) => void;
	// May be empty, or its first entry may be the empty (nothing-to-buy) set -- see render logic
	// below for how each case reads.
	options: PurchaseSet[];
	// The optimizer's DFS hit its node-visit safety ceiling and stopped early -- options are a
	// best-effort selection, not a guaranteed optimum, and the card says so.
	truncated: boolean;
	selectedIndex: number | null;
	// Clicking the already-selected option calls this with null (toggle off).
	onSelect: (index: number | null) => void;
}

function parseBudgetInput(raw: string): number {
	if (raw === '') return 0;
	const v = parseInt(raw, 10);
	if (!Number.isFinite(v) || v < 0) return 0;
	return v;
}

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
		>
			<div class="spOptimizerOptionTop">
				<span class="spOptimizerOptionRank">{rank}</span>
				<span class="spOptimizerOptionGain">
					Est. +{option.totalGain.toFixed(2)} lengths
				</span>
			</div>
			<div class="spOptimizerOptionMeta">
				{option.totalCost} SP · {option.skillIds.length} skill
				{option.skillIds.length === 1 ? '' : 's'}
			</div>
			<div class="spOptimizerOptionIcons">
				{option.skillIds.map((id) => (
					<img
						key={id}
						class={`spOptimizerOptionIcon ${getSkillRarityClass(id)}`}
						src={getSkillIcon(id)}
						loading="lazy"
						title={getSkillName(id)}
					/>
				))}
			</div>
		</button>
	);
}

export function SpOptimizerCard(props: SpOptimizerCardProps) {
	if (!props.shopFilterActive) {
		return (
			<div class="spOptimizerCard spOptimizerCardPrompt">
				Add skills under Shop skills to get a buy list.
			</div>
		);
	}

	// Body content depends on which of several mutually-exclusive states applies -- see the plan's
	// render logic. Kept as a single `body` slot (rather than early-returning per branch) so the
	// header + budget input above always render once shopFilterActive is true.
	let body: any = null;
	if (props.dirty) {
		body = (
			<div class="spOptimizerDirtyNote">
				Shop skills changed since this run — run the chart again for an
				up-to-date buy list.
			</div>
		);
	} else if (props.candidateCount === 0) {
		body = <div class="spOptimizerHint">Run the chart to get a buy list.</div>;
	} else if (props.budget <= 0) {
		body = <div class="spOptimizerHint">Enter your SP budget.</div>;
	} else {
		// The empty (nothing-bought) set, if present, is never itself a clickable option -- filter
		// it out entirely rather than rendering a "buy nothing" button.
		const entries = props.options
			.map((option, index) => ({ option, index }))
			.filter(({ option }) => option.skillIds.length > 0);
		if (entries.length === 0) {
			body = (
				<div class="spOptimizerHint">
					Nothing worth buying within this budget.
				</div>
			);
		} else {
			body = (
				<div class="spOptimizerBody">
					<div class="spOptimizerOptions">
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
					</div>
					{props.truncated && (
						<div class="spOptimizerFootnote">
							The search hit its safety limit before covering every combination
							— these options may not be the true best. A smaller shortlist or
							budget gives a complete answer.
						</div>
					)}
					<div class="spOptimizerFootnote">
						Estimates sum each skill's individually measured gain — combinations
						aren't re-simulated.
					</div>
				</div>
			);
		}
	}

	return (
		<div class="spOptimizerCard">
			<div class="spOptimizerHeader">
				<span class="spOptimizerTitle">Buy list</span>
				<label class="spOptimizerBudgetLabel">
					SP budget
					<input
						type="number"
						class="spOptimizerBudgetInput"
						min="0"
						step="10"
						value={props.budget}
						onInput={(e) =>
							props.onBudgetChange(
								parseBudgetInput((e.target as HTMLInputElement).value),
							)
						}
					/>
				</label>
			</div>
			{body}
		</div>
	);
}
