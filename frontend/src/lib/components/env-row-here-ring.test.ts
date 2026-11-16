/** "You are here" round a mark that is itself a ring (recovered): never two touching concentric rings (a radio button); the cue steps out to a hairline with a gap. */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const s = readFileSync(resolve(__dirname, 'EnvRow.svelte'), 'utf8');

it('a here site whose mark is the recovered ring gets the stepped-out cue', () => {
	expect(s).toMatch(/class:env-site--here-ring=\{g\.some\(\(x\) => x\.here\) && waveMark\(g\)\.slices\.some\(\(x\) => x\.kind === 'recovered'\)\}/);
	const rule = s.slice(s.indexOf('.env-site--here.env-site--here-ring {'));
	expect(rule.slice(0, 200)).toMatch(/box-shadow: none;[\s\S]*outline: 1px solid var\(--k-fg-subtle\);[\s\S]*outline-offset: 2px;/);
});
it('every other here mark keeps the 1px ring', () => {
	expect(s).toMatch(/\.env-site--here \{\s*box-shadow: 0 0 0 1px var\(--k-fg-muted\);/);
});
