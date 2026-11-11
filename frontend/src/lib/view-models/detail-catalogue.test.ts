import { describe, expect, it } from 'vitest';
import { respond } from '../demo/respond';
import { resetDemoState } from '../demo/state';
import { ingestListResponse } from '../releases/feed';
import { resetReleaseCatalogue, availableReleases, releasesOf } from '../releases/registry.svelte';
import { promotionCandidates } from './promotion';
import { behindOfStatus } from './behind';
import { SOURCE_CLUSTER_ANNOTATION } from '../source-dashboard';
import type { Rollout } from '../../types';

/**
 * The rollout DETAIL response must carry what the list carries (the source-cluster stamp), so the detail page finds
 * its release catalogue: "N newer" and the Change version rows come from the same slices as the env strip and /rollouts.
 */
const detail = (ns: string, name: string): Rollout => {
	const body = JSON.parse(respond('GET', `/api/rollouts/${ns}/${name}`).body ?? '{}') as { rollout: Rollout };
	return body.rollout;
};
const list = () => ingestListResponse(JSON.parse(respond('GET', '/api/rollouts').body ?? '{}'), { fleetWide: true });

describe('rollout detail finds its release catalogue (generic mock, as the real backend serves it)', () => {
	it('is stamped with its source cluster like the list items', () => {
		resetDemoState();
		expect(detail('checkout-edge-staging', 'checkout-edge').metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION]).toBeTruthy();
	});

	it('checkout-edge staging: 2 newer builds the page can deploy, the same count as the strip', () => {
		resetDemoState();
		resetReleaseCatalogue();
		const r = detail('checkout-edge-staging', 'checkout-edge');
		list();
		expect(releasesOf(r).state).toBe('ready');
		const newer = promotionCandidates(r);
		expect(newer.length).toBe(2);
		expect(newer.length).toBe(behindOfStatus(r));
	});

	it('Change version lists the catalogue builds (checkout-edge staging)', () => {
		resetDemoState();
		resetReleaseCatalogue();
		const r = detail('checkout-edge-staging', 'checkout-edge');
		list();
		const tags = (availableReleases(r) ?? []).map((x) => x.tag);
		expect(tags.length).toBeGreaterThan(20);
		expect(tags).toContain('9a1f4c2');
		expect(tags).toContain('4d0b7e8');
	});

	it('a detail response without the stamp reads as loading, never as "on the newest"', () => {
		resetDemoState();
		resetReleaseCatalogue();
		const r = detail('checkout-edge-staging', 'checkout-edge');
		list();
		const unstamped = { ...r, metadata: { ...r.metadata, annotations: {} } } as Rollout;
		expect(releasesOf(unstamped).state).toBe('loading');
	});
});

describe('the hold reason shows on the detail page (checkout-api staging, home-incident)', () => {
	it('an unstamped detail response (an older backend) still finds its catalogue and builds a held story', async () => {
		const { readFileSync } = await import('node:fs');
		const { respondHomeIncident } = await import('../demo/home-incident');
		const { blockingStory, buildGateContext } = await import('./blocking-story');
		const { withSourceCluster } = await import('../api/rollouts');
		const fixture = JSON.parse(readFileSync(new URL('./home/fixtures/incident-input.json', import.meta.url), 'utf8'));
		const now = new Date(fixture.capturedAt);
		resetReleaseCatalogue();
		const l = JSON.parse(respondHomeIncident('GET', '/api/rollouts', fixture, now)!.body!);
		ingestListResponse(l, { fleetWide: true });
		const ns = 'checkout-api-staging';
		const item = l.rollouts.items.find((x: Rollout) => x.metadata?.namespace === ns && x.metadata?.name === 'checkout-api') as Rollout;
		const cluster = item.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] as string;
		const d = JSON.parse(respondHomeIncident('GET', `/api/rollouts/${ns}/checkout-api`, fixture, now)!.body!);
		// what the backend served before it stamped the detail response
		delete d.rollout.metadata.annotations[SOURCE_CLUSTER_ANNOTATION];
		expect(releasesOf(d.rollout).state).toBe('loading');
		const r = withSourceCluster(d, cluster).rollout as Rollout;
		expect(releasesOf(r).state).toBe('ready');
		expect(promotionCandidates(r).length).toBeGreaterThan(0);
		const ctx = buildGateContext({ environments: l.environments, rolloutDependencies: l.rolloutDependencies ?? null, rolloutGates: d.rolloutGates });
		expect(blockingStory(r, ctx, { now }).gates.length).toBeGreaterThan(0);
	});
});
