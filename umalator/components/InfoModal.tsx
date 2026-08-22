import { type ComponentChildren, h } from 'preact';

import './InfoModal.css';

export interface InfoEntry {
	summary: ComponentChildren;
	body: ComponentChildren;
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
		<div
			class="infoModalOverlay"
			onClick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div class="infoModal">
				<button
					type="button"
					class="infoModalClose"
					onClick={onClose}
					title="Close"
				>
					✕
				</button>
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
			</div>
		</div>
	);
}
