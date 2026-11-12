import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { newestBuild, placeHolds } from './data';

/* batch4: the nested Slipway's compact "Newer builds" row counts what the place's own tab offers, labelled "To deploy" (checkout-api af-south-1: the app page counts 5 in the catalogue, the tab lists 4) */
describe('newestBuild carries the tab\'s own count beside the catalogue distance', () => {
	it('checkout-api af-south-1: 5 behind in the catalogue, 4 to deploy on its tab', () => {
		const af = placeHolds('checkout-api', 'incident').find((p) => p.label === 'af-south-1')!;
		const row = { app: 'checkout-api', href: af.href, state: af.state, word: '' } as never;
		const nb = newestBuild(row)!;
		expect(nb.count).toBe(5);
		expect(nb.toDeploy).toBe(4);
		expect(nb.toDeploy).toBe(af.heldBuilds.length);
	});
	it('the compact Slipway prints toDeploy under the label "To deploy", never the catalogue count', () => {
		const src = readFileSync('src/lib/components/new/Slipway.svelte', 'utf8');
		expect(src).toContain("label: 'To deploy'");
		expect(src).toContain('${n.toDeploy}');
		expect(src).not.toContain("label: 'Newer builds'");
	});
});
