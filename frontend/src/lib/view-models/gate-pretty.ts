import { prettyNameOf } from './gate-name';

/** name -> published pretty name, from a rollout detail response's `rolloutGates` (the Gates tab's own source). Gates without one are absent. */
export function prettyMapOf(gates: { items?: { metadata?: { name?: string; annotations?: Record<string, string> } }[] } | null | undefined): Map<string, string> {
	const out = new Map<string, string>();
	for (const g of gates?.items ?? []) {
		const n = g.metadata?.name;
		const p = prettyNameOf(g.metadata);
		if (n && p) out.set(n, p);
	}
	return out;
}
