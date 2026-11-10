import { describe, expect, it } from 'vitest';
import { respondGithub, DEMO_LOGIN } from './github-data';
import { resetDemoState } from './state';
import { respond } from './respond';
import { buildChangeRows } from '../view-models/changes';
import type { ChangesResponse } from '../api/changes';
import type { Scenario } from './state';

/**
 * ⭐ (2026-10-10, squad-changes demo-data trim) THE VIEWER SHARE BOUND.
 *
 * Before this test existed, `danielreed` (the signed-in demo viewer)
 * authored 68 of the fixture universe's 102 changes — `AUTHORS`' own `pick`
 * pool used to include `DEMO_LOGIN`, stacked on top of a SEPARATE flat
 * probability every landmark/filler/orphan call site rolled on its own, and
 * the two compounded. "/changes" > "Your changes" then read as nearly the
 * WHOLE feed ("29 of 41 not everywhere"), not a slice of it a real engineer
 * would actually have open. `github-data.ts`'s `VIEWER_AUTHORED` is now the
 * ONLY source of viewer authorship (pinned, seven shas, one per repo where
 * possible) — this test pins the budget so a future edit cannot silently
 * widen it back out.
 *
 * Every non-viewer author must also be drawn from the demo's own Western
 * roster (`AUTHORS` in `github-data.ts`) — spelled out here rather than
 * imported so a change to that file's internal pool is caught by this test
 * rather than silently validated against itself.
 */
const WESTERN_ROSTER = new Set([
	DEMO_LOGIN, // 'danielreed' (Daniel Reed)
	'sam-oliver',
	'jmatthews',
	'mark-collins',
	'paul-stevens',
	'nick-keller',
	'anna-ward',
	'tom-becker'
]);

const SCENARIOS: Scenario[] = ['calm', 'incident', 'wide'];

function viewerChangesFor(): ChangesResponse['changes'] {
	const res = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
	const body = JSON.parse(res!.body) as ChangesResponse;
	return body.changes.filter((c) => c.author === DEMO_LOGIN);
}

describe('github-data — the viewer owns a slice of the changes, not most of it', () => {
	it('every author in the full fixture universe is in the Western roster', () => {
		const res = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		const body = JSON.parse(res!.body) as ChangesResponse;
		expect(body.changes.length).toBeGreaterThan(0);
		for (const c of body.changes) {
			expect(WESTERN_ROSTER.has(c.author), `unexpected author "${c.author}" on ${c.repo}#${c.number ?? c.mergeCommitSha}`).toBe(true);
		}
	});

	// ⭐ `github-data.ts` does not vary authorship by scenario (the module
	// doc's own "Authorship is the same in every scenario" rule) — this
	// loop is not expecting the COUNT to differ, it is pinning that the
	// SAME 6-8 budget holds whichever scenario a reviewer happens to be
	// looking at when they check "Your changes".
	for (const scenario of SCENARIOS) {
		it(`viewer authors 6-8 changes in ${scenario}`, () => {
			resetDemoState(scenario);
			const viewer = viewerChangesFor();
			expect(viewer.length).toBeGreaterThanOrEqual(6);
			expect(viewer.length).toBeLessThanOrEqual(8);
		});
	}

	it('the viewer-authored changes are spread across more than one repo', () => {
		const viewer = viewerChangesFor();
		const repos = new Set(viewer.map((c) => c.repo));
		expect(repos.size).toBeGreaterThan(1);
	});

	/**
	 * SPEC must-fix G: in `incident` the viewer owns one FAILED change, and
	 * in `incident` or `wide` the viewer owns one HELD change. Computed
	 * through the real `/api/rollouts` merge (`respond.ts`'s own
	 * `withLiveOverrides`, not the raw scenario-mapped fleet/dep arrays
	 * alone) — `checkout-worker`'s incident failure lives in the `live`
	 * fixture map, not `mockFleetRollouts`, so skipping that merge would
	 * silently miss it (see this lane's own TASK 2 investigation).
	 */
	it('incident: the viewer owns exactly one failed change (checkout-worker a02f1c4)', () => {
		resetDemoState('incident');
		const rolloutsRes = respond('GET', '/api/rollouts');
		const rolloutsBody = JSON.parse(rolloutsRes.body!);
		const viewer = viewerChangesFor();
		const rows = buildChangeRows(
			viewer,
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);
		const failed = rows.filter((r) => r.verdictTone === 'failed');
		expect(failed.length).toBeGreaterThanOrEqual(1);
		expect(failed.some((r) => r.sha === 'a02f1c4')).toBe(true);
	});

	it('incident or wide: the viewer owns at least one held change (platform-telemetry #20)', () => {
		for (const scenario of ['incident', 'wide'] as const) {
			resetDemoState(scenario);
			const rolloutsRes = respond('GET', '/api/rollouts');
			const rolloutsBody = JSON.parse(rolloutsRes.body!);
			const viewer = viewerChangesFor();
			const rows = buildChangeRows(
				viewer,
				rolloutsBody.rollouts.items,
				rolloutsBody.environments.items,
				{ items: rolloutsBody.rolloutDependencies.items },
				new Date()
			);
			const held = rows.filter((r) => r.verdictTone === 'held');
			if (scenario === 'incident') {
				// `TASK 2`'s own pin: platform-telemetry #20 (4a8d2e6) is HELD
				// for approval in incident, not failed.
				expect(held.some((r) => r.sha === '4a8d2e6')).toBe(true);
			}
		}
		resetDemoState('calm');
	});
});
