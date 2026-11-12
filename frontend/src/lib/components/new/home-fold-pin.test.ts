import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { foldPinIntoFleet } from './home-page';
import { pinOnlyPlaces, rollouts } from './data';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { resetHomeModel } from '$lib/components/home/sketch/home-data';
import { installEdge, uninstallEdge } from '$lib/testing/edge-source';

/**
 * QA56 LOW-2. M6 (label dedupe in foldPinIntoFleet): through homePage a pinned label never already sits in heldRegions (pinOnlyPlaces skips places a row names),
 * so the fold is pinned directly here. M5 (askKeys/mineKeys as pinOnlyPlaces' skip): EQUIVALENT under the model. The skip set holds keys of rows' places
 * (asks are failed/approval rows, "yours" are rides over R.rows), and pinOnlyPlaces' own `rows.some(...)` already skips every place a row names, so the
 * property test below shows the skip never changes the answer on the incident fixture or on the incident fixture plus the edge apps.
 */
type By = Parameters<typeof foldPinIntoFleet>[0];
const pin = (label: string, tier = 'prod') => ({ app: 'checkout-api', tier, label, href: `/rollouts/${tier}/x-${label}/checkout-api`, key: `checkout-api@${tier}-${label}`, since: '2026-11-10T10:00:00Z' }) as never;
const held = (n: string) => ({ key: 'checkout-api|held', app: 'checkout-api', failing: false, mark: 'held' as const, word: 'Held' as const, href: `/rollouts/prod/${n}`, places: [{ tier: 'prod', place: '1 region' }], since: '2026-11-10T09:00:00Z' }) as never;

describe('foldPinIntoFleet: the app\'s held row names each pinned region once', () => {
	it('a pinned label the held rows already name does not count twice (M6)', () => {
		const regs = new Map([['checkout-api', new Map([['prod', ['eu-west']]])]]);
		const by: By = new Map([['checkout-api|held', held('a')]]);
		foldPinIntoFleet(by, regs, [pin('eu-west')]);
		expect(regs.get('checkout-api')!.get('prod')).toEqual(['eu-west']);
	});
	it('a new pinned label joins the named ones, in order', () => {
		const regs = new Map([['checkout-api', new Map([['prod', ['eu-west']]])]]);
		const by: By = new Map([['checkout-api|held', held('a')]]);
		foldPinIntoFleet(by, regs, [pin('us-east'), pin('us-east')]);
		expect(regs.get('checkout-api')!.get('prod')).toEqual(['eu-west', 'us-east']);
	});
});

describe('M5 is equivalent: the askKeys/mineKeys skip never changes pinOnlyPlaces', () => {
	afterEach(() => { installLiveSource(null); resetHomeModel(); uninstallEdge(); });
	const check = () => {
		const R = rollouts('incident');
		const apps = R.c.m.apps as never;
		const everyRowKey = new Set(R.rows.flatMap((r) => [r.key, ...r.regions.map((g) => `${r.app}@${r.tier}-${g}`)]));
		const plain = pinOnlyPlaces(apps, R.rows).map((p) => p.key);
		expect(pinOnlyPlaces(apps, R.rows, everyRowKey).map((p) => p.key)).toEqual(plain);
		return plain;
	};
	it('incident fixture', () => { resetHomeModel(); check(); });
	it('incident + home-edge apps', () => {
		installEdge();
		expect(check().length).toBeGreaterThan(0);
	});
});
