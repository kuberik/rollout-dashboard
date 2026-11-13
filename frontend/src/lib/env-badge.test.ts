import { describe, expect, it } from 'vitest';
import { splitEnvName } from './env-badge';

/** the env badge is [tier][place]: identity on the left, a neutral place (a name or a count) on the right, never one coloured sentence */
describe('splitEnvName', () => {
	it('splits a named place after the first dash', () => {
		expect(splitEnvName('prod-eu-west')).toEqual({ tier: 'prod', place: 'eu-west' });
		expect(splitEnvName('staging')).toEqual({ tier: 'staging', place: null });
	});
	it('reads a folded set of regions as a count', () => {
		expect(splitEnvName('5 prod regions')).toEqual({ tier: 'prod', place: '5 regions' });
		expect(splitEnvName('1 prod region')).toEqual({ tier: 'prod', place: '1 region' });
	});
	it('reads a part of the set as the same count, not a tier word (visual audit #17)', () => {
		expect(splitEnvName('3 of 5 prod regions')).toEqual({ tier: 'prod', place: '3 of 5 regions' });
		expect(splitEnvName('3 of 5 prod regions').place).not.toMatch(/prod/i);
	});
});
