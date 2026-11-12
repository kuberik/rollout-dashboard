import { afterEach, describe, expect, it } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import * as D from '$lib/components/new/data';
import { commitsOf } from '$lib/components/new/change/detail-model';
import { WAVES_STEPS } from './waves-story';
import type { Environment, Rollout } from '../../types';

/**
 * `/api/demo/waves?step=` — the stepped sites-and-waves story for hello-waves (waves-story.ts):
 * each beat's per-site build and bake, the promotion gate holding prod while staging bakes, and the
 * change (exampleco/hello-waves PR #21, c6f19d2) resolving on the changes list with a change page.
 */
const get = (q: string) => respond('GET', `/api/demo/waves${q}`);
const list = () => {
	const b = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	return { rollouts: b.rollouts.items as Rollout[], environments: b.environments.items as Environment[], deps: b.rolloutDependencies };
};
const SITES: Record<string, string> = {
	dev: 'hello-waves-dev',
	staging: 'hello-waves-staging',
	'eu-west-1': 'hello-waves-prod-eu-west-1',
	'us-east-1': 'hello-waves-prod-us-east-1',
	'ap-south-1': 'hello-waves-prod-ap-south-1'
};
const site = (k: string) => {
	const r = list().rollouts.find((x) => x.metadata?.namespace === SITES[k] && x.metadata?.name === 'hello-waves-app')!;
	const h = r.status!.history![0];
	return { tag: h.version.tag, bake: h.bakeStatus, msg: h.bakeStatusMessage, gates: r.status!.gates as { passing?: boolean }[] };
};
const NEW = 'c6f19d2';
const OLD = '0f1f88a';
const OK = 'Succeeded';

afterEach(() => installLiveSource(null));

describe('waves story', () => {
	it('reports no beat before one is fired, and rejects unknown beats', () => {
		resetDemoState('calm');
		expect(JSON.parse(get('').body!)).toMatchObject({ step: null });
		expect(get('?step=nope').status).toBe(400);
		// the calm scenario is untouched: every site Succeeded on c6f19d2
		for (const k of Object.keys(SITES)) expect(site(k)).toMatchObject({ tag: NEW, bake: OK });
	});

	const BEATS: Record<string, Record<string, [string, string]>> = {
		arm: { dev: [NEW, OK], staging: [NEW, 'InProgress'], 'eu-west-1': [OLD, OK], 'us-east-1': [OLD, OK], 'ap-south-1': [OLD, OK] },
		staging: { dev: [NEW, OK], staging: [NEW, OK], 'eu-west-1': [OLD, OK], 'us-east-1': [OLD, OK], 'ap-south-1': [OLD, OK] },
		wave1: { dev: [NEW, OK], staging: [NEW, OK], 'eu-west-1': [NEW, 'InProgress'], 'us-east-1': [NEW, 'Deploying'], 'ap-south-1': [OLD, OK] },
		'wave1-done': { dev: [NEW, OK], staging: [NEW, OK], 'eu-west-1': [NEW, OK], 'us-east-1': [NEW, OK], 'ap-south-1': [OLD, OK] },
		wave2: { dev: [NEW, OK], staging: [NEW, OK], 'eu-west-1': [NEW, OK], 'us-east-1': [NEW, OK], 'ap-south-1': [NEW, 'InProgress'] },
		done: { dev: [NEW, OK], staging: [NEW, OK], 'eu-west-1': [NEW, OK], 'us-east-1': [NEW, OK], 'ap-south-1': [NEW, OK] }
	};
	it('has exactly the documented beats', () => expect([...WAVES_STEPS]).toEqual(Object.keys(BEATS)));
	for (const [beat, want] of Object.entries(BEATS)) {
		it(`beat ${beat}: per-site build and bake`, () => {
			resetDemoState('calm');
			expect(get(`?step=${beat}`).status).toBe(200);
			expect(JSON.parse(get('').body!).step).toBe(beat);
			for (const [k, [tag, bake]] of Object.entries(want)) expect(site(k), `${beat} ${k}`).toMatchObject({ tag, bake });
		});
	}

	it('InProgress bakes read "checking"; prod is held by its promotion gate while staging bakes', () => {
		resetDemoState('calm');
		get('?step=arm');
		expect(site('staging').msg).toBe('checking');
		for (const k of ['eu-west-1', 'us-east-1', 'ap-south-1']) expect(site(k).gates.some((g) => g.passing === false), k).toBe(true);
		get('?step=staging');
		expect(site('eu-west-1').gates.every((g) => g.passing !== false)).toBe(true);
	});

	it('reset clears the story back to the scenario', () => {
		resetDemoState('calm');
		get('?step=arm');
		resetDemoState('calm');
		expect(JSON.parse(get('').body!).step).toBeNull();
		expect(site('eu-west-1')).toMatchObject({ tag: NEW, bake: OK });
	});

	it('the hello-waves change resolves on the changes list with its change page', () => {
		resetDemoState('calm');
		get('?step=wave1');
		const l = list();
		const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
		const src = {
			rollouts: l.rollouts,
			environments: l.environments,
			rolloutDependencies: l.deps,
			kustomizations: [],
			kruiseRollouts: [],
			changes: gh.changes,
			changesState: 'ok',
			healthChecks: null,
			github: { configured: true, connected: true, login: 'demo' },
			me: 'demo',
			now: new Date()
		} as unknown as FleetSource;
		installLiveSource(src);
		const mine = D.changes('incident').items.filter((c) => c.title === 'Cache region config at startup');
		expect(mine).toHaveLength(1);
		expect(mine[0].changeHref).toBe('/changes/github.com/exampleco/hello-waves/pull/21');
		expect(mine[0].prNumber).toBe(21);
	});

	// root cause (roster-data.ts team items): with no rollout row in flight, the change item's `apps` fell back to
	// the REPO name, so the page lost its places/history/author. Every beat, and no beat, must resolve the same PR.
	const seenAuthors = new Set<string | null>();
	for (const beat of [null, ...WAVES_STEPS]) {
		it(`beat ${beat ?? 'none'}: PR #21 resolves to c6f19d2 (one author) with its 5 places`, () => {
			resetDemoState('calm');
			if (beat) get(`?step=${beat}`);
			const l = list();
			const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
			installLiveSource({ rollouts: l.rollouts, environments: l.environments, rolloutDependencies: l.deps, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
			const c = D.changes('incident').items.find((i) => i.changeHref === '/changes/github.com/exampleco/hello-waves/pull/21')!;
			expect(c.apps).toEqual(['hello-waves-app']);
			expect(D.placesOfChange(c, 'incident')).toHaveLength(5);
			const commit = commitsOf(c, 'incident').commits[0];
			expect(commit.sha.slice(0, 7)).toBe('c6f19d2');
			// the author of the commit row is the same at every beat (the page prints jmatthews in the browser, where the range endpoint answers)
			seenAuthors.add(commit.author);
			expect(seenAuthors.size).toBe(1);
		});
	}
});
