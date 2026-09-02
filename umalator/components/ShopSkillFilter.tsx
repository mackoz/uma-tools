import { h } from 'preact';

import { parseBudgetInput } from './SpOptimizerCard';

import './ShopSkillFilter.css';

// UI-27/UI-28: the Skill Chart's "Shop skills" shortlist row -- lets a career run's actual shop
// offering narrow the chart's candidate pool instead of ranking the whole activateable pool. Pure
// presentation; all state lives in umalator/app.tsx (see doBasinnChart/chartCandidates there) and
// the pure predicates live in umalator/shopSkillFilter.ts.
//
// UI-28 collapsed this from four controls (checkbox + Edit... + Clear + an always-visible chip
// strip) to two: one combined button that opens the picker (umalator/components/ShopSkillPanel.tsx
// now owns the shortlist view, rendered inside that picker) plus Clear. There's no more
// enabled/disabled toggle -- a non-empty shortlist is always active.
interface ShopSkillFilterProps {
	skillIds: string[];
	onOpen: () => void;
	onClear: () => void;
	// Count of shortlisted skills that can't activate on this course/run style -- surfaced here so
	// the diagnostic ShopSkillPanel's "Won't activate here" section carries isn't lost entirely
	// while the picker is closed. Per-skill detail lives in the panel; this is just the summary.
	wontProcCount: number;
	// UI-16 follow-up: the SP budget the Buy list card (SpOptimizerCard.tsx) optimizes against.
	// Entered here, next to the shortlist it applies to, rather than in the card itself -- the
	// card only displays results. Same app.tsx state (spBudget) either way.
	budget: number;
	onBudgetChange: (sp: number) => void;
	disabled?: boolean;
}

export function ShopSkillFilter({
	skillIds,
	onOpen,
	onClear,
	wontProcCount,
	budget,
	onBudgetChange,
	disabled,
}: ShopSkillFilterProps) {
	return (
		<div class="chartFilterRow shopSkillFilterRow">
			<span class="chartFilterLabel">Shop skills</span>
			<button
				type="button"
				class="shopSkillFilterBtn"
				onClick={onOpen}
				disabled={disabled}
			>
				{skillIds.length === 0
					? 'Shop Skills'
					: `Shop Skills — ${skillIds.length} Selected`}
			</button>
			{skillIds.length > 0 && (
				<button
					type="button"
					class="shopSkillFilterBtn"
					onClick={onClear}
					disabled={disabled}
				>
					Clear
				</button>
			)}
			{skillIds.length > 0 && (
				<label class="shopSkillBudgetLabel">
					SP budget
					<input
						type="number"
						class="shopSkillBudgetInput"
						min="0"
						step="10"
						value={budget}
						disabled={disabled}
						onInput={(e) =>
							onBudgetChange(
								parseBudgetInput((e.target as HTMLInputElement).value),
							)
						}
					/>
				</label>
			)}
			{wontProcCount > 0 && (
				<span class="shopSkillFilterWontProc">
					⚠ {wontProcCount} won't activate here
				</span>
			)}
		</div>
	);
}
