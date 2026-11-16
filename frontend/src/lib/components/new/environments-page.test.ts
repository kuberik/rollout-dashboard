/** r39 Environments page view-model: every tile's buckets sum to its places, the state line leads with the worst fact, calm = nothing adverse. */
import { describe, it, expect } from 'vitest';
import { environmentsPage, stateLine, barSegments, regionRecovered } from './environments-page';
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
				expect(P.prod.regions!.cells.length + P.prod.regions!.healthy + (P.prod.regions!.held?.regions ?? 0) + (P.prod.regions!.waiting?.regions ?? 0)).toBe(m.busy.length + m.rest.length + (m.base ? 1 : 0));
			}
		});
	}
	it('state line: failing leads in danger, then waiting (held), then moving, else All N healthy', () => {
		expect(stateLine({ places: 8, failing: 1, waiting: 2, yours: 1, moving: 1, rest: 4 }, 'deploying').lead).toMatchObject({ text: '1 failing', ink: 'danger' });
		const w = stateLine({ places: 8, failing: 0, waiting: 3, yours: 1, moving: 0, rest: 5 }, 'deploying');
		expect(w.lead).toMatchObject({ text: '3 waiting', you: '1 for you', ink: 'held' });
		expect(w.mark).toBe('approval-yours');
		expect(stateLine({ places: 2, failing: 0, waiting: 0, yours: 0, moving: 1, rest: 1 }, 'checking')).toMatchObject({ lead: { text: '1 checking', ink: 'progress' }, mark: 'checking' });
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
	it('calm: af-south-1 (healthy, waiting its wave turn) is counted WAITING (neutral, nothing failed), not held and not healthy; the two sum to the old healthy count', async () => {
		const { envsModel } = await import('./envs-model');
		const { regionCells, environmentsPage } = await import('./environments-page');
		const old = regionCells(envsModel('calm')).healthy;
		const r = environmentsPage('calm').prod!.regions!;
		expect(r.held ?? null, 'nothing failed upstream: not held').toBeNull();
		expect(r.waiting, 'a waiting region is said, neutrally').toMatchObject({ regions: 1, because: 'waiting for 3 prod regions' });
		expect(r.healthy + r.waiting!.regions).toBe(old);
	});
	it('the held phrase says who failed the bake', async () => {
		const { waveHeldPhrase } = await import('./environments-page');
		expect(waveHeldPhrase(4, 'us-east-1', 'us-east-1')).toBe('4 regions held · us-east-1 failed the bake');
		expect(waveHeldPhrase(1, '3 prod regions', null)).toBe('1 region waiting for 3 prod regions');
	});
});

describe('a failure whose checks recovered is `failed`, not `failing`', () => {
	const t = { places: 8, waiting: 1, yours: 0, moving: 0, rest: 4 };
	it('some failing now, some recovered: the lead counts the live ones, the recovered ones follow as `failed`', () => {
		const s = stateLine({ ...t, failing: 3, recovered: 1 }, 'deploying');
		expect(s.lead).toMatchObject({ text: '2 failing', ink: 'danger' });
		expect(s.parts[0].text).toBe('1 failed');
		expect(s.mark).toBe('failed');
	});
	it('every failure recovered: the lead says `failed`, never `failing`', () => {
		const s = stateLine({ ...t, failing: 2, recovered: 2 }, 'deploying');
		expect(s.lead.text).toBe('2 failed');
		expect(s.lead.ink).toBe('muted');
		expect(s.parts.map((p) => p.text).join(' ')).not.toContain('failing');
	});
	it('no recovered count (older callers): unchanged', () => {
		expect(stateLine({ ...t, failing: 2 }, 'deploying').lead.text).toBe('2 failing');
	});
});

describe('the tile text, region cells and aria label use the same two failure words', () => {
	it('failedParts: live first, recovered as `failed`', async () => {
		const { failedParts } = await import('./state-words');
		expect(failedParts(6, 2)).toEqual(['4 failing', '2 failed']);
		expect(failedParts(2, 2)).toEqual(['2 failed']);
		expect(failedParts(3, 0)).toEqual(['3 failing']);
	});
	it('a region cell carries its recovered count from the model', async () => {
		const { regionCells } = await import('./environments-page');
		const r = (label: string, mark: string, failing: number, recovered: number) => ({ label, regionless: false, mark, failing, recovered, waiting: 0, moving: 0, envHref: '/envs/x' });
		const m = { base: null, busy: [r('us-east-1', 'failed', 6, 2), r('eu-west', 'failed', 1, 0)], rest: [] } as never;
		expect(regionCells(m).cells.map((c) => [c.label, c.failing, c.recovered])).toEqual([['us-east-1', 6, 2], ['eu-west', 1, 0]]);
	});
});

describe('region cell parts follow the tier line', () => {
	it('only the failing-now part is danger ink; failed is neutral', async () => {
		const { regionCellParts } = await import('./environments-page');
		expect(regionCellParts({ failing: 6, recovered: 2, waiting: 0, moving: 0, movingWord: 'checking' })).toEqual([{ text: '4 failing', ink: 'danger' }, { text: '2 failed', ink: null }]);
		expect(regionCellParts({ failing: 2, recovered: 2, waiting: 0, moving: 0, movingWord: 'checking' })).toEqual([{ text: '2 failed', ink: null }]);
	});
	it('the moving part carries the count and the tier word', async () => {
		const { regionCellParts } = await import('./environments-page');
		expect(regionCellParts({ failing: 0, recovered: 0, waiting: 3, moving: 1, movingWord: 'checking' }).map((p) => p.text)).toEqual(['3 waiting', '1 checking']);
		expect(regionCellParts({ failing: 0, recovered: 0, waiting: 0, moving: 2, movingWord: 'in progress' })[0].text).toBe('2 in progress');
	});
	it('waiting and moving parts are neutral: only a check failing now spends a hue', async () => {
		const { regionCellParts } = await import('./environments-page');
		expect(regionCellParts({ failing: 1, recovered: 0, waiting: 3, moving: 1, movingWord: 'checking' }).map((p) => p.ink)).toEqual(['danger', null, null]);
		expect(regionCellParts({ failing: 0, recovered: 0, waiting: 3, moving: 1, movingWord: 'deploying' }).map((p) => p.ink)).toEqual([null, null]);
	});
	it('movingWordOf: checking / deploying / in progress when both or none', async () => {
		const { movingWordOf } = await import('./envs-model');
		const p = (...s: string[]) => s.map((state) => ({ state }));
		expect(movingWordOf(p('checking', 'checking'))).toBe('checking');
		expect(movingWordOf(p('deploying'))).toBe('deploying');
		expect(movingWordOf(p('deploying', 'checking'))).toBe('in progress');
		expect(movingWordOf(p('rest'))).toBe('in progress');
	});
	it('the aria label pluralises one place and says in progress for a zero count', async () => {
		const { environmentsPage } = await import('./environments-page');
		const labels = environmentsPage('calm' as never).tiles.map((t) => t.label);
		for (const l of labels) { expect(l).not.toMatch(/^1 places/); expect(l).not.toMatch(/ 0 (deploying|checking)/); }
	});
});

describe('the recovered ring on the Environments marks', () => {
	const t = (failing: number, recovered: number) => stateLine({ places: 4, failing, recovered, waiting: 0, yours: 0, moving: 0, rest: 4 - failing }, 'deploying');
	it('the lead mark is the ring only when every failed place has recovered; a mixed tile keeps the solid disc', () => {
		expect(t(2, 2).recovered).toBe(true);
		expect(t(2, 1).recovered).toBeUndefined();
		expect(t(1, 0).recovered).toBeUndefined();
		expect(stateLine({ places: 2, failing: 0, waiting: 0, yours: 0, moving: 0, rest: 2 }, 'deploying').recovered).toBeUndefined();
	});
	it('a region cell is the ring only when every failed place in it recovered', () => {
		expect(regionRecovered({ mark: 'failed', failing: 2, recovered: 2 })).toBe(true);
		expect(regionRecovered({ mark: 'failed', failing: 2, recovered: 1 })).toBe(false);
		expect(regionRecovered({ mark: 'failed', failing: 1, recovered: 0 })).toBe(false);
		expect(regionRecovered({ mark: 'approval', failing: 0, recovered: 0 })).toBe(false);
	});
});
