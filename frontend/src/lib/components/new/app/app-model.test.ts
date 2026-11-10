import { describe, it, expect } from 'vitest';
import { placeHolds, gatesOf, apps, tabPill, newestBuild, type GateInfo } from '../data';
import { buildsOf, holdSentences, deployTargets, holdRows, nextOf, pillOf, currencyOf, ledgerOf, foldLedger, tabLag, placeNote, stopWord, stopShort, weekSummary, placeWord, pinnedPlaces } from './app-model';

describe('app-model on the demo apps', () => {
	const P = placeHolds('invoice-api', 'incident');
	it('says the hold per place, never one reason for all', () => {
		expect(holdSentences(P)).toEqual(['held by health checks in eu-west', 'waiting for approval in us-east, us-west']);
	});
	it('offers ONE deploy per place: eu-west gets the newest build already healthy in staging, gated and moving places none', () => {
		const t = deployTargets(P);
		expect([...t.entries()].map(([b, ps]) => [b, ps.map((p) => p.place)])).toEqual([['a11c808', ['eu-west']]]);
	});
	it('lists every newer build once and says where it already runs', () => {
		const b = buildsOf(P);
		expect(b.length).toBe(7);
		expect(b.find((x) => x.build === 'a11c404')?.runsIn).toEqual(['us-east', 'us-west']);
		expect(b.find((x) => x.build === 'a11c909')?.moving).toBe(true);
	});
	it('holding rows: the approval gate with its places and held builds, then the health hold', () => {
		const r = holdRows(gatesOf('invoice-api', 'incident'), P);
		expect(r.map((x) => x.kind)).toEqual(['approval', 'health']);
		expect(r[0].places).toEqual(['us-east', 'us-west']);
		expect(r[0].held.length).toBe(5);
	});
	it('holding rows: same-named gates of several prod sites keep unique keys (each_key_duplicate "gate:Gate")', () => {
		const g = (id: string, place: string): GateInfo => ({ id, name: 'Gate', kind: 'approval', sentence: 'Releases when someone approves', holding: true, heldPending: false, places: [place], held: ['a11c808'], releasedBy: 'someone approves' });
		const r = holdRows([g('ghd-6p5hd', 'us-east'), g('ghd-7k2qx', 'us-west'), g('ghd-9b4zt', 'eu-west')], P);
		const gateRowsOf = r.filter((x) => x.kind === 'approval');
		expect(gateRowsOf.map((x) => x.name)).toEqual(['Gate', 'Gate', 'Gate']);
		expect(new Set(r.map((x) => x.key)).size).toBe(r.length);
	});
	it('next arrival and why', () => {
		const eu = P.find((p) => p.place === 'eu-west')!;
		expect(nextOf(P, eu.href)).toBe('7 builds behind');
		const test = P.find((p) => p.place === 'test')!;
		expect(nextOf(P, test.href)).toBe('next a11c909 · after dev');
	});
});

describe('apps-12 AT1: one pill rule for the tile and the app page', () => {
	for (const st of ['incident', 'calm', 'quiet'] as const) {
		it(`${st}: the tile's pill (placeList) is the page's pill (placeHolds) for every app`, () => {
			for (const a of apps(st as never).items) {
				const tile = pillOf(a.placeList, st);
				const page = pillOf(placeHolds(a.app, st as never), st);
				expect(`${a.app} ${tile?.word} ${tile?.role}`).toBe(`${a.app} ${page?.word} ${page?.role}`);
			}
		});
	}
	it('the headline is the production place that most needs reading; a dev place moving does not change it', () => {
		const p = pillOf(placeHolds('invoice-api', 'incident'), 'incident')!;
		expect(p.place.label).toBe('eu-west');
		expect(p.word).toBe('FAILED');
	});
	it('apps-13 AL4: the pill is the tab\'s own word AND colour for the headline place (no invented neutral)', () => {
		for (const sc of ['incident', 'calm', 'quiet'] as const) for (const a of apps(sc).items) {
			const places = placeHolds(a.app, sc); const p = pillOf(places, sc);
			if (!p) continue;
			if (p.word === tabPill({ href: p.place.href }).word) expect(p.role).toBe(tabPill({ href: p.place.href }).role);
		}
	});
	it('apps-13 AL3: currency of every place is against the APP\'s own newest build, as its tab says it, in all three states', () => {
		for (const sc of ['incident', 'calm', 'quiet'] as const) for (const a of apps(sc).items) for (const pl of placeHolds(a.app, sc)) {
			const nb = newestBuild({ app: a.app, href: pl.href, state: 'healthy', word: '' } as never);
			const c = currencyOf(pl.href, a.app);
			expect(c.behind).toBe(nb?.count ?? 0);
			expect(c.word).toBe(nb ? `${nb.count} build${nb.count === 1 ? '' : 's'} behind` : 'Up to date');
			expect(c.word).not.toMatch(/live/i);
		}
	});
});


describe('r34 builds-lag: the Sounding ledger (lag = position in THIS app\'s own sequence, as each place\'s tab counts it)', () => {
	const ALL = (['incident', 'calm', 'quiet'] as const).flatMap((sc) => apps(sc).items.map((a) => ({ sc, app: a.app, P: placeHolds(a.app, sc) })));
	it('every place of every app, in all three states, stands exactly once, on the stop of the build it runs', () => {
		for (const { sc, app, P } of ALL) {
			const L = ledgerOf(P);
			const seen = L.flatMap((s) => s.places.map((p) => p.href));
			expect(seen.sort(), `${sc} ${app}`).toEqual(P.map((p) => p.href).sort());
			expect(new Set(L.map((s) => s.build)).size, `${sc} ${app}: a build twice`).toBe(L.length);
		}
	});
	it('the stop index is the place\'s own tab count ("N newer builds") for every place; a disagreeing place is flagged by placeNote, never silently relabelled', () => {
		const flagged: string[] = [];
		for (const { sc, app, P } of ALL) for (const s of ledgerOf(P)) for (const p of s.places) {
			if (s.custom) { expect(stopWord(s)).toBe('Custom build'); continue; }
			const note = placeNote(s, p);
			if (note) { flagged.push(`${sc} ${app} ${p.place}`); expect(note).toBe(tabLag(p) ? `${tabLag(p)} build${tabLag(p) === 1 ? '' : 's'} behind` : 'Up to date'); }
			else expect(s.index, `${sc} ${app} ${p.place}`).toBe(tabLag(p));
		}
		expect([...new Set(flagged.map((f) => f.replace(/^\w+ /, "")))].sort()).toEqual(["orders-api production"]);
	});
	it('invoice-api: every place against its tab, incident', () => {
		const L = ledgerOf(placeHolds('invoice-api', 'incident'));
		const at = (b: string) => L.find((s) => s.build === b)!;
		expect(L.map((s) => [s.build, s.index])).toEqual([['a11c909', 0], ['a11c808', 1], ['a11c707', 2], ['a11c606', 3], ['a11c505', 4], ['a11c404', 5], ['a11c303', 6], ['a11c202', 7]]);
		expect(at('a11c909').places.map((p) => p.place)).toEqual(['dev']);
		expect(at('a11c808').places.map((p) => p.place).sort()).toEqual(['staging', 'test']);
		expect(at('a11c404').places.map((p) => p.place).sort()).toEqual(['us-east', 'us-west']);
		expect(at('a11c202').places.map((p) => p.place)).toEqual(['eu-west']);
		expect(stopWord(at('a11c808'))).toBe('1 build behind');
		expect(stopWord(at('a11c202'))).toBe('7 builds behind');
		expect(at('a11c909').title).toBe('Add idempotency key to invoice creation');
		expect(at('a11c909').age).toBeTruthy();
	});
	it('payments-core: eu-central runs a build outside the app\'s sequence = "Custom build", last, never counted', () => {
		const L = ledgerOf(placeHolds('payments-core', 'incident'));
		const c = L.filter((s) => s.custom);
		expect(c.map((s) => s.build)).toEqual(['d0ff17e']);
		expect(L[L.length - 1].custom).toBe(true);
		expect(c[0].index).toBeNull();
		expect(L.filter((s) => !s.custom).map((s) => s.index)).toEqual([0, 1, 2, 3].slice(0, L.length - 1));
	});
	it('checkout-api: af-south-1 is 5 builds behind and says the tab\'s cause, "Held by the pin"', () => {
		const P = placeHolds('checkout-api', 'incident');
		const item = apps('incident').items.find((a) => a.app === 'checkout-api')!;
		const pins = pinnedPlaces(item.holds);
		const af = P.find((p) => p.label === 'af-south-1')!;
		expect(pins.has(af.place)).toBe(true);
		expect(placeWord(af, pins.has(af.place))).toBe('Held by the pin');
		expect(ledgerOf(P).find((s) => s.places.includes(af))!.index).toBe(5);
		expect(P.filter((p) => pins.has(p.place)).length).toBe(1);
	});
	it('runs of 4 or more unused builds fold into one row (never the first or last stop); expanding shows them', () => {
		const L = ledgerOf(placeHolds('checkout-edge', 'incident'));
		const f = foldLedger(L);
		expect(f.filter((i) => i.kind === 'fold').length).toBeGreaterThan(0);
		expect(f.filter((i) => i.kind === 'fold').every((i) => i.kind === 'fold' && i.stops.length >= 4 && i.stops.every((s) => !s.places.length))).toBe(true);
		expect(f[0].kind).toBe('stop');
		expect(f[f.length - 1].kind).toBe('stop');
		const key = (f.find((i) => i.kind === 'fold') as { key: string }).key;
		expect(foldLedger(L, new Set([key])).filter((i) => i.kind === 'stop').length).toBeGreaterThan(f.filter((i) => i.kind === 'stop').length);
		expect(ledgerOf(placeHolds('invoice-api', 'incident')).length).toBe(foldLedger(ledgerOf(placeHolds('invoice-api', 'incident'))).length);
	});
});

describe('r2 apps: ledger lag track and the Summary figures', () => {
	it('the 64px lag track prints Newest / "N behind" / Custom; the full words stay in stopWord', () => {
		expect(stopShort({ index: 0, custom: false })).toBe('Newest');
		expect(stopShort({ index: 5, custom: false })).toBe('5 behind');
		expect(stopShort({ index: 0, custom: true })).toBe('Custom');
		expect(stopWord({ index: 5, custom: false })).toMatch(/5 builds behind/);
	});
	it('weekSummary folds deploys, failures, rollbacks, the median to healthy and the days holding data', () => {
		const now = Date.parse('2026-11-02T12:00:00Z');
		const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
		const s = weekSummary([
			{ history: [{ timestamp: at(1), bakeStatus: 'Failed' }, { timestamp: at(30), bakeStatus: 'Succeeded', bakeEndTime: at(29.9) }, { timestamp: at(24 * 9), bakeStatus: 'Succeeded', bakeEndTime: at(24 * 9 - 1) }], rolledBack: [true, false, false] },
		], 7, now);
		expect(s).toMatchObject({ deploys: 2, failed: 1, rolledBack: 1, openFailure: true, daysWithData: 2 });
		expect(s.medianHealthyMs).toBe(6 * 60_000);
		expect(s.lastFailureMs).toBe(now - 3_600_000);
		expect(weekSummary([], 7, now)).toMatchObject({ deploys: 0, daysWithData: 0, medianHealthyMs: null, lastFailureMs: null, openFailure: false });
	});
});

/* QA #23: a build a place runs that is a known release but no longer in the newer-builds spine was SUPERSEDED, not "Custom". Only a build
   nothing else knows (no title, no timestamp, never listed) is custom. */
describe('QA #23: superseded vs custom', () => {
	const hb = (build: string, created: string) => ({ build, title: `t ${build}`, author: null, created, here: true });
	const place = (name: string, deployed: string, held: ReturnType<typeof hb>[]) => ({ wave: null, env: name, label: name, place: name, tier: name === 'prod' ? 'prod' : 'staging', state: 'healthy', href: `/x/${name}`, deployedBuild: deployed, holdReason: null, gate: null, heldBuilds: held, runs: null }) as never;
	it('a build outside every release stream is Custom', () => {
		const newer = [hb('c3', '2026-01-03T00:00:00Z'), hb('c2', '2026-01-02T00:00:00Z'), hb('c1', '2026-01-01T00:00:00Z')];
		const stops = ledgerOf([place('prod', 'c0', newer), place('dev', 'c1', []), place('stale', 'cX', [hb('c1', '2026-01-01T00:00:00Z')])] as never);
		const x = stops.find((s) => s.build === 'cX')!;
		expect(x.custom).toBe(true); /* nothing knows cX: custom */
		expect(stops.filter((s) => s.custom).map((s) => s.build)).toEqual(['cX']);
	});
});
