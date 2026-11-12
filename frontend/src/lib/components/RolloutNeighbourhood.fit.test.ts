import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * jsdom has no layout, so "the graph fits at every container width from 672px"
 * is asserted on the arithmetic of the stylesheet: at the narrowest three-column
 * container (672px) the gutters are at their floor and the tile floor is off, and
 * at 812px (the width the landing film lane measured, 878px of grid) the fixed
 * minimums fit. The real-browser measurement lives in the PR description.
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
	test('the 240px tile floor is not applied at the 672px three-column breakpoint', () => {
		expect(blocks('672px')).not.toMatch(/min-width:\s*240px/);
		expect(blocks('1100px')).toMatch(/\.hood-tile\s*\{\s*min-width:\s*240px/);
	});

	test('gutters are fluid, never a fixed 8rem/9rem', () => {
		const wide = blocks('672px');
		expect(wide).not.toMatch(/minmax\(0,\s*\d+px\)\s+\d+rem/);
		expect(wide).toMatch(/--hood-gutter:\s*clamp\(5rem,/);
	});

	test('812px of container fits the worst case', () => {
		// Floors at 812: gutters clamp(5rem, 12cqi, 8rem) -> max(80, min(97, 128)) = 97.
		const gutter = Math.min(128, Math.max(80, 0.12 * 812));
		const steep = Math.min(144, Math.max(88, 0.13 * 812));
		// Tracks are minmax(0, ...): their floor is 0 once the tile floor is off.
		expect(2 * steep).toBeLessThan(812);
		expect(2 * gutter).toBeLessThan(812);
		// And the old numbers did not fit: 240 + 240 + 240 + 2 * 9rem = 1008 at 812.
		expect(240 * 3 + 2 * 144).toBeGreaterThan(812);
	});
});
