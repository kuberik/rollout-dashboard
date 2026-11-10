import { expect, it } from 'vitest';
import { prodCountPhrase } from './regions';

it('prod count says regions only across more than one site (QA2)', () => {
	expect(prodCountPhrase(['prod', 'production', 'prod'], null)).toBe('3 prod');
	expect(prodCountPhrase(['prod', 'prod'], [1])).toBe('1 of 2 prod');
	expect(prodCountPhrase(['prod-us-east-1', 'prod-eu-west-1', 'prod-ap-1'], null)).toBe('3 regions');
	expect(prodCountPhrase(['prod-us-east-1', 'prod-eu-west-1', 'prod-ap-1'], [1])).toBe('1 of 3 regions');
});
