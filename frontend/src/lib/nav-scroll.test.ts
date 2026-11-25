import { describe, expect, it } from 'vitest';
import { isQueryOnlyNavigation } from './nav-scroll';

const u = (s: string) => ({ url: new URL(s, 'https://k.test') });

describe('isQueryOnlyNavigation', () => {
	it('is true when only the query of the same path changes (filter goto)', () => {
		expect(isQueryOnlyNavigation({ type: 'goto', from: u('/rollouts'), to: u('/rollouts?state=held') })).toBe(true);
		expect(isQueryOnlyNavigation({ type: 'goto', from: u('/rollouts?ns!=a'), to: u('/rollouts?ns!=a,b&q=api') })).toBe(true);
		expect(isQueryOnlyNavigation({ type: 'link', from: u('/activity?kind=failed'), to: u('/activity') })).toBe(true);
	});
	it('is false for a different path', () => {
		expect(isQueryOnlyNavigation({ type: 'goto', from: u('/rollouts'), to: u('/activity') })).toBe(false);
		expect(isQueryOnlyNavigation({ type: 'link', from: u('/rollouts/ns/a'), to: u('/rollouts/ns/b') })).toBe(false);
	});
	it('is false for back/forward and first load', () => {
		expect(isQueryOnlyNavigation({ type: 'popstate', from: u('/rollouts'), to: u('/rollouts?state=held') })).toBe(false);
		expect(isQueryOnlyNavigation({ type: 'enter', from: null, to: u('/rollouts') })).toBe(false);
	});
});
