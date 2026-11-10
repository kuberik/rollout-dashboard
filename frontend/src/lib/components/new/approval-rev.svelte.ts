/**
 * r34 r3-approve — the one reactive tick of the approvals overlay. The five list pages read a pinned fixture through
 * data.ts (no query client), so an approval is applied to that fixture in place and every derivation re-runs when this
 * counter moves: `homeModel()` and `rawOf()` read it, so any `$derived(rollouts(hs))` on any page tracks it.
 */
let rev = $state(0);
export const approvalRev = (): number => rev;
export const bumpApprovals = (): void => { rev++; };
