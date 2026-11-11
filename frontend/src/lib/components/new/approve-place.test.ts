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
	describe('inside the trigger\'s own card (measured numbers)', () => {
		const out = (p: { left: number; width: number }, c: { left: number; right: number }) => Math.max(0, c.left - p.left) + Math.max(0, p.left + p.width - c.right);
		it('/apps 1440: a right-aligned button in a half-width card anchors its right edge, 0px outside', () => {
			const card = { left: 256, right: 821 };
			const p = approvePlace({ top: 739, left: 693, right: 800, bottom: 771 }, 1440, 900, main, undefined, card);
			expect(out(p, card)).toBe(0);
			expect(p.left + p.width).toBe(800);
		});
		it('/apps 1024: 0px outside the card', () => {
			const card = { left: 256, right: 613 };
			const m = { left: 240, right: 1024 };
			const p = approvePlace({ top: 400, left: 490, right: 597, bottom: 430 }, 1024, 768, m, undefined, card);
			expect(out(p, card)).toBe(0);
		});
		it('Home attention card at 1024 and 700, trigger narrower than 260: panel fits the card', () => {
			for (const [vw, card, btn] of [[1024, { left: 256, right: 425 }, [277, 404]], [700, { left: 256, right: 451 }, [277, 430]]] as const) {
				const p = approvePlace({ top: 400, left: btn[0], right: btn[1], bottom: 430 }, vw, 800, { left: 240, right: vw }, undefined, card);
				expect(out(p, card)).toBe(0);
			}
		});
		it('left-aligned button anchors the left edge; /rollouts 1440 stays 0 outside; /changes flips to the right edge', () => {
			const r = { left: 1030, right: 1401 };
			const p = approvePlace({ top: 420, left: 1051, right: 1162, bottom: 456 }, 1440, 900, main, undefined, r);
			expect(p.left).toBe(1051);
			expect(out(p, r)).toBe(0);
			const c = { left: 837, right: 1401 };
			const q = approvePlace({ top: 453, left: 1132, right: 1243, bottom: 489 }, 1440, 900, main, undefined, c);
			expect(q.left + q.width).toBe(1243);
		});
	});
});
