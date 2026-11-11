import { it, expect, vi } from 'vitest';

/* a place without a release catalogue still has a health word and a running build; only the currency slot ("N behind" / "On the newest") says there is no source */
vi.mock('./data', async (orig) => ({ ...(await orig<typeof import('./data')>()), noReleasesAt: () => ({ label: 'No release source', message: '' }) }));
import * as D from './data';
import { rolloutsPage, sentenceOf } from './rollouts-page';

it('At rest rows keep the health word and the build id; the label sits in the currency slot', () => {
	const P = rolloutsPage('calm');
	expect(P.rest.length).toBeGreaterThan(0);
	for (const r of P.rest) {
		expect(r.sentence).toMatch(/^(Healthy|Rolled back) · No release source$/);
		expect(r.code).not.toBe('');
	}
});
it('an active row keeps its state word and appends the label', () => {
	const row = D.rollouts('incident').rows.find((r) => r.group === 'moving')!;
	const [lead, rest] = sentenceOf({ ...row, noReleases: { label: 'No release source', message: '' } } as never, 'incident' as never);
	expect(lead).toMatch(/^(Deploying|Checking)$/);
	expect(rest.endsWith('No release source')).toBe(true);
});
