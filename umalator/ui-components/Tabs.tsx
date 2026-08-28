import { type ComponentChildren, h } from 'preact';

import './Tabs.css';

export interface TabItem {
	key: string;
	// Text label (underline/segmented variants) and/or icon (iconrail variant).
	label?: ComponentChildren;
	icon?: ComponentChildren;
	// iconrail: shown as a CSS-only tooltip and used as the accessible name (the
	// item has no visible label there). Other variants get it as a native `title`
	// instead -- supplementary detail on hover, not a replacement for the visible
	// label as the accessible name.
	tooltip?: string;
	// Overrides the `selected`-key comparison for items whose active state is
	// independent of the group's single selection (e.g. sidebar panel toggles).
	active?: boolean;
	disabled?: boolean;
	// segmented: per-item color, e.g. {'--seg-bg': ..., '--seg-accent': ...}. Lets a
	// caller (Skill Chart's rarity row) color each item without teaching this shared
	// primitive what the colors mean. Not typed as Record<K, V> -- that identifier
	// collides project-wide with Immutable.js's ambient Record<TProps> (used for
	// HorseState) once both are in scope.
	style?: { [key: string]: string };
}

interface TabsProps {
	id?: string;
	class?: string;
	variant: 'underline' | 'iconrail' | 'segmented';
	items: TabItem[];
	selected?: string | null;
	onSelect: (key: string) => void;
	// Extra non-tab content rendered after the tabs (e.g. action buttons).
	trailing?: ComponentChildren;
}

export function Tabs(props: TabsProps) {
	const isIconrail = props.variant === 'iconrail';
	return (
		<div
			id={props.id}
			class={`tabs tabs--${props.variant}${props.class ? ` ${props.class}` : ''}`}
		>
			{props.items.map((item) => {
				const active = item.active ?? item.key === props.selected;
				return (
					<button
						key={item.key}
						type="button"
						class={`tabsItem${active ? ' active' : ''}${item.disabled ? ' disabled' : ''}`}
						style={item.style}
						aria-label={isIconrail ? item.tooltip : undefined}
						aria-disabled={item.disabled || undefined}
						title={isIconrail ? undefined : item.tooltip}
						data-tip={isIconrail ? item.tooltip : undefined}
						onClick={item.disabled ? undefined : () => props.onSelect(item.key)}
					>
						{item.icon}
						{item.label}
					</button>
				);
			})}
			{props.trailing}
		</div>
	);
}
