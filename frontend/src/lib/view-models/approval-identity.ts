/**
 * THE ONE WAY TO NAME WHO APPROVED (CONTRACT D6). `by` is the full Kubernetes username (`oidc:luka`); the person reads the part after the
 * first colon. No colon: unchanged. `('a:b:c')` is `b:c`. The full string belongs in the title / tooltip of whatever prints this.
 * Used by the history row, any approval chip that names the approver, and the Undo toast. A leaf module.
 */
export const displayIdentity = (s: string): string => { const i = s.indexOf(':'); return i < 0 ? s : s.slice(i + 1); };

/** "luka", "luka, ana": the approvers of a still-standing approval, by display name (an approval without a trustworthy `by` is named by its RolloutApproval name). */
export const approversWords = (a: readonly { name: string; by?: string }[]): string => [...new Set(a.map((x) => (x.by ? displayIdentity(x.by) : x.name)))].join(', ');
