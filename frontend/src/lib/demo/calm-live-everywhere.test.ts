import { describe, expect, it } from 'vitest';
import { resetDemoState } from './state';
import { respond } from './respond';
import { respondGithub, DEMO_LOGIN } from './github-data';
import { buildChangeRows, familyProgress, standingWords } from '../view-models/changes';
import type { ChangesResponse } from '../api/changes';

/**
 * ⭐ (2026-10-10, squad-changes2 "live everywhere" ask) CALM NEEDS A PR THAT
 * IS LIVE EVERYWHERE.
 *
 * Before this fix, no change in the `calm` scenario had every one of its
 * services' cells on a build that `containedIn` the change in EVERY tier
 * (dev/staging/prod) — `orders-api/staging` sat one ladder step behind
 * (`01ab7c9`, before PR #89's own `7c14e2a`), so PR #89 ("Fix decimal
 * rounding in order totals", the viewer's own change — `VIEWER_AUTHORED` in
 * `github-data.ts`) was `live` in dev and prod but `not-built`/behind in
 * staging — the "live everywhere" verdict the PR detail page can render was
 * never actually exercised against real demo data.
 *
 * `mock-data.ts`'s `FLEET` now bumps `orders-api/staging`'s head one ladder
 * step forward (`01ab7c9` → `7c14e2a`) — still `Succeeded`, still the
 * oldest-deployed tier, just caught up to the same change dev and prod
 * already carry. This test pins that PR #89 reads `live` (every cell `live`
 * in every family) in `calm`, so a future edit that regresses any one tier
 * fails loudly.
 */
describe('calm — at least one PR is live everywhere', () => {
	it('orders-api #89 (the viewer’s own change) is live in every tier', () => {
		resetDemoState('calm');
		const rolloutsRes = respond('GET', '/api/rollouts');
		const rolloutsBody = JSON.parse(rolloutsRes.body!);
		const changesRes = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		const changesBody = JSON.parse(changesRes!.body) as ChangesResponse;
		const pr89 = changesBody.changes.find(
			(c) => c.repo === 'orders-api' && c.number === 89
		);
		expect(pr89, 'orders-api PR #89 (7c14e2a) must exist in the fixture universe').toBeTruthy();
		expect(pr89!.author).toBe(DEMO_LOGIN);

		const rows = buildChangeRows(
			[pr89!],
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);
		const row = rows[0];
		expect(row.verdictTone).toBe('live');
		expect(row.verdictWord.toLowerCase()).toContain('live');

		// Every mark on every service, in every family, reads `live` — not
		// merely the row-level verdict, which a single-service fixture could
		// satisfy trivially.
		expect(row.grid.services.length).toBeGreaterThan(0);
		for (const service of row.grid.services) {
			for (const mark of service.marks) {
				expect(mark.state, `${service.appName}/${mark.family} should be live`).toBe('live');
			}
		}

		// ⭐ BUG 1 (squad-changes shared row, 2026-10-10) — THE DOTS AND THE
		// TEXT MUST TELL ONE STORY. The shared row (`ChangeLine.svelte`) draws
		// its meter from `familyProgress(row)`; pin both that meter's own dot
		// sequence (DEV → STAGING → PROD, every family filled/live, chain
		// order) and the standing word it reads alongside the meter ("live
		// everywhere") so a future regression that un-syncs the two fails
		// loudly, not just the `grid.services` check above.
		const steps = familyProgress(row);
		expect(steps.map((s) => s.family)).toEqual(['DEV', 'STAGING', 'PROD']);
		expect(steps.every((s) => s.tone === 'live')).toBe(true);
		expect(steps.every((s) => s.liveCount === s.builtCount && s.builtCount > 0)).toBe(true);
		expect(standingWords(row)).toBe('live everywhere');
	});

	/** THE WIDER CLAIM: at least one PR in the whole calm feed is live
	 *  everywhere — pinned independently of which specific PR carries it, so
	 *  this survives a future renumbering of `orders-api`'s PRs. */
	it('at least one change in the calm feed is live everywhere', () => {
		resetDemoState('calm');
		const rolloutsRes = respond('GET', '/api/rollouts');
		const rolloutsBody = JSON.parse(rolloutsRes.body!);
		const changesRes = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		const changesBody = JSON.parse(changesRes!.body) as ChangesResponse;
		const rows = buildChangeRows(
			changesBody.changes,
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);
		const liveEverywhere = rows.filter(
			(r) =>
				r.verdictTone === 'live' &&
				r.grid.services.length > 0 &&
				r.grid.services.every((s) => s.marks.every((m) => m.state === 'live'))
		);
		expect(liveEverywhere.length).toBeGreaterThanOrEqual(1);
	});
});
