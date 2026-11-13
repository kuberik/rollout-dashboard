/**
 * QA2 #9: what the History tab's CURRENT-row chip says. Currency ("Up to date" / "N builds behind") is only true to print for a HEALTHY row,
 * and it is a COUNT, so it takes the neutral `count` chip.
 *
 * A failed or in-flight current row is the same object the tab header's state pill is about, so it prints THAT pill: the same role and
 * the same word (`rolloutStateChip`). Visual audit #3 (2026-11-13): the header said red `FAILED` while this row said grey `FAILING` in the
 * `count` chip, the quietest chip on the page carrying its most adverse fact, in a second spelling. One fact, one chip.
 */
import { lagWord } from '$lib/components/new/app/app-model';
import { rolloutStateChip, type StateChipRole } from './rollout-state-chip';

export type CurrentRowChip = { role: StateChipRole | 'count'; label: string };

/** null = no chip (an unknown or Cancelled status, or a healthy row whose currency the fleet has not answered yet) */
export function currentRowChip(bakeStatus: string | null | undefined, behind: number | null): CurrentRowChip | null {
	if (bakeStatus === 'Succeeded') return behind === null ? null : { role: 'count', label: lagWord(behind) };
	if (bakeStatus === 'Failed' || bakeStatus === 'InProgress' || bakeStatus === 'BakeTimeRetrying' || bakeStatus === 'Deploying') {
		const { role, label } = rolloutStateChip(bakeStatus);
		return { role, label };
	}
	return null;
}
