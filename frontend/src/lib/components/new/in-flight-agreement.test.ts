import { it, expect, afterEach } from 'vitest';
import fleet from './fixtures/qa-live-fleet-deploying.json';
import heldFleet from './fixtures/qa-live-fleet-held.json';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { rolloutsPage } from './rollouts-page';
import { isInFlightEntry } from '$lib/view-models/activity-figures';

/**
 * QA #21: /activity's "In flight" and /rollouts' "In flight" / "N moving" are one fact. The fleet is a real snapshot of the live hub taken
 * while three rollouts were deploying or checking (qa-live rollouts3.json). Both surfaces get the SAME fleet; they must count the same rollouts.
 */
afterEach(() => installLiveSource(null));

it('the Rollouts "moving" count equals the Activity in-flight predicate over the same fleet', () => {
	const items = ((fleet as any).rollouts.items ?? (fleet as any).rollouts) as any[];
	installLiveSource({
		rollouts: items,
		environments: (fleet as any).environments?.items ?? [],
		rolloutDependencies: (fleet as any).rolloutDependencies ?? null,
		kustomizations: (fleet as any).kustomizations?.items ?? [],
		kruiseRollouts: (fleet as any).kruiseRollouts?.items ?? [],
		changes: [],
		changesState: 'not_connected',
		healthChecks: null,
		github: { configured: true, connected: false },
		me: '',
		now: new Date('2026-11-09T14:05:00Z')
	} as any);
	const activity = items.filter((r) => isInFlightEntry({ bakeStatus: r.status?.history?.[0]?.bakeStatus, isLive: true })).length;
	expect(activity).toBeGreaterThan(0);
	const P = rolloutsPage('incident');
	expect(P.counts.moving).toBe(activity);
});

import * as D from './data';
import { isGeneratedGateName } from '$lib/view-models/gate-name';
it('QA #17: no held row of the fleet names its gate by a generated id ("Ghd 4bntr")', () => {
	const f: any = heldFleet;
	const items = f.rollouts.items as any[];
	installLiveSource({
		rollouts: items, environments: f.environments?.items ?? [], rolloutDependencies: f.rolloutDependencies ?? null,
		kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: null,
		github: { configured: true, connected: false }, me: '', now: new Date('2026-11-09T14:05:00Z')
	} as any);
	const named = D.rollouts('incident').rows.map((r) => D.gateName(r)).filter(Boolean) as { name: string; sentence: string }[];
	expect(named.length).toBeGreaterThan(0);
	for (const g of named) {
		expect(g.name).not.toMatch(/^ghd\b/i);
		expect(isGeneratedGateName(g.name.toLowerCase().replace(/ /g, '-'))).toBe(false);
		expect(g.sentence).not.toMatch(/ghd[- ][a-z0-9]{5}/i);
	}
});
