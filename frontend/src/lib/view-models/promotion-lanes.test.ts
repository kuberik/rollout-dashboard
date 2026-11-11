import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/releases/registry.svelte', async (orig) => {
	const m = await orig<typeof import('$lib/releases/registry.svelte')>();
	return { ...m, noReleasesOf: (r: { metadata?: { namespace?: string } } | null) => (r?.metadata?.namespace === 'norel' ? { kind: 'empty', label: 'No releases yet', message: '' } : m.noReleasesOf(r as never)) };
});
import type { Rollout, Environment } from '$lib/../types';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildLanes, appsWithoutEnvironment, tierOf } from './promotion-lanes';

const NOW = new Date('2026-10-08T12:00:00Z');

const mkRollout = (name: string, namespace: string): Rollout =>
	({
		metadata: { name, namespace },
		spec: {},
		status: { history: [] }
	}) as unknown as Rollout;

const mkEnv = (name: string, namespace: string, tier: string): Environment =>
	({
		metadata: { name, namespace },
		spec: { environment: tier, name, rolloutRef: { name } }
	}) as unknown as Environment;

/**
 * ⛔ U-12 (2026-10-08) — see the fix's own doc comment on
 * `appsWithoutEnvironment`. Mirrors `version-utils.test.ts`'s
 * `groupRolloutsByApp — a same-named, unbound rollout is not dropped`.
 */
describe('appsWithoutEnvironment — a same-named, unbound rollout is not dropped (U-12)', () => {
	it('names the app even though its bound sibling has a lane', () => {
		const bound = mkRollout('orders-api', 'orders-api-prod');
		const orphan = mkRollout('orders-api', 'orders-prod'); // no Environment matches this one
		const env = mkEnv('orders-api', 'orders-api-prod', 'prod');

		const cards = buildRolloutCards([bound, orphan], [env], NOW);
		const lanes = buildLanes(cards);

		// The bound rollout still gets its own lane.
		expect(lanes.map((l) => l.app)).toContain('orders-api');

		// And the orphan is still named here, not silently merged away because
		// the SAME name already resolved a lane for its sibling.
		expect(appsWithoutEnvironment(cards)).toContain('orders-api');
	});

	it('an entirely unbound app (no name collision) is still named', () => {
		const lonely = mkRollout('standalone-api', 'standalone-prod');
		const cards = buildRolloutCards([lonely], [], NOW);
		expect(appsWithoutEnvironment(cards)).toEqual(['standalone-api']);
	});

	it('a fully bound app is never named', () => {
		const bound = mkRollout('hello-world-app', 'hello-world-prod');
		const env = mkEnv('hello-world-app', 'hello-world-prod', 'prod');
		const cards = buildRolloutCards([bound], [env], NOW);
		expect(appsWithoutEnvironment(cards)).toEqual([]);
	});
});

import { stairColumns, stairRise } from './promotion-lanes';

describe('stair geometry (shared by every drawn chain)', () => {
	it('rises by tier index among the tiers in play', () => {
		expect(stairRise('dev', ['dev', 'staging', 'prod'])).toBe(0);
		expect(stairRise('staging', ['dev', 'staging', 'prod'])).toBe(0.5);
		expect(stairRise('prod', ['dev', 'staging', 'prod'])).toBe(1);
		expect(stairRise('prod', ['prod'])).toBe(0);
		expect(stairRise('test', ['dev', 'prod'])).toBe(0);
	});
	it('gives stages 1fr and production 1.5fr', () => {
		expect(stairColumns(['dev', 'prod'])).toBe('minmax(88px, 1fr) minmax(160px, 1.5fr)');
	});
});

import { STATE_ORDER } from './promotion-lanes';
import { CHANGE_STATE_RANK } from '$lib/rollout-cards';

describe('STATE_ORDER agrees with the product-wide CHANGE_STATE_RANK', () => {
	it('failed > stuck > held > in progress', () => {
		const i = (s: string) => STATE_ORDER.indexOf(s as never);
		expect(i('failed')).toBeLessThan(i('stuck'));
		expect(i('stuck')).toBeLessThan(i('held'));
		expect(i('held')).toBeLessThan(i('deploying'));
		expect(i('held')).toBeLessThan(i('checking'));
		expect(CHANGE_STATE_RANK.held).toBeLessThan(CHANGE_STATE_RANK.deploying);
	});
});

describe('tierOf — the nine controller names', () => {
	it.each([
		['development', 'dev'],
		['qa', 'test'],
		['stage', 'staging'],
		['preprod', 'staging'],
		['production', 'prod'],
		['prod-test-1', 'prod'],
		['sandbox', 'other']
	])('%s -> %s', (name, tier) => {
		expect(tierOf(name)).toBe(tier);
	});
});

/** QA #11 (hello-world-manifests): rollouts with NO Environment object, tiered only by the theme annotation, still draw a named box for every tier. */
describe('envless rollouts with a theme annotation (QA #11)', () => {
	const themed = (ns: string, theme: string): Rollout =>
		({ metadata: { name: 'hello-world-manifests', namespace: ns, annotations: { 'dashboard.rollout.kuberik.com/theme': theme }, labels: { environment: theme } }, spec: {}, status: { history: [] } }) as unknown as Rollout;
	it('every node of the lane has a non-empty label and the tier it was themed with', () => {
		const cards = buildRolloutCards([themed('hello-world-dev', 'dev'), themed('hello-world-staging', 'staging'), themed('hello-world-prod', 'prod')], [], NOW);
		const lanes = buildLanes(cards);
		const nodes = lanes.flatMap((l) => [...l.stages, ...l.prod]);
		expect(nodes.length).toBe(3);
		for (const n of nodes) expect(n.env.trim()).not.toBe('');
		expect(nodes.map((n) => n.tier).sort()).toEqual(['dev', 'prod', 'staging']);
	});
});

describe('buildLanes: a place with no releases is a none node from the catalogue rule (rollout detail lane)', () => {
	it('flags it noReleases and state none; a sibling with releases is unaffected', () => {
		const a = mkRollout('checkout-worker', 'norel');
		const b = mkRollout('checkout-worker', 'rel');
		const lanes = buildLanes(buildRolloutCards([a, b], [mkEnv('checkout-worker', 'norel', 'dev'), mkEnv('checkout-worker', 'rel', 'prod')], NOW));
		const nodes = [...lanes[0].stages, ...lanes[0].prod];
		const dev = nodes.find((n) => n.card.ns === 'norel')!;
		expect(dev.state).toBe('none');
		expect(dev.noReleases).toBe(true);
		expect(nodes.find((n) => n.card.ns === 'rel')!.noReleases).toBeUndefined();
	});
});
