/**
 * THE APPROVAL WIRE CONTRACT (design/APPROVALS-API.md §5.1, §8.3; .work/approvals/CONTRACT.md "Dashboard HTTP contract"). The mock
 * (src/lib/demo/respond.ts) implements the same contract so the UI is built against the real shape.
 *
 *   POST /api[/clusters/<cluster>]/rollouts/<namespace>/<name>/approve      body { version: string, revoke?: boolean }
 *     approve 200  { approval: { name, version, by? } }     the RolloutApproval for (rollout, version) exists (also when it already did, identically)
 *     approve 409  { error }                                 not a current release candidate, or a name collision with a different spec
 *     revoke  200  {}                                        the dashboard's own RolloutApproval is gone (or already was)
 *     revoke  200  { stillApproved: true, approvals: [{ name, by? }] }   ANOTHER RolloutApproval (git, a colleague) still approves the version: the build stays approved
 *     403 { error } the API server refused (no `create rolloutapprovals`); 400 empty version
 *   GET  .../rollouts/<ns>/<name>/approvals            { byVerified: boolean, approvals: [{ name, version, by?, createdAt }] }  `by` only when byVerified
 *   GET  .../rollouts/<ns>/<name>/permissions/all      permissions.approve = may create rolloutapprovals here (absent from an older backend: allowed)
 *
 * One request per rollout: a folded "5 prod regions" row is five requests, each region's own approval.
 */
import { apiPath } from './urls';

/** `/rollouts/<cluster>/<ns>/<name>` -> the request pieces (null for any other href) */
export function rolloutOfHref(href: string): { cluster: string; namespace: string; name: string } | null {
	const p = href.split('?')[0].split('/').filter(Boolean);
	return p[0] === 'rollouts' && p.length >= 4 ? { cluster: p[1], namespace: p[2], name: p[3] } : null;
}

export type ApprovalRef = { name: string; by?: string };
export type ApprovalReply = { approval?: ApprovalRef & { version?: string }; stillApproved?: boolean; approvals?: ApprovalRef[] };
export type ApprovalListEntry = ApprovalRef & { version: string; createdAt: string };
export type ApprovalList = { byVerified: boolean; approvals: ApprovalListEntry[] };

/** Approve (or, with `revoke`, withdraw) one rollout's approval of `version`; resolves with the server's reply (a revoke answers `stillApproved` while another approval remains). */
export async function postApproval(href: string, version: string, revoke = false, f: typeof fetch = fetch): Promise<ApprovalReply> {
	const r = rolloutOfHref(href);
	if (!r) throw new Error(`not a rollout: ${href}`);
	const res = await f(apiPath(r.cluster, `/rollouts/${r.namespace}/${r.name}/approve`), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(revoke ? { version, revoke: true } : { version })
	});
	if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${revoke ? 'Undo' : 'Approve'} failed (${res.status})`);
	return ((await res.json().catch(() => null)) ?? {}) as ApprovalReply;
}

/** GET a rollout's approvals and whether their `by` is trustworthy on that cluster (`byVerified`). Never throws: no answer = nothing known, `by` stays hidden. */
export async function fetchApprovals(cluster: string, namespace: string, name: string, f: typeof fetch = fetch): Promise<ApprovalList> {
	try {
		const res = await f(apiPath(cluster, `/rollouts/${namespace}/${name}/approvals`));
		if (!res.ok) return { byVerified: false, approvals: [] };
		const j = await res.json();
		return { byVerified: j?.byVerified === true, approvals: Array.isArray(j?.approvals) ? j.approvals : [] };
	} catch {
		return { byVerified: false, approvals: [] };
	}
}

export const approvalsQueryKey = (namespace: string, name: string, cluster?: string) => ['rollout-approvals', namespace, name, cluster] as const;
export const approvalsQueryOptions = ({ cluster, namespace, name }: { cluster: string; namespace: string; name: string }) => ({
	queryKey: approvalsQueryKey(namespace, name, cluster),
	queryFn: () => fetchApprovals(cluster, namespace, name),
	staleTime: 60000
});
