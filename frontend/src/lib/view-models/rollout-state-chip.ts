/**
 * The rollout object's state pill — the word and Chip role the Overview's
 * title line prints beside `name / build`. Pure so every rollout tab
 * (History, Logs, Gates, diff) prints the SAME word for the same entry:
 * a tab switch never changes what the header says about the object.
 * (Mirrors the Overview's `heroIdentity` snippet; §3.2 "an object page's
 * title pill is the object's state and is always present".)
 */
import { bakeTitle, bakeWord } from '$lib/bake-status';

export type StateChipRole = 'ready' | 'failing' | 'checking' | 'deploying' | 'unranked';

export function rolloutStateChip(bakeStatus: string | null | undefined): {
	role: StateChipRole;
	label: string;
	title: string;
} {
	const s = bakeStatus ?? undefined;
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
	const label = s === 'Succeeded' ? 'deployed' : s === 'Failed' ? 'failed' : bakeWord(s);
	return { role, label, title: bakeTitle(s) };
}
