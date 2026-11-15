/**
 * QA2 #9: what the History tab's CURRENT-row position chip says. Currency ("Up to date" / "N builds behind") is only true to print for a HEALTHY row;
 * a failed or in-flight current row says its state, in the shared state vocabulary (`state-words.ts`), never "Up to date".
 */
import { stateWord } from '$lib/components/new/state-words';
import { bakePaused } from '$lib/bake-hold';
import { lagWord } from '$lib/components/new/app/app-model';

/** null = no word to print (an unknown or Cancelled status is not a state this vocabulary has) */
export function currentRowChip(bakeStatus: string | null | undefined, behind: number | null, paused = false): string | null {
	if (bakeStatus === 'Succeeded') return behind === null ? null : lagWord(behind); /* null: the fleet has not answered, no count yet */
	if (bakeStatus === 'Failed') return stateWord('failed')!;
	if (bakeStatus === 'InProgress' || bakeStatus === 'BakeTimeRetrying') return stateWord(paused && bakeStatus === 'InProgress' ? 'paused' : 'checking')!;
	if (bakeStatus === 'Deploying') return stateWord('deploying')!;
	return null;
}

/** the current row's own live line, "Checking for" / "Paused for" / "Deploying for": a stopped bake clock reads Paused, counted from the hold start */
export function liveStatusVerb(e: { bakeStatus?: string; bakeHoldStartTime?: string | null }): { word: string; since: 'hold' | 'deploy' } | null {
	if (e.bakeStatus === 'InProgress') return bakePaused(e) ? { word: 'Paused for', since: 'hold' } : { word: 'Checking for', since: 'deploy' };
	if (e.bakeStatus === 'Deploying') return { word: 'Deploying for', since: 'deploy' };
	return null;
}

/** the Deploys card's rollup for a current row whose bake is paused: never "All healthy" while a check is pending */
export function pausedRollup(pending: number): string {
	return pending > 0 ? `Bake paused · ${pending} check${pending === 1 ? '' : 's'} pending` : 'Bake paused';
}
