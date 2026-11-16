/** The /activity section headers fold their deploy count on a phone when failure counts follow it, so the header stays one line (as the env page's Today header does). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deploysRollupParts } from '$lib/view-models/activity-groups';
import { foldsOnPhone } from '$lib/view-models/rollup-fold';

describe('activity headers: the deploy count folds on a phone', () => {
	it('the Deploys header: the count is a fold part, the failure counts stay', () => {
		const [count, ...rest] = deploysRollupParts(84, 6, 2);
		expect(foldsOnPhone(count)).toBe(true);
		expect(rest.every((p) => !foldsOnPhone(p))).toBe(true);
	});
	it('the day cards ("In the last hour", the days): the count folds when a failure follows it', () => {
		const src = readFileSync(resolve(__dirname, '+page.svelte'), 'utf8');
		expect(src).toContain("[out.tone === 'adverse' ? { text: noun, fold: true } : noun]");
	});
});
