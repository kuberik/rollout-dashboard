import { describe, expect, it } from 'vitest';
import { kApp } from './kstairs';
import type { Lane, LaneNode } from './promotion-lanes';

const node = (env: string, state: string): LaneNode => ({ card: { version: 'abc1234' } as never, tier: 'prod', env, state: state as never, behind: 0 });
const lane = (prod: LaneNode[]): Lane => ({ app: 'a', byTier: {}, stages: [], prod, state: prod[0].state, lead: prod[0] });

describe('kstairs prod phrase counts SITES, not entries (QA2)', () => {
	it('several prod entries on the default site never print "regions"', () => {
		const m = kApp(lane([node('prod', 'failed'), node('production', 'failed'), node('prod', 'failed')]), () => false);
		expect(m.phrase?.text).not.toMatch(/regions/);
	});
	it('entries on distinct named sites do', () => {
		const m = kApp(lane([node('prod-us-east-1', 'failed'), node('prod-eu-west-1', 'failed')]), () => false);
		expect(m.phrase?.text).toBe('failed in 2 prod regions');
	});
});
