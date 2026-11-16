import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The failing/failed ink rule lives in state-words (`failedInkParts` / `failedRollup`); a rollup never maps a word to its ink by hand. */
it.each(['view-models/activity-groups.ts', 'components/new/changes-page.ts', 'view-models/repo-card.ts'])('%s takes the failure ink from the shared helper', (f) => {
	const src = readFileSync(resolve(__dirname, '..', f), 'utf8');
	expect(src).not.toMatch(/endsWith\(\s*['"` ]\s*failing/);
	expect(src).toMatch(/failedRollup|failedInkParts/);
});
