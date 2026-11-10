/** r39 Environments page view-model: every tile's buckets sum to its places, the state line leads with the worst fact, calm = nothing adverse. */
import { describe, it, expect } from 'vitest';
import { environmentsPage, stateLine, barSegments } from './environments-page';
import { envsModel } from './envs-model';
import type { HomeState } from './data';

describe('environmentsPage', () => {
	for (const hs of ['incident', 'calm', 'quiet'] as HomeState[]) {
		it(`${hs}: each tile's buckets sum to its places; Production carries the regions, the others none`, () => {
			const P = environmentsPage(hs);
			for (const t of [...P.tiles, ...(P.prod ? [P.prod] : [])]) {
				expect(t.failing + t.waiting + t.moving + t.rest, t.key).toBe(t.places);
				expect(t.yours).toBeLessThanOrEqual(t.waiting);
				expect(!!t.regions, t.key).toBe(t.key === 'prod');
			}
			if (P.prod) {
				const m = envsModel(hs);
				expect(P.prod.regions!.cells.length + P.prod.regions!.healthy + (P.prod.regions!.held?.regions ?? 0)).toBe(m.busy.length + m.rest.length + (m.base ? 1 : 0));
			}
		});
	}
	it('state line: failing leads in danger, then waiting (held), then moving, else All N healthy', () => {
		expect(stateLine({ places: 8, failing: 1, waiting: 2, yours: 1, moving: 1, rest: 4 }, 'deploying').lead).toMatchObject({ text: '1 failing', ink: 'danger' });
		const w = stateLine({ places: 8, failing: 0, waiting: 3, yours: 1, moving: 0, rest: 5 }, 'deploying');
		expect(w.lead).toMatchObject({ text: '3 waiting', you: '1 for you', ink: 'held' });
		expect(w.mark).toBe('approval-yours');
		expect(stateLine({ places: 2, failing: 0, waiting: 0, yours: 0, moving: 1, rest: 1 }, 'checking')).toMatchObject({ lead: { text: '1 checking', ink: 'active' }, mark: 'checking' });
		expect(stateLine({ places: 8, failing: 0, waiting: 0, yours: 0, moving: 0, rest: 8 }, 'deploying').lead.text).toBe('All 8 healthy');
	});
	it('bar drops empty segments, in failing, waiting, moving, healthy order', () => {
		expect(barSegments({ failing: 1, waiting: 0, moving: 2, rest: 5 }).map((s) => s.k)).toEqual(['f', 'm', 'r']);
	});
});

import { regionCells } from './environments-page';
it('QA #10: a single site draws no region cells and no region count', () => {
	const r = (label: string, regionless: boolean, mark: string) => ({ label, regionless, mark, failing: 0, waiting: 0, moving: 1, envHref: '/envs/x' });
	const m = { base: r('production', true, 'checking'), busy: [], rest: [r('prod', true, 'newest')] } as never;
	expect(regionCells(m)).toEqual({ cells: [], healthy: 0 });
	const many = { base: null, busy: [r('eu-west', false, 'checking')], rest: [r('us-east', false, 'newest')] } as never;
	expect(regionCells(many).cells.length + regionCells(many).healthy).toBe(2);
});

import { readFileSync } from 'node:fs';
it('QA #24: the arrivals grid only CAPS its columns (a count of 4+ never sets more columns than the width has)', () => {
	const css = readFileSync('src/lib/components/new/Environments.svelte', 'utf8');
	for (const n of [4, 5, 6]) {
		const rules = css.split('\n').filter((l) => l.includes(`.arrgrid[data-n='${n}']`));
		expect(rules.length).toBe(1);
		expect(rules[0], `n=${n} must sit in a container min-width query`).toMatch(/@container \(min-width: \d+px\)/);
	}
});

it('round 2 B3: an arrival at the default site carries no place word ("· production")', () => {
	for (const hs of ['incident', 'calm', 'quiet'] as const) for (const a of environmentsPage(hs).arrivals) expect(['production', 'prod', 'default']).not.toContain(a.place.toLowerCase());
});

describe('QA2 #5: a held build is not arriving', () => {
	it('the tile counts only the inbound builds nothing holds back', async () => {
		const { inbound, isArriving } = await import('./data');
		let sawHeld = false;
		for (const hs of ['incident', 'calm', 'quiet'] as const) {
			const L = environmentsPage(hs);
			for (const t of [...L.tiles, ...(L.prod ? [L.prod] : [])]) {
				const all = inbound(hs, t.key as never);
				sawHeld ||= all.some((x) => !isArriving(x));
				expect(t.arriving.builds, `${hs}/${t.key}`).toBe(all.filter(isArriving).length);
			}
		}
		expect(sawHeld, 'fixture must contain a held inbound build').toBe(true);
	});
});

describe('batch4 #3: regions a wave holds are not plain "healthy"', () => {
	it('calm: af-south-1 (healthy, waiting on the regions before it) is counted held, not healthy; the two sum to the old healthy count', async () => {
		const { envsModel } = await import('./envs-model');
		const { regionCells, environmentsPage } = await import('./environments-page');
		const old = regionCells(envsModel('calm')).healthy;
		const r = environmentsPage('calm').prod!.regions!;
		expect(r.held, 'a held region is said').toMatchObject({ regions: 1, because: 'waiting for 3 prod regions' });
		expect(r.healthy + r.held!.regions).toBe(old);
	});
	it('the held phrase says who failed the bake', async () => {
		const { waveHeldPhrase } = await import('./environments-page');
		expect(waveHeldPhrase(4, 'us-east-1', 'us-east-1')).toBe('4 regions held · us-east-1 failed the bake');
		expect(waveHeldPhrase(1, '3 prod regions', null)).toBe('1 region held · waiting for 3 prod regions');
	});
});
