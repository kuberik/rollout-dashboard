import { displayIdentity } from './approval-identity';

/**
 * The quiet "approved by" fact on a History row's meta line (the `dot-list-row t-meta` line that already carries the outcome, the actor and the
 * note). `approval` is `status.history[].approval` straight from the CRD ({ name, by? }): `by` is shown ONLY when that rollout's cluster says its
 * approvals' `by` is verified (the approvals endpoint's `byVerified`; an unverified `by` is a claim, not a fact); otherwise the approval's name.
 * `title` carries the full string (the full username, or the name). null: the entry was not released by an approval.
 */
export function historyApprovalFact(approval: { name?: string; by?: string } | null | undefined, byVerified: boolean): { text: string; title: string } | null {
	if (!approval || (!approval.name && !approval.by)) return null;
	if (approval.by && byVerified) return { text: `approved by ${displayIdentity(approval.by)}`, title: `Approved by ${approval.by}` };
	return approval.name ? { text: `approval ${approval.name}`, title: `RolloutApproval ${approval.name}` } : null;
}
