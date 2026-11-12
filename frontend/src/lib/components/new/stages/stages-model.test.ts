import { describe, it, expect, afterEach } from 'vitest';
import { findChange, classified, countsOf, spineOf, howFacts, envFull } from '../change/detail-model';
import { ago } from '../data';
import { respond } from '../../../demo/respond';
import { resetDemoState } from '../../../demo/state';
import { WAVES_STEPS } from '../../../demo/waves-story';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { stagesOf, releaseCommits, releaseLine, narrowRollup } from './stages-model';
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
			for (const app of ['hello-waves-app', 'checkout-api', 'orders-api', 'payments-core']) {
				const places = placeHolds(app, s);
				if (!places.length) continue;
				const st = stagesOf({ kind: 'app', app }, s);
				const stops = ledgerOf(places);
				const total = places.filter((p) => !noReleasesAt(p.href)).length;
				const onNewest = stops[0] && !stops[0].custom ? stops[0].places.filter((p) => !noReleasesAt(p.href)).length : 0;
				if (!st.release) { expect(st.rollup.parts[0].text, `${b} ${s} ${app}`).toBe('No releases'); continue; }
				expect(st.rollup.parts[0].text, `${b} ${s} ${app}`).toBe(`${onNewest} of ${total} place${total === 1 ? '' : 's'}`);
			}
		};
		for (const b of WAVES_STEPS) { beat(b); check(b, 'incident'); }
		installLiveSource(null);
		for (const s of SCEN) check('mock', s);
	});
	it('a place moving a build that is NOT the release is quiet: no glow, not counted, its state as plain words', () => {
		installLiveSource(null);
		const st = stagesOf({ kind: 'app', app: 'checkout-api' }, 'incident');
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
			const st = stagesOf({ kind: 'app', app: a.app }, sc);
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
	it('In this release: rows are the builds between prod and the release; empty once every place runs it; the line names the release', () => {
		beat('arm');
		const r = releaseCommits(APP, 'incident');
		expect(r.status).toBe('ready');
		expect(r.release).toBe('c6f19d2');
		expect(r.base).toBe('0f1f88a');
		expect(r.commits.map((c) => c.sha)).toEqual(['c6f19d2']);
		expect(releaseLine(APP, 'incident')?.build).toBe('c6f19d2');
		beat('done');
		expect(releaseCommits(APP, 'incident')).toMatchObject({ status: 'empty', release: 'c6f19d2', commits: [] });
		installLiveSource(null);
		const ck = releaseCommits('checkout-api', 'incident');
		expect(ck.status).toBe('ready');
		expect(ck.commits.length).toBeGreaterThan(1);
		expect(ck.commits[0].sha).toBe(releaseLine('checkout-api', 'incident')?.build);
	});
	it('narrow rollup: more than one adverse count folds checking + deploying into one "N in progress"; the unit never shortens', () => {
		beat('wave1');
		const st = stagesOf({ kind: 'app', app: APP }, 'incident');
		expect(st.rollup.text).toBe('4 of 5 places · 1 checking · 1 deploying');
		expect(st.narrow?.text).toBe('4 of 5 places · 2 in progress');
		expect(st.narrow?.parts.at(-1)?.ink).toBe('active');
		/* one adverse count: unchanged; held and failed stay separate */
		beat('wave1-half');
		expect(stagesOf({ kind: 'app', app: APP }, 'incident').narrow?.text).toBe('4 of 5 places · 1 deploying');
		const r = { text: '', parts: [{ text: '1 of 7 places', ink: 'muted' as const }, { text: '1 failing', ink: 'danger' as const }, { text: '1 checking', ink: 'progress' as const }, { text: '1 deploying', ink: 'active' as const }] };
		expect(narrowRollup(r, 2).parts.map((p) => p.text)).toEqual(['1 of 7 places', '1 failing', '2 in progress']);
	});
});
