import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { respondHomeIncident, type HomeFixture } from '../demo/home-incident';
import { newerReleaseCount, promotionCandidates } from './promotion';
import { behindOfStatus } from './behind';
import { rankVerdictsByRollout } from './env-rank';
import { availableReleases, releaseCandidates, gatedReleaseCandidates } from '../releases/registry.svelte';
import type { Environment, Rollout } from '../../types';

/**
 * The key view-model rules, read from the shape the product serves: every rollout carries a releaseSourceRef and
 * its releases come from ReleaseSlices plus status.candidates (never the old lists). Nothing here goes through the
 * old-shape test adapter: the served rollouts have a ref, and the adapter never applies to those.
 */
const fixture = JSON.parse(readFileSync(new URL('./home/fixtures/incident-input.json', import.meta.url), 'utf8')) as HomeFixture;
const body = JSON.parse(respondHomeIncident('GET', '/api/rollouts', fixture, new Date(fixture.capturedAt))!.body!) as {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
};
const rollouts = body.rollouts.items;
const at = (ns: string, name: string) => {
	const r = rollouts.find((x) => x.metadata?.namespace === ns && x.metadata?.name === name);
	if (!r) throw new Error(`${ns}/${name} not in the served list`);
	return r;
};
const tags = (l: { tag?: string }[] | undefined) => (l ?? []).map((x) => x.tag);

describe('slices-shape view-models (home-incident, as served)', () => {
	it('serves no old fields and a ref on every rollout (but the one without a source)', () => {
		for (const r of rollouts) {
			const st = (r.status ?? {}) as Record<string, unknown>;
			for (const f of ['availableReleases', 'releaseCandidates', 'gatedReleaseCandidates']) expect(st[f], `${r.metadata?.name} ${f}`).toBeUndefined();
			const spec = r.spec as { releaseSourceRef?: unknown };
			if (r.metadata?.name !== 'recommender-svc') expect(spec.releaseSourceRef, r.metadata?.name).toBeTruthy();
		}
	});

	it('held, behind and newer: orders-api staging has one newer build (held), prod and dev have none', () => {
		const staging = at('orders-api-staging', 'orders-api');
		expect(tags(availableReleases(staging))).toEqual(['7c14e2a', 'e936e6f']);
		expect(tags(releaseCandidates(staging))).toEqual(['e936e6f']);
		expect(newerReleaseCount(staging)).toBe(1);
		expect(promotionCandidates(staging).length).toBe(1);
		expect(behindOfStatus(staging)).toBe(1);
		expect(releaseCandidates(at('orders-api-prod', 'orders-api'))).toBeUndefined();
		expect(releaseCandidates(at('orders-api-dev', 'orders-api'))).toBeUndefined();
	});

	it('newer counts come from the whole catalogue, not the controller working set: checkout-edge prod has 19', () => {
		const prod = at('checkout-edge-prod', 'checkout-edge');
		expect(newerReleaseCount(prod)).toBe(19);
		expect(releaseCandidates(prod)!.length).toBe(19);
		expect(promotionCandidates(prod).length).toBe(19);
		// gated subset comes from status.candidates
		expect((gatedReleaseCandidates(prod) ?? []).length).toBeLessThanOrEqual(19);
	});

	it('the place verdict (rank) agrees with the counts', () => {
		const ranks = rankVerdictsByRollout(rollouts, body.environments.items);
		expect(ranks.get(at('orders-api-staging', 'orders-api'))).toEqual({ kind: 'behind', by: 1 });
		expect(ranks.get(at('checkout-edge-prod', 'checkout-edge'))).toEqual({ kind: 'behind', by: 19 });
	});
});
