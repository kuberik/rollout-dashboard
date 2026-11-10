import { describe, it, expect } from 'vitest';
import * as D from './data';
import { rides, primaryKey, squaresSentence, pathOrder, spanLabel, placeShort, shortState } from './change-view';
import { rideTruth } from './change-truth';

const all = (s: 'incident' | 'calm' | 'quiet' = 'incident') => {
	const C = D.changes(s, { rolledBackLands: true });
	const R = D.rollouts(s);
	return { C, R, rs: rides(C.items.filter((i) => !i.rolledBack), R.rows, C.lead?.key ?? null, (c) => rideTruth(c, s)) };
};

describe('changes-7', () => {
	it('X12: #36 landed in eu-west before the failing build: not failing, no roll back', () => {
		const { rs } = all();
		const r = rs.find((x) => x.items.some((c) => c.key === 'invoice-api#36'))!;
		expect(r.state).toBe('landed');
		expect(rs.filter((x) => x.state === 'failed').some((x) => x.items.some((c) => c.key === 'invoice-api#36'))).toBe(false);
		expect(rs.find((x) => x.items.some((c) => c.key === 'invoice-api#37'))!.state).toBe('failed');
	});
	it('X12: exactly one primary among the stopped rides', () => {
		const { rs } = all();
		const stopped = rs.filter((r) => r.bucket === 'stopped');
		const failing = stopped.find((r) => r.state === 'failed')!;
		const k = primaryKey(stopped, failing.href);
		expect(stopped.filter((r) => r.key === k)).toHaveLength(1);
		expect(primaryKey(stopped, null)).toBeNull();
	});
	it('X14: a failing ride is aged from the tab row', () => {
		const { rs } = all();
		for (const r of rs.filter((x) => x.state === 'failed' && x.row?.since)) expect(Date.parse(r.since!)).toBeGreaterThanOrEqual(Date.parse(r.row!.since!) - 1);
	});
	it('X15: one sentence names every coloured square', () => {
		expect(squaresSentence(['failed', 'waiting', 'waiting'])).toBe('1 failing · 2 waiting');
		expect(squaresSentence(['failed', 'waiting', 'waiting'], true)).toBe('1 failing · 2 held');
		expect(squaresSentence(['healthy', 'healthy', 'behind'])).toBe('2 deployed');
		expect(squaresSentence(['behind'])).toBe('not reached');
	});
	it('X19: tiers in path order', () => {
		expect(pathOrder('Live in staging, test and dev')).toBe('Live in dev, test and staging');
		expect(pathOrder('Healthy in staging and dev')).toBe('Healthy in dev and staging');
		expect(pathOrder('Failing in eu-west')).toBe('Failing in eu-west');
	});
	it('X13: a group labels what it spans', () => {
		expect(spanLabel(10, 19)).toBe('10 changes · 19 held builds');
		expect(spanLabel(4, 1)).toBe('4 changes · 1 held build');
		expect(spanLabel(4, 0)).toBe('4 changes · 1 build');
	});
	it('X23a: short words carry the tab env name', () => {
		const { rs } = all();
		const r = rs.find((x) => x.state === 'failed' && x.href.includes('invoice-api-prod-eu-west'))!;
		expect(shortState(r.state, placeShort(r))).toBe('Failing · prod-eu-west');
	});
});
