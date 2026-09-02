/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import ControlCenter from '$lib/ControlCenter.svelte';
import Activity from '../../routes/activity/+page.svelte';
import { fleet, respond } from './fleet-fixture';

/**
 * ⭐ A ROLLBACK MUST READ AS A ROLLBACK ON EVERY LIST SURFACE THAT SHOWS THE
 * DEPLOY, NOT ONLY ON `/`'S DISC (`rollout-cards.ts::detectRollback`) AND
 * THE HISTORY TAB. (2026-09-02)
 *
 * -- GROUND TRUTH -----------------------------------------------------------
 *
 * `detectRollback` answers for the CURRENT deploy only (`history[0]` vs
 * `[1]`), so it goes silent the instant a rollback is auto-corrected forward
 * again — exactly what happened on the live cluster's own
 * `hello-world-dev/hello-world-app`: rolled back by hand, then automatically
 * redeployed forward. `ActivityRail` and `/activity` both read
 * `history-marks.ts::deployActs` PER HISTORY INDEX instead, which keeps
 * answering for the entry where the rollback actually happened, however long
 * ago that was and whatever is live now.
 *
 * `fleet-fixture.ts`'s `cameFrom` builds exactly that second history entry;
 * `at < cameFrom` is a rollback — an OLDER release replacing a newer one, the
 * same test `history-marks.test.ts` uses to hold `deployActs` and
 * `detectRollback` in agreement.
 */

afterEach(() => vi.unstubAllGlobals());

function rollbackFleet() {
	// One rolled-back cell; everything else is an ordinary single-entry
	// history, so the assertions below can tell "the rollback's own mark"
	// from "the page prints the word somewhere for unrelated reasons".
	return fleet((app, tier) =>
		app === 'alpha-app' && tier === 'dev' ? { hold: 'none', at: 0, cameFrom: 2 } : { hold: 'none' }
	);
}

describe('the rollback mark is at rest, not only on hover, and not only on the current deploy', () => {
	test('ActivityRail (embedded in `/`) prints the word for the rolled-back row', async () => {
		vi.stubGlobal('fetch', vi.fn(respond(rollbackFleet())));
		render(WithQueryClient, { props: { component: ControlCenter as any } });
		await waitFor(
			() => expect(screen.getAllByText('Rolled back', { exact: false }).length).toBeGreaterThan(0),
			{ timeout: 5000 }
		);
	});

	test('/activity prints the word on the row, at rest', async () => {
		vi.stubGlobal('fetch', vi.fn(respond(rollbackFleet())));
		render(WithQueryClient, { props: { component: Activity as any } });
		await waitFor(
			() => expect(screen.getAllByText('Rolled back', { exact: false }).length).toBeGreaterThan(0),
			{ timeout: 5000 }
		);
	});

	test('/activity counts the rollback in its rollups instead of calling the day "all fine"', async () => {
		vi.stubGlobal('fetch', vi.fn(respond(rollbackFleet())));
		render(WithQueryClient, { props: { component: Activity as any } });
		await waitFor(
			() => expect(screen.getAllByText('Rolled back', { exact: false }).length).toBeGreaterThan(0),
			{ timeout: 5000 }
		);
		// The day carrying the rollback (all 6 fixture rollouts deploy on it)
		// must count it -- NOT read as the norm, which is exactly the
		// sentence a reader would act on by not looking closer. A day with
		// no rollback (the fixture's other history entry, one day earlier)
		// legitimately keeps "all fine", so the assertion is scoped to the
		// specific defect string rather than banning the phrase outright.
		expect(document.body.textContent).toMatch(/6 deploys · 1 rolled back/);
		expect(document.body.textContent).not.toMatch(/6 deploys · all fine/);
	});
});
