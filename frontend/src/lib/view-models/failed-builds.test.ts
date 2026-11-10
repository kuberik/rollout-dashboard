import { afterEach, describe, expect, it } from 'vitest';
import { behindOfRollout, behindOfStatus } from './behind';
import { promotionCandidates } from './promotion';
import { failedBuildKeys, failedHere } from './failed-builds';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { inbound, isArriving, placesOf } from '$lib/components/new/data';
import { environmentsPage } from '$lib/components/new/environments-page';

/**
 * batch4 #1. checkout-api 4.46.0-46 failed its bake in prod wave 1 (us-east-1), was rolled back to 4.45.0-45 and pinned; the release candidate
 * b-46 is still published. It is not behind, not arriving, not waiting while the place runs 4.45.0-45.
 */
const v45 = { tag: 'b-45', version: '4.45.0-45', revision: 'aaaaaaa1111111' };
const v46 = { tag: 'b-46', version: '4.46.0-46', revision: 'bbbbbbb2222222' };
const rolledBack = {
	currentVersion: 'b-45',
	releaseCandidates: [v46],
	history: [
		{ bakeStatus: 'Succeeded', version: v45 }, /* the rollback */
		{ bakeStatus: 'Failed', version: v46 },
		{ bakeStatus: 'Succeeded', version: v45 }
	]
};

describe('failed-builds helper', () => {
	it('names a failed build by tag, version and sha; a blocker revision counts too', () => {
		const f = failedBuildKeys(rolledBack.history);
		expect(failedHere(v46, f)).toBe(true);
		expect(failedHere('4.46.0-46', f)).toBe(true);
		expect(failedHere(v45, f)).toBe(false);
		expect(failedHere({ revision: 'ccccccc3333333' }, failedBuildKeys([], ['ccccccc3333333']))).toBe(true);
	});
});

describe("History's 'N behind' ignores a failed, rolled-back build", () => {
	it('a rolled-back place with only its failed build published is not behind', () => {
		expect(behindOfStatus(rolledBack)).toBe(0);
		expect(behindOfRollout({ status: rolledBack })).toBe(0);
	});
	it('a genuinely newer build still counts beside it', () => {
		const v47 = { tag: 'b-47', version: '4.47.0-47', revision: 'ddddddd4444444' };
		expect(behindOfStatus({ ...rolledBack, releaseCandidates: [v47, v46] })).toBe(1);
	});
	it('the availableReleases fallback agrees', () => {
		const st = { currentVersion: 'b-45', availableReleases: [v45, v46], history: rolledBack.history };
		expect(behindOfStatus(st)).toBe(0);
	});
});

describe('Environments: a failed, rolled-back build is not arriving', () => {
	afterEach(() => installLiveSource(null));
	it('billing-api: prod runs b17b002, b17b003 failed there and was rolled back: no inbound, tile counts 0 for it', () => {
		const fx = fixtureSource();
		const before = inbound('incident', 'prod').find((x) => x.app === 'billing-api');
		expect(before && isArriving(before), 'fixture: billing-api b17b003 arrives in prod').toBe(true);
		const prodHref = placesOf('incident', 'billing-api').find((p) => p.tier === 'prod')!.href;
		const [, , ns, name] = prodHref.split('/').filter(Boolean);
		const rollouts = (fx.rollouts as any[]).map((r) => {
			if (r.metadata.namespace !== ns || r.metadata.name !== name) return r;
			const [cur, ...rest] = r.status.history;
			const failed = { ...cur, bakeStatus: 'Failed', version: { ...cur.version, revision: 'b17b003aaaaaaaa', tag: 'b17b003', version: undefined } };
			return { ...r, status: { ...r.status, history: [cur, failed, ...rest] } };
		});
		installLiveSource({ ...fx, rollouts } as any);
		expect(inbound('incident', 'prod').find((x) => x.app === 'billing-api')).toBeUndefined();
		const after = environmentsPage('incident');
		const prod = after.prod!;
		expect(prod.arriving.builds).toBe(inbound('incident', 'prod').filter(isArriving).length);
	});
});

describe('the shared candidate set (held / waiting states read it)', () => {
	it('promotionCandidates drops the failed, rolled-back build and keeps a genuinely newer one', () => {
		const v47 = { tag: 'b-47', version: '4.47.0-47', revision: 'ddddddd4444444' };
		const ro = (cands: unknown[]) => ({ status: { ...rolledBack, availableReleases: [v45, v46, v47], releaseCandidates: cands } }) as never;
		expect(promotionCandidates(ro([v46]))).toEqual([]);
		expect(promotionCandidates(ro([v47, v46])).map((c) => c.tag)).toEqual(['b-47']);
	});
});
