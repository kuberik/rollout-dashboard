import { describe, it, expect } from 'vitest';
import { apps, rollouts, newestBuild, runsIn, noReleasesAt } from './data';
import { envPage } from './env/env-page';
import { restCurrency, currencyOf } from './app/app-model';

/* One order, one newest, on the mock (home-incident data): "Newest" and "N behind" are read off the release catalogue, by every surface. */
const item = (app: string) => apps('incident').items.find((a) => a.app === app)!;

describe('standalone-api in prod: held by a dependency gate that allows only s-10, 2 behind in the catalogue (s-11, s-12)', () => {
	it('is not on its newest build: the tile says 2 behind', () => {
		const a = item('standalone-api');
		expect(a.newest).toBe('1.12.0-12');
		expect(a.behind?.n).toBe(2);
		expect(a.placeList.map((p) => [p.version, p.onNewest, p.behind])).toEqual([['1.10.0-10', false, 2]]);
	});
	it('/envs/prod does NOT list it In step, and DOES list it as held', () => {
		const G = envPage('incident', 'prod')!.gangway;
		expect(G.inStep.map((x) => x.app)).not.toContain('standalone-api');
		expect(G.held.map((x) => x.app)).toContain('standalone-api');
		expect(G.behind.map((x) => x.app)).not.toContain('standalone-api');
	});
	it('the rollout page\'s newest-build line and the Gates tab read the same 2', () => {
		const row = rollouts('incident').rows.find((r) => r.app === 'standalone-api')!;
		const nb = newestBuild(row);
		expect(nb?.count).toBe(2);
		expect(nb?.newest).toBe('1.12.0-12');
		expect(runsIn('standalone-api', 'incident').map((r) => r.word)).toEqual(['2 behind']);
	});
	it('the tile\'s rest currency is measured against the catalogue: every place on one build, and the catalogue has newer ones, is not "Up to date"', () => {
		const a = item('standalone-api');
		expect(restCurrency(a.placeList, a.placeList[0].href, a.app)).toBe('2 builds behind');
		expect(currencyOf(a.placeList[0].href, a.app).word).toBe('2 builds behind');
	});
});

describe('/envs/<env> and the /apps tile say the same thing about an app that lags', () => {
	it('"Ready to promote" on the tile is exactly the app listed under Ready to promote on /envs/<env>; otherwise the tile says Behind and /envs lists it under Behind or Held', () => {
		for (const tier of ['dev', 'test', 'staging', 'prod'] as const) {
			const G = envPage('incident', tier)!.gangway;
			for (const a of apps('incident').items) {
				const m = /^Ready to promote to (\w+)/.exec(a.fact);
				const b = /^Behind in (\w+)/.exec(a.fact);
				if (m && m[1] === tier) expect(G.ready.map((x) => x.app), `${a.app} in ${tier}`).toContain(a.app);
				if (b && b[1] === tier) expect(G.ready.map((x) => x.app), `${a.app} in ${tier}`).not.toContain(a.app);
			}
		}
	});
	it('a Behind row names the lagging place and links to its rollout', () => {
		for (const tier of ['dev', 'test', 'staging', 'prod'] as const)
			for (const b of envPage('incident', tier)!.gangway.behind) {
				expect(b.href, b.app).toMatch(/^\/rollouts\//);
				expect(b.n).toBeGreaterThan(0);
			}
	});
});

describe('no release = not affected', () => {
	it('a place without releases reads no lag word on the Gates tab', () => {
		for (const a of apps('incident').items) for (const r of runsIn(a.app, 'incident')) if (noReleasesAt(r.href)) expect(r.word, a.app).toBe('');
	});
});
