import { describe, it, expect } from 'vitest';
import { load } from './+page';

describe('/apps/<name>/pipeline redirects to /progress', () => {
	const go = (name: string, search: string) => {
		try {
			(load as unknown as (e: unknown) => void)({ params: { name }, url: new URL('https://x/apps/' + name + '/pipeline' + search) });
		} catch (r) {
			return r as { status: number; location: string };
		}
		throw new Error('no redirect');
	};
	it('308, keeps the release and calm params', () => {
		const r = go('checkout-api', '?release=4.44.0-44&calm=1');
		expect(r.status).toBe(308);
		expect(r.location).toBe('/apps/checkout-api/progress?release=4.44.0-44&calm=1');
	});
	it('no query: a bare target', () => expect(go('a b', '').location).toBe('/apps/a%20b/progress'));
});
