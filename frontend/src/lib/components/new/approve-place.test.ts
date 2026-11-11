import { describe, it, expect } from 'vitest';
import { approvePlace, ownCard, MIN_W } from './approve-place';

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
		it('Home attention card at 1024 and 700, trigger narrower than 260: panel is at least 280 wide and inside main', () => {
			for (const [vw, card, btn] of [[1024, { left: 256, right: 425 }, [277, 404]], [700, { left: 256, right: 451 }, [277, 430]]] as const) {
				const p = approvePlace({ top: 400, left: btn[0], right: btn[1], bottom: 430 }, vw, 800, { left: 240, right: vw }, undefined, card);
				expect(p.width).toBeGreaterThanOrEqual(280);
				expect(p.left).toBeGreaterThanOrEqual(248);
				expect(p.left + p.width).toBeLessThanOrEqual(vw - 8);
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
	it('a 169px card does not shrink the panel below 280px; it extends past the card, inside main', () => {
		const card = { left: 256, right: 425 };
		const p = approvePlace({ top: 400, left: 277, right: 404, bottom: 430 }, 1024, 768, { left: 240, right: 1024 }, undefined, card);
		expect(p.width).toBeGreaterThanOrEqual(MIN_W);
		expect(p.left).toBeGreaterThanOrEqual(248);
		expect(p.left + p.width).toBeLessThanOrEqual(1016);
	});
	it('flips above when the measured panel height would run past the viewport foot (1024x768, button bottom 606)', () => {
		const a = { top: 570, left: 277, right: 404, bottom: 606 };
		expect(approvePlace(a, 1024, 768, { left: 240, right: 1024 }, undefined, null, 166)).toHaveProperty('bottom');
		expect(approvePlace(a, 1024, 768, { left: 240, right: 1024 }, undefined, null, 130)).toHaveProperty('top');
	});
	describe('ownCard', () => {
		const rect = (l: number, r: number) => ({ getBoundingClientRect: () => ({ top: 0, left: l, right: r, bottom: 100, width: r - l }) });
		it('finds the nearest bordered, rounded ancestor wider than the trigger; null on a bare row', () => {
			const style = (b: string, rad: string) => ({ borderTopWidth: b, borderTopLeftRadius: rad }) as CSSStyleDeclaration;
			const card = { tagName: 'DIV', parentElement: { tagName: 'MAIN' }, ...rect(256, 584) } as unknown as HTMLElement;
			const plain = { tagName: 'DIV', parentElement: card, ...rect(270, 570) } as unknown as HTMLElement;
			const btn = { parentElement: plain, getBoundingClientRect: () => ({ width: 286 }) } as unknown as HTMLElement;
			const map = new Map<unknown, CSSStyleDeclaration>([[plain, style('0px', '0px')], [card, style('1px', '8px')]]);
			const orig = globalThis.getComputedStyle;
			globalThis.getComputedStyle = ((e: Element) => map.get(e)) as typeof getComputedStyle;
			try {
				expect(ownCard(btn)).toEqual({ top: 0, left: 256, right: 584, bottom: 100 });
				map.set(card, style('0px', '0px'));
				expect(ownCard(btn)).toBeNull();
			} finally { globalThis.getComputedStyle = orig; }
		});
		/* each clause of the rule must be load-bearing: a card needs a border AND rounded corners AND to be wider than the trigger */
		const probe = (b: string, rad: string, cardL: number, cardR: number, w = 286) => {
			const card = { tagName: 'DIV', parentElement: { tagName: 'MAIN' }, ...rect(cardL, cardR) } as unknown as HTMLElement;
			const btn = { parentElement: card, getBoundingClientRect: () => ({ width: w }) } as unknown as HTMLElement;
			const orig = globalThis.getComputedStyle;
			globalThis.getComputedStyle = (() => ({ borderTopWidth: b, borderTopLeftRadius: rad })) as unknown as typeof getComputedStyle;
			try { return ownCard(btn); } finally { globalThis.getComputedStyle = orig; }
		};
		it('a border without rounded corners is not a card', () => { expect(probe('1px', '0px', 256, 584)).toBeNull(); });
		it('rounded corners without a border is not a card', () => { expect(probe('0px', '8px', 256, 584)).toBeNull(); });
		it('an ancestor not wider than the trigger (within 10px) is not a card; wider than that is', () => {
			expect(probe('1px', '8px', 270, 556)).toBeNull(); // 286 wide = the trigger
			expect(probe('1px', '8px', 270, 566)).toBeNull(); // 296 = trigger + 10: not wider enough
			expect(probe('1px', '8px', 270, 567)).toEqual({ top: 0, left: 270, right: 567, bottom: 100 });
		});
	});
});
