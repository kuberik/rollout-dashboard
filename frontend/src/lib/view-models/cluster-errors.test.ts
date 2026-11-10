import { it, expect } from 'vitest';
import { clusterErrorsFor } from './cluster-errors';
const e = (name: string) => ({ url: `https://${name}`, name, error: 'timeout' });
it('keeps only the errors naming this rollout\'s cluster', () => {
	expect(clusterErrorsFor([e('prod'), e('dev')], 'prod')).toEqual([e('prod')]);
	expect(clusterErrorsFor([e('dev')], 'prod')).toEqual([]);
	expect(clusterErrorsFor(undefined, 'prod')).toEqual([]);
});

import { readFileSync } from 'node:fs';
it('A10: the notice formats the last-seen time with the shared display-zone formatter, not toLocaleTimeString', () => {
	const src = readFileSync('src/lib/components/PartialDataNotice.svelte', 'utf8');
	expect(src).not.toMatch(/toLocaleTimeString/);
	expect(src).toMatch(/formatClockTime/);
});
