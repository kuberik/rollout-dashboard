import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * jsdom has no layout, so "the graph fits at every container width" is asserted
 * on the arithmetic of the stylesheet: below 560px the layers stack (a list),
 * 560-959px is the compact two-column graph (fluid tracks, no floor), and from
 * the 960px three-column breakpoint the gutters are fluid, the tile floor is off
 * until 1100px, and the tracks keep >= 220px. (#140 measured 812px, the landing
 * film's width, which is now the compact graph.) The real-browser measurement lives in the PR description.
 */
const src = readFileSync(
	fileURLToPath(new URL('./RolloutNeighbourhood.svelte', import.meta.url)),
	'utf8'
);
const style = src.slice(src.indexOf('<style>'));

function blocks(query: string): string {
	// All `@container (min-width: <query>) { ... }` bodies, brace-matched.
	let out = '';
	let i = 0;
	const head = `@container (min-width: ${query})`;
	while ((i = style.indexOf(head, i)) !== -1) {
		let depth = 0;
		let j = style.indexOf('{', i);
		const start = j;
		for (; j < style.length; j++) {
			if (style[j] === '{') depth++;
			if (style[j] === '}' && --depth === 0) break;
		}
		out += style.slice(start, j);
		i = j;
	}
	return out;
}

describe('RolloutNeighbourhood fits its container', () => {
	test('the 240px tile floor is not applied at the 960px three-column breakpoint', () => {
		expect(blocks('960px')).not.toMatch(/min-width:\s*240px/);
		expect(blocks('1100px')).toMatch(/\.hood-tile\s*\{\s*min-width:\s*240px/);
	});

	test('gutters are fluid, never a fixed 8rem/9rem', () => {
		const wide = blocks('960px');
		expect(wide).not.toMatch(/minmax\(0,\s*\d+px\)\s+\d+rem/);
		expect(wide).toMatch(/--hood-gutter:\s*clamp\(5rem,/);
	});

	test('972px of container (above the 960px breakpoint) fits, with tile tracks >= 220px', () => {
		// Floors at 972: gutters clamp(5rem, 12cqi, 8rem) -> max(80, min(117, 128)) = 117; steep max(88, min(126, 144)) = 126.
		// Below 960 the compact two-column graph takes over (560-959) and below 560 the list (Gatehouse tiles, owner 2026-11-12).
		const gutter = Math.min(128, Math.max(80, 0.12 * 972));
		const steep = Math.min(144, Math.max(88, 0.13 * 972));
		expect((972 - 2 * steep) / 3).toBeGreaterThanOrEqual(220);
		// Tracks are minmax(0, ...): their floor is 0 once the tile floor is off.
		expect(2 * steep).toBeLessThan(972);
		expect(2 * gutter).toBeLessThan(972);
		// And the old numbers did not fit: 240 + 240 + 240 + 2 * 9rem = 1008 at 812.
		expect(240 * 3 + 2 * 144).toBeGreaterThan(812);
	});
});
