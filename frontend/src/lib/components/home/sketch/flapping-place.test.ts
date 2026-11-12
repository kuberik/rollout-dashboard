import { describe, it, expect, afterEach } from 'vitest';
import { resetHomeModel, homeModel, ME } from './home-data';
import { buildSketch } from './sketch-home';
import type { HomeModel, AppEnv } from '$lib/view-models/home-model';

/**
 * Home's "Check flapping in <place>" names the place from the environment's typed row (the same placeName as every ask),
 * never by parsing the environment id: an environment called `production` must not read "uction" (QA73 nit 1), and a
 * `prod`-prefixed environment that is not a prod region must keep its own name.
 */
afterEach(() => resetHomeModel());
const flapIn = (
	env: Partial<AppEnv> & { env: string; label: string; isProdRegion: boolean }
): string => {
	const base = homeModel('incident');
	const app = base.apps[0];
	const row = { ...app.envs[0], ...env } as AppEnv;
	const m: HomeModel = {
		...base,
		apps: base.apps.map((a) => (a === app ? { ...a, envs: [...a.envs, row] } : a)),
		signals: [
			{
				key: 'flap-test',
				kind: 'check-flapping',
				app: app.app,
				env: env.env,
				phrase: 'smoke flips',
				facts: null,
				since: base.now,
				ageMs: 0
			} as HomeModel['signals'][number]
		]
	};
	const x = buildSketch(m, 'nobody-' + ME).elsewhere.find((e) => e.key === 'flap-test');
	expect(x, 'the flapping signal is listed').toBeDefined();
	return x!.status;
};

describe('Home flapping status names the place from the typed environment row', () => {
	it('an environment called "production" reads production, never "uction"', () => {
		expect(flapIn({ env: 'production', label: 'production', isProdRegion: false })).toBe(
			'Check flapping in production: smoke flips'
		);
	});
	it('a prod-prefixed environment that is not a prod region keeps its own name', () => {
		expect(flapIn({ env: 'product-x', label: 'product-x', isProdRegion: false })).toBe(
			'Check flapping in product-x: smoke flips'
		);
	});
	it('a prod region is said by its display name, as the asks say it', () => {
		expect(flapIn({ env: 'prod-zz-north', label: 'zz-north', isProdRegion: true })).toBe(
			'Check flapping in zz-north: smoke flips'
		);
	});
});
