/* A leaf module (no `$lib` imports): the mock server (src/lib/demo/state.ts) runs under plain node from vite.config, so it may not import place-verdict. */

/** THE APPROVAL WRITE, ONE FUNCTION: what a person's Approve does to the approval gate's allow-list. Conservative, per-build: it allows ONLY the approved build. It mirrors what the real approve write does to the policy-owned gate (design/APPROVALS-API.md §5.1: one RolloutApproval per rollout+version; §8.3: the gate admits exactly the approved versions); POST /approve is lib/api/approvals.ts. */
export const approvalWrite = (allowed: readonly string[], approvedTag: string): string[] => [...new Set([...allowed, approvedTag])];
/** THE INVERSE of `approvalWrite`, for the optimistic Undo: removes ONLY that tag, every other approved build stays (design/APPROVALS-API.md §5.1/§8.3: revoke deletes one RolloutApproval). */
export const approvalUnwrite = (allowed: readonly string[], approvedTag: string): string[] => allowed.filter((v) => v !== approvedTag);
