/**
 * QA2 #9: what the History tab's CURRENT-row position chip says. Currency ("Up to date" / "N builds behind") is only true to print for a HEALTHY row;
 * a failed or in-flight current row says its state, in the shared state vocabulary (`state-words.ts`), never "Up to date".
 */
import { stateWord } from '$lib/components/new/state-words';
import { lagWord } from '$lib/components/new/app/app-model';

/** null = no word to print (an unknown or Cancelled status is not a state this vocabulary has) */
export function currentRowChip(bakeStatus: string | null | undefined, behind: number): string | null {
	if (bakeStatus === 'Succeeded') return lagWord(behind);
	if (bakeStatus === 'Failed') return stateWord('failed')!;
	if (bakeStatus === 'InProgress' || bakeStatus === 'BakeTimeRetrying') return stateWord('checking')!;
	if (bakeStatus === 'Deploying') return stateWord('deploying')!;
	return null;
}
