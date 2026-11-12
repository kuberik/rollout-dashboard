import { describe, it, expect } from 'vitest';
import { rollouts, changes, ago, waitClock, buildInQuestionFacts } from './data';
import { findChange, classified, openedOf, spineOf } from './change/detail-model';
import { placeAge } from './app/app-model';
import { rolloutsPage } from './rollouts-page';

/* batch4 P1: ONE CLOCK PER WAIT. Any "Waiting ..." prints the hold clock (waitClock), the figure the /rollouts row prints, on the change page and the app's place row too.
   The build's own age belongs only to the labelled Newer-builds list. */
const S = 'incident' as const;
const rowOf = (app: string, tier: string) => rollouts(S).rows.find((r) => r.app === app && r.tier === tier && r.group === 'approval')!;

describe('one clock per wait (mock scenario incident)', () => {
	for (const [app, tier, slug, WAIT, BUILD] of [
		['telemetry-indexer', 'prod', 'github.com/exampleco/platform-telemetry/pull/20', '42m', '2h'],
		['invoice-api', 'prod', null, '4h', '1h'],
	] as const) {
		it(`${app} ${tier}: /rollouts row, app place row and change page read the same wait figure`, () => {
			const row = rowOf(app, tier);
			expect(row, 'fixture has the waiting row').toBeTruthy();
			const hold = ago(waitClock(row, S));
			/* pinned from the fixture: the hold began WAIT ago; the waiting build is BUILD old and must not be what any surface says */
			expect([hold, ago(buildInQuestionFacts(row)!.since)]).toEqual([WAIT, BUILD]);
			const listed = rolloutsPage(S).groups.flatMap((g) => g.rows).find((x) => x.row.key === row.key)!;
			expect(listed.age).toBe(WAIT);
			expect(placeAge(row, S)).toBe(WAIT);
			if (slug) {
				const c = findChange(slug, S)!;
				const { places } = classified(c, S);
				const w = places.filter((p) => p.kind === 'waiting' && p.app === app && p.tier === tier);
				expect(w.length).toBeGreaterThan(0);
				for (const p of w) {
					expect(ago(p.at ?? p.since)).toBe(WAIT);
					expect(openedOf(p, S).since).toBe(WAIT);
				}
				for (const e of spineOf(c, S, places).filter((x) => x.kind === 'waiting' && x.app === app)) expect(ago(e.at)).toBe(WAIT);
			}
		});
	}
	it('every waiting place of every change reads its row\'s wait clock', () => {
		let n = 0;
		for (const c of changes(S).items) {
			const { places } = classified(c, S);
			for (const p of places.filter((x) => x.kind === 'waiting' && x.row)) {
				n++;
				/* change-stages r2: ONE clock, asked for THIS change's build (data.ts `waitClock(row, s, build)` clamps it to the build's arrival upstream) */
				expect([c.title, p.label, ago(p.at ?? p.since), openedOf(p, S).since]).toEqual([c.title, p.label, ago(waitClock(p.row!, S, p.build)), ago(waitClock(p.row!, S, p.build))]);
				expect(Date.parse(waitClock(p.row!, S, p.build)!)).toBeGreaterThanOrEqual(Date.parse(waitClock(p.row!, S)!));
			}
		}
		expect(n).toBeGreaterThan(0);
	});
});
