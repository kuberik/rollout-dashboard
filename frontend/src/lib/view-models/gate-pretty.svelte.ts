/**
 * Round 2 B4 — the pretty names of the gates the FLEET LIST does not carry (`status.gates` has names only; the published
 * `gate.kuberik.com/pretty-name` lives on the gate object the rollout detail response returns). Keyed by cluster/namespace/gate name so two
 * clusters' same-named gates never share a name. Until published, `gateDisplayName` falls back to the readable resource name or "Gate".
 */
import { SvelteMap } from 'svelte/reactivity';
const known = new SvelteMap<string, string>();
const k = (cluster: string, ns: string, name: string) => `${cluster}/${ns}/${name}`;
export function publishGatePretty(cluster: string, ns: string, m: Map<string, string>): void {
	for (const [n, v] of m) if (known.get(k(cluster, ns, n)) !== v) known.set(k(cluster, ns, n), v);
}
export const gatePrettyOf = (cluster: string, ns: string, name: string): string | null => known.get(k(cluster, ns, name)) ?? null;
