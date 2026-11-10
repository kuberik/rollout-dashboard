import { describe, it, expect } from 'vitest';
import * as D from './data';
import { rides, folioFacts } from './change-view';
import { rideTruth } from './change-truth';

const rs = () => {
	const C = D.changes('incident', { rolledBackLands: true });
	const R = D.rollouts('incident');
	return rides(C.items.filter((i) => !i.rolledBack), R.rows, C.lead?.key ?? null, (c) => rideTruth(c, 'incident'));
};

describe('changes-8', () => {
	it('Y1: the failing lead prints the change own commit and author (the History tab), not the release boilerplate', () => {
		const r = rs().find((x) => x.items.some((c) => c.key === 'invoice-api#37'))!;
		const f = folioFacts(r);
		const k = f.commits.find((c) => c.sha === 'a11c202')!;
		expect(k).toBeTruthy();
		expect(k.title).toBe('Retry webhook delivery with exponential backoff');
		expect(k.author).toBe('danielreed');
		expect(f.commits.some((c) => /^Release commit for build/.test(c.title))).toBe(false);
	});
});
