import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A deploy row's Roll back and View diff have a reserved column of their own at hover-capable widths: the summary truncates before it and
 * nothing slides over the text or the date. jsdom has no layout, so this pins the class contracts the browser measurement relies on.
 */
const src = readFileSync(resolve(__dirname, '+page.svelte'), 'utf8');
const slotAt = src.indexOf('data-row-actions');
const timeAt = src.indexOf('<div class="hidden shrink-0 text-right sm:block">');
const slot = src.slice(slotAt, timeAt);
const time = src.slice(timeAt, src.indexOf('Expand affordance', timeAt));

describe('History deploy row: the actions have their own column, nothing slides over text', () => {
	test('the action column is a reserved, in-flow lg column before the time', () => {
		expect(slotAt).toBeGreaterThan(0);
		expect(timeAt).toBeGreaterThan(slotAt);
		const open = src.slice(src.lastIndexOf('<div', slotAt), slotAt);
		expect(open).toMatch(/\bhidden\b/);
		expect(open).toMatch(/\bw-52\b/);
		expect(open).toMatch(/\bshrink-0\b/);
		expect(open).toMatch(/\blg:flex\b/);
		expect(slot).toContain('Roll back to this build');
	});
	test('no absolutely positioned overlay on the row, and the buttons are hidden at rest', () => {
		expect(slot).not.toMatch(/\babsolute\b/);
		expect(time).not.toMatch(/\babsolute\b|group-hover:opacity-0|group-focus-within:opacity-0/);
		expect(slot).toMatch(/\bopacity-0\b/);
		expect(slot).toMatch(/lg:group-hover:opacity-100/);
	});
	test('the time column holds only the clock and the age', () => {
		expect(time).toContain('clockTime(entry.timestamp)');
		expect(time).not.toContain('btn');
	});
});
