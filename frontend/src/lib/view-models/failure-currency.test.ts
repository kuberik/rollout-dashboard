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
});
