import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

/** Body of every `@media (prefers-reduced-motion: reduce)` block. */
function reducedBlocks(): string[] {
	const out: string[] = [];
	const re = /@media \(prefers-reduced-motion: reduce\)\s*\{/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(css))) {
		let depth = 1;
		let i = re.lastIndex;
		while (depth > 0 && i < css.length) {
			if (css[i] === '{') depth++;
			else if (css[i] === '}') depth--;
			i++;
		}
		out.push(css.slice(re.lastIndex, i - 1));
	}
	return out;
}

describe('prefers-reduced-motion', () => {
	it('stops every looping Tailwind animation utility the product uses', () => {
		const joined = reducedBlocks().join('\n');
		for (const cls of ['animate-spin', 'animate-pulse', 'animate-ping']) {
			expect(joined).toContain(`.${cls}`);
		}
		expect(joined).toMatch(/animation:\s*none/);
	});
});
