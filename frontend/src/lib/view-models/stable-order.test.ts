import { describe, expect, it } from 'vitest';
import { RetainedRows, StableOrder, stableOrder } from './stable-order';

const k = (s: string) => s;

describe('stableOrder', () => {
	it('takes the sorted order as-is the first time', () => {
		expect(stableOrder(null, ['held', 'b', 'c'], k)).toEqual(['held', 'b', 'c']);
	});

	it('keeps existing rows in place when the sort would move them', () => {
		// payments-svc's hold clears: the sort now puts it last — the page does not.
		expect(stableOrder(['pay', 'dev', 'id'], ['dev', 'id', 'pay'], k)).toEqual(['pay', 'dev', 'id']);
	});

	it('appends new rows at the end, in the sort\'s order, and drops removed ones', () => {
		expect(stableOrder(['a', 'b', 'c'], ['x', 'c', 'y', 'a'], k)).toEqual(['a', 'c', 'x', 'y']);
	});

	it('works on objects through the key function', () => {
		const rows = [{ key: 'b' }, { key: 'a' }];
		expect(stableOrder(['a', 'b'], rows, (r) => r.key)).toEqual([{ key: 'a' }, { key: 'b' }]);
	});
});

describe('StableOrder', () => {
	it('holds order across updates and re-sorts when the reset key changes', () => {
		const o = new StableOrder();
		expect(o.apply('ck/eu', ['eu', 'us1', 'us2'], k)).toEqual(['eu', 'us1', 'us2']);
		expect(o.apply('ck/eu', ['us1', 'us2', 'eu'], k)).toEqual(['eu', 'us1', 'us2']);
		// Navigation to another rollout: a fresh, sorted order.
		expect(o.apply('ck/us1', ['us1', 'us2', 'eu'], k)).toEqual(['us1', 'us2', 'eu']);
	});
});

describe('RetainedRows', () => {
	it('keeps a row that leaves, marked resolved, with its last data, in place', () => {
		const r = new RetainedRows<{ k: string; v: number }>();
		const key = (x: { k: string }) => x.k;
		expect(r.apply('p', [{ k: 'a', v: 1 }, { k: 'b', v: 1 }], key)).toEqual([
			{ row: { k: 'a', v: 1 }, resolved: false },
			{ row: { k: 'b', v: 1 }, resolved: false }
		]);
		// `a` clears; `c` appears.
		expect(r.apply('p', [{ k: 'b', v: 2 }, { k: 'c', v: 1 }], key)).toEqual([
			{ row: { k: 'a', v: 1 }, resolved: true },
			{ row: { k: 'b', v: 2 }, resolved: false },
			{ row: { k: 'c', v: 1 }, resolved: false }
		]);
		// `a` comes back: live again, same place.
		expect(r.apply('p', [{ k: 'a', v: 3 }], key).map((x) => [x.row.k, x.resolved])).toEqual([
			['a', false],
			['b', true],
			['c', true]
		]);
	});

	it('forgets resolved rows when the reset key changes', () => {
		const r = new RetainedRows<string>();
		r.apply('p', ['a', 'b'], (s) => s);
		expect(r.apply('q', ['b'], (s) => s)).toEqual([{ row: 'b', resolved: false }]);
	});
});
