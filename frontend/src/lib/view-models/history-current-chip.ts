/**
 * QA2 #9: what the History tab's CURRENT-row chip says. Currency ("Up to date" / "N builds behind") is only true to print for a HEALTHY row,
 * and it is a COUNT, so it takes the neutral `count` chip.
 *
 * A failed or in-flight current row is the same object the tab header's state pill is about, so it prints THAT pill: the same role and
 * the same word (`rolloutStateChip`). Visual audit #3 (2026-11-13): the header said red `FAILED` while this row said grey `FAILING` in the
 * `count` chip, the quietest chip on the page carrying its most adverse fact, in a second spelling. One fact, one chip.
 */
import { failedInkParts } from '$lib/components/new/state-words';
import { bakePaused, type BakeHoldFields } from '$lib/bake-hold';
import { lagWord } from '$lib/components/new/app/app-model';
import { rolloutStateChip, type StateChipRole } from './rollout-state-chip';

export type CurrentRowChip = { role: StateChipRole | 'count'; label: string };

/** null = no chip (an unknown or Cancelled status, or a healthy row whose currency the fleet has not answered yet) */
/** `failingNow`: the same input the tab header's pill takes (a check of the head deploy fails right now), so the row and the header say the same word */
export function currentRowChip(bakeStatus: string | null | undefined, behind: number | null, hold?: BakeHoldFields | null, failingNow = false): CurrentRowChip | null {
	if (bakeStatus === 'Succeeded') return behind === null ? null : { role: 'count', label: lagWord(behind) };
	if (bakeStatus === 'Failed' || bakeStatus === 'InProgress' || bakeStatus === 'BakeTimeRetrying' || bakeStatus === 'Deploying') {
		const { role, label } = rolloutStateChip(bakeStatus, hold, failingNow);
		return { role, label };
	}
	return null;
}

/** the current row's own live line, "Checking for" / "Paused for" / "Deploying for": a stopped bake clock reads Paused, counted from the hold start */
export function liveStatusVerb(e: { bakeStatus?: string; bakeHoldStartTime?: string | null }): { word: string; since: 'hold' | 'deploy' } | null {
	if (e.bakeStatus === 'InProgress') return bakePaused(e) ? { word: 'Paused for', since: 'hold' } : { word: 'Checking for', since: 'deploy' };
	if (e.bakeStatus === 'Deploying') return { word: 'Deploying for', since: 'deploy' };
	return null;
}

/**
 * the Deploys card's rollup for a current row whose bake is paused, never "All healthy" while a check is pending. As parts, each in its own ink like the Health checks
 * header: only the state ("Bake paused") is in held ink, the pending count is the neutral meta ink.
 */
export function pausedRollup(pending: number): { text: string; ink: string }[] {
	return [{ text: 'Bake paused', ink: 'text-held' }, ...(pending > 0 ? [{ text: `${pending} check${pending === 1 ? '' : 's'} pending`, ink: 'text-fg-muted' }] : [])];
}

/**
 * the Deploys card's "N failed" rollup (and the page header's count) as inked parts: ONE failing/failed split with the shared ink. The only failure that can be live is the
 * open one (the newest deploy): a check failing now reads "failing" in danger ink, a recovered failure reads "failed" in neutral ink; an open failure with no health check
 * involved stays "failed" in danger ink (a failed deploy is not a recovered one); a superseded failure is neutral.
 */
export function deploysFailedParts(failed: number, head: { open: boolean; failingNow: boolean; recovered: boolean }): { text: string; ink: string }[] {
	if (failed <= 0) return [];
	if (head.open && !head.failingNow && !head.recovered) return [{ text: `${failed} failed`, ink: 'text-danger' }];
	const now = head.open && head.failingNow ? 1 : 0;
	return failedInkParts(failed, failed - now).map((p) => ({ text: p.text, ink: p.ink === 'danger' ? 'text-danger' : 'text-fg-muted' }));
}
