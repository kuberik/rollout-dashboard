import { describe, test, expect } from 'vitest';
import { ScrollDirectionTracker } from './scroll-direction.svelte';

describe('ScrollDirectionTracker', () => {
	test('starts shown', () => {
		expect(new ScrollDirectionTracker().hidden).toBe(false);
	});

	test('stays shown while under the threshold, even scrolling down', () => {
		const t = new ScrollDirectionTracker(24);
		t.update(5);
		t.update(15);
		t.update(24);
		expect(t.hidden).toBe(false);
	});

	test('hides on downward movement once past the threshold', () => {
		const t = new ScrollDirectionTracker(24);
		t.update(10);
		t.update(40);
		expect(t.hidden).toBe(true);
	});

	test('any upward movement reveals it immediately, however far down the page is', () => {
		const t = new ScrollDirectionTracker(24);
		t.update(10);
		t.update(600);
		expect(t.hidden).toBe(true);
		t.update(599); // 1px up
		expect(t.hidden).toBe(false);
	});

	test('is always shown at or below the threshold, even arriving downward from a hidden state', () => {
		const t = new ScrollDirectionTracker(24);
		t.update(10);
		t.update(500);
		expect(t.hidden).toBe(true);
		// A downward-continuing sequence that lands AT the threshold is still
		// "at the top" and must show, even though the last delta was still
		// positive (500 → 600 → ... would keep hiding past it).
		t.update(600);
		expect(t.hidden).toBe(true);
		t.reset();
		t.update(600);
		t.update(24);
		expect(t.hidden).toBe(false);
	});

	test('no movement leaves the current state alone', () => {
		const t = new ScrollDirectionTracker(24);
		t.update(10);
		t.update(500);
		expect(t.hidden).toBe(true);
		t.update(500);
		expect(t.hidden).toBe(true);
	});

	test('direction flips repeatedly track the most recent movement', () => {
		const t = new ScrollDirectionTracker(24);
		t.update(100);
		t.update(200); // down → hidden
		expect(t.hidden).toBe(true);
		t.update(180); // up → shown
		expect(t.hidden).toBe(false);
		t.update(220); // down → hidden
		expect(t.hidden).toBe(true);
		t.update(210); // up → shown
		expect(t.hidden).toBe(false);
	});

	test('reset() shows the header and forgets the last position', () => {
		const t = new ScrollDirectionTracker(24);
		t.update(10);
		t.update(500);
		expect(t.hidden).toBe(true);
		t.reset();
		expect(t.hidden).toBe(false);
		// Immediately after reset, the next sample is measured from 0 again —
		// landing at 30 reads as downward movement past the threshold.
		t.update(30);
		expect(t.hidden).toBe(true);
	});

	test('reset(y) seeds the baseline at a restored scroll offset, not always 0', () => {
		const t = new ScrollDirectionTracker(24);
		t.update(10);
		t.update(500);
		expect(t.hidden).toBe(true);
		// A reload restored the browser's previous scroll offset (570) before
		// this ran. Seeding from 0 here would make the next upward sample
		// read as a huge false "downward" jump; seeding from the real offset
		// makes small movements around it read correctly.
		t.reset(570);
		expect(t.hidden).toBe(false);
		t.update(560); // a real 10px upward scroll
		expect(t.hidden).toBe(false);
		t.update(590); // a real 30px downward scroll, still past the threshold
		expect(t.hidden).toBe(true);
	});

	test('a custom threshold is honoured', () => {
		const t = new ScrollDirectionTracker(100);
		t.update(50);
		t.update(90);
		expect(t.hidden).toBe(false); // still under 100
		t.update(150);
		expect(t.hidden).toBe(true);
	});
});
