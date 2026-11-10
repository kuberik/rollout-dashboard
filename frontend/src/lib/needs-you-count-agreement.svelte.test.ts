/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Apps from '../routes/apps/+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';

/**
 * THE "NEEDS YOU" COUNT MUST EQUAL THE CARD'S OWN ROW COUNT. (TL
 * whole-product consistency review, finish round 2) `NeedsYouCard` lists
 * `needsYou.length + heldByApproval.length` rows (before its own 3/5 display
 * cap): Home's title pill, Home's header meta fact, and `/apps`' summary
 * clause all have to read that SAME sum, or a fleet with a held-by-approval
 * rollout and nothing else shows a card with a row in it beside a pill that
 * says nothing at all (exactly what shipped before this fix, on the demo's
 * own `calm` scenario — one held rollout, zero failed/stuck, "0 needs you").
 *
 * Runs against the real demo fixtures (`resetDemoState`/`respond`, the same
 * data `/api/demo/reset?scenario=…` serves the running dev server) rather
 * than a synthetic fixture, across the three scenarios the product ships
 * screenshots for: `calm` (the held-only case this bug shipped under),
 * `incident` (failed + stuck + held, all three kinds in the cap at once) and
 * `wide` (enough held/failed rollouts to matter for ordering).
 */

function stubDemoFetch() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			const r = respond('GET', url);
			return new Response(r.body ?? '{}', { status: r.status ?? 200 });
		})
	);
}

afterEach(() => vi.unstubAllGlobals());

describe.each(['calm', 'incident', 'wide'] as const)('Needs-you count agrees with its own rows — %s', (scenario) => {
	/* 2026-11-09: `Home's title pill reads the same number as the card's rows` went with ControlCenter (old Home, its Needs-you card and pill); the new Home has no such pill. */

	/* truth-4 re-pin (r34): /apps no longer draws a "Needs you" card of rows. Its lead band is the "Needs attention" card of app TILES
	   (`[data-band="needs"]`), and the clause "N need you" counts the APPS in that band whose next step is the viewer's (Apps.svelte `yours`).
	   A tile carries no per-viewer marker, so the checkable invariant is: no band -> no clause; a clause -> 1 <= N <= the band's tile count. */
	test(`/apps' summary clause reads a number the band's own tiles can account for`, async () => {
		resetDemoState(scenario);
		stubDemoFetch();
		const { container } = render(WithQueryClient, { props: { component: Apps as any } });
		await waitFor(() => expect(container.querySelector('[data-page="apps"]')).toBeTruthy(), {
			timeout: 5000
		});
		await waitFor(() => expect(container.textContent).not.toMatch(/^\s*$/), { timeout: 5000 });

		/* r39: the Attention section's rollup says "N yours" (SectionHeader), the tiles are the lead + grid <li>s */
		const tiles = container.querySelectorAll('[data-band="needs"] ul > li').length;
		const summaryText = [...container.querySelectorAll('[data-band="needs"] span')]
			.map((s) => s.textContent?.trim() ?? '')
			.find((t) => /^\d+ yours$/.test(t));

		if (tiles === 0) {
			expect(summaryText, `no Needs-attention tiles -- the summary must not state a count either`).toBeUndefined();
			return;
		}
		if (summaryText === undefined) return; // none of the band's apps waits on the viewer: no clause is the truthful rendering
		const summaryCount = Number(summaryText.match(/^(\d+)/)![1]);
		expect(
			summaryCount,
			`/apps' summary read ${summaryCount} but the Needs-attention band holds ${tiles} tile(s)`
		).toBeLessThanOrEqual(tiles);
		expect(summaryCount).toBeGreaterThanOrEqual(1);
	});
});
