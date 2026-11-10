import { describe, expect, it } from 'vitest';
import catalogueRaw from './catalogue.txt?raw';

/**
 * ⭐ "PROD", NEVER "PRODUCTION" — GUARDED. (qa11 B5, 2026-10-11.) The dashboard
 * names the tier "prod" everywhere (`PromotionPipeline`'s fleet header,
 * `/environments`'s banner and "Prod regions" card, `/envs/<name>`'s preset
 * title, Home's deploy chart, `/apps`'s median-trip copy, the force-deploy
 * notice) — a stray "production" was still visible on four of those
 * surfaces for the SAME tier every other surface already shortens. This is
 * the census-level guard: `catalogue.txt` (`scan.ts`'s exhaustive literal
 * scan, checked by `drift.test.ts`) is the complete list of every
 * operator-visible string in the product, so a regex over it is a regex
 * over everything the user can read.
 */
describe('the tier is spelled "prod", never "production"', () => {
	it('no catalogued user-visible string says "production"', () => {
		const offenders = catalogueRaw
			.trimEnd()
			.split('\n')
			.filter(Boolean)
			.filter((line) => /\bproduction\b/i.test(line));

		expect(offenders).toEqual([]);
	});
});
