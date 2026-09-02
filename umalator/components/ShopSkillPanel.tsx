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
	// UI-16 follow-up (shared ○/◎ hints): hint level (0-5, default 0), keyed by CLUSTER -- a hint
	// is earned per-SKILL in game and discounts both a ○ rung and its ◎ upgrade, so this is no
	// longer keyed by raw skill id (see umalator/spOptimizer.ts's buildHintClusters/HintClusters).
	// A key absent from this map is level 0.
	hints: { [clusterKey: string]: number };
	// skillId -> cluster key (app.tsx's module-level HINT_CLUSTERS). An id absent from this map is
	// its own singleton cluster, matching the `hintKeys[id] ?? id` convention used everywhere else
	// this map is consulted.
	hintKeys: { [skillId: string]: string };
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

// Flattens a section's FamilyEntry[] into skill ids in on-screen render order: each top row
// immediately followed by its rate-descending children.
function flattenEntries(entries: FamilyEntry[]): string[] {
	const out: string[] = [];
	for (const entry of entries) {
		out.push(entry.id, ...entry.children);
	}
	return out;
}

interface RowHintInfo {
	hintLevel: number;
	showHint: boolean;
	// Only meaningful when showHint is true: whether this owner's cluster has more than one
	// shortlisted member, i.e. whether the field's aria-label should call out the shared pair.
	sharedWithPair: boolean;
	// Only set when showHint is false: the tooltip explaining which skill's field this row's hint
	// is controlled by.
	sharedTitle?: string;
}

// UI-16 follow-up (shared ○/◎ hints) -- the owner rule: across the panel's FULL render order (the
// "In the pool" section then "Won't activate here", each in buildFamilyTree order -- top rows
// before their rate-descending children), the FIRST row of each cluster renders the hint field;
// every later row of the same cluster renders none, with a title pointing at the owner instead.
// This is the ONLY rule -- deliberately not "top row": for a plain ○/◎ pair the ◎ (top row) owns
// the field same as "top row" would predict, but for a three-rung ○/◎/gold family the TOP row is
// the GOLD (buildFamilyTree always picks the highest rate as the top), which sits in its own
// (rarity-differentiated) cluster and so owns its own field -- the shared ○/◎ field lands on the
// first CHILD (the ◎), not the top row. Computed once over the combined render order rather than
// per-section, so a cluster split across both sections still gets exactly one field, wherever its
// first-encountered member happens to render.
function buildHintInfo(
	renderOrder: string[],
	hintKeys: { [skillId: string]: string },
	hints: { [clusterKey: string]: number },
): Map<string, RowHintInfo> {
	const clusterCounts = new Map<string, number>();
	for (const id of renderOrder) {
		const key = hintKeys[id] ?? id;
		clusterCounts.set(key, (clusterCounts.get(key) ?? 0) + 1);
	}
	const ownerOfCluster = new Map<string, string>();
	const info = new Map<string, RowHintInfo>();
	for (const id of renderOrder) {
		const key = hintKeys[id] ?? id;
		const hintLevel = hints[key] ?? 0;
		const owner = ownerOfCluster.get(key);
		if (owner == null) {
			ownerOfCluster.set(key, id);
			info.set(id, {
				hintLevel,
				showHint: true,
				sharedWithPair: (clusterCounts.get(key) ?? 0) > 1,
			});
		} else {
			info.set(id, {
				hintLevel,
				showHint: false,
				sharedWithPair: false,
				sharedTitle: `Hint level is shared with ${getSkillName(owner)}`,
			});
		}
	}
	return info;
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
	sharedWithPair,
	onHintChange,
}: {
	id: string;
	level: number;
	// UI-16 follow-up: this owner row's cluster has another shortlisted member (its ○/◎ pair
	// partner) -- call that out in the accessible name, since the field visually only sits next to
	// one of the two rows it actually controls.
	sharedWithPair: boolean;
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
			aria-label={
				sharedWithPair
					? `Hint level for ${getSkillName(id)} (shared with its ○/◎ pair)`
					: `Hint level for ${getSkillName(id)}`
			}
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
	hintInfo,
	onHintChange,
}: {
	id: string;
	parentId?: string;
	indented: boolean;
	onRemove: (skillId: string) => void;
	wontProcHere: boolean;
	hintInfo: RowHintInfo;
	onHintChange: (skillId: string, level: number) => void;
}) {
	const label = parentId
		? `Remove ${getSkillName(id)}, required by ${getSkillName(parentId)}`
		: `Remove ${getSkillName(id)} from shop skills`;
	// The "can't activate here" explanation takes priority when both apply -- it's the more
	// actionable of the two (a dimmed/struck-through row reads as broken without it; a fieldless
	// owned-elsewhere row is merely explained, not alarming).
	const title = wontProcHere
		? "Can't activate on this course for this run style — it won't appear in the chart."
		: hintInfo.sharedTitle;
	return (
		<span
			class={`shopSkillChip shopSkillPanelItem ${getSkillRarityClass(id)}${wontProcHere ? ' shopSkillChipDimmed' : ''}${indented ? ' shopSkillPanelItemChild' : ''}`}
			title={title}
		>
			<img class="shopSkillChipIcon" src={getSkillIcon(id)} loading="lazy" />
			<span class="shopSkillChipName">{getSkillName(id)}</span>
			{hintInfo.showHint ? (
				<ShopSkillHintInput
					id={id}
					level={hintInfo.hintLevel}
					sharedWithPair={hintInfo.sharedWithPair}
					onHintChange={onHintChange}
				/>
			) : (
				// Same footprint as the field it stands in for, so the remove button still lines up
				// in a column across owner and non-owner rows (see the title above for why the gap
				// isn't just left empty).
				<span class="shopSkillHintSpacer" aria-hidden="true" />
			)}
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

// UI-16 follow-up: takes the precomputed {entries, count} instead of the raw id list -- entries
// (and the render-order-dependent owner rule that produces hintInfo) are now computed ONCE in
// ShopSkillPanel over both sections' combined render order, not per-section, so a cluster split
// across "In the pool" and "Won't activate here" still gets exactly one field. `hintInfo` carries
// every resolved per-row value (hintLevel/showHint/sharedWithPair/sharedTitle) -- this component
// (and ShopSkillRow) never needs the raw hints/hintKeys maps.
function ShopSkillSection({
	title,
	entries,
	count,
	onRemove,
	wontProcSet,
	hintInfo,
	onHintChange,
}: {
	title: string;
	entries: FamilyEntry[];
	count: number;
	onRemove: (skillId: string) => void;
	wontProcSet: Set<string>;
	hintInfo: Map<string, RowHintInfo>;
	onHintChange: (skillId: string, level: number) => void;
}) {
	if (count === 0) return null;
	return (
		<div class="shopSkillPanelSection">
			<div class="shopSkillPanelSectionLabel">
				{title} ({count})
			</div>
			{entries.map((entry) => (
				<div key={entry.id} class="shopSkillPanelFamily">
					<ShopSkillRow
						id={entry.id}
						indented={false}
						onRemove={onRemove}
						wontProcHere={wontProcSet.has(entry.id)}
						hintInfo={hintInfo.get(entry.id) as RowHintInfo}
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
							hintInfo={hintInfo.get(childId) as RowHintInfo}
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
	hintKeys,
	onHintChange,
}: ShopSkillPanelProps) {
	const { procable: inPool, wontProc } = partition;
	const wontProcSet = new Set(wontProc);

	// Hoisted out of ShopSkillSection (UI-16 follow-up): both sections' trees are built here, in
	// one pass, so the owner rule below can see the panel's FULL render order (In the pool, then
	// Won't activate here) rather than just one section's.
	const poolEntries = buildFamilyTree(inPool, ladder);
	const wontProcEntries = buildFamilyTree(wontProc, ladder);
	const renderOrder = [
		...flattenEntries(poolEntries),
		...flattenEntries(wontProcEntries),
	];
	const hintInfo = buildHintInfo(renderOrder, hintKeys, hints);

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
						entries={poolEntries}
						count={inPool.length}
						onRemove={onRemove}
						wontProcSet={wontProcSet}
						hintInfo={hintInfo}
						onHintChange={onHintChange}
					/>
					<ShopSkillSection
						title="Won't activate here"
						entries={wontProcEntries}
						count={wontProc.length}
						onRemove={onRemove}
						wontProcSet={wontProcSet}
						hintInfo={hintInfo}
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
