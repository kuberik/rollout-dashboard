import { describe, it, expect, afterEach } from 'vitest';
import { findChange, classified, countsOf, spineOf, howFacts, envFull } from '../change/detail-model';
import { ago } from '../data';
import { respond } from '../../../demo/respond';
import { resetDemoState } from '../../../demo/state';
import { WAVES_STEPS } from '../../../demo/waves-story';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { stagesOf, releaseLine, narrowRollup, releasesInFlight, resolveRelease } from './stages-model';
import { placeHolds, noReleasesAt, placesOf, rowsOf, apps } from '../data';
import { ledgerOf } from '../app/app-model';

const SLUGS = ['github.com/exampleco/checkout-api/pull/80', 'github.com/exampleco/platform-telemetry/pull/20'];
const SCEN = ['incident', 'calm', 'quiet'] as const;
const shape = (slug: string, s: (typeof SCEN)[number]) => {
	const c = findChange(slug, s);
	if (!c) return null;
	const st = stagesOf({ kind: 'change', change: c }, s);
	return { cols: st.columns.map((x) => x.key), lanes: st.lanes.map((l) => ({ app: l.app, cells: l.cells.map((x) => x?.places.map((p) => p.href) ?? null) })) };
};

describe('stages model: the shape is topology, never state', () => {
	for (const slug of SLUGS) {
		it(`${slug}: columns, lanes and place order identical across incident/calm/quiet`, () => {
			const seen = SCEN.map((s) => shape(slug, s)).filter(Boolean);
			expect(seen.length).toBeGreaterThan(0);
			for (const x of seen) expect(x).toEqual(seen[0]);
		});
	}
	it('columns run tier (dev, test, staging, prod) then wave ascending', () => {
		const c = findChange(SLUGS[0], 'incident')!;
		const { columns } = stagesOf({ kind: 'change', change: c }, 'incident');
		const rank = { dev: 0, test: 1, staging: 2, prod: 3 } as Record<string, number>;
		for (let i = 1; i < columns.length; i++) {
			const a = columns[i - 1], b = columns[i];
			expect(rank[a.tier] < rank[b.tier] || (a.tier === b.tier && (a.wave ?? 0) <= (b.wave ?? 0))).toBe(true);
		}
	});
	it('a wave leader precedes its followers inside a cell', () => {
		const c = findChange(SLUGS[0], 'incident')!;
		for (const l of stagesOf({ kind: 'change', change: c }, 'incident').lanes) for (const cell of l.cells) {
			const flags = (cell?.places ?? []).map((p) => p.leader);
			expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
		}
	});
	for (const slug of SLUGS) for (const s of SCEN) {
		it(`${slug} (${s}): tile states agree with countsOf`, () => {
			const c = findChange(slug, s);
			if (!c) return;
			const cl = classified(c, s);
			const n = countsOf(cl.all, cl.places);
			const all = stagesOf({ kind: 'change', change: c }, s).lanes.flatMap((l) => l.cells.flatMap((x) => x?.places ?? []));
			const k = (st: string) => all.filter((p) => p.state === st).length;
			expect(all.length).toBe(cl.all.length);
			expect({ live: k('deployed'), checking: k('checking'), deploying: k('deploying'), waiting: k('approval'), held: k('held'), failing: k('failed') }).toEqual({ live: n.live, checking: n.checking, deploying: n.deploying, waiting: n.waiting, held: n.held, failing: n.failing });
		});
	}
});

describe('change-stages r2: one truth for ages and the hold clock', () => {
	it('a deployed tile ages from the instant History prints as First deployed', () => {
		const c = findChange(SLUGS[0], 'incident')!;
		const cl = classified(c, 'incident');
		const ev = spineOf(c, 'incident', cl.places);
		for (const l of stagesOf({ kind: 'change', change: c }, 'incident').lanes) for (const cell of l.cells) for (const p of cell?.places ?? []) {
			if (p.state !== 'deployed') continue;
			const first = ev.find((e) => e.words === 'First deployed' && e.places.some((x) => x.href === p.href));
			if (first) expect(p.age).toBe(ago(first.at));
		}
	});
	it('a hold never precedes the first deploy upstream; Released sits after the merge', () => {
		const c = findChange('github.com/exampleco/checkout-api/pull/83', 'incident');
		if (!c) return;
		const ev = spineOf(c, 'incident', classified(c, 'incident').places);
		const held = ev.find((e) => e.kind === 'held' || e.kind === 'waiting');
		const first = ev.find((e) => e.words === 'First deployed');
		if (held && first) expect(Date.parse(held.at!)).toBeGreaterThanOrEqual(Date.parse(first.at!));
		const rel = ev.find((e) => e.kind === 'released');
		if (rel) expect(Date.parse(rel.at!)).toBeGreaterThanOrEqual(Date.parse(c.mergedAt));
	});
});

describe('change-strip: hello-waves beats', () => {
	const shapeOf = (st: ReturnType<typeof stagesOf>) => ({ cols: st.columns.map((x) => x.key), cells: st.lanes.map((l) => l.cells.map((x) => x?.places.map((p) => p.href) ?? null)) });
	const flat = (st: ReturnType<typeof stagesOf>) => st.lanes.flatMap((l) => l.cells.flatMap((c) => c?.places ?? []));
	/* the waves-story helper: fire the beat, then install the demo API's rollouts as the live source (what waves-story.test.ts does) */
	const beat = (b: string) => {
		resetDemoState('incident');
		respond('GET', `/api/demo/waves?step=${b}`);
		const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
		installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
	};
	afterEach(() => installLiveSource(null));
	it('the hello-waves change: the shape is identical across every beat, only the states move', () => {
		const shapes: unknown[] = [], states = new Set<string>();
		for (const b of WAVES_STEPS) {
			beat(b);
			const c = findChange('github.com/exampleco/hello-waves/pull/21', 'incident');
			expect(c, b).toBeTruthy();
			const st = stagesOf({ kind: 'change', change: c! }, 'incident');
			shapes.push(shapeOf(st));
			flat(st).forEach((p) => states.add(p.state));
		}
		expect(shapes.length).toBeGreaterThan(2);
		for (const x of shapes) expect(x).toEqual(shapes[0]);
		expect(states.size).toBeGreaterThan(1);
	});
	it('QA strip r1 (2, 3): a mixed wave still reached production, and Summary agrees with History', () => {
		for (const b of WAVES_STEPS) {
			beat(b);
			const c = findChange('github.com/exampleco/hello-waves/pull/21', 'incident')!;
			const cl = classified(c, 'incident');
			const ev = spineOf(c, 'incident', cl.places);
			const how = howFacts(c, cl.places, cl.all, ev);
			const doneProd = flat(stagesOf({ kind: 'change', change: c }, 'incident')).filter((p) => p.tier === 'prod' && p.state === 'deployed').length;
			/* production is reached exactly when a prod site FINISHED deploying the change */
			expect(!!how.toProd, b).toBe(doneProd > 0);
			expect(ev.filter((e) => e.reachedProd).length, b).toBe(doneProd > 0 ? 1 : 0);
		}
		beat('wave1-half');
		const c = findChange('github.com/exampleco/hello-waves/pull/21', 'incident')!;
		const ev = spineOf(c, 'incident', classified(c, 'incident').places);
		expect(ev.find((e) => e.kind === 'moving' && e.tier === 'prod')?.words).toBe('Wave 1 deploying');
	});
	it('QA strip r1 (5): a prod site called "production" is the tier, never "prod-production"', () => {
		expect(envFull('prod', 'production')).toBe('prod');
		expect(envFull('prod', 'eu-west-1')).toBe('prod-eu-west-1');
	});
});

describe('app-pipeline: app scope (hello-waves-app)', () => {
	const APP = 'hello-waves-app';
	const flat = (st: ReturnType<typeof stagesOf>) => st.lanes.flatMap((l) => l.cells.flatMap((c) => c?.places ?? []));
	const beat = (b: string) => {
		resetDemoState('incident');
		respond('GET', `/api/demo/waves?step=${b}`);
		const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
		installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
	};
	afterEach(() => installLiveSource(null));
	const EXPECT: Record<string, string[]> = {
		arm: ['deployed', 'checking', 'notreached', 'notreached', 'notreached'],
		staging: ['deployed', 'deployed', 'notreached', 'notreached', 'notreached'],
		wave1: ['deployed', 'deployed', 'checking', 'deploying', 'notreached'],
		'wave1-half': ['deployed', 'deployed', 'deployed', 'deploying', 'notreached'],
		'wave1-done': ['deployed', 'deployed', 'deployed', 'deployed', 'notreached'],
		wave2: ['deployed', 'deployed', 'deployed', 'deployed', 'checking'],
		done: ['deployed', 'deployed', 'deployed', 'deployed', 'deployed']
	};
	it('tile and row keys are identical at every beat; the states per beat are the expected ones', () => {
		let keys: string[] | null = null;
		for (const b of WAVES_STEPS) {
			beat(b);
			const st = stagesOf({ kind: 'app', app: APP }, 'incident');
			const k = [...st.columns.map((c) => c.key), ...flat(st).map((p) => p.href)];
			keys ??= k;
			expect(k, b).toEqual(keys);
			expect(flat(st).map((p) => p.state), b).toEqual(EXPECT[b]);
			expect(flat(st).filter((p) => p.live).length, b).toBe(flat(st).some((p) => p.state === 'deploying' || p.state === 'checking') ? 1 : 0);
			/* a not-reached site prints the build it still runs; a site on the release prints none */
			for (const p of flat(st)) expect(!!p.build, `${b} ${p.href}`).toBe(p.state === 'notreached');
		}
	});
	it('the rollup "N of M places" is the Builds card\'s count, at every beat and in every scenario', () => {
		const check = (b: string, s: 'incident' | 'calm' | 'quiet') => {
			for (const app of ['hello-waves-app', 'checkout-api', 'orders-api', 'payments-core', 'recommender-svc']) {
				const places = placeHolds(app, s);
				if (!places.length) continue;
				const st = stagesOf({ kind: 'app', app }, s);
				const stops = ledgerOf(places);
				const total = places.filter((p) => !noReleasesAt(p.href)).length;
				const onNewest = stops[0] && !stops[0].custom ? stops[0].places.filter((p) => !noReleasesAt(p.href)).length : 0;
				const sel = stagesOf({ kind: 'app', app, release: stops[0]?.build }, s);
				if (!st.release) { expect(st.rollup.parts[0].text, `${b} ${s} ${app}`).toBe('No releases yet'); expect(releaseLine(app, s), `${b} ${s} ${app}`).toBeNull(); continue; }
				/* the newest selected: N = places on it at rest (the Builds card's count minus the ones still moving or failed there) */
				const n = Number(sel.rollup.parts[0].text.split(' ')[0]);
				expect(sel.rollup.parts[0].text, `${b} ${s} ${app}`).toBe(`${n} of ${total} place${total === 1 ? '' : 's'}`);
				expect(n, `${b} ${s} ${app}`).toBeLessThanOrEqual(onNewest);
			}
		};
		for (const b of WAVES_STEPS) { beat(b); check(b, 'incident'); }
		installLiveSource(null);
		for (const s of SCEN) check('mock', s);
	});
	it('a place moving a build that is NOT the release is quiet: no glow, not counted, its state as plain words', () => {
		installLiveSource(null);
		const st = stagesOf({ kind: 'app', app: 'checkout-api', release: ledgerOf(placeHolds('checkout-api', 'incident'))[0].build }, 'incident');
		const off = flat(st).filter((p) => p.word === 'Checking' || p.word === 'Deploying');
		expect(off.length).toBeGreaterThan(0);
		for (const p of off) {
			expect(p.state).toBe('notreached');
			expect(p.live).toBe(false);
			expect(p.build).toBeTruthy();
			expect(p.build).not.toBe(st.release);
		}
		expect(st.rollup.text).not.toMatch(/checking|deploying/);
		expect(flat(st).some((p) => p.live)).toBe(false);
	});
	it('truth: a place the rows mark held / approval, or whose env failed, is held / approval / failed in the Pipeline model (every app, incident and calm)', () => {
		installLiveSource(null);
		let seen = 0;
		for (const sc of ['incident', 'calm'] as const) for (const a of apps(sc).items) {
			/* the newest selected: no place is "ahead" of it (an ahead place is Deployed by rule) */
			const st = stagesOf({ kind: 'app', app: a.app, release: ledgerOf(placeHolds(a.app, sc).filter((p) => !noReleasesAt(p.href)))[0]?.build }, sc);
			for (const x of placesOf(sc, a.app)) {
				if (noReleasesAt(x.href)) continue;
				const mine = flat(st).find((p) => p.href === x.href)!;
				const row = rowsOf(sc, x.tier, x.label).find((r) => r.app === a.app && r.href === x.href);
				const want = x.state === 'failed' ? 'failed' : row?.group === 'approval' ? 'approval' : row?.group === 'held' ? 'held' : null;
				if (!want) continue;
				seen++;
				expect(mine.state, `${sc} ${a.app} ${x.href}`).toBe(want);
			}
		}
		expect(seen).toBeGreaterThan(0);
	});
	it('the release line names the selected stop (default: the lead)', () => {
		beat('arm');
		expect(releaseLine(APP, 'incident')?.build).toBe('c6f19d2');
		expect(releaseLine(APP, 'incident', 'c6f19d2')?.build).toBe('c6f19d2');
		expect(releaseLine(APP, 'incident', 'nope')?.build).toBe('c6f19d2');
	});
	it('narrow rollup: more than one adverse count folds checking + deploying into one "N in progress"; the unit never shortens', () => {
		beat('wave1');
		const st = stagesOf({ kind: 'app', app: APP }, 'incident');
		expect(st.rollup.text).toBe('2 of 5 places · 1 checking · 1 deploying');
		expect(st.narrow?.text).toBe('2 of 5 places · 2 in progress');
		expect(st.narrow?.parts.at(-1)?.ink).toBe('active');
		/* one adverse count: unchanged; held and failed stay separate */
		beat('wave1-half');
		expect(stagesOf({ kind: 'app', app: APP }, 'incident').narrow?.text).toBe('3 of 5 places · 1 deploying');
		const r = { text: '', parts: [{ text: '1 of 7 places', ink: 'muted' as const }, { text: '1 failing', ink: 'danger' as const }, { text: '1 checking', ink: 'progress' as const }, { text: '1 deploying', ink: 'active' as const }] };
		expect(narrowRollup(r, 2).parts.map((p) => p.text)).toEqual(['1 of 7 places', '1 failing', '2 in progress']);
	});
});

describe('pipeline release switcher', () => {
	afterEach(() => installLiveSource(null));
	const flat = (st: ReturnType<typeof stagesOf>) => st.lanes.flatMap((l) => l.cells.flatMap((c) => c?.places ?? []));
	const A = 'checkout-api';
	it('default = the oldest release not everywhere; rows run oldest first with the default tagged', () => {
		installLiveSource(null);
		const r = releasesInFlight(A, 'incident');
		expect(r.items.length).toBeGreaterThanOrEqual(2);
		expect(r.selectedDefault).toBe(r.items[0].build);
		expect(r.items.map((i) => i.oldest)).toEqual(r.items.map((_, i) => i === 0));
		const stops = ledgerOf(placeHolds(A, 'incident').filter((p) => !noReleasesAt(p.href)));
		const idx = r.items.map((i) => stops.find((s) => s.build === i.build)!.index as number);
		expect(idx).toEqual([...idx].sort((a, b) => b - a));
		expect(stagesOf({ kind: 'app', app: A }, 'incident').release).toBe(r.selectedDefault);
	});
	it('URL param: a valid stop selects it, unknown or none falls back to the default', () => {
		installLiveSource(null);
		const r = releasesInFlight(A, 'incident');
		const other = r.items[r.items.length - 1].build;
		expect(other).not.toBe(r.selectedDefault);
		expect(resolveRelease(A, 'incident', other)).toBe(other);
		expect(resolveRelease(A, 'incident', 'nope')).toBe(r.selectedDefault);
		expect(resolveRelease(A, 'incident', null)).toBe(r.selectedDefault);
		expect(resolveRelease(A, 'incident')).toBe(r.selectedDefault);
		expect(stagesOf({ kind: 'app', app: A, release: other }, 'incident').release).toBe(other);
		expect(stagesOf({ kind: 'app', app: A, release: 'nope' }, 'incident').release).toBe(r.selectedDefault);
	});
	it('reached by a newer build: Deployed "on <build>", counted in N, never live or not reached; live only for a place moving the selected build', () => {
		installLiveSource(null);
		const r = releasesInFlight(A, 'incident');
		const stops = ledgerOf(placeHolds(A, 'incident').filter((p) => !noReleasesAt(p.href)));
		let sawAhead = false;
		for (const it of r.items) {
			const st = stagesOf({ kind: 'app', app: A, release: it.build }, 'incident');
			const rel = stops.find((s) => s.build === it.build)!.index as number;
			const ps = flat(st);
			const hold = placeHolds(A, 'incident');
			for (const p of ps) {
				const h = hold.find((x) => x.href === p.href)!;
				const v = placesOf('incident', A).find((x) => x.href === p.href)!.version;
				const vi = stops.find((s) => s.build === v)?.index ?? null;
				void h;
				if (noReleasesAt(p.href)) continue;
				if (vi != null && vi < rel && p.state !== 'failed') {
					sawAhead = true;
					expect(p.ahead).toBe(true);
					expect(p.live).toBe(false);
					expect(p.build).toBe(v);
					expect(p.word).toBe('On');
					expect(['deployed', 'checking', 'deploying']).toContain(p.state);
				}
				if (p.live) expect(vi).toBe(rel);
			}
			const n = Number(st.rollup.parts[0].text.split(' ')[0]);
			const want = ps.filter((p) => { const v = placesOf('incident', A).find((x) => x.href === p.href)!.version; const vi = stops.find((s) => s.build === v)?.index ?? null; return vi != null && (vi < rel || (vi === rel && (p.state === 'deployed' || p.state === 'held' || p.state === 'approval'))); }).length;
			expect(n).toBe(want);
		}
		expect(sawAhead).toBe(true);
	});
	it('ahead in flight: a place checking a newer build draws its own mark, no glow, not in the in-flight counts, still reached', () => {
		installLiveSource(null);
		const st = stagesOf({ kind: 'app', app: A, release: '4.41.0-41' }, 'incident');
		const ah = flat(st).filter((p) => p.ahead && (p.state === 'checking' || p.state === 'deploying'));
		expect(ah.length).toBeGreaterThan(0);
		for (const p of ah) { expect(p.live).toBe(false); expect(p.build).toMatch(/^4\.\d/); expect(p.progress).toBeNull(); }
		expect(st.rollup.text).not.toMatch(/checking|deploying/);
		expect(flat(st).some((p) => p.live)).toBe(false);
	});
	it('0px shape: columns, lanes and places are identical across every release of an app', () => {
		installLiveSource(null);
		for (const app of [A, 'orders-api', 'payments-core', 'hello-waves-app']) {
			const r = releasesInFlight(app, 'incident');
			const shapes = [null, ...r.items.map((i) => i.build)].map((b) => { const st = stagesOf({ kind: 'app', app, release: b }, 'incident'); return { cols: st.columns.map((c) => c.key), lanes: st.lanes.map((l) => l.cells.map((c) => c?.places.map((p) => p.href) ?? null)) }; });
			for (const s of shapes) expect(s, app).toEqual(shapes[0]);
			if (r.items.length) { const t = r.items.map((i) => i.tiers.map((x) => `${x.tier}:${x.sites.length}`).join(',')); for (const x of t) expect(x).toBe(t[0]); }
		}
	});
	it('the rail is for 2+ releases in flight: hello-waves-app has at most one at every beat', () => {
		for (const b of WAVES_STEPS) {
			resetDemoState('incident');
			respond('GET', `/api/demo/waves?step=${b}`);
			const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
			const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
			installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
			expect(releasesInFlight('hello-waves-app', 'incident').items.length, b).toBeLessThanOrEqual(1);
		}
	});
});
