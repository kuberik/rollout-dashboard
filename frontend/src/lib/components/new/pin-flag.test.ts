import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { placesOf, apps, appHolds } from './data';
import { homeModel } from '$lib/components/home/sketch/home-data';
import { installEdge, uninstallEdge } from '$lib/testing/edge-source';

/**
 * Batch 4 (d): a pin holds the builds newer than its own whatever the place's health. deploy-pin-fail is pinned to dp-2 and its newest deploy of dp-2 failed
 * its bake, with dp-3 waiting behind the pin. The app row said "Pinned to dp-2" (it reads `spec.wantedVersion`) while the place's `pinned` flag
 * (`pinHoldsBuilds`, which also required the place to be healthy) was false, so the place-level surfaces (the app page's pin glyph, the held counts)
 * disagreed with the row. The state word stays "failed" (a flag beside the state, never folded into it).
 */
beforeEach(installEdge);
afterEach(uninstallEdge);
const prod = (app: string) => placesOf('incident', app).find((p) => p.tier === 'prod')!;

describe('every surface agrees whether a place is pinned', () => {
	it('deploy-pin-fail: the failed place is flagged pinned in the Home model, the app places and the app row', () => {
		expect(prod('deploy-pin-fail').state).toBe('failed');
		expect(prod('deploy-pin-fail').pinned).toBe(true);
		const env = homeModel('incident').apps.find((a) => a.app === 'deploy-pin-fail')!.envs.find((e) => e.tier === 'prod')!;
		expect(env.pinned).toBe(true);
		expect(apps('incident').items.find((a) => a.app === 'deploy-pin-fail')!.placeList.find((p) => p.tier === 'prod')!.pinned).toBe(true);
		const row = apps('incident').items.find((a) => a.app === 'deploy-pin-fail')!;
		expect(appHolds(row as never, 'incident').map((x) => x.text)).toEqual(['Pinned to dp-2 in production']);
	});
	it('mail-relay (pinned, healthy, behind) stays flagged; a place that is not pinned is not', () => {
		expect(prod('mail-relay').pinned).toBe(true);
		expect(prod('search-indexer').pinned).toBe(false);
	});
});
