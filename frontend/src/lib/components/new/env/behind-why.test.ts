import { describe, it, expect } from 'vitest';
import { behindWhy, envPage } from './env-page';
import { placeHolds } from '../data';

describe('a Behind row says why from the lagging place\'s own tab data', () => {
	it('"nothing inbound" only when the place\'s Newer builds list is empty', () => {
		expect(behindWhy({ heldBuilds: [], holdReason: null })).toBe('nothing inbound');
		expect(behindWhy(null)).toBe('nothing inbound');
	});
	it('a list with builds says how many it offers; held on a check says so', () => {
		expect(behindWhy({ heldBuilds: [{}], holdReason: null })).toBe('1 to deploy');
		expect(behindWhy({ heldBuilds: [{}, {}], holdReason: 'health' })).toBe('2 waiting on a check');
	});
	it('hello-world /envs/dev (incident): its tab lists e2c9b47, so the row never says "nothing inbound"', () => {
		const dev = placeHolds('hello-world', 'incident').find((p) => p.tier === 'dev')!;
		expect(dev.heldBuilds.length).toBe(1);
		const b = envPage('incident', 'dev')!.gangway.behind.find((x) => x.app === 'hello-world')!;
		expect(b.why).toBe('1 to deploy');
		expect(b.why).not.toMatch(/nothing inbound/);
	});
});
