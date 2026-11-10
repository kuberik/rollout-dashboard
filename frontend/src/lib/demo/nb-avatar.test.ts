import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { respondHomeIncident, type HomeFixture } from './home-incident';
import { avatarFor } from './github-data';

/* r34 tabs-nb r2 (#1 TRUTH): one login, one face. A range the incident mock re-headlines from the
   fixture change (title AND author) must carry that author's avatar and the fixture repo's commit
   url too, or the tabs draw danielreed as "M" in the header and "A" in a Newer builds row. */
const fixture = JSON.parse(
	readFileSync(new URL('./../view-models/home/fixtures/incident-input.json', import.meta.url), 'utf8')
) as HomeFixture;
const now = new Date(Date.parse(fixture.capturedAt) + 3_600_000);

describe('incident mock: the re-headlined range commits', () => {
	it('every invoice-api range commit by a login has that login\'s one avatar and its own repo url', () => {
		const path = '/api/rollouts/invoice-api-prod-eu-west/invoice-api/commits';
		const seen = new Map<string, Set<string>>();
		for (const [base, head] of [['a11c808', 'a11c909'], ['a11c707', 'a11c808'], ['a11c101', 'a11c202']]) {
			const r = respondHomeIncident('GET', `${path}?base=${base}&head=${head}`, fixture, now);
			const j = JSON.parse(r?.body ?? '{"commits":[]}') as { commits: { author: string; avatarUrl: string; url: string }[] };
			for (const c of j.commits) {
				if (!seen.has(c.author)) seen.set(c.author, new Set());
				seen.get(c.author)!.add(c.avatarUrl);
				expect(c.avatarUrl).toBe(avatarFor(c.author));
				expect(c.url).not.toContain('unknown-service');
			}
		}
		expect(seen.size).toBeGreaterThan(0);
		for (const faces of seen.values()) expect(faces.size).toBe(1);
	});
});
