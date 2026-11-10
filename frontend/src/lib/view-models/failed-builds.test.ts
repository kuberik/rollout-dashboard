import { afterEach, describe, expect, it } from 'vitest';
import { behindOfRollout, behindOfStatus } from './behind';
import { promotionCandidates } from './promotion';
import { failedHere, liveOf } from './failed-builds';
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

describe('failed-builds helper (a wrapper over failedHereVerdict: the latest attempt)', () => {
	it('names a failed build by tag, version, full revision; a wave blocker names it by a short sha', () => {
		expect(failedHere(rolledBack, v46)).toBe(true);
		expect(failedHere(rolledBack, { version: '4.46.0-46' })).toBe(true);
		expect(failedHere(rolledBack, v45)).toBe(false);
		expect(failedHere({ history: [] }, v46, ['bbbbbbb'])).toBe(true);
	});
	it('all-digit tags never collide: 20261110 failed does not hide 20261111', () => {
		const st = { history: [{ bakeStatus: 'Failed', version: { tag: '20261110', revision: 'aaaaaaaaaaaa' } }] };
		expect(failedHere(st, { tag: '20261110' })).toBe(true);
		expect(failedHere(st, { tag: '20261111', revision: 'bbbbbbbbbbbb' })).toBe(false);
		expect(failedHere({ history: [] }, { tag: '20261111' }, ['2026111'])).toBe(false); /* a short sha only prefixes a revision, never a tag */
		expect(liveOf(st, [{ tag: '20261110' }, { tag: '20261111' }]).map((x) => x.tag)).toEqual(['20261111']);
	});
	it('a retried build that later succeeded counts normally', () => {
		const st = { history: [{ bakeStatus: 'Succeeded', version: v46 }, { bakeStatus: 'Failed', version: v46 }, { bakeStatus: 'Succeeded', version: v45 }] };
		expect(failedHere(st, v46)).toBe(false);
	});
});

describe("History's 'N behind' ignores a failed, rolled-back build", () => {
	it('a rolled-back place with only its failed build published is not behind', () => {
		expect(behindOfStatus({ status: rolledBack })).toBe(0);
		expect(behindOfRollout({ status: rolledBack })).toBe(0);
	});
	it('a genuinely newer build still counts beside it', () => {
		const v47 = { tag: 'b-47', version: '4.47.0-47', revision: 'ddddddd4444444' };
		expect(behindOfStatus({ status: { ...rolledBack, releaseCandidates: [v47, v46] } })).toBe(1);
	});
	it('the availableReleases fallback agrees', () => {
		const st = { currentVersion: 'b-45', availableReleases: [v45, v46], history: rolledBack.history };
		expect(behindOfStatus({ status: st })).toBe(0);
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

/* the controller keeps a failed build as a candidate; clearing a pin (or deploying it again) really redeploys it, so those surfaces must still list it */
describe('promotionCandidates is NOT filtered (clear-pin, auto-deploy, the rollout detail row still list the failed build)', () => {
	it('the failed, rolled-back build stays a promotion candidate', () => {
		const v47 = { tag: 'b-47', version: '4.47.0-47', revision: 'ddddddd4444444' };
		const ro = (cands: unknown[]) => ({ status: { ...rolledBack, availableReleases: [v45, v46, v47], releaseCandidates: cands } }) as never;
		expect(promotionCandidates(ro([v46])).map((c) => c.tag)).toEqual(['b-46']);
		expect(promotionCandidates(ro([v47, v46])).map((c) => c.tag)).toEqual(['b-47', 'b-46']);
	});
});
