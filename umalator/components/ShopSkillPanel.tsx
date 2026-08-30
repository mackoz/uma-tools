import { h } from 'preact';

import {
	getSkillIcon,
	getSkillName,
	getSkillRarityClass,
} from '../../components/SkillPicker';
import { type LadderIndex, partitionShopSkills } from '../shopSkillFilter';

import './ShopSkillPanel.css';

// UI-28: the shop-skill picker's side panel -- lives inside components/SkillPicker.tsx's modal
// (passed as its `sidePanel` prop) as a running view of the shortlist being built in the grid to
// its left. Two things this panel renders that a flat list wouldn't: the procable/wontProc split
// (partitionShopSkills -- same diagnostic ShopSkillFilter.tsx's old chip strip carried, relocated
// here rather than dropped) and the shop's upgrade-ladder structure (a prerequisite pulled in by
// addShopSkill in umalator/app.tsx renders indented beneath the skill that pulled it in).
interface ShopSkillPanelProps {
	skillIds: string[];
	onRemove: (skillId: string) => void;
	onClear: () => void;
	procable: Set<string> | null;
	ladder: LadderIndex;
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

function ShopSkillRow({
	id,
	parentId,
	indented,
	onRemove,
	wontProcHere,
}: {
	id: string;
	parentId?: string;
	indented: boolean;
	onRemove: (skillId: string) => void;
	wontProcHere: boolean;
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
}: {
	title: string;
	ids: string[];
	ladder: LadderIndex;
	onRemove: (skillId: string) => void;
	wontProcSet: Set<string>;
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
					/>
					{entry.children.map((childId) => (
						<ShopSkillRow
							key={childId}
							id={childId}
							parentId={entry.id}
							indented={true}
							onRemove={onRemove}
							wontProcHere={wontProcSet.has(childId)}
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
	procable,
	ladder,
}: ShopSkillPanelProps) {
	const { procable: inPool, wontProc } = partitionShopSkills(
		skillIds,
		procable,
	);
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
					/>
					<ShopSkillSection
						title="Won't activate here"
						ids={wontProc}
						ladder={ladder}
						onRemove={onRemove}
						wontProcSet={wontProcSet}
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
