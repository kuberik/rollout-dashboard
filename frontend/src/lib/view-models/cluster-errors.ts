/**
 * QA #3 (UI half). The fleet list answers with `clusterErrors` naming every spoke the hub could not read. A rollout detail page is
 * one cluster's object: it must say so when ITS cluster is one of them (the data it draws is the hub's last known state).
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

export type ClusterKind = 'timeout' | 'unreachable' | 'rejected' | 'bad_answer';
const KINDS: readonly string[] = ['timeout', 'unreachable', 'rejected', 'bad_answer'];
const isKind = (k: string | undefined): k is ClusterKind => !!k && KINDS.includes(k);

/**
 * The typed way a cluster read failed. The hub's `kind` wins; an older hub only sent `reason`, where 'slow' meant a timeout and anything else
 * (or nothing) meant unreachable. Never derived from the `error` text.
 */
export function clusterKind(e: ClusterError): ClusterKind {
	if (isKind(e.kind)) return e.kind;
	return clusterReason(e) === 'slow' ? 'timeout' : 'unreachable';
}

const DETAILS: readonly string[] = ['not_json', 'wrong_shape'];

/**
 * The Details line for one cluster, plain words chosen by the typed kind (and status / detail) and nothing else, always naming the cluster. A stale-and-slow
 * cluster keeps the sentence that says it is up. Where the typed fields carry no cause (see clusterRawNote) the sentence stays generic.
 */
export function clusterDetail(e: ClusterError): string {
	if (clusterReason(e) === 'slow') return `${e.name} is up, but did not answer in time.`;
	switch (clusterKind(e)) {
		case 'timeout':
			return `${e.name} did not answer in time.`;
		case 'rejected':
			return e.status ? `${e.name} refused the hub (HTTP ${e.status}).` : `${e.name} refused the hub.`;
		case 'bad_answer':
			if (e.detail === 'not_json') return `${e.name} answered with something that is not JSON.`;
			if (e.detail === 'wrong_shape') return `${e.name} answered with JSON that is not a dashboard response.`;
			return `${e.name} answered with something the dashboard could not read.`;
		default:
			return `${e.name} could not be reached.`;
	}
}

/**
 * The raw server message, but ONLY for an entry whose typed copy names no cause: a rejection without a status, a bad answer without a known detail, or
 * a kind this build does not know. A fully typed entry returns undefined, so the raw text is never printed beside words that already say it.
 */
export function clusterRawNote(e: ClusterError): string | undefined {
	if (!e.error) return undefined;
	const unknownKind = !!e.kind && !isKind(e.kind);
	const noCause =
		unknownKind ||
		(e.kind === 'rejected' && !e.status) ||
		(e.kind === 'bad_answer' && !(e.detail && DETAILS.includes(e.detail)));
	return noCause ? e.error : undefined;
}

export type ClusterNoticeCopy = { stale: boolean; slow: boolean; title: string; message: string };

/**
 * The notice's title and sentence. `lastSeenText` is the already-formatted clock time of the stale payload ('' when unknown).
 * Stale clusters keep their rollouts on the page; every other error means the cluster's items are absent.
 * Slow only when EVERY stale cluster is slow (reason 'slow', or a read that timed out: the hub reports a hang as reason 'unreachable', kind 'timeout'):
 * one unreachable cluster makes the group unreachable.
 */
export function clusterNoticeCopy(errors: readonly ClusterError[], subject: string, lastSeenText: string): ClusterNoticeCopy {
	const names = errors.map((e) => e.name).filter(Boolean);
	const one = names.length === 1;
	const stale = errors.length > 0 && errors.every((e) => e.stale);
	const slow = stale && errors.every((e) => clusterReason(e) === 'slow' || clusterKind(e) === 'timeout');
	if (slow) {
		return {
			stale,
			slow,
			title: one
				? `${names[0]} is slow to answer${lastSeenText ? ` — showing its data from ${lastSeenText}` : ''}`
				: `${names.length} clusters are slow to answer${lastSeenText ? ` — showing their data from ${lastSeenText}` : ''}`,
			message: `${one ? 'Its' : 'Their'} rollouts show the last known state the hub holds. They refresh as soon as ${one ? `${names[0]} answers` : 'the clusters answer'}.`
		};
	}
	if (stale) {
		return {
			stale,
			slow,
			title: one
				? `${names[0]} is unreachable — its rollouts show their last known state`
				: `${names.length} clusters are unreachable — their rollouts show their last known state`,
			message: `${one ? names[0] : 'These clusters'} stopped answering${lastSeenText ? ` after ${lastSeenText}` : ''}. What you see for ${one ? 'it' : 'them'} is the last known state the hub holds.`
		};
	}
	return {
		stale,
		slow,
		title: one ? `${names[0]} did not answer — this page is incomplete` : `${names.length} clusters did not answer — this page is incomplete`,
		message: `Everything on ${subject} covers only the clusters that replied — a rollout on ${one ? names[0] : 'one of these'} is missing from these counts, not healthy in them.`
	};
}
