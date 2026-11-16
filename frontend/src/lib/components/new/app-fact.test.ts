import { describe, it, expect } from 'vitest';
import { outcomeOf } from './data';

describe('the app row fact says failed for a recovered failure, failing while a check fails now', () => {
	const row = (recovered?: boolean) => ({ group: 'failed', state: 'failed', where: 'production', word: 'Failing', failure: recovered === undefined ? null : { recovered } }) as never;
	it('live failure', () => expect(outcomeOf(row(false))).toBe('Failing in production'));
	it('no health evidence', () => expect(outcomeOf(row())).toBe('Failing in production'));
	it('recovered', () => expect(outcomeOf(row(true))).toBe('Failed in production'));
});
