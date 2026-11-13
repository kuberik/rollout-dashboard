/**
 * POST /api/rollouts/:namespace/:name/bypass-gates, the write behind "Skip once".
 *
 * One call skips ONE rule for ONE held build on ONE rollout; the dialog calls it once per selected rollout, each through its own
 * cluster path (`apiPath`), because each cluster resolves its own gates. Never send `gates`, and never send an empty body: an empty
 * body means "skip every rule" (what Change version's force deploy does).
 */
import { apiFetch, ApiError } from './errors';
import { apiPath } from './urls';
import type { RuleRef } from '$lib/view-models/skip-rule';

export type SkipRuleResponse = {
	version: string;
	/** The RolloutGate names the rule resolved to on this rollout. */
	gates: string[];
	scope: 'only' | 'all';
};

export async function skipRuleOnce(args: {
	cluster?: string;
	namespace: string;
	name: string;
	/** The held build's TAG, the rollout's own candidate. */
	version: string;
	rule: RuleRef;
}): Promise<SkipRuleResponse> {
	const { cluster, namespace, name, version, rule } = args;
	const res = await apiFetch(
		apiPath(cluster, `/rollouts/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/bypass-gates`),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ version, rule })
		}
	);
	return (await res.json()) as SkipRuleResponse;
}

/**
 * The plain sentence for a failed skip, as the design's error table has it. `build` is printed by the caller in code type, so it is
 * a separate part: `{ before, build, after }` joins to the sentence.
 */
export function skipErrorCopy(
	e: unknown,
	ctx: { ruleLabel: string; cluster?: string }
): { before: string; build?: boolean; after: string } {
	if (e instanceof ApiError) {
		if (e.status === 409) return { before: '', build: true, after: " isn't waiting to deploy here any more." };
		if (e.status === 422) return { before: `${ctx.ruleLabel} no longer holds this rollout.`, after: '' };
		if (e.status === 403) return { before: "You can't change this rollout.", after: '' };
		if (e.status === 404) return { before: 'This rollout no longer exists.', after: '' };
		const unreachable = e.status === 0 || e.status >= 500;
		if (unreachable && !e.hasBody) {
			return { before: ctx.cluster ? `Couldn't reach ${ctx.cluster}. Try again.` : "Couldn't reach the cluster. Try again.", after: '' };
		}
		// a plain server sentence: first sentence, as-is
		const first = (e.message || '').split(/(?<=[.!?])\s/)[0]?.trim();
		if (first && !/^Request failed/.test(first)) return { before: first, after: '' };
		return { before: ctx.cluster ? `Couldn't reach ${ctx.cluster}. Try again.` : "Couldn't reach the cluster. Try again.", after: '' };
	}
	return { before: ctx.cluster ? `Couldn't reach ${ctx.cluster}. Try again.` : "Couldn't reach the cluster. Try again.", after: '' };
}
