// HP-7 Task 9: the "Incoming Stamina Debuffs" dialog opened from HorseDef's STAM DEBUFF row.
//
// Deliberately separate from "+ Add Skill" (components/SkillPicker.tsx's SkillPickerModal):
// that picker equips a skill this uma casts on *others*; this dialog configures debuffs *other*
// umas land on *this* uma, which have no representation in `state.skills` at all (they're
// per-uma counts in HorseState.incomingDebuffs, consumed by umalator/compare.ts's
// addIncomingDebuffs against this uma's own RaceSolverBuilder). Modeled on SkillPickerModal's
// overlay/portal/focus/close pattern (see components/SkillPicker.tsx) rather than invented fresh.
import type { Map as ImmMap } from 'immutable';
import { Minus, Plus, X } from 'lucide-preact';
import { h } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';

import { getSkillName } from './SkillPicker';
import {
	bucketsForCourse,
	type DebuffBucket,
	excludedDebuffCount,
	formatPercent,
	STAMINA_DEBUFF_BUCKETS,
	totalDrain,
} from './StaminaDebuffs';

import './StaminaDebuffDialog.css';

const WINDOW_ORDER: readonly DebuffBucket['window'][] = [
	'early',
	'mid',
	'late',
];
const WINDOW_LABELS: Record<DebuffBucket['window'], string> = {
	early: 'Early Race',
	mid: 'Mid Race',
	late: 'Late Race',
};

// uma-skill-tools/CourseData.ts: `export const enum DistanceType { Short = 1, Mile, Mid, Long }`.
// "Medium" (not "Mid") matches this repo's own public naming for the category (see CLAUDE.md's
// JP vs Global data table, "Courses" row).
const DISTANCE_LABELS: Record<number, string> = {
	1: 'Short',
	2: 'Mile',
	3: 'Medium',
	4: 'Long',
};

interface StepperProps {
	value: number;
	disabled: boolean;
	onChange: (value: number) => void;
}

function Stepper({ value, disabled, onChange }: StepperProps) {
	return (
		<div class="stamDebuffStepper">
			<button
				type="button"
				class="stamDebuffStepperBtn"
				disabled={disabled || value <= 0}
				onClick={() => onChange(value - 1)}
				aria-label="Decrease count"
			>
				<Minus size={12} />
			</button>
			<span class="stamDebuffStepperValue">{value}</span>
			<button
				type="button"
				class="stamDebuffStepperBtn"
				disabled={disabled || value >= 9}
				onClick={() => onChange(value + 1)}
				aria-label="Increase count"
			>
				<Plus size={12} />
			</button>
		</div>
	);
}

export interface StaminaDebuffDialogProps {
	isOpen: boolean;
	onClose: () => void;
	// Bucket representative id -> count (0-9). See components/StaminaDebuffs.ts.
	incoming: ImmMap<string, number>;
	onChange: (next: ImmMap<string, number>) => void;
	// `course.distanceType`, or null/undefined when no course is available -- every bucket then
	// renders as course-unknown rather than falsely enabled or falsely greyed.
	distanceType: number | null | undefined;
}

export function StaminaDebuffDialog({
	isOpen,
	onClose,
	incoming,
	onChange,
	distanceType,
}: StaminaDebuffDialogProps) {
	const dialogRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) return;
		function handleKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose();
		}
		document.addEventListener('keydown', handleKeydown);
		const t = window.requestAnimationFrame(() => dialogRef.current?.focus());
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			window.cancelAnimationFrame(t);
		};
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	const possibleIds =
		distanceType != null
			? new Set(bucketsForCourse(distanceType).map((b) => b.id))
			: null;

	function setCount(bucketId: string, count: number) {
		onChange(
			count > 0 ? incoming.set(bucketId, count) : incoming.delete(bucketId),
		);
	}

	// I2 fix (HP-7 fix-round-2): course-aware, matching the greyed-out rows above -- a bucket the
	// current course can't produce is dropped from the total, not just visually disabled while
	// still counting. `excluded` says so in the footer instead of silently dropping the figure.
	const total = totalDrain(incoming, distanceType);
	const excluded = excludedDebuffCount(incoming, distanceType);

	const modal = (
		<div class="stamDebuffOverlay" onClick={onClose}>
			<div
				class="stamDebuffModal"
				ref={dialogRef}
				tabIndex={-1}
				onClick={(e) => e.stopPropagation()}
			>
				<div class="stamDebuffHeader">
					<div>
						<h3>Incoming Stamina Debuffs</h3>
						<p class="stamDebuffSubtitle">
							Debuffs other umas land on this uma -- to have this uma{' '}
							<em>cast</em> a debuff, use + Add Skill instead.
						</p>
					</div>
					<button
						type="button"
						class="stamDebuffClose"
						onClick={onClose}
						aria-label="Close"
					>
						<X size={16} />
					</button>
				</div>
				<div class="stamDebuffBody">
					{WINDOW_ORDER.map((window) => {
						const buckets = STAMINA_DEBUFF_BUCKETS.filter(
							(b) => b.window === window,
						).sort((a, b) => b.drain - a.drain || (a.id < b.id ? -1 : 1));
						if (buckets.length === 0) return null;
						return (
							<div class="stamDebuffGroup" key={window}>
								<div class="stamDebuffGroupLabel">{WINDOW_LABELS[window]}</div>
								{buckets.map((bucket) => {
									const possible =
										possibleIds == null || possibleIds.has(bucket.id);
									const reason =
										bucket.distanceType != null
											? `${DISTANCE_LABELS[bucket.distanceType] ?? bucket.distanceType} only`
											: null;
									return (
										<div
											class={`stamDebuffRow${possible ? '' : ' stamDebuffRow--disabled'}`}
											key={bucket.id}
										>
											<div class="stamDebuffRowMain">
												<span class="stamDebuffName">
													{getSkillName(bucket.id)}
												</span>
												<span class="stamDebuffDrain">
													{formatPercent(bucket.drain)}
												</span>
												{reason && !possible && (
													<span class="stamDebuffReason">{reason}</span>
												)}
											</div>
											<Stepper
												value={incoming.get(bucket.id, 0)}
												disabled={!possible}
												onChange={(v) => setCount(bucket.id, v)}
											/>
										</div>
									);
								})}
							</div>
						);
					})}
				</div>
				<div class="stamDebuffFooter">
					<span>Total</span>
					<span
						class={`stamDebuffFooterValue${total > 0 ? '' : ' stamDebuffFooterValue--none'}`}
					>
						{total > 0 ? `−${formatPercent(total)} max HP` : 'none'}
						{excluded > 0 && ` (${excluded} excluded, wrong course)`}
					</span>
				</div>
			</div>
		</div>
	);

	return createPortal(modal, document.body);
}
