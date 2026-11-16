import { describe, it, expect } from 'vitest';
import { failureActs, failureActionOrder, failedRowAction, FAILED_ROW_SECONDARY, cardActs, attentionRank } from './failure-actions';

const retry = { k: 'retry' }, rollback = { k: 'rollback' }, open = { k: 'open' };
const keys = (xs: { k: string }[]) => xs.map((x) => x.k);

describe('failureActs', () => {
	it('recovered: Retry primary, Roll back first secondary, the rest after', () => {
		const a = failureActs(true, { retry, rollback, rest: [open] });
		expect(a.primary).toBe(retry);
		expect(keys(a.secondary)).toEqual(['rollback', 'open']);
	});
	it('failing now: Roll back primary, Retry the first secondary, printed AFTER the primary (a banner row prints secondaries first)', () => {
		const a = failureActs(false, { retry, rollback, rest: [open] });
		expect(a.primary).toBe(rollback);
		expect(keys(a.secondary)).toEqual(['retry', 'open']);
		expect(a.secondary[0]).toMatchObject({ k: 'retry', after: true });
	});
	it('recovered with no retry offered keeps Roll back primary; failing with no rollback has no primary', () => {
		expect(failureActs(true, { rollback, rest: [open] })).toEqual({ primary: rollback, secondary: [open] });
		expect(failureActs(false, { retry, rest: [open] }).primary).toBeUndefined();
	});
	it('the word order is Roll back, then Retry, whichever is the primary', () => {
		expect(failureActionOrder(true)).toEqual(['rollback', 'retry']);
		expect(failureActionOrder(false)).toEqual(['rollback', 'retry']);
	});
});

describe('failedRowAction (the palette row, also what Enter does)', () => {
	it('a failing row leads with Roll back (the rollout opens its dialog); Open logs is its secondary', () => {
		expect(failedRowAction(false, false)).toEqual({ label: 'Roll back', sub: undefined, query: 'action=rollback' });
		expect(failedRowAction(false, true)).toEqual({ label: 'Roll back', sub: undefined, query: 'action=rollback' });
		expect(FAILED_ROW_SECONDARY).toEqual({ label: 'Open logs', sub: 'logs' });
	});
	it('a recovered failure leads with Retry (the Overview, where its typed confirm lives)', () => {
		expect(failedRowAction(true, false)).toEqual({ label: 'Retry', sub: undefined });
	});
	it('on the Overview already, a recovered failure falls back to the logs (never a no-op)', () => {
		expect(failedRowAction(true, true)).toEqual({ label: 'Open logs', sub: 'logs' });
	});
});

describe('cardActs: the action set of a list card, per state', () => {
	const all = { rollback: true, retry: true, open: true, approve: true };
	it('failing now: Roll back is the one primary, then Open', () => {
		expect(cardActs({ ...all, state: 'failed', recovered: false, retry: false })).toEqual([{ key: 'rollback', primary: true }, { key: 'open', primary: false }]);
	});
	it('recovered: Roll back then Retry, both secondary, no primary at all', () => {
		const a = cardActs({ ...all, state: 'failed', recovered: true, open: false });
		expect(a).toEqual([{ key: 'rollback', primary: false }, { key: 'retry', primary: false }]);
		expect(a.some((x) => x.primary)).toBe(false);
	});
	it('approval: Approve primary, then Open', () => {
		expect(cardActs({ ...all, state: 'approval', recovered: false })).toEqual([{ key: 'approve', primary: true }, { key: 'open', primary: false }]);
	});
	it('an action the surface does not offer is skipped, and a card never has two primaries', () => {
		expect(cardActs({ state: 'failed', recovered: true, rollback: false, retry: true, open: false, approve: false })).toEqual([{ key: 'retry', primary: false }]);
		for (const state of ['failed', 'approval'] as const) for (const recovered of [false, true]) expect(cardActs({ ...all, state, recovered }).filter((x) => x.primary).length).toBeLessThanOrEqual(1);
	});
});

describe('attentionRank: failing now, then approvals, then recovered', () => {
	it('orders the three', () => {
		expect(attentionRank('failed', false)).toBeLessThan(attentionRank('approval', false));
		expect(attentionRank('approval', false)).toBeLessThan(attentionRank('failed', true));
	});
});
