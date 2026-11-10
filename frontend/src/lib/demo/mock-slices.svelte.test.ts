/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { applySlicesMode, canConvert, SLICES_MODE_APPS } from './mock-slices';
import { mockFleetRollouts } from './mock-data';
import { respond } from './respond';
import { getScenarioFleetRollouts, resetDemoState } from './state';
import { ingestListResponse } from '../releases/feed';
import {
	availableReleases,
	gatedReleaseCandidates,
	releaseCandidates,
	resetReleaseCatalogue
} from '../releases/registry.svelte';

const OLD = ['availableReleases', 'releaseCandidates', 'gatedReleaseCandidates'] as const;
// JSON (not toEqual): field order inside objects and list order must match too.
const j = (v: unknown) => JSON.stringify(v);

beforeEach(() => {
	resetReleaseCatalogue();
	resetDemoState();
});

function expectEquivalent(original: any, converted: any) {
	for (const f of OLD) expect(converted.status[f], `${original.metadata.name} still has ${f}`).toBeUndefined();
	expect(converted.spec.releaseSourceRef.name).toBeTruthy();
	expect(j(availableReleases(converted))).toBe(j(original.status.availableReleases));
	// The controller writes these lists `omitempty`, so an empty list is served as absent.
	const served = (l: unknown) => (Array.isArray(l) && l.length === 0 ? undefined : l);
	expect(j(releaseCandidates(converted))).toBe(j(served(original.status.releaseCandidates)));
	expect(j(gatedReleaseCandidates(converted))).toBe(j(served(original.status.gatedReleaseCandidates)));
}

describe('mock slices mode', () => {
	it('static fixtures: every converted rollout reads back exactly its original three lists', () => {
		const originals = structuredClone(mockFleetRollouts).filter((r: any) => canConvert(r));
		expect(originals.length).toBeGreaterThan(0);
		const { rollouts, sources, slices } = applySlicesMode(structuredClone(originals));
		ingestListResponse({ releaseSources: { items: sources }, releaseSlices: { items: slices } });
		rollouts.forEach((c, i) => expectEquivalent(originals[i], c));
	});

	it('every converted catalogue spans at least two slices, one sealed, none empty', () => {
		const originals = structuredClone(mockFleetRollouts).filter((r: any) => canConvert(r));
		const { sources, slices } = applySlicesMode(originals);
		for (const s of sources) {
			const mine = slices.filter((sl) => sl.source === s.metadata.name && sl.metadata.namespace === s.metadata.namespace);
			expect(mine.length).toBeGreaterThanOrEqual(2);
			expect(mine.some((sl) => sl.sealed)).toBe(true);
			expect(mine.some((sl) => !sl.sealed)).toBe(true);
			for (const sl of mine) expect(sl.releases!.length).toBeGreaterThan(0);
		}
	});

	it('served /api/rollouts: converted rollouts carry no old fields, the rest keep them, accessors match the stored originals', () => {
		const originals = new Map(
			(getScenarioFleetRollouts() as any[]).map((r) => [`${r.metadata.namespace}/${r.metadata.name}`, structuredClone(r)])
		);
		const body = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		ingestListResponse(body);
		expect(body.releaseSources.items.length).toBeGreaterThan(0);
		let converted = 0;
		let kept = 0;
		for (const r of body.rollouts.items) {
			const o = originals.get(`${r.metadata.namespace}/${r.metadata.name}`);
			if (r.spec?.releaseSourceRef) {
				expect(o).toBeDefined();
				converted++;
				expect(SLICES_MODE_APPS.has(r.metadata.name)).toBe(true);
				expectEquivalent(o, r);
			} else if (o) {
				kept++;
				// Not converted: the accessors are the old fields, verbatim.
				expect(j(availableReleases(r))).toBe(j(r.status?.availableReleases));
				expect(j(releaseCandidates(r))).toBe(j(r.status?.releaseCandidates));
			}
		}
		expect(converted).toBeGreaterThan(0);
		expect(kept).toBeGreaterThan(0);
		// catalogue keys carry the same cluster stamp as the rollouts
		const r0 = body.rollouts.items.find((r: any) => r.spec?.releaseSourceRef);
		expect(r0.metadata.annotations['rollout-dashboard.kuberik.com/source-cluster']).toBeDefined();
	});

	it('a rollout whose writers produced candidate lists (promote, scenarios) round-trips too, incl. [] and gated subsets', () => {
		const v = (t: string, n: number) => ({ tag: t, version: t, revision: t, created: `2026-11-0${n}T00:00:00Z` });
		const A = [v('a', 1), v('b', 2), v('c', 3), v('d', 4), v('e', 5)];
		const mk = (cands: any[], gated: any[]) => ({
			metadata: { name: 'payments-core', namespace: 'x-prod', annotations: { 'rollout-dashboard.kuberik.com/source-cluster': 'c1' } },
			spec: { releasesRepository: { url: 'r' } },
			status: { currentVersion: 'b', history: [{ version: { tag: cands.length ? 'b' : 'e' } }], availableReleases: A, releaseCandidates: cands, gatedReleaseCandidates: gated }
		});
		const cases = [
			mk([A[4], A[3], A[2]], [A[3]]),
			mk([A[4], A[3], A[2]], []),
			mk([A[4], A[3], A[2]], [A[4], A[3], A[2]]),
			mk([], [])
		];
		for (const original of cases) {
			resetReleaseCatalogue();
			const { rollouts, sources, slices } = applySlicesMode(structuredClone([original]));
			ingestListResponse({ releaseSources: { items: sources }, releaseSlices: { items: slices } });
			expectEquivalent(original, rollouts[0]);
		}
	});
});
