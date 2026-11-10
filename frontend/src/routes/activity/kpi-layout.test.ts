import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

describe('Activity KPI head layout', () => {
	it('lays out by the chart card width (container query), not by viewport utilities', () => {
		const tag = /<div class="act-kpis[^"]*"[^>]*>/.exec(src)?.[0] ?? '';
		expect(tag).not.toMatch(/grid-cols|sm:/);
		expect(src).toMatch(/\.act-chart \{ container-type: inline-size; \}/);
		expect(src).toMatch(/@container \(min-width: 32rem\) \{\s*\.act-kpis \{ grid-template-columns: repeat\(4,/);
		expect(src).toMatch(/\.act-kpis \{ display: grid; grid-template-columns: repeat\(2,/);
	});
});
