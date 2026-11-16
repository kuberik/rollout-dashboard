/** The /activity chart marker and the failure banner lead with a failure failing now; a recovered one is neutral and follows. */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(__dirname, '+page.svelte'), 'utf8');
const bars = readFileSync(resolve(__dirname, '../../lib/components/charts/DeployBars.svelte'), 'utf8');

it('the banner reads the failing-now failures first', () => {
	const i = page.indexOf('const unresolvedFailures = $derived(');
	expect(i).toBeGreaterThan(0);
	expect(page.slice(i, i + 260)).toMatch(/isHeadRecovered\(e\)[\s\S]*sort\(\(a, b\) => Number\(a\.over\) - Number\(b\.over\)\)/);
});
it('a recovered live failure marks its chart pill recovered, and the pill, line and on-series dot draw the neutral ink', () => {
	expect(page).toMatch(/recovered: e\.isLive && checksKnown && isHeadRecovered\(e\)/);
	expect(bars.match(/m\.resolved \|\| m\.recovered \? 'resolved'/g)?.length).toBe(2);
	expect(bars).toMatch(/bad\.resolved \|\| bad\.recovered \? 'resolved'/);
});
