import { describe, it, expect, vi } from 'vitest';
/* Newest and "N behind" come from the release catalogue's one order, whatever each place's own list looks like.
   Per-href catalogue (oldest first) and deploy history are fed to the real ledger through the data module's two readers. */
const CAT: Record<string, string[]> = {};
const HIST: Record<string, { build: string; at: string }[]> = {};
const NOREL = new Set<string>();
vi.mock('../data', async (orig) => ({
	...(await orig<typeof import('../data')>()),
	streamBuilds: (href: string) => CAT[href] ?? [],
	noReleasesAt: (href: string) => (NOREL.has(href) ? { kind: 'no-source', label: 'No release source', message: '' } : undefined),
	deployedHistory: (href: string) => (HIST[href] ?? []).map((h) => ({ build: h.build, title: null, author: null, at: h.at }))
}));
import { ledgerOf, stopWord, placeNote } from './app-model';

const held = (b: string) => ({ build: b, title: null, author: null, created: null, here: true });
const place = (name: string, deployed: string, state = 'healthy', heldBuilds: string[] = []) => ({
	wave: null, env: name, label: name, place: name, tier: name === 'prod' ? 'prod' : 'staging', state, href: `/x/${name}`, deployedBuild: deployed,
	holdReason: state === 'failed' ? 'failed' : null, gate: null, heldBuilds: heldBuilds.map(held), runs: deployed
});
const print = (stops: ReturnType<typeof ledgerOf>) =>
	stops.map((s) => `${s.build}: ${stopWord(s)} [${s.places.map((p) => `${p.env}${placeNote(s, p) ? ` note="${placeNote(s, p)}"` : ''}`).join(', ')}]`);
const reset = () => {
	for (const k of Object.keys(CAT)) delete CAT[k];
	for (const k of Object.keys(HIST)) delete HIST[k];
	NOREL.clear();
};

describe('the ledger: Newest is the catalogue\'s newest, N behind its distance', () => {
	it('S1: the newest c3 failed in staging and prod rolled back to c1: c3 is Newest (its row says failed), c1 is 2 behind, never "Up to date"', () => {
		reset();
		CAT['/x/stg'] = CAT['/x/prod'] = ['c0', 'c1', 'c2', 'c3'];
		const L = print(ledgerOf([place('stg', 'c3', 'failed'), place('prod', 'c1')] as never));
		expect(L[0]).toBe('c3: Newest [stg]');
		expect(L.find((l) => l.startsWith('c1:'))).toMatch(/^c1: 2 builds behind \[prod( note="Nothing inbound")?\]$/);
		expect(L.join('\n')).not.toMatch(/Up to date/);
	});
	it('S2: the newest c4 failed in staging while prod runs c1 and holds [c3,c2]: c4 is Newest, c3 1 behind, c1 3 behind', () => {
		reset();
		CAT['/x/stg'] = CAT['/x/prod'] = ['c0', 'c1', 'c2', 'c3', 'c4'];
		const L = print(ledgerOf([place('stg', 'c4', 'failed'), place('prod', 'c1', 'healthy', ['c3', 'c2'])] as never));
		expect(L[0]).toBe('c4: Newest [stg]');
		expect(L).toContain('c3: 1 build behind []');
		expect(L.find((l) => l.startsWith('c1:'))).toMatch(/^c1: 3 builds behind \[prod/);
	});
	it('S2b: a held older build is never Newest (staging rolled back to c3, prod holds [c3,c2])', () => {
		reset();
		CAT['/x/stg'] = CAT['/x/prod'] = ['c0', 'c1', 'c2', 'c3', 'c4'];
		const L = print(ledgerOf([place('stg', 'c3'), place('prod', 'c1', 'healthy', ['c3', 'c2'])] as never));
		expect(L[0]).toBe('c4: Newest []');
		expect(L.find((l) => l.startsWith('c3:'))).toMatch(/^c3: 1 build behind \[stg/);
	});
	it('S3: catalogues of different length (stg [c3..c6] runs c6, prod [c0..c5] runs c5): c6 is Newest, c5 is 1 behind', () => {
		reset();
		CAT['/x/stg'] = ['c3', 'c4', 'c5', 'c6'];
		CAT['/x/prod'] = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
		const L = print(ledgerOf([place('stg', 'c6'), place('prod', 'c5')] as never));
		expect(L[0]).toBe('c6: Newest [stg]');
		expect(L[1]).toMatch(/^c5: 1 build behind \[prod/);
		expect(L.join('\n')).not.toMatch(/c5: Newest/);
	});
	it('S4: equal-length sliding windows give the same ledger whichever place is read first', () => {
		reset();
		CAT['/x/prod'] = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
		CAT['/x/stg'] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
		const a = print(ledgerOf([place('prod', 'c5'), place('stg', 'c6')] as never));
		const b = print(ledgerOf([place('stg', 'c6'), place('prod', 'c5')] as never));
		expect(a).toEqual(b);
		expect(a[0]).toBe('c6: Newest [stg]');
		expect(a[1]).toMatch(/^c5: 1 build behind \[prod/);
	});
	it('no catalogue at all: the places\' own lists and the latest deploy still name a Newest', () => {
		reset();
		HIST['/x/stg'] = [{ build: 'c3', at: '2026-11-10T10:00:00Z' }];
		HIST['/x/prod'] = [{ build: 'c1', at: '2026-11-10T10:38:00Z' }];
		const L = print(ledgerOf([place('stg', 'c3'), place('prod', 'c1')] as never));
		expect(L[0]).toMatch(/^c1: Newest/);
	});
	it('no release = not affected: a place without releases is not counted, and its sibling on the catalogue\'s newest is not behind', () => {
		reset();
		CAT['/x/prod'] = ['c0', 'c1', 'c2'];
		NOREL.add('/x/stg');
		const L = print(ledgerOf([place('stg', 'zz'), place('prod', 'c2')] as never));
		expect(L[0]).toBe('c2: Newest [prod]');
		expect(L.join('\n')).not.toMatch(/c2: 1 build behind/);
	});
});
