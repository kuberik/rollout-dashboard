import { describe, it, expect } from 'vitest';
import { pinHoldsBuilds } from '$lib/view-models/pin-hold';
import { heldUnion, heldBanner } from './data';
import { causeLine } from './app/app-model';

/** Pins down four rules the count/banner code could silently lose: each test fails when its rule is removed. */

const card = (rank: unknown, extra: Record<string, unknown> = {}) =>
	({ pinnedVersion: '1.2.3', statusKey: 'succeeded', stuck: null, checkFailure: null, rank, ...extra }) as never;

describe('pinHoldsBuilds: a pin holds only when newer builds exist', () => {
	it('a pinned place that already runs the newest build holds nothing', () => {
		expect(pinHoldsBuilds(card({ kind: 'newest' }))).toBe(false);
	});
	it('a pinned place behind newer builds holds them', () => {
		expect(pinHoldsBuilds(card({ kind: 'behind', by: 2 }))).toBe(true);
	});
	it('an unpinned place holds nothing', () => {
		expect(pinHoldsBuilds(card({ kind: 'behind', by: 2 }, { pinnedVersion: null }))).toBe(false);
	});
});

const place = (label: string, tier: string, state: string, pinned = false) => ({ label, tier, state, pinned }) as never;

describe('heldUnion: every cause counts, approvals included', () => {
	it('a place waiting for approval is held, beside the one a rule holds', () => {
		const u = heldUnion({ placeList: [place('us-east', 'prod', 'awaiting-approval'), place('eu-west', 'prod', 'held-by-rule'), place('dev', 'dev', 'healthy')] })!;
		expect(u.count).toBe(2);
		expect(u.sentence).toBe('Held in 2 prod regions');
	});
	it('a place only the pin holds counts with them', () => {
		expect(heldUnion({ placeList: [place('us-east', 'prod', 'awaiting-approval'), place('af', 'prod', 'rolled-back', true)] })!.count).toBe(2);
	});
});

const h = (text: string) => ({ text, parts: [text] });
describe('heldBanner: a headline of its own only when more than one cause holds the app', () => {
	const list = { placeList: [place('us-east', 'prod', 'awaiting-approval'), place('eu-west', 'prod', 'held-by-rule')] };
	it('one cause: null, that cause\'s own sentence is the headline', () => {
		expect(heldBanner(list, [h('Waits on payments-svc'), h('Waits on payments-svc')])).toBeNull();
	});
	it('two causes: the union headline and each cause once', () => {
		expect(heldBanner(list, [h('Waits on payments-svc'), h('Pinned to 1.0'), h('Pinned to 1.0')])).toEqual({ title: 'Held in 2 prod regions', message: ['Waits on payments-svc · Pinned to 1.0'] });
	});
});

describe('causeLine: the app page banner says the lead once', () => {
	it('drops a part that repeats the lead', () => {
		expect(causeLine(['Held by X in prod', 'Held by X in prod', 'Pinned to 1.0'])).toBe('Pinned to 1.0');
	});
	it('null when nothing new is left', () => {
		expect(causeLine(['Held by X in prod', 'Held by X in prod'])).toBeNull();
		expect(causeLine(['Held by X in prod'])).toBeNull();
	});
});
