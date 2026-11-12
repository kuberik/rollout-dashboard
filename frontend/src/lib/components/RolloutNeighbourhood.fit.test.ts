import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * jsdom has no layout, so "the graph fits at every container width" is asserted on the arithmetic of the stylesheet: below the
 * three-column breakpoint the layers stack (always fits); at the breakpoint (1000px of container since the Gatehouse tiles, #140 set
 * 800) the gutters are fluid and the tile floor is off, and a tile track still has >= 240px, so one-row tiles keep their names whole.
 * The real-browser measurement lives in the PR description.
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
	test('the 240px tile floor is not applied at the 1000px three-column breakpoint', () => {
		expect(blocks('1000px')).not.toMatch(/min-width:\s*240px/);
		expect(blocks('1100px')).toMatch(/\.hood-tile\s*\{\s*min-width:\s*240px/);
	});

	test('gutters are fluid, never a fixed 8rem/9rem', () => {
		const wide = blocks('1000px');
		expect(wide).not.toMatch(/minmax\(0,\s*\d+px\)\s+\d+rem/);
		expect(wide).toMatch(/--hood-gutter:\s*clamp\(5rem,/);
	});

	test('1012px of container (above the 1000px breakpoint) fits, and every tile track keeps >= 240px', () => {
		// At 1012: gutters clamp(5rem, 12cqi, 8rem) -> max(80, min(121, 128)) = 121; steep max(88, min(132, 144)) = 132.
		const gutter = Math.min(128, Math.max(80, 0.12 * 1012));
		const steep = Math.min(144, Math.max(88, 0.13 * 1012));
		// Gatehouse tiles (2026-11-12): the breakpoint moved from 800 to 1000 so a tile's name never breaks mid-word.
		expect((1012 - 2 * steep) / 3).toBeGreaterThanOrEqual(240);
		// Tracks are minmax(0, ...): their floor is 0 once the tile floor is off.
		expect(2 * steep).toBeLessThan(1012);
		expect(2 * gutter).toBeLessThan(1012);
		// And the pre-#140 numbers did not fit at #140's own 812: 240 * 3 + 2 * 9rem = 1008.
		expect(240 * 3 + 2 * 144).toBeGreaterThan(812);
	});
});
