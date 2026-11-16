/** Gates tab, recovered head: the focus node draws the recovered ring (not the quiet green dot) and the sentence is the true one, not "Nothing is holding". */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(__dirname, '../routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte'), 'utf8');
const hood = readFileSync(resolve(__dirname, 'components/RolloutNeighbourhood.svelte'), 'utf8');

it('the focus node takes the recovered ring from the page', () => {
	expect(page).toMatch(/focusRecovered=\{headRecovered\}/);
	expect(hood).toMatch(/<StatusMark state=\{focusRecovered \? 'failed' : focusHeldBuilds\.length > 0 \? 'held' : 'newest'\} recovered=\{focusRecovered\} \/>/);
});
it('a recovered head says what releases it, before the "Nothing is holding" fallback', () => {
	const rec = page.indexOf('{:else if headRecovered}');
	expect(rec).toBeGreaterThan(0);
	expect(page.slice(rec, rec + 400)).toContain('checkHoldSentence(true)');
	expect(rec).toBeLessThan(page.indexOf('Nothing is holding this rollout.'));
});
