/**
 * QA #3 (UI half). The fleet list answers with `clusterErrors` naming every spoke the hub could not read. A rollout detail page is
 * one cluster's object: it must say so when ITS cluster is one of them (the data it draws is the hub's last copy, not live).
 * Pure so the match rule is tested: a rollout's `cluster` route param is the spoke's name, or 'local'/the hub's own name for the hub.
 */
import type { ClusterError } from '$lib/api/rollouts';

export function clusterErrorsFor(errors: readonly ClusterError[] | null | undefined, cluster: string | null | undefined): ClusterError[] {
	if (!errors?.length || !cluster) return [];
	return errors.filter((e) => e.name === cluster);
}

/**
 * MED-2: "slow" is not "unreachable". The hub types WHY a cluster's data is stale (`reason`); an absent reason (an older hub) reads as
 * unreachable, the only thing a stale mark meant before. Never branch on `error` text.
 */
export function clusterReason(e: ClusterError): 'slow' | 'unreachable' {
	return e.reason === 'slow' ? 'slow' : 'unreachable';
}

export type ClusterNoticeCopy = { stale: boolean; slow: boolean; title: string; message: string };

/**
 * The notice's title and sentence. `lastSeenText` is the already-formatted clock time of the stale payload ('' when unknown).
 * Stale clusters keep their rollouts on the page; every other error means the cluster's items are absent.
 * Slow only when EVERY stale cluster is slow: one unreachable cluster makes the group unreachable.
 */
export function clusterNoticeCopy(errors: readonly ClusterError[], subject: string, lastSeenText: string): ClusterNoticeCopy {
	const names = errors.map((e) => e.name).filter(Boolean);
	const one = names.length === 1;
	const stale = errors.length > 0 && errors.every((e) => e.stale);
	const slow = stale && errors.every((e) => clusterReason(e) === 'slow');
	if (slow) {
		return {
			stale,
			slow,
			title: one
				? `${names[0]} is slow to answer${lastSeenText ? ` · showing its data from ${lastSeenText}` : ''}`
				: `${names.length} clusters are slow to answer${lastSeenText ? ` · showing their data from ${lastSeenText}` : ''}`,
			message: `${one ? 'Its' : 'Their'} rollouts are the last copy the hub holds, not live state. They refresh as soon as ${one ? names[0] : 'the cluster'} answers.`
		};
	}
	if (stale) {
		return {
			stale,
			slow,
			title: one
				? `${names[0]} is unreachable — its rollouts show their last known state`
				: `${names.length} clusters are unreachable — their rollouts show their last known state`,
			message: `${one ? names[0] : 'These clusters'} stopped answering${lastSeenText ? ` after ${lastSeenText}` : ''}. What you see for ${one ? 'it' : 'them'} is the last copy the hub holds, not live state.`
		};
	}
	return {
		stale,
		slow,
		title: one ? `${names[0]} did not answer — this page is incomplete` : `${names.length} clusters did not answer — this page is incomplete`,
		message: `Everything on ${subject} covers only the clusters that replied — a rollout on ${one ? names[0] : 'one of these'} is missing from these counts, not healthy in them.`
	};
}
