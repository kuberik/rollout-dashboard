/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySlicesMode,
	canConvert,
	RELEASE_SOURCE_REQUIRED_MESSAGE,
	UNSOURCED_APPS
} from './mock-slices';
import { releaseSourceRequiredMessage } from '../releases/catalogue';
import { mockFleetRollouts } from './mock-data';
import { respond } from './respond';
import { getScenarioFleetRollouts, resetDemoState } from './state';
import { ingestListResponse } from '../releases/feed';
import {
	availableReleases,
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
	for (const f of OLD)
		expect(converted.status[f], `${original.metadata.name} still has ${f}`).toBeUndefined();
	expect(converted.spec.releaseSourceRef.name).toBeTruthy();
	expect(j(availableReleases(converted))).toBe(
		j(original.status.availableReleases?.length ? original.status.availableReleases : [])
	);
}

describe('mock release catalogue', () => {
	it('every sourced rollout is served without the old fields and reads its releases from slices', () => {
		const originals = structuredClone(mockFleetRollouts).filter((r: any) => canConvert(r));
		expect(originals.length).toBeGreaterThan(0);
		const { rollouts, sources, slices } = applySlicesMode(structuredClone(originals));
		ingestListResponse({ releaseSources: { items: sources }, releaseSlices: { items: slices } });
		rollouts.forEach((c, i) => expectEquivalent(originals[i], c));
	});

	it('served /api/rollouts: no rollout carries an old field; the unsourced app has no ref and the controller condition', () => {
		const body = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		ingestListResponse(body);
		let unsourced = 0;
		for (const r of body.rollouts.items) {
			for (const f of OLD)
				expect(r.status?.[f], `${r.metadata.name} still has ${f}`).toBeUndefined();
			if (UNSOURCED_APPS.has(r.metadata.name)) {
				unsourced++;
				expect(r.spec?.releaseSourceRef).toBeUndefined();
				expect(releaseSourceRequiredMessage(r)).toBe(RELEASE_SOURCE_REQUIRED_MESSAGE);
				expect(availableReleases(r)).toBeUndefined();
			} else {
				expect(r.spec?.releaseSourceRef?.name, r.metadata.name).toBeTruthy();
			}
		}
		expect(unsourced).toBeGreaterThan(0);
	});

	it('the detail GET is served in the same shape', () => {
		const sourced = (getScenarioFleetRollouts() as any[]).find((r) => canConvert(r));
		const body = JSON.parse(
			respond('GET', `/api/rollouts/${sourced.metadata.namespace}/${sourced.metadata.name}`).body ??
				'{}'
		);
		for (const f of OLD) expect(body.rollout?.status?.[f]).toBeUndefined();
	});

	it('a rollout whose writers produced candidate lists round-trips its catalogue, incl. empty ones', () => {
		const v = (t: string, n: number) => ({
			tag: t,
			version: t,
			revision: t,
			created: `2026-11-0${n}T00:00:00Z`
		});
		const A = [v('a', 1), v('b', 2), v('c', 3), v('d', 4), v('e', 5)];
		const original = {
			metadata: {
				name: 'payments-core',
				namespace: 'x-prod',
				annotations: { 'rollout-dashboard.kuberik.com/source-cluster': 'c1' }
			},
			spec: {},
			status: {
				currentVersion: 'b',
				history: [{ version: { tag: 'b' } }],
				availableReleases: A,
				releaseCandidates: [A[4], A[3], A[2]],
				gatedReleaseCandidates: [A[3]]
			}
		};
		const { rollouts, sources, slices } = applySlicesMode(structuredClone([original]) as any[]);
		ingestListResponse({ releaseSources: { items: sources }, releaseSlices: { items: slices } });
		expectEquivalent(original, rollouts[0]);
		expect(releaseCandidates(rollouts[0])?.map((c) => c.tag)).toEqual(['e', 'd', 'c']);
		const empty = applySlicesMode(
			structuredClone([
				{
					...original,
					metadata: { ...original.metadata, name: 'empty-app' },
					status: { history: [] }
				}
			] as any[])
		);
		ingestListResponse({
			releaseSources: { items: empty.sources },
			releaseSlices: { items: empty.slices }
		});
		expect(availableReleases(empty.rollouts[0])).toEqual([]);
	});
});
