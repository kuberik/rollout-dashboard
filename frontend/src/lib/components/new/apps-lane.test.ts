import { describe, it, expect } from 'vitest';
import { maskLane } from './apps-lane';

const node = (href: string, state: string, over: Record<string, unknown> = {}) =>
	({
		card: { href, ns: 'ns', name: 'x' },
		tier: 'dev',
		env: 'dev',
		state,
		behind: 0,
		...over
	}) as never;
const lane = (n: unknown) =>
	({ app: 'x', byTier: { dev: [n] }, stages: [n], prod: [], state: 'none', lead: n }) as never;
const app = (p: Record<string, unknown>) =>
	({ placeList: [{ href: '/h', state: 'healthy', currency: 'newest', ...p }] }) as never;

describe('maskLane: a no-release place is a none node WITH the flag', () => {
	it('a behind/newest node whose place has no releases becomes none + noReleases', () => {
		const l = maskLane(app({ currency: 'none' }), lane(node('/h', 'newest')));
		expect(l.stages[0].state).toBe('none');
		expect(l.stages[0].noReleases).toBe(true);
	});
	it('an already-none (pending) node gains the flag when its place has no releases', () => {
		expect(maskLane(app({ currency: 'none' }), lane(node('/h', 'none'))).stages[0].noReleases).toBe(
			true
		);
	});
	it('a pending none node whose place has releases stays unflagged', () => {
		expect(maskLane(app({}), lane(node('/h', 'none'))).stages[0].noReleases).toBeUndefined();
	});
});
