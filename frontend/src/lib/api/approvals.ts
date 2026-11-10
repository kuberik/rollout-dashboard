/**
 * THE APPROVAL WIRE CONTRACT (r34 r3-approve; owner 2026-11-02: "we'll have proper approval mechanism at some point though.
 * assume that it does exist"). The Go backend has no such route yet; this file is the one place the dashboard names it, and
 * the mock (src/lib/demo/respond.ts) implements the same contract so the UI is built against the real shape.
 *
 *   POST /api[/clusters/<cluster>]/rollouts/<namespace>/<name>/approve
 *     body  { version: string, revoke?: boolean }
 *     200   {}                      the rollout's approval gate allows `version` (and the builds held with it) and the controller deploys it
 *     4xx   { error: string }       not allowed / no such rollout / nothing waits
 *   `revoke: true` withdraws a just-given approval (the Undo window): the gate refuses `version` again, if it has not finished deploying.
 *
 * One request per rollout: a folded "5 prod regions" row is five requests, each region's own gate.
 */
import { apiPath } from './urls';

/** `/rollouts/<cluster>/<ns>/<name>` -> the request pieces (null for any other href) */
export function rolloutOfHref(href: string): { cluster: string; namespace: string; name: string } | null {
	const p = href.split('?')[0].split('/').filter(Boolean);
	return p[0] === 'rollouts' && p.length >= 4 ? { cluster: p[1], namespace: p[2], name: p[3] } : null;
}

export async function postApproval(href: string, version: string, revoke = false, f: typeof fetch = fetch): Promise<void> {
	const r = rolloutOfHref(href);
	if (!r) throw new Error(`not a rollout: ${href}`);
	const res = await f(apiPath(r.cluster, `/rollouts/${r.namespace}/${r.name}/approve`), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(revoke ? { version, revoke: true } : { version })
	});
	if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${revoke ? 'Undo' : 'Approve'} failed (${res.status})`);
}
