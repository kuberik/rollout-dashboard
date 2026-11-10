/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { respondHomeIncident, type HomeFixture } from './home-incident';
import { SLICES_MODE_APPS } from './mock-slices';
import { ingestListResponse } from '../releases/feed';
import { availableReleases, releaseCandidates, gatedReleaseCandidates } from '../releases/registry.svelte';

const OLD = ['availableReleases', 'releaseCandidates', 'gatedReleaseCandidates'] as const;

describe('mock slices mode, home-incident scenario path (dev-mock-api serves it in front of respond())', () => {
	const fixture = JSON.parse(
		readFileSync(new URL('../view-models/home/fixtures/incident-input.json', import.meta.url), 'utf8')
	) as HomeFixture;
	const tags = (l: { tag: string }[] | undefined) => l?.map((v) => v.tag);

	it('serves releaseSources/releaseSlices and converts payments-core/edge-mesh rollouts; accessors read back the fixture tags', () => {
		const body = JSON.parse(respondHomeIncident('GET', '/api/rollouts', fixture, new Date(Date.parse(fixture.capturedAt) + 1000))!.body!);
		expect(body.releaseSlices.items.length).toBeGreaterThan(0);
		ingestListResponse(body);
		const conv = body.rollouts.items.filter((r: any) => r.spec?.releaseSourceRef);
		expect(conv.length).toBeGreaterThan(0);
		for (const r of conv) {
			expect(SLICES_MODE_APPS.has(r.metadata.name)).toBe(true);
			for (const f of OLD) expect(r.status[f]).toBeUndefined();
			const orig = fixture.rollouts.find(
				(o: any) =>
					o.metadata.name === r.metadata.name &&
					o.metadata.namespace === r.metadata.namespace &&
					o.metadata.annotations?.['rollout-dashboard.kuberik.com/source-cluster'] ===
						r.metadata.annotations?.['rollout-dashboard.kuberik.com/source-cluster']
			) as any;
			expect(tags(availableReleases(r))).toEqual(tags(orig.status.availableReleases));
			const served = (l: any) => (Array.isArray(l) && l.length === 0 ? undefined : l);
			expect(tags(releaseCandidates(r))).toEqual(tags(served(orig.status.releaseCandidates)));
			expect(tags(gatedReleaseCandidates(r))).toEqual(tags(served(orig.status.gatedReleaseCandidates)));
		}
		const slices = body.releaseSlices.items;
		expect(slices.some((s: any) => s.sealed)).toBe(true);
		expect(slices.some((s: any) => !s.sealed)).toBe(true);
		// pinned JSON untouched
		expect(JSON.stringify(fixture)).not.toContain('releaseSourceRef');
	});
});
