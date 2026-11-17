/** "You are here" round a mark that is itself a ring (recovered): never a second ring (a target); the current box's border carries "here". */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const s = readFileSync(resolve(__dirname, 'EnvRow.svelte'), 'utf8');

it('a here site whose mark is the recovered ring draws no ring of its own', () => {
	expect(s).toMatch(/class:env-site--here-ring=\{g\.some\(\(x\) => x\.here\) && waveMark\(g\)\.slices\.some\(\(x\) => x\.kind === 'recovered'\)\}/);
	const rule = s.slice(s.indexOf('.env-site--here.env-site--here-ring {'));
	const body = rule.slice(0, rule.indexOf('}'));
	expect(body).toMatch(/box-shadow: none;/);
	expect(body).not.toMatch(/outline/);
});
it('every other here mark keeps the 1px ring', () => {
	expect(s).toMatch(/\.env-site--here \{\s*box-shadow: 0 0 0 1px var\(--k-fg-muted\);/);
});
