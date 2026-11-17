/**
 * The rollout object's state pill — the word and Chip role the Overview's
 * title line prints beside `name / build`. Pure so every rollout tab
 * (History, Logs, Gates, diff) prints the SAME word for the same entry:
 * a tab switch never changes what the header says about the object.
 * (Mirrors the Overview's `heroIdentity` snippet; §3.2 "an object page's
 * title pill is the object's state and is always present".)
 */
import { bakeTitle, bakeWord } from '$lib/bake-status';
import { bakePaused, type BakeHoldFields } from '$lib/bake-hold';
import { failedWord } from '$lib/components/new/state-words';

export type StateChipRole = 'ready' | 'failing' | 'checking' | 'held' | 'deploying' | 'unranked';

/**
 * `hold`: the history entry's bake-hold fields. A bake whose clock is stopped by a not-Healthy check reads "paused" in the held role: ONE state word for the rollout on every tab.
 * `failingNow`: a health check of this failed deploy fails right now. The word then is "failing" (`failedWord`, the one failure word); a deploy that failed with no check involved, or
 * whose checks have all recovered, stays "failed". The role is `failing` for both: a recovered failure is still a failed deploy, and the product's other chips (the Change page's
 * `issue` chip) keep the one danger role and let the word carry the difference.
 */
export function rolloutStateChip(bakeStatus: string | null | undefined, hold?: BakeHoldFields | null, failingNow = false): {
	role: StateChipRole;
	label: string;
	title: string;
} {
	const s = bakeStatus ?? undefined;
	if (s === 'InProgress' && bakePaused(hold)) return { role: 'held', label: 'paused', title: 'The new version is live; the bake clock is stopped while a health check is not healthy' };
	const role: StateChipRole =
		s === 'Succeeded'
			? 'ready'
			: s === 'Failed'
				? 'failing'
				: s === 'InProgress'
					? 'checking'
					: s === 'Deploying'
						? 'deploying'
						: 'unranked';
	const label = s === 'Succeeded' ? 'deployed' : s === 'Failed' ? failedWord(!failingNow).toLowerCase() : bakeWord(s);
	return { role, label, title: bakeTitle(s) };
}
