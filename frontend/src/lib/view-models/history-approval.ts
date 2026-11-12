import { displayIdentity } from './approval-identity';

/**
 * The quiet "approved" fact on a History row's meta line (the `dot-list-row t-meta` line that carries the outcome, the actor and the note).
 * `approval` is `status.history[].approval` straight from the CRD ({ name, by? }). An approver is named ONLY when `by` is present and that
 * rollout's cluster verifies it (the approvals endpoint's `byVerified`); otherwise the text is a bare "approved" (no approver claim: it may
 * have come from git, kubectl or an unverified cluster, so the line never says which) and the object name lives only in the tooltip.
 * null: the entry was not released by an approval.
 */
export function historyApprovalFact(approval: { name?: string; by?: string } | null | undefined, byVerified: boolean): { text: string; title: string; who?: string } | null {
	if (!approval || (!approval.name && !approval.by)) return null;
	if (approval.by && byVerified) {
		const who = displayIdentity(approval.by);
		return { who, text: `approved by ${who}`, title: who === approval.by ? `Approved by ${who}` : `Approved by ${who} (${approval.by})` };
	}
	return { text: 'approved', title: approval.name ? `Approved by RolloutApproval ${approval.name} (no verified approver)` : 'Approved (no verified approver)' };
}

/** An approval carries the human part of the line: an automatic (controller) actor is replaced by it; a person-triggered deploy keeps its actor. */
export const approvalReplacesActor = (approved: unknown, actorKind: string | undefined): boolean => !!approved && actorKind === 'controller';

/**
 * THE APPROVAL FACT OF ONE BUILD AT A PLACE, from the place's RolloutApprovals (`GET .../approvals`): the same words the History row prints
 * (`historyApprovalFact`), so a place's Overview row, its Gates tile and its History say one thing. A person's (`by`) approval is preferred over
 * a git one when both stand. null: no RolloutApproval names the version.
 */
export function approvedFactOf(version: string, approvals: readonly { name: string; version: string; by?: string }[] | undefined, byVerified: boolean): { text: string; title: string } | null {
	const mine = (approvals ?? []).filter((a) => a.version === version);
	const pick = (byVerified ? mine.find((a) => a.by) : null) ?? mine[0];
	return pick ? historyApprovalFact({ name: pick.name, by: pick.by }, byVerified) : null;
}
