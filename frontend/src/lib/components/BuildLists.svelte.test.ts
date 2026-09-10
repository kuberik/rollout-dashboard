import { describe, test, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import BuildLists from './BuildLists.svelte';
import { buildRevisionLedger } from '$lib/view-models/revision-ledger';
import type { Environment, Rollout } from '../../types';

const NOW = Date.now();

function rel(sha: string, minutesAgo: number) {
	return {
		tag: `main-${sha}`,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(NOW - minutesAgo * 60_000).toISOString()
	};
}
type Rel = ReturnType<typeof rel>;

function rollout(
	name: string,
	ns: string,
	releases: Rel[],
	history: { r: Rel; minutesAgo: number }[],
	versionHistoryLimit?: number
): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: versionHistoryLimit ? { versionHistoryLimit } : {},
		status: {
			source: 'https://github.com/acme/monorepo.git',
			availableReleases: [...releases].reverse(),
			history: history.map((h) => ({
				version: h.r,
				timestamp: new Date(NOW - h.minutesAgo * 60_000).toISOString(),
				bakeStatus: 'Succeeded'
			}))
		}
	} as unknown as Rollout;
}

function environment(app: string, ns: string, tier: string): Environment {
	return {
		metadata: { name: app, namespace: ns },
		spec: { environment: tier, name: app, rolloutRef: { name: app } }
	} as unknown as Environment;
}

/**
 * Same shape as `routes/revisions/page.svelte.test.ts`'s own `repoFixture`:
 * `r1` is `web`'s current head (excluded — it's the hero's row, not a
 * build-list row); `r2` is `api`'s current build ("Also still running");
 * `r3` is known but never deployed (the rail's "No deploy on record"); `r4` ran once, on
 * `web`, and nothing runs it now ("No longer running anywhere").
 */
function repoFixture() {
	const r1 = rel('a111111', 10);
	const r2 = rel('a222222', 200);
	const r3 = rel('a333333', 400);
	const r4 = rel('a444444', 600);
	const releases = [r1, r2, r3, r4];
	const web = rollout('web', 'team', releases, [
		{ r: r1, minutesAgo: 10 },
		{ r: r4, minutesAgo: 600 }
	]);
	const api = rollout('api', 'team', releases, [{ r: r2, minutesAgo: 200 }]);
	const [repo] = buildRevisionLedger(
		[web, api],
		[environment('web', 'team', 'prod'), environment('api', 'team', 'prod')]
	);
	return repo;
}

beforeEach(() => {
	sessionStorage.clear();
});

describe('BuildLists', () => {
	test('a genuinely empty "Also still running" renders as a titled Card, not a bare note — revisions-pass-6, item 5', () => {
		// Only `web`'s own head is deployed and it IS this repo's one lead
		// row, so nothing else is still running anywhere — the "every place
		// is on a build above" phrasing, since there is a lead row to point
		// at.
		//
		// ⛔ SUPERSEDES finding 7 (2026-09-09), which had this render as a
		// bare, unbordered `<p>` on the theory that an empty headered `Card`
		// "outranks a full one by sheer position and chrome". Measured
		// against the RAIL's own empty state ("No deploy on record") two hundred
		// pixels away — a full titled `Card` with an icon and a `0 builds`
		// rollup — that produced the opposite defect: this section's own
		// landmark ("Also still running") vanished from the page's heading
		// structure whenever there was nothing to show, and the two empty
		// states in the same component read as two different KINDS of fact.
		// It is a `Card` again, always, so the section survives being empty.
		const r1 = rel('b111111', 10);
		const web = rollout('web', 'team', [r1], [{ r: r1, minutesAgo: 10 }]);
		const [repo] = buildRevisionLedger([web], [environment('web', 'team', 'prod')]);
		const { container } = render(BuildLists, { repo, now: new Date(NOW), storageKey: 'empty' });
		expect(
			screen.getByText(/Nothing older is still running — every place is on a build above\./)
		).toBeInTheDocument();
		// The landmark and its rollup are back, inside a real `Card`. Scoped
		// to THIS card specifically — the rail's own empty state ("Never
		// deployed") also reads "0 builds" on this fixture, so a page-wide
		// text query would match twice.
		const title = screen.getByText('Also still running');
		expect(title).toBeInTheDocument();
		const card = title.closest('.card-cq');
		expect(card?.textContent ?? '').toContain('0 builds');
		expect(card?.textContent ?? '').toContain('still running');
	});

	test('a non-empty "Also still running" renders as a real card with its rows', () => {
		const repo = repoFixture();
		render(BuildLists, { repo, now: new Date(NOW), storageKey: 'nonempty' });
		expect(screen.getByText('Also still running')).toBeInTheDocument();
		expect(screen.getByText('a222222')).toBeInTheDocument();
	});

	test('the rail heading is "No deploy on record" when history may be truncated — finding 2, round 11 QA item 13', () => {
		const r1 = rel('c111111', 5);
		const r2 = rel('c222222', 4000); // never deployed, and OLD enough to plausibly have been evicted
		// Exactly at the cap: 1 history entry, `versionHistoryLimit: 1`.
		const web = rollout('web', 'team', [r1, r2], [{ r: r1, minutesAgo: 5 }], 1);
		const [repo] = buildRevisionLedger([web], [environment('web', 'team', 'prod')]);
		render(BuildLists, { repo, now: new Date(NOW), storageKey: 'at-limit' });
		expect(screen.getByText('No deploy on record')).toBeInTheDocument();
		expect(screen.getByText(/may simply predate that window/)).toBeInTheDocument();
	});

	/**
	 * ⭐ LANE 9, ROUND 11 QA, ITEM 13 — THE HEADING NO LONGER FLIPS. It used
	 * to read "Never deployed" whenever history was provably complete and
	 * "No deploy on record" whenever it might not be — one rail, two
	 * landmark names, depending on data the reader never sees directly.
	 * The heading is fixed now; only the BODY still carries the
	 * cautious/confident distinction (the footnote's presence, asserted
	 * here by its absence in the provably-complete case).
	 */
	test('the rail heading stays "No deploy on record" when history is provably complete', () => {
		const r1 = rel('d111111', 5);
		const r2 = rel('d222222', 4000);
		// Two releases known, one history entry, limit 10 — provably complete.
		const web = rollout('web', 'team', [r1, r2], [{ r: r1, minutesAgo: 5 }], 10);
		const [repo] = buildRevisionLedger([web], [environment('web', 'team', 'prod')]);
		render(BuildLists, { repo, now: new Date(NOW), storageKey: 'not-at-limit' });
		expect(screen.getAllByText('No deploy on record')).toHaveLength(1);
		expect(screen.queryByText('Never deployed')).toBeNull();
		expect(screen.queryByText(/may simply predate that window/)).toBeNull();
	});

	/**
	 * ⭐ FINDING 5 — "SHOW N MORE BUILDS" SURVIVES A RETURN VISIT. This is the
	 * component-level proof of the mechanism the fix relies on: expanding a
	 * list under one `storageKey`, then mounting a FRESH instance under the
	 * SAME key (standing in for "the page the operator comes back to after
	 * pressing Back") starts already expanded.
	 */
	test('expanding "No longer running anywhere" persists across a fresh mount under the same storageKey', async () => {
		const releases = [rel('e000000', 5)];
		for (let i = 1; i <= 8; i++) releases.push(rel(`e${i}11111`, 100 + i));
		const history = [
			{ r: releases[0], minutesAgo: 5 },
			...releases.slice(1).map((r, i) => ({ r, minutesAgo: 100 + i }))
		];
		const web = rollout('web', 'team', releases, history);
		const [repo] = buildRevisionLedger([web], [environment('web', 'team', 'prod')]);

		const first = render(BuildLists, { repo, now: new Date(NOW), storageKey: 'persist-key' });
		const showMore = screen.getByText(/Show \d+ older build/);
		await fireEvent.click(showMore);
		expect(screen.getByText(/Hide \d+ older build/)).toBeInTheDocument();
		first.unmount();
		cleanup();

		render(BuildLists, { repo, now: new Date(NOW), storageKey: 'persist-key' });
		expect(screen.getByText(/Hide \d+ older build/)).toBeInTheDocument();
	});

	test('a DIFFERENT storageKey does not inherit another repo’s expanded state', async () => {
		const releases = [rel('f000000', 5)];
		for (let i = 1; i <= 8; i++) releases.push(rel(`f${i}11111`, 100 + i));
		const history = [
			{ r: releases[0], minutesAgo: 5 },
			...releases.slice(1).map((r, i) => ({ r, minutesAgo: 100 + i }))
		];
		const web = rollout('web', 'team', releases, history);
		const [repo] = buildRevisionLedger([web], [environment('web', 'team', 'prod')]);

		const first = render(BuildLists, { repo, now: new Date(NOW), storageKey: 'key-a' });
		await fireEvent.click(screen.getByText(/Show \d+ older build/));
		first.unmount();
		cleanup();

		render(BuildLists, { repo, now: new Date(NOW), storageKey: 'key-b' });
		expect(screen.getByText(/Show \d+ older build/)).toBeInTheDocument();
	});
});
