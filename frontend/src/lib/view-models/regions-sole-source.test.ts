import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { failedLiveLabel } from './fleet-facts';

/* QA #10: "regions" are SITES. These surfaces were fixed to take their count from regions.ts (siteCount / regionsPhrase) and must not
   grow a hand-rolled `${n} regions` again. (The older data-model surfaces still derive their count from a row's region labels.) */
const FIXED = ['lib/components/new/home-page.ts', 'lib/components/PromotionLane.svelte', 'lib/components/new/app/AppDetail.svelte', 'lib/components/new/environments-page.ts', 'lib/view-models/fleet-facts.ts'];
describe('region counts come from regions.ts', () => {
	for (const f of FIXED) it(f, () => {
		const src = readFileSync(`src/${f}`, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
		const bad = src.filter((l) => /`[^`]*\$\{[^}]*\}\s*(prod\s+|\$\{[^}]*\}\s+)?regions?\b/.test(l) && !/regionsPhrase|siteCount|sites\.size|ns\.length\} regions|\$\{k\} of/.test(l));
		expect(bad, bad.join('\n')).toEqual([]);
	});
	it('failedLiveLabel says no region for one prod site', () => {
		const f = { failed: { live: { apps: 3, regions: 1 } } } as never;
		expect(failedLiveLabel(f)).toBe('3 apps failing');
		expect(failedLiveLabel({ failed: { live: { apps: 3, regions: 2 } } } as never)).toBe('3 apps failing, incl. 2 regions');
	});
});
