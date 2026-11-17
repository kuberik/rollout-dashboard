import { describe, expect, it } from 'vitest';
import { markRecoveredOf, type TRow } from './rollout-view';

const row = (group: string, failure: unknown) => ({ group, failure }) as unknown as TRow;

/** Only a positive recovered flag on a failed row draws the ring; "not known yet" (no health evidence) stays the solid disc. */
describe('markRecoveredOf', () => {
	it('a failed row with recovered checks', () => expect(markRecoveredOf(row('failed', { recovered: true }))).toBe(true));
	it('a failing-now or unknown failure is not', () => {
		expect(markRecoveredOf(row('failed', { recovered: false }))).toBe(false);
		expect(markRecoveredOf(row('failed', null))).toBe(false);
	});
	it('another group never is', () => expect(markRecoveredOf(row('held', { recovered: true }))).toBe(false));
});
