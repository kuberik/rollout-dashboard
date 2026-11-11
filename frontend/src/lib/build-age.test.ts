import { describe, it, expect } from 'vitest';
import { buildAge } from './utils';

/* batch4 P1: a build's own age is never a wait clock. Where it is printed (Newer builds rows) it says so: "built 2h ago". */
describe('buildAge', () => {
	const now = new Date('2026-11-11T12:00:00Z');
	it('labels the build age as the build\'s own', () => {
		expect(buildAge('2026-11-11T10:00:00Z', now)).toBe('built 2h ago');
		expect(buildAge('2026-11-11T11:19:00Z', now)).toBe('built 41m ago');
	});
});
