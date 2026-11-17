import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A deploy row's hover actions (Roll back, View diff) sit BESIDE the time column, never over it: the clock and the age are what a reader
 * hovers a row to read, so they stay at full opacity and the overlay is anchored to the column's left edge. jsdom has no layout, so this
 * pins the two class contracts the browser measurement relies on.
 */
const src = readFileSync(resolve(__dirname, '+page.svelte'), 'utf8');
const start = src.indexOf('<div class="relative hidden shrink-0 text-right sm:block">');
const column = src.slice(start, src.indexOf('Expand affordance', start));

describe('History deploy row: hover actions never cover the date', () => {
	test('the time column is found', () => {
		expect(start).toBeGreaterThan(0);
		expect(column).toContain('clockTime(entry.timestamp)');
	});
	test('the clock and the age do not fade on hover or focus', () => {
		expect(column).not.toMatch(/group-hover:opacity-0|group-focus-within:opacity-0/);
	});
	test('the overlay is anchored left of the column, desktop only, hidden at rest', () => {
		const overlay = column.match(/class="(pointer-events-none absolute[^"]*)"/)?.[1] ?? '';
		expect(overlay).toMatch(/\bright-full\b/);
		expect(overlay).not.toMatch(/\bright-0\b/);
		expect(overlay).toMatch(/\bhidden\b/);
		expect(overlay).toMatch(/\blg:flex\b/);
		expect(overlay).toMatch(/\bopacity-0\b/);
	});
});
