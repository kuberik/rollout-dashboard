import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdHeight } from './smooth-height';

/** A ResizeObserver whose callback the test drives by hand. */
let fire: (h: number) => void = () => {};
class FakeRO {
	constructor(cb: ResizeObserverCallback) {
		fire = (h) => cb([{ borderBoxSize: [{ blockSize: h }] } as unknown as ResizeObserverEntry], this as never);
	}
	observe() {}
	disconnect() {}
}

describe('holdHeight', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('ResizeObserver', FakeRO);
		vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1440 }));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('keeps the tallest height across live updates, and drops it on a width change', () => {
		const node = { style: { minHeight: '' }, offsetHeight: 0 } as unknown as HTMLElement;
		const a = holdHeight(node);
		fire(80);
		fire(60); // live data made the row shorter: held
		expect(node.style.minHeight).toBe('80px');

		// A height-only resize (mobile URL bar) keeps it.
		window.dispatchEvent(new Event('resize'));
		vi.advanceTimersByTime(200);
		expect(node.style.minHeight).toBe('80px');

		// A width change (resize / rotation) releases it after the debounce.
		(window as unknown as { innerWidth: number }).innerWidth = 390;
		window.dispatchEvent(new Event('resize'));
		vi.advanceTimersByTime(100);
		expect(node.style.minHeight).toBe('80px');
		vi.advanceTimersByTime(100);
		expect(node.style.minHeight).toBe('');

		// It re-measures from scratch at the new width.
		fire(120);
		fire(100);
		expect(node.style.minHeight).toBe('120px');
		a.destroy?.();
	});

	it('releases when the reset key changes', () => {
		const node = { style: { minHeight: '' }, offsetHeight: 0 } as unknown as HTMLElement;
		const a = holdHeight(node, 'x');
		fire(80);
		a.update?.('y');
		expect(node.style.minHeight).toBe('');
	});
});
