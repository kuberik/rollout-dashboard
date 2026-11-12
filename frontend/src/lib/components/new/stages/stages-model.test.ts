import { describe, it, expect, afterEach } from 'vitest';
import { findChange, classified, countsOf, spineOf } from '../change/detail-model';
import { ago } from '../data';
import { respond } from '../../../demo/respond';
import { resetDemoState } from '../../../demo/state';
import { WAVES_STEPS } from '../../../demo/waves-story';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { stagesOf } from './stages-model';

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
});
