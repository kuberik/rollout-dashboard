import { describe, expect, it } from 'vitest';
import { newestFailureEvents } from './failure-currency';

const ev = (kind: string, href: string | null, at: string | null) => ({ kind, href, at });
describe('newestFailureEvents', () => {
	it('picks the newest failed event of each place; older failures and other kinds are history', () => {
		const old = ev('failed', '/a', '2026-11-16T08:00:00Z'), cur = ev('failed', '/a', '2026-11-16T10:00:00Z'), other = ev('failed', '/b', '2026-11-16T09:00:00Z');
		const got = newestFailureEvents([old, cur, ev('deploy', '/a', '2026-11-16T11:00:00Z'), other, ev('failed', null, '2026-11-16T12:00:00Z')]);
		expect([...got]).toEqual([cur, other]);
		expect(got.has(old)).toBe(false);
	});
	it('equal times: the first one seen is the current one, not the last', () => {
		const first = ev('failed', '/a', '2026-11-16T10:00:00Z'), second = ev('failed', '/a', '2026-11-16T10:00:00Z');
		const [a] = [...newestFailureEvents([first, second])];
		expect(a).toBe(first);
		const [b] = [...newestFailureEvents([second, first])];
		expect(b).toBe(second);
	});
	it('a failure with no time never beats a dated one, in either order', () => {
		const dated = ev('failed', '/a', '2026-11-16T10:00:00Z'), none = ev('failed', '/a', null);
		expect([...newestFailureEvents([none, dated])]).toEqual([dated]);
		expect([...newestFailureEvents([dated, none])]).toEqual([dated]);
	});
	it('a place whose failures all lack a time still has one current failure (the first)', () => {
		const a = ev('failed', '/a', null), b = ev('failed', '/a', null);
		expect([...newestFailureEvents([a, b])][0]).toBe(a);
	});
	it('an unparseable time counts as no time', () => {
		const bad = ev('failed', '/a', 'not a date'), dated = ev('failed', '/a', '2026-11-16T10:00:00Z');
		expect([...newestFailureEvents([bad, dated])]).toEqual([dated]);
	});
});
