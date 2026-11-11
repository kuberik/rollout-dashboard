import { describe, it, expect } from 'vitest';
import { rollouts, changes, ago, waitClock } from './data';
import { findChange, classified, openedOf, spineOf } from './change/detail-model';
import { placeAge } from './app/app-model';
import { rolloutsPage } from './rollouts-page';

/* batch4 P1: ONE CLOCK PER WAIT. Any "Waiting ..." prints the hold clock (waitClock), the figure the /rollouts row prints, on the change page and the app's place row too.
   The build's own age belongs only to the labelled Newer-builds list. */
const S = 'incident' as const;
const rowOf = (app: string, tier: string) => rollouts(S).rows.find((r) => r.app === app && r.tier === tier && r.group === 'approval')!;

describe('one clock per wait (mock scenario incident)', () => {
	for (const [app, tier, slug] of [
		['telemetry-indexer', 'prod', 'github.com/exampleco/platform-telemetry/pull/20'],
		['invoice-api', 'prod', null],
	] as const) {
		it(`${app} ${tier}: /rollouts row, app place row and change page read the same wait figure`, () => {
			const row = rowOf(app, tier);
			expect(row, 'fixture has the waiting row').toBeTruthy();
			const hold = ago(waitClock(row, S));
			const listed = rolloutsPage(S).groups.flatMap((g) => g.rows).find((x) => x.row.key === row.key)!;
			expect(listed.age).toBe(hold);
			expect(placeAge(row, S)).toBe(hold);
			if (slug) {
				const c = findChange(slug, S)!;
				const { places } = classified(c, S);
				const w = places.filter((p) => p.kind === 'waiting' && p.app === app && p.tier === tier);
				expect(w.length).toBeGreaterThan(0);
				for (const p of w) {
					expect(ago(p.at ?? p.since)).toBe(ago(waitClock(p.row!, S)));
					expect(openedOf(p, S).since).toBe(ago(waitClock(p.row!, S)));
				}
				for (const e of spineOf(c, S, places).filter((x) => x.kind === 'waiting' && x.app === app)) expect(ago(e.at)).toBe(ago(waitClock(w[0].row!, S)));
			}
		});
	}
	it('every waiting place of every change reads its row\'s wait clock', () => {
		let n = 0;
		for (const c of changes(S).items) {
			const { places } = classified(c, S);
			for (const p of places.filter((x) => x.kind === 'waiting' && x.row)) {
				n++;
				expect([c.title, p.label, ago(p.at ?? p.since), openedOf(p, S).since]).toEqual([c.title, p.label, ago(waitClock(p.row!, S)), ago(waitClock(p.row!, S))]);
			}
		}
		expect(n).toBeGreaterThan(0);
	});
});
