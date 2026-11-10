import { describe, it, expect } from 'vitest';
import { absenceFor } from './data';

describe('absenceFor (QA #9, #20): GitHub absent is a reason with a remedy', () => {
	it('ok is no absence', () => expect(absenceFor('ok')).toBeNull());
	it('not_connected offers Connect', () => {
		const a = absenceFor('not_connected')!;
		expect(a.connect).toBe(true);
		expect(a.sentence).toMatch(/not connected/);
		expect(a.title).toBe('Changes need GitHub');
	});
	it('not_configured has no Connect (an admin has to act)', () => {
		const a = absenceFor('not_configured')!;
		expect(a.connect).toBe(false);
		expect(a.sentence).toMatch(/not configured/);
	});
	it('error says GitHub did not answer, no Connect', () => {
		expect(absenceFor('error')).toMatchObject({ kind: 'error', connect: false });
	});
	it('loading is its own kind', () => expect(absenceFor('loading')?.kind).toBe('loading'));
});
