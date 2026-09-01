import { h } from 'preact';

import {
	getSkillIcon,
	getSkillName,
	getSkillRarityClass,
} from '../../components/SkillPicker';
import type { LadderIndex } from '../shopSkillFilter';

import './ShopSkillPanel.css';

// UI-28: the shop-skill picker's side panel -- lives inside components/SkillPicker.tsx's modal
// (passed as its `sidePanel` prop) as a running view of the shortlist being built in the grid to
// its left. Two things this panel renders that a flat list wouldn't: the procable/wontProc split
// (same diagnostic ShopSkillFilter.tsx's old chip strip carried, relocated here rather than
// dropped) and the shop's upgrade-ladder structure (a prerequisite pulled in by addShopSkill in
// umalator/app.tsx renders indented beneath the skill that pulled it in).
interface ShopSkillPanelProps {
	skillIds: string[];
	onRemove: (skillId: string) => void;
	onClear: () => void;
	// The partitionShopSkills(skillIds, procable) result -- computed once by the caller (app.tsx
	// already needs it for the filter row's own wontProc summary) and passed down rather than
	// recomputed here, so the same shopSkillIds/procable pair isn't partitioned twice per render.
	partition: { procable: string[]; wontProc: string[] };
	ladder: LadderIndex;
	// UI-16: per-skill shop hint level (0-5, default 0), keyed by skill id -- feeds the SP
	// optimizer's discountedCost. An id absent from this map is level 0.
	hints: { [skillId: string]: number };
	onHintChange: (skillId: string, level: number) => void;
}

interface FamilyEntry {
	id: string;
	children: string[];
}

// Groups a section's ids (already filtered to just this section by partitionShopSkills) into
// top-level entries with their same-ladder-group children indented beneath them. Single-level
// indentation regardless of chain depth (a 3-rung ladder's top rung gets two indented children,
// not a nested tree) -- matches the shop's own "here's everything below this" framing.
//
// Deliberately scoped to `ids` (one section at a time), not the whole shortlist: if a family's
// members split across both sections (the parent procable, its prerequisite not), each section
// only sees its own member and renders it flat rather than orphaning an indent under a parent
// that isn't in this list.
function buildFamilyTree(ids: string[], ladder: LadderIndex): FamilyEntry[] {
	const groups = new Map<string, string[]>();
	for (const id of ids) {
		const rung = ladder[id];
		if (!rung) continue;
		const list = groups.get(rung.group);
		if (list) list.push(id);
		else groups.set(rung.group, [id]);
	}
	const topOf = new Map<string, string>();
	for (const [group, members] of groups) {
		if (members.length < 2) continue;
		let top = members[0];
		for (const id of members) if (ladder[id].rate > ladder[top].rate) top = id;
		topOf.set(group, top);
	}
	const isChild = (id: string) => {
		const rung = ladder[id];
		if (!rung) return false;
		const top = topOf.get(rung.group);
		return top != null && top !== id;
	};
	const entries: FamilyEntry[] = [];
	for (const id of ids) {
		if (isChild(id)) continue;
		const rung = ladder[id];
		const children =
			rung && topOf.get(rung.group) === id
				? (groups.get(rung.group) as string[])
						.filter((x) => x !== id)
						.sort((a, b) => ladder[b].rate - ladder[a].rate)
				: [];
		entries.push({ id, children });
	}
	return entries;
}

// Keyboard-first bulk entry (UI-16): typing a digit 0-5 in one hint field sets it and jumps
// focus to the next `.shopSkillHint` field in DOM order, so a user with a long shortlist can
// click the first field once and then type straight through the whole list. Queries the DOM
// live (rather than threading refs through every row) since the set of rows changes as the
// shortlist changes and DOM order already matches the visual/tab order.
function focusNextHintInput(current: HTMLInputElement) {
	const inputs = Array.from(
		document.querySelectorAll<HTMLInputElement>('.shopSkillHint'),
	);
	const idx = inputs.indexOf(current);
	if (idx === -1 || idx === inputs.length - 1) return;
	const next = inputs[idx + 1];
	next.focus();
	next.select();
}

function ShopSkillHintInput({
	id,
	level,
	onHintChange,
}: {
	id: string;
	level: number;
	onHintChange: (skillId: string, level: number) => void;
}) {
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Tab') return; // native focus movement, left alone
		// Modified keys (Cmd+R, Ctrl+C, ...) are browser/app shortcuts, not hint entry -- never
		// swallow them.
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const input = e.currentTarget as HTMLInputElement;
		if (e.key >= '0' && e.key <= '5') {
			e.preventDefault();
			onHintChange(id, Number(e.key));
			focusNextHintInput(input);
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			onHintChange(id, Math.min(5, level + 1));
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			onHintChange(id, Math.max(0, level - 1));
			return;
		}
		// Digits 6-9 and other printable characters: ignore. Non-printable keys (Escape, F5,
		// Backspace, ...) pass through -- the value is controlled, so they can't corrupt it, and
		// swallowing them would break things like reload while a hint field is focused.
		if (e.key.length === 1) e.preventDefault();
	};
	return (
		<input
			type="text"
			inputMode="numeric"
			maxLength={1}
			class="shopSkillHint"
			value={String(level)}
			aria-label={`Hint level for ${getSkillName(id)}`}
			onKeyDown={onKeyDown}
			onInput={(e) => {
				// Controlled: onKeyDown owns every mutation, so just re-render from state in case
				// something (e.g. a mobile IME) bypasses keyDown and edits the DOM value directly.
				(e.currentTarget as HTMLInputElement).value = String(level);
			}}
			onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
		/>
	);
}

function ShopSkillRow({
	id,
	parentId,
	indented,
	onRemove,
	wontProcHere,
	hintLevel,
	onHintChange,
}: {
	id: string;
	parentId?: string;
	indented: boolean;
	onRemove: (skillId: string) => void;
	wontProcHere: boolean;
	hintLevel: number;
	onHintChange: (skillId: string, level: number) => void;
}) {
	const label = parentId
		? `Remove ${getSkillName(id)}, required by ${getSkillName(parentId)}`
		: `Remove ${getSkillName(id)} from shop skills`;
	return (
		<span
			class={`shopSkillChip shopSkillPanelItem ${getSkillRarityClass(id)}${wontProcHere ? ' shopSkillChipDimmed' : ''}${indented ? ' shopSkillPanelItemChild' : ''}`}
			title={
				wontProcHere
					? "Can't activate on this course for this run style — it won't appear in the chart."
					: undefined
			}
		>
			<img class="shopSkillChipIcon" src={getSkillIcon(id)} loading="lazy" />
			<span class="shopSkillChipName">{getSkillName(id)}</span>
			<ShopSkillHintInput
				id={id}
				level={hintLevel}
				onHintChange={onHintChange}
			/>
			<button
				type="button"
				class="shopSkillChipRemove"
				aria-label={label}
				onClick={() => onRemove(id)}
			>
				×
			</button>
		</span>
	);
}

function ShopSkillSection({
	title,
	ids,
	ladder,
	onRemove,
	wontProcSet,
	hints,
	onHintChange,
}: {
	title: string;
	ids: string[];
	ladder: LadderIndex;
	onRemove: (skillId: string) => void;
	wontProcSet: Set<string>;
	hints: { [skillId: string]: number };
	onHintChange: (skillId: string, level: number) => void;
}) {
	if (ids.length === 0) return null;
	const entries = buildFamilyTree(ids, ladder);
	return (
		<div class="shopSkillPanelSection">
			<div class="shopSkillPanelSectionLabel">
				{title} ({ids.length})
			</div>
			{entries.map((entry) => (
				<div key={entry.id} class="shopSkillPanelFamily">
					<ShopSkillRow
						id={entry.id}
						indented={false}
						onRemove={onRemove}
						wontProcHere={wontProcSet.has(entry.id)}
						hintLevel={hints[entry.id] ?? 0}
						onHintChange={onHintChange}
					/>
					{entry.children.map((childId) => (
						<ShopSkillRow
							key={childId}
							id={childId}
							parentId={entry.id}
							indented={true}
							onRemove={onRemove}
							wontProcHere={wontProcSet.has(childId)}
							hintLevel={hints[childId] ?? 0}
							onHintChange={onHintChange}
						/>
					))}
				</div>
			))}
		</div>
	);
}

export function ShopSkillPanel({
	skillIds,
	onRemove,
	onClear,
	partition,
	ladder,
	hints,
	onHintChange,
}: ShopSkillPanelProps) {
	const { procable: inPool, wontProc } = partition;
	const wontProcSet = new Set(wontProc);

	return (
		<div class="shopSkillPanel">
			<div class="shopSkillPanelHeader">
				Shop skills · {skillIds.length} selected
			</div>
			{skillIds.length === 0 ? (
				<div class="shopSkillPanelEmpty">
					Pick skills from the list to build your shortlist.
				</div>
			) : (
				<div class="shopSkillPanelList">
					<ShopSkillSection
						title="In the pool"
						ids={inPool}
						ladder={ladder}
						onRemove={onRemove}
						wontProcSet={wontProcSet}
						hints={hints}
						onHintChange={onHintChange}
					/>
					<ShopSkillSection
						title="Won't activate here"
						ids={wontProc}
						ladder={ladder}
						onRemove={onRemove}
						wontProcSet={wontProcSet}
						hints={hints}
						onHintChange={onHintChange}
					/>
				</div>
			)}
			{skillIds.length > 0 && (
				<button type="button" class="shopSkillPanelClear" onClick={onClear}>
					Clear all
				</button>
			)}
		</div>
	);
}
