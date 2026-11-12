/* A leaf module (no `$lib` imports): the mock server (src/lib/demo/state.ts) runs under plain node from vite.config, so it may not import place-verdict. */

/** THE APPROVAL WRITE, ONE FUNCTION: what a person's Approve does to the approval gate's allow-list. Conservative, per-build: it allows ONLY the approved build. It mirrors what the real approve write does to the policy-owned gate (design/APPROVALS-API.md §5.1: one RolloutApproval per rollout+version; §8.3: the gate admits exactly the approved versions); POST /approve is lib/api/approvals.ts. */
export const approvalWrite = (allowed: readonly string[], approvedTag: string): string[] => [...new Set([...allowed, approvedTag])];
/** THE INVERSE of `approvalWrite`, for the optimistic Undo: removes ONLY that tag, every other approved build stays (design/APPROVALS-API.md §5.1/§8.3: revoke deletes one RolloutApproval). */
export const approvalUnwrite = (allowed: readonly string[], approvedTag: string): string[] => allowed.filter((v) => v !== approvedTag);

type GateLike = { name?: string; kind?: string | null; passing?: boolean | null; allowedVersions?: string[] | null };
type RolloutResp = { rollout?: { status?: { gates?: GateLike[] } & Record<string, unknown> } | null } & Record<string, unknown>;
/** a gate Approve writes to: policy-owned (`kind` approval, an allow-list); the name is read only for a payload without `kind` (same rule as place-verdict's `isApprovalLike`) */
const takesApproval = (g: GateLike): boolean => g.allowedVersions != null && (g.kind == null ? /approval/.test(g.name ?? '') : g.kind === 'approval');

/**
 * THE OPTIMISTIC GRANT, ON THE ROLLOUT PAYLOAD A PLACE'S OWN PAGE READS (`['rollout', ns, name, cluster]`). The fleet fixture Home reads is patched by
 * `grantApproval` (data.ts); the per-rollout query is a second copy of the same gate, and until the controller reconciles (seconds) it still said "held
 * ... releases when someone approves", so the place disagreed with Home. Both copies are written by the same click, with the same `approvalWrite`.
 * Pure: returns a new response (the cache never mutates in place), or the same object when nothing here takes an approval.
 */
export function grantInRollout<T extends RolloutResp>(resp: T | undefined, approvedTag: string): T | undefined {
	const gates = resp?.rollout?.status?.gates;
	if (!resp || !gates?.some(takesApproval)) return resp;
	const next = gates.map((g) => (takesApproval(g) ? { ...g, passing: true, allowedVersions: approvalWrite(g.allowedVersions!, approvedTag) } : g));
	return { ...resp, rollout: { ...resp.rollout, status: { ...resp.rollout!.status, gates: next } } };
}
