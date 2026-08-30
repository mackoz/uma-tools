import { h } from 'preact';

import {
	getSkillIcon,
	getSkillName,
	getSkillRarityClass,
} from '../../components/SkillPicker';
import { partitionShopSkills } from '../shopSkillFilter';

import './ShopSkillFilter.css';

// UI-27: the Skill Chart's "Shop skills" shortlist row -- lets a career run's actual shop
// offering narrow the chart's candidate pool instead of ranking the whole activateable pool.
// Pure presentation; all state lives in umalator/app.tsx (see doBasinnChart/chartCandidates
// there) and the pure predicates live in umalator/shopSkillFilter.ts.
interface ShopSkillFilterProps {
	enabled: boolean;
	onToggleEnabled: (enabled: boolean) => void;
	skillIds: string[];
	onRemove: (skillId: string) => void;
	onClear: () => void;
	onEdit: () => void;
	// null = the candidate pool hasn't been computed yet (picker never opened this session) --
	// every chip renders as provisionally procable rather than flagged, same convention as
	// partitionShopSkills itself.
	procable: Set<string> | null;
	disabled?: boolean;
}

export function ShopSkillFilter({
	enabled,
	onToggleEnabled,
	skillIds,
	onRemove,
	onClear,
	onEdit,
	procable,
	disabled,
}: ShopSkillFilterProps) {
	const { wontProc } = partitionShopSkills(skillIds, procable);
	const wontProcSet = new Set(wontProc);

	return (
		<div class="chartFilterRow shopSkillFilterRow">
			<span class="chartFilterLabel">Shop skills</span>
			<label class="shopSkillFilterToggle">
				<input
					type="checkbox"
					checked={enabled}
					disabled={disabled}
					onInput={(e) =>
						onToggleEnabled((e.target as HTMLInputElement).checked)
					}
				/>
				<span class="shopSkillFilterToggleLabel">
					{skillIds.length === 0 ? 'off' : `${skillIds.length} selected`}
				</span>
			</label>
			<button
				type="button"
				class="shopSkillFilterBtn"
				onClick={onEdit}
				disabled={disabled}
			>
				Edit…
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
				<div class="shopSkillChipStrip">
					{skillIds.map((id) => {
						const wontProcHere = wontProcSet.has(id);
						return (
							<span
								key={id}
								class={`shopSkillChip ${getSkillRarityClass(id)}${wontProcHere ? ' shopSkillChipDimmed' : ''}`}
								title={
									wontProcHere
										? "Can't activate on this course for this run style — it won't appear in the chart."
										: undefined
								}
							>
								<img
									class="shopSkillChipIcon"
									src={getSkillIcon(id)}
									loading="lazy"
								/>
								<span class="shopSkillChipName">{getSkillName(id)}</span>
								<button
									type="button"
									class="shopSkillChipRemove"
									aria-label={`Remove ${getSkillName(id)} from shop skills`}
									disabled={disabled}
									onClick={() => onRemove(id)}
								>
									×
								</button>
							</span>
						);
					})}
				</div>
			)}
		</div>
	);
}
