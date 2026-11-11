import { describe, it, expect } from 'vitest';
import { approvePlace } from './approve-place';

const main = { left: 240, right: 1440 }; // sidebar 240 wide
describe('approve popover placement', () => {
	it('stays inside main when the trigger sits at main\'s left edge (not over the sidebar)', () => {
		const p = approvePlace({ top: 100, left: 260, right: 340, bottom: 130 }, 1440, 900, main);
		expect(p.left).toBeGreaterThanOrEqual(main.left + 8);
	});
	it('stays inside main on the right edge', () => {
		const p = approvePlace({ top: 100, left: 1300, right: 1430, bottom: 130 }, 1440, 900, main);
		expect(p.left + p.width).toBeLessThanOrEqual(main.right - 8);
	});
	it('hangs under its own button: left edge to the trigger left when there is room', () => {
		const p = approvePlace({ top: 0, left: 700, right: 800, bottom: 30 }, 1440, 900, main);
		expect(p.left).toBe(700);
		expect(p.left).toBeLessThanOrEqual(800);
	});
	it('flips to the trigger right edge when start-aligned would run past main', () => {
		const p = approvePlace({ top: 0, left: 1250, right: 1360, bottom: 30 }, 1440, 900, main);
		expect(p.left + p.width).toBe(1360);
	});
	it('a full-width card button gives the panel its own width, inside the card', () => {
		const p = approvePlace({ top: 0, left: 277, right: 563, bottom: 30 }, 1440, 900, main);
		expect(p.left).toBe(277);
		expect(p.left + p.width).toBe(563);
	});
	it('falls back to the viewport without bounds', () => {
		expect(approvePlace({ top: 0, left: 0, right: 50, bottom: 30 }, 1000, 900).left).toBe(8);
	});
	it('flips above near the foot', () => {
		expect(approvePlace({ top: 800, left: 700, right: 800, bottom: 830 }, 1440, 900, main)).toHaveProperty('bottom', 108);
	});
});
