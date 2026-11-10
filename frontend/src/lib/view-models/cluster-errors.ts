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
