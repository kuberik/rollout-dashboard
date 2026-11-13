import { describe, it, expect } from 'vitest';
import { apps, rollouts, pathReach, pathPosition, reachSentence, appOrder } from './data';
import { newestOf } from '$lib/releases/order';
import { newestLine } from './change/detail-model';

/* "N of M places on the newest": computed ONCE as data ({n, m, build}) against the catalogue's newest (releases/order.ts), phrased from the numbers; nothing parses a sentence back. */
describe('pathReach: the newest is the catalogue newest, the same one the Builds card reads', () => {
	const names = [...new Set(apps('incident').items.map((a) => a.app))];
	it('every app: build is the catalogue newest, n counts the places on it, the sentence is its phrasing', () => {
		for (const app of names) {
			const r = pathReach({ app }, 'incident');
			const placeList = apps('incident').items.find((a) => a.app === app)!.placeList;
			expect(r.build, app).toBe(newestOf(appOrder(app, 'incident')) ?? r.build);
			expect(r.n, app).toBeLessThanOrEqual(r.m);
			expect(pathPosition({ app }, 'incident'), app).toBe(reachSentence(r));
			/* the Builds card's own count (places on the newest by build; failing places count here, the app tile excludes them) */
			expect(r.n, app).toBe(placeList.filter((p) => p.currency !== 'none' && p.onBuild).length || (placeList.every((p) => p.currency === 'none') ? placeList.filter((p) => p.onBuild).length : 0));
		}
	});
	it('the rollout rows print the same fact as the change page line', () => {
		for (const row of rollouts('incident').rows) {
			const r = pathReach(row, 'incident');
			const line = newestLine(row.app, 'incident');
			if (!r.m) continue;
			expect(line, row.app).toContain(String(r.m));
			expect(line.includes(`${r.n} of ${r.m}`) || r.n === r.m, row.app).toBe(true);
		}
	});
	it('phrases from the numbers', () => {
		expect(reachSentence({ n: 0, m: 0 })).toBe('Never deployed');
		expect(reachSentence({ n: 3, m: 3 })).toBe('All 3 places on the newest build');
		expect(reachSentence({ n: 1, m: 6 })).toBe('1 of 6 places on the newest build');
		expect(reachSentence({ n: 0, m: 1 })).toBe('0 of 1 place on the newest build');
	});
});
