/**
 * THE /activity FILTER (2026-11-22): adapts the activity feed's entries to the shared filter model
 * (`filter/filter-model.ts`), so /activity draws the SAME bar, menu and pills as /rollouts and keeps no filter logic of its own.
 * Properties (menu order): Kind (Failed / In flight / Rolled back), Tier (dev/test/staging/prod, the fold `tierOf` gives every region),
 * Environment (the exact region, e.g. prod-eu-west), Namespace, Rollout. Search matches rollout name, namespace and version.
 * TIER vs EXACT ENV (decided): both exist, as two properties. `?tier=` is a tier (aliases production/development/stage fold to the canonical word);
 * `?env=` is an exact environment key, so a deep link from /envs/<name> lands on one region; an env value that names no environment but IS a tier
 * word (`?env=prod`) is read as the tier, which is what the chip row's "prod" meant. A feed row carries one Kind (failed, then rolled back, then in
 * flight): the three states overlap only in theory and a Linear-style "is" needs one value per row.
 */
import { canonicalTier } from '$lib/view-models/sites-waves';
import { tierOf, TIER_ORDER } from '$lib/view-models/promotion-lanes';
import { rankBy, parseQuery, type FacetDef, type FilterQuery } from './filter/filter-model';

export type ActivityKind = 'failed' | 'in_flight' | 'rolled_back';
export const KIND_ORDER: ActivityKind[] = ['failed', 'in_flight', 'rolled_back'];
export const KIND_WORD: Record<ActivityKind, string> = { failed: 'Failed', in_flight: 'In flight', rolled_back: 'Rolled back' };

/** the slice of a feed entry the filter reads */
export type FilterEntry = { rolloutName: string; rolloutNamespace: string; displayName: string; envKey: string; envLabel: string; version: string };
const envOf = (e: FilterEntry) => e.envKey || e.envLabel;

export function activityFacets<E extends FilterEntry>(kindOf: (e: E) => ActivityKind | '', envWord: (key: string) => string = (k) => k): FacetDef<E>[] {
	return [
		{ key: 'kind', label: 'Kind', of: kindOf, order: rankBy(KIND_ORDER), values: KIND_ORDER, word: (v) => KIND_WORD[v as ActivityKind] ?? v },
		{ key: 'tier', label: 'Tier', of: (e) => tierOf(envOf(e)), order: rankBy([...TIER_ORDER].reverse()), values: TIER_ORDER as string[] },
		{ key: 'env', label: 'Environment', of: envOf, word: envWord },
		{ key: 'ns', label: 'Namespace', of: (e) => e.rolloutNamespace },
		{ key: 'app', label: 'Rollout', of: (e) => e.rolloutName }
	];
}
export const activityText = (e: FilterEntry): string[] => [e.rolloutName, e.displayName, e.rolloutNamespace, e.version];

/**
 * The query a URL spells. Old links keep working: `?kind=failed`, `?tier=production` (alias folded), `?env=`, `?app=`, `?ns=` are the model's own
 * spelling for those keys; `?env=prod` (a tier word, no such environment) is moved to `tier`.
 */
export function parseActivityQuery(params: URLSearchParams, defs: Pick<FacetDef<unknown>, 'key' | 'values'>[], envKeys: ReadonlySet<string>): FilterQuery {
	const p = new URLSearchParams(params);
	const fold = (raw: string) => raw.split(',').map((x) => x.trim()).filter(Boolean).map((x) => canonicalTier(x) ?? x);
	for (const sfx of ['', '!']) {
		const tier = p.get(`tier${sfx}`);
		if (tier) p.set(`tier${sfx}`, fold(tier).join(','));
		const env = p.get(`env${sfx}`);
		if (env && !p.has(`tier${sfx}`)) {
			const words = env.split(',').map((x) => x.trim()).filter(Boolean);
			if (words.length && words.every((w) => !envKeys.has(w) && !w.includes('-') && canonicalTier(w))) {
				p.delete(`env${sfx}`);
				p.set(`tier${sfx}`, fold(env).join(','));
			}
		}
	}
	return parseQuery(p, defs);
}
