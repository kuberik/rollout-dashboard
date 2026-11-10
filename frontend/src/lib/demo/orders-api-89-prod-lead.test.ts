import { describe, expect, it } from 'vitest';
import { resetDemoState } from './state';
import { respond } from './respond';
import { buildChangeRows } from '../view-models/changes';
import type { ChangesResponse } from '../api/changes';

/**
 * ⭐ (2026-10-11, squad-changes "Median merge→prod" fix) `orders-api` #89
 * (`7c14e2a`) PINS THE ROOT-CAUSE FIX.
 *
 * `orders-api-prod`'s own retained history has an OLDER `01ab7c9` redeploy
 * (2026-10-05) sitting after the merge (2026-10-02) in array position —
 * `buildCell` (`pr-pipeline.ts`) reads that as "the merge predates what this
 * rollout's history remembers" and nulls the live cell's own `since`
 * (`'live (since before recorded history)'`). Before the fix,
 * `firstProdLeadMs` (`changes.ts`) read exactly that nulled `since` and
 * returned `null` for a change that had plainly, verifiably reached prod —
 * `historyMatches` (the SAME cell) has carried `7c14e2a`, `Succeeded`, the
 * whole time. This pins a positive `prodLeadMs` for #89 so a future edit
 * that goes back to reading `since` fails loudly here instead of silently
 * reintroducing the "—" that started this fix.
 *
 * ⚠️ UPDATED 2026-10-12 (QA causality pass). The merge time for `7c14e2a`
 * is no longer a flat "100 minutes ago" — `EXPLICIT_MERGE_MINUTES_AGO`
 * (`github-data.ts`) now pins it to just before `orders-api/staging`'s own
 * `22 * 60`-minute-old deploy of this exact build (`FLEET`, `mock-data.ts`
 * — a build cannot be deployed before the commit that produced it
 * merged), so the real `prodLeadMs` here is ~22h (staging's own bake time
 * before promoting to prod), not the few-minutes-to-hours span the old
 * flat pin produced. The upper bound below moved from 6h to 24h for
 * exactly that reason — still "a plausible span", just a longer true one.
 */
function orders89Row(scenario: 'calm' | 'incident') {
	resetDemoState(scenario);
	const rolloutsRes = respond('GET', '/api/rollouts');
	const rolloutsBody = JSON.parse(rolloutsRes.body!);
	const changesRes = respond('GET', '/api/github/changes?days=365');
	const changesBody = JSON.parse(changesRes.body!) as ChangesResponse;
	const pr89 = changesBody.changes.find((c) => c.repo === 'orders-api' && c.number === 89);
	expect(pr89, 'orders-api #89 (7c14e2a) must exist in the fixture universe').toBeTruthy();
	const rows = buildChangeRows(
		[pr89!],
		rolloutsBody.rollouts.items,
		rolloutsBody.environments.items,
		{ items: rolloutsBody.rolloutDependencies.items },
		new Date()
	);
	return rows[0];
}

describe('orders-api #89 — prodLeadMs reads historyMatches, not the nulled since', () => {
	it('calm: a real, positive prodLeadMs, not null', () => {
		const row = orders89Row('calm');
		expect(row.sha).toBe('7c14e2a');
		expect(row.prodLeadMs).not.toBeNull();
		expect(row.prodLeadMs as number).toBeGreaterThan(0);
		// A plausible merge→prod span (~22h, staging's own bake time before
		// promoting), never the old multi-day artefact the ladder-position
		// merge-age formula produced.
		expect(row.prodLeadMs as number).toBeLessThan(24 * 60 * 60 * 1000);
	});

	it('incident: the same real, positive prodLeadMs', () => {
		const row = orders89Row('incident');
		expect(row.prodLeadMs).not.toBeNull();
		expect(row.prodLeadMs as number).toBeGreaterThan(0);
	});
});
