import { describe, it, expect } from 'vitest';
import { getEnvironmentRank, sortEnvironmentNames } from './env-order';

describe('getEnvironmentRank — the nine controller names lead', () => {
	it.each([
		['dev', 0],
		['development', 0],
		['test', 2],
		['qa', 2],
		['staging', 4],
		['stage', 4],
		['preprod', 4],
		['prod', 7],
		['production', 7]
	])('%s ranks %i', (name, rank) => {
		expect(getEnvironmentRank(name)).toBe(rank);
	});

	it('ranks by the leading token, not by a substring further in', () => {
		expect(getEnvironmentRank('prod-test-1')).toBe(7);
		expect(getEnvironmentRank('prod-dev-eu')).toBe(7);
		expect(getEnvironmentRank('dev-prod')).toBe(0);
		expect(getEnvironmentRank('Staging.eu')).toBe(4);
	});

	it('still guesses legacy names by substring', () => {
		expect(getEnvironmentRank('eu-prod')).toBe(8);
		expect(getEnvironmentRank('my-qa-box')).toBe(3);
		expect(getEnvironmentRank('sandbox')).toBe(6);
		expect(getEnvironmentRank(undefined)).toBe(6);
	});

	it('sorts a mixed list in tier order', () => {
		expect(sortEnvironmentNames(['prod-test-1', 'qa', 'dev', 'stage'])).toEqual([
			'dev',
			'qa',
			'stage',
			'prod-test-1'
		]);
	});
});
