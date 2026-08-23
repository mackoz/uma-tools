import { type ComponentChildren, h } from 'preact';

import './InfoModal.css';

export interface InfoEntry {
	summary: ComponentChildren;
	body: ComponentChildren;
}

interface InfoModalShellProps {
	class?: string;
	onClose: () => void;
	children: ComponentChildren;
}

// The bare modal chrome (backdrop, panel, close button) without the
// title/entries structure -- for overlays that bring their own content,
// like the About/changelog panel.
export function InfoModalShell(props: InfoModalShellProps) {
	return (
		<div
			class="infoModalOverlay"
			onClick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) props.onClose();
			}}
		>
			<div class={`infoModal${props.class ? ` ${props.class}` : ''}`}>
				<button
					type="button"
					class="infoModalClose"
					onClick={props.onClose}
					title="Close"
				>
					✕
				</button>
				{props.children}
			</div>
		</div>
	);
}

interface InfoModalProps {
	title: string;
	intro?: ComponentChildren;
	entries: InfoEntry[];
	outro?: ComponentChildren;
	onClose: () => void;
}

export function InfoModal({
	title,
	intro,
	entries,
	outro,
	onClose,
}: InfoModalProps) {
	return (
		<InfoModalShell onClose={onClose}>
			<h2>{title}</h2>
			{intro && <p class="infoModalIntro">{intro}</p>}
			<ul class="infoModalList">
				{entries.map((entry, i) => (
					<li key={i}>
						<details>
							<summary>{entry.summary}</summary>
							{entry.body}
						</details>
					</li>
				))}
			</ul>
			{outro && <p class="infoModalOutro">{outro}</p>}
		</InfoModalShell>
	);
}
