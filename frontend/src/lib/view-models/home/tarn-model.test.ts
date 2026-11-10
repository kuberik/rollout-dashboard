import { describe, expect, it } from 'vitest';
import { buildHomeModel } from '../home-model';
import { homeInput, FIXTURE_NOW } from './fixture';
import { needs, watch } from './tarn-model';
import { buildLumenHome } from './lumen';

describe('needs(): each place acts on its own rollout', () => {
	it('two failing prod regions each roll back their own region, not the lead', () => {
		const m = buildHomeModel(homeInput());
		const app = m.apps.find((a) => a.app === 'invoice-api')!;
		const prod = app.envs.filter((e) => e.env === 'prod-eu-west' || e.env === 'prod-us-east');
		expect(prod.map((e) => [e.env, e.state])).toEqual([
			['prod-eu-west', 'failed'],
			['prod-us-east', 'awaiting-approval']
		]);
		// the fixture fails eu-west (the lead); fail us-east too
		prod[1].state = 'failed';

		const out = needs(m, FIXTURE_NOW, new Set(['invoice-api'])).filter(
			(n) => n.app === 'invoice-api' && n.kind === 'failed'
		);
		expect(out.map((n) => [n.kind, n.action.href])).toEqual([
			['failed', '/rollouts/prod/invoice-api-prod-eu-west/invoice-api'],
			['failed', '/rollouts/prod/invoice-api-prod-us-east/invoice-api']
		]);
		for (const e of prod)
			expect(out.find((n) => n.key === `invoice-api|${e.env}`)!.action.href).toBe(e.href);
	});

	it('uses the rollout card href, not a name guessed from app and env', () => {
		const m = buildHomeModel(homeInput());
		const app = m.apps.find((a) => a.app === 'hello-frontend-app')!;
		const prod = app.envs.find((e) => e.env === 'prod')!;
		expect(prod.state).toBe('failed');
		const [n] = needs(m, FIXTURE_NOW, new Set(['hello-frontend-app'])).filter(
			(x) => x.app === 'hello-frontend-app'
		);
		expect(n.action.href).toBe('/rollouts/prod/hello-dep-prod/hello-frontend-app');
	});
});

describe('watch(): a failed-deploy signal', () => {
	/** an edge-mesh slow-bake signal (its dev bake moved 75m back, past its 60m
	 *  spec.bakeTime; the fixture's own bake is on schedule), turned into a failed deploy */
	function withFailedSignal() {
		const input = homeInput();
		input.rollouts = structuredClone(input.rollouts);
		const r = input.rollouts.find(
			(x) => x.metadata?.namespace === 'edge-mesh-dev' && x.metadata?.name === 'edge-mesh'
		)!;
		const h = r.status!.history![0];
		h.bakeStartTime = h.timestamp = new Date(input.now.getTime() - 75 * 60e3).toISOString();
		const m = buildHomeModel(input);
		const i = m.signals.findIndex((s) => s.app === 'edge-mesh' && s.kind === 'slow-bake');
		expect(i).toBeGreaterThanOrEqual(0);
		m.signals[i] = {
			...m.signals[i],
			kind: 'failed',
			facts: { kind: 'failed', failure: 'deploy' }
		};
		return { m, key: m.signals[i].key };
	}

	it('is kind failed at failure severity, not checking', () => {
		const { m, key } = withFailedSignal();
		const w = watch(m, FIXTURE_NOW, new Set()).find((x) => x.key === key)!;
		expect([w.kind, w.sev]).toEqual(['failed', 0]);
	});

	it('reads "failing" in the Watch line', () => {
		const { m, key } = withFailedSignal();
		const w = buildLumenHome(m, FIXTURE_NOW).watch.find((x) => x.key === key)!;
		expect(w.kindWord).toBe('failing');
	});
});

describe('every rollout link is a real rollout, never a guessed name', () => {
	const input = homeInput();
	const real = new Set(input.rollouts.map((r) => `${r.metadata?.namespace}/${r.metadata?.name}`));
	const rolloutLinks = (v: unknown, out: string[] = []): string[] => {
		if (Array.isArray(v)) v.forEach((x) => rolloutLinks(x, out));
		else if (v && typeof v === 'object')
			for (const [k, x] of Object.entries(v)) {
				if (typeof x === 'string' && /href$/i.test(k) && x.startsWith('/rollouts/')) out.push(x);
				else rolloutLinks(x, out);
			}
		return out;
	};

	it('every AppEnv.href names its own rollout', () => {
		const m = buildHomeModel(input);
		const envs = m.apps.flatMap((a) => a.envs);
		expect(envs.length).toBeGreaterThan(10);
		for (const e of envs) {
			const [, , , ns, name] = e.href.split('/').map(decodeURIComponent);
			expect(real.has(`${ns}/${name}`), e.href).toBe(true);
		}
	});

	it('every rollout link on the Home page model is a real rollout (every app starred)', () => {
		const m = buildHomeModel(input);
		const home = buildLumenHome(m, FIXTURE_NOW, { starredApps: new Set(m.apps.map((a) => a.app)) });
		const links = rolloutLinks(home);
		expect(links.length).toBeGreaterThan(5);
		for (const l of links) {
			const [, , , ns, name] = l.split('/').map(decodeURIComponent);
			expect(real.has(`${ns}/${name}`), l).toBe(true);
		}
	});

	it('a place whose namespace breaks the <app>-<env> convention links to its own rollout', () => {
		const m = buildHomeModel(input);
		const e = m.apps
			.find((a) => a.app === 'hello-frontend-app')!
			.envs.find((x) => x.env === 'prod')!;
		expect(e.href).toBe('/rollouts/prod/hello-dep-prod/hello-frontend-app');
		const home = buildLumenHome(m, FIXTURE_NOW, { starredApps: new Set(['hello-frontend-app']) });
		const w = home.watch.filter((x) => x.app === 'hello-frontend-app');
		for (const x of w) expect(x.href).not.toMatch(/hello-frontend-app-prod/);
	});
});

describe('app and activity links are finished hrefs', () => {
	it('every app link is /apps/<encoded name>', () => {
		const m = buildHomeModel(homeInput());
		const home = buildLumenHome(m, FIXTURE_NOW, { starredApps: new Set(m.apps.map((a) => a.app)) });
		const appLinks = [
			...m.apps.map((a) => [a.app, a.href]),
			...home.needs.map((n) => [n.app, n.appHref]),
			...home.busy.map((g) => [g.app, g.appHref]),
			...home.watch.map((w) => [w.app, w.appHref]),
			...home.rolling.map((r) => [r.app, r.appHref]),
			...home.quiet.map((q) => [q.app, q.appHref])
		];
		expect(appLinks.length).toBeGreaterThan(5);
		for (const [app, href] of appLinks) expect(href).toBe(`/apps/${encodeURIComponent(app)}`);
		expect(home.watchMoreHref).toBe('/activity');
	});

	it('a held Watch line lists its places as data, and `place` is them joined', () => {
		const home = buildLumenHome(buildHomeModel(homeInput()), FIXTURE_NOW, {
			starredApps: new Set()
		});
		for (const w of home.watch) {
			expect(w.places.length).toBeGreaterThan(0);
			expect(w.place).toBe(w.places.join(', '));
		}
	});
});
