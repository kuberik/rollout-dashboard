import { describe, it, expect } from 'vitest';
import { rollouts, ago, waitClock } from './data';
import { rolloutsPage } from './rollouts-page';
import { placeAge } from './app/app-model';

/* A row that covers SEVERAL places (payments-core: 5 of 6 prod regions folded) shows the LONGEST wait among them: the clock of the oldest held place.
   sa-east has waited 1d; the row's first place only 4h. Single-place rows are unchanged. */
const S = 'incident' as const;
const row = () => rollouts(S).rows.find((r) => r.app === 'payments-core' && r.tier === 'prod' && r.group === 'approval')!;

describe('multi-place wait clock (mock scenario incident)', () => {
	it('payments-core 5 of 6 prod regions reads "1d" on every surface that prints its wait', () => {
		const r = row();
		expect(r.regions).toHaveLength(5);
		expect(ago(waitClock(r, S))).toBe('1d');
		const page = rolloutsPage(S);
		const listed = page.groups.flatMap((g) => g.rows).find((x) => x.row.key === r.key);
		const card = page.attention.find((x) => x.row.key === r.key);
		expect(listed || card, 'the row is on the page').toBeTruthy();
		if (listed) expect(listed.age).toBe('1d');
		if (card) expect(card.model.forAge).toBe('for 1d');
		expect(placeAge(r, S)).toBe('1d');
	});
	it('a single-place row keeps its own clock', () => {
		const r = rollouts(S).rows.find((x) => x.app === 'invoice-api' && x.tier === 'prod' && x.group === 'approval')!;
		expect(ago(waitClock(r, S))).toBe('4h');
	});
});
