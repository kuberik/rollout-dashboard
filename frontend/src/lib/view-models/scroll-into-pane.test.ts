import { describe, expect, it } from 'vitest';
import { paneScrollDelta } from './scroll-into-pane';

describe('paneScrollDelta', () => {
	const pane = { top: 100, bottom: 500 };
	it('a field inside the pane needs no scroll', () => {
		expect(paneScrollDelta(pane, { top: 300, bottom: 340 })).toBe(0);
		expect(paneScrollDelta(pane, { top: 100, bottom: 476 })).toBe(0);
	});
	it('a field below the pane, or under its bottom fade, scrolls down by what covers it plus the margin', () => {
		expect(paneScrollDelta(pane, { top: 480, bottom: 520 })).toBe(52);
		expect(paneScrollDelta(pane, { top: 450, bottom: 490 })).toBe(22);
	});
	it('a field above the pane scrolls up', () => {
		expect(paneScrollDelta(pane, { top: 80, bottom: 120 })).toBe(-28);
	});
});
