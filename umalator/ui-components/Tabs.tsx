import { type ComponentChildren, h } from 'preact';

import './Tabs.css';

export interface TabItem {
	key: string;
	// Text label (underline variant) and/or icon (iconrail variant).
	label?: ComponentChildren;
	icon?: ComponentChildren;
	// iconrail: shown as a CSS-only tooltip and used as the accessible name.
	tooltip?: string;
	// Overrides the `selected`-key comparison for items whose active state is
	// independent of the group's single selection (e.g. sidebar panel toggles).
	active?: boolean;
	disabled?: boolean;
}

interface TabsProps {
	id?: string;
	class?: string;
	variant: 'underline' | 'iconrail';
	items: TabItem[];
	selected?: string | null;
	onSelect: (key: string) => void;
	// Extra non-tab content rendered after the tabs (e.g. action buttons).
	trailing?: ComponentChildren;
}

export function Tabs(props: TabsProps) {
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
						aria-label={item.tooltip}
						data-tip={item.tooltip}
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
