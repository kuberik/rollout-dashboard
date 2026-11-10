import { describe, it, expect } from 'vitest';
import { apps, placeHolds, placesOf, runsIn } from './data';
import { tabLag, currencyOf } from './app/app-model';

/* QA #12: ONE behind count per place. Apps tile (placeList/behind), the app page's strip + ledger (tabLag) and the Gates tab's Runs-in
   (runsIn) all read the same number for the same place. */
for (const st of ['incident', 'calm', 'quiet'] as const) {
	describe(`${st}: "behind" agrees across surfaces`, () => {
		for (const a of apps(st).items) {
			it(a.app, () => {
				const holds = placeHolds(a.app, st);
				for (const h of holds) {
					const cur = currencyOf(h.href, a.app).behind;
					expect(`${a.app}/${h.place} currency ${cur}`).toBe(`${a.app}/${h.place} currency ${tabLag(h)}`);
				}
				for (const r of runsIn(a.app, st)) {
					const h = holds.find((x) => x.href === r.href);
					if (!h || r.word === 'failing' || r.word === 'on the newest') continue;
					const n = /^(\d+) behind$/.exec(r.word)?.[1];
					if (n) expect(`${a.app}/${r.label} runsIn ${n}`).toBe(`${a.app}/${r.label} runsIn ${tabLag(h)}`);
				}
			});
		}
	});
}

import { placeLabel } from './data';
describe('QA #10/#11: placeLabel', () => {
	it('never blank; counts sites not places', () => {
		expect(placeLabel({ tier: 'staging', regions: [''] })).toBe('staging');
		expect(placeLabel({ tier: 'prod', regions: ['', ''] })).toBe('production');
		expect(placeLabel({ tier: 'prod', regions: ['prod', 'prod'] })).toBe('production');
		expect(placeLabel({ tier: 'prod', regions: ['eu', 'us', 'eu'] })).toBe('2 prod regions');
	});
});

import { gatesOf } from './data';
describe('QA #17: a gate is named once, through gateDisplayName', () => {
	it('no gate on any page reads like a humanised generated id', () => {
		for (const st of ['incident', 'calm', 'quiet'] as const) for (const a of apps(st).items) for (const g of gatesOf(a.app, st)) expect(g.name, `${a.app}: ${g.name}`).not.toMatch(/ [bcdfghjklmnpqrstvwxz2456789]{5}$/i);
	});
});

describe('round 3: a held gate is pending until its held-here answer is published', () => {
	it('gatesOf marks a holding gate heldPending while heldHere is unknown', () => {
		for (const st of ['incident'] as const) for (const a of apps(st).items) for (const g of gatesOf(a.app, st)) if (g.holding) expect(g.heldPending, `${a.app}:${g.name}`).toBe(true);
	});
});
