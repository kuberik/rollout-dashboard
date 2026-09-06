import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * ⭐ REVISIONS-2026-09-06 ROUND 5, ITEM 2 (IN-FLIGHT DETAIL, blocking) — A
 * COMPONENT TEST ON A FIXTURE WHOSE `history[0].bakeStatus` IS `Deploying`.
 *
 * No cluster on this box has an in-flight place right now (nothing to load a
 * real one from — see the coordinator's own task note), so the fixture is
 * the only way to exercise this page's three round-5 fixes at all before a
 * live canary verifies them:
 *
 *   1. The `Deploying` bucket's own row states the in-flight fact — never the
 *      `ahead` bucket's "now on <sha>" sentence. As of the 2026-09-06 round-7
 *      critique the bake word/sha no longer repeat in the row's own caption
 *      (the card title already says "Deploying" and the page's own `h1`
 *      already names the sha): the env chip carries the bake state itself,
 *      as an icon inside its own box (`BakeStatusIcon`), and the row prints
 *      only `started <t> ago`.
 *   2. The head band names the place in flight (`N of M places run this
 *      build · 1 deploying`).
 *   3. `Running it now`'s header glyph goes neutral while any place on this
 *      build is still deploying, even though the live place IS this
 *      service's newest.
 *
 * Same mocking shape as `routes/revisions/page.svelte.test.ts` (the sibling
 * list-page suite this route already has) — `$app/state`/`$app/navigation`
 * are hoisted mocks, and the fleet is served from one stubbed `fetch`.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/revisions'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { configure } from '@testing-library/svelte';

configure({ asyncUtilTimeout: 5000 });

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Page from './+page.svelte';
import type { Environment, Rollout } from '../../../types';

const FIXTURE_NOW = Date.now();
const REPO = 'https://github.com/acme/deploy-fixture.git';
const REPO_PATH = 'github.com/acme/deploy-fixture';
// 40 hex characters — `resolveRevision` matches a full revision directly.
const REVISION = 'd1111111111111111111111111111111111111';
const SHORT = REVISION.slice(0, 7);

function iso(minutesAgo: number): string {
	return new Date(FIXTURE_NOW - minutesAgo * 60_000).toISOString();
}

/**
 * One (app, namespace) rollout, with an explicit `bakeStatus` per history
 * entry — the sibling list-page fixture's own `rollout()` helper hardcodes
 * `Succeeded`, which is exactly the fact this fixture needs to vary.
 */
function rollout(
	name: string,
	ns: string,
	history: { tag: string; minutesAgo: number; bakeStatus: string }[]
): Rollout {
	const release = { tag: `main-${SHORT}`, revision: REVISION, created: iso(60) };
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source: REPO,
			availableReleases: [release],
			history: history.map((h) => ({
				version: release,
				timestamp: iso(h.minutesAgo),
				bakeStatus: h.bakeStatus
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
 * ONE SERVICE, TWO PLACES: `dev` already ran this build to completion (the
 * `live` bucket, and it is this service's only release so it is also this
 * service's newest); `staging` is still taking it — `history[0].bakeStatus`
 * is `Deploying`, landed 2 minutes ago. This is the live cluster's exact
 * shape during the canary the coordinator's task note measured (item 2:
 * `/revisions` read `fully rolled out` for ~2 minutes while one place was
 * `Deploying`), collapsed to the smallest fixture that reaches it.
 */
function inFlightFixture() {
	const dev = rollout('canary-app', 'dev', [{ tag: 'main', minutesAgo: 30, bakeStatus: 'Succeeded' }]);
	const staging = rollout('canary-app', 'staging', [
		{ tag: 'main', minutesAgo: 2, bakeStatus: 'Deploying' }
	]);
	return {
		rollouts: [dev, staging],
		environments: [environment('canary-app', 'dev', 'dev'), environment('canary-app', 'staging', 'staging')]
	};
}

function stubFetch(rollouts: Rollout[], environments: Environment[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok: true,
			json: async () => ({
				rollouts: { items: rollouts },
				environments: { items: environments }
			})
		}))
	);
}

beforeEach(() => {
	state.page.params = { slug: `${REPO_PATH}/${REVISION}` };
	state.page.url = new URL(`http://localhost/revisions/${REPO_PATH}/${REVISION}`);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function renderDetail() {
	render(WithQueryClient, { props: { component: Page as any } });
	await waitFor(() => expect(screen.getByText(/places run this build/)).toBeInTheDocument());
}

describe('/revisions/[...slug] — in-flight is a state (REVISIONS-2026-09-06, round 5, item 2)', () => {
	test('item 1: the deploying row states the in-flight fact, never "now on"', async () => {
		const fleet = inFlightFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderDetail();

		// Its own bucket, blue glyph, one place.
		const deployingHeading = screen.getByRole('heading', { level: 2, name: 'Deploying' });
		expect(deployingHeading).toBeInTheDocument();
		const deployingCard = deployingHeading.closest('section');
		expect(deployingCard).not.toBeNull();
		const deployingIcon = deployingCard!.querySelector('header svg');
		expect(deployingIcon?.getAttribute('class') ?? '').toContain('tone-active');

		// The row itself: since-when, not the "ahead" bucket's "now on <sha>"
		// wording, and — round 7 — not a re-spelling of "Deploying <sha>"
		// either. The card title and the page's own h1 already say both.
		expect(deployingCard!.textContent).toMatch(/started .* ago/);
		expect(deployingCard!.textContent).not.toContain('now on');
		expect(deployingCard!.textContent).not.toContain(`Deploying ${SHORT}`);

		// The environment chip is still a link into its own rollout (the row's
		// app-name link shares the same accessible name, hence `getAllByRole`).
		const stagingLinks = screen.getAllByRole('link', {
			name: /Open the STAGING rollout for canary-app/i
		});
		const stagingChip = stagingLinks.find((a) => a.classList.contains('rev-env-atom'));
		expect(stagingChip).toHaveAttribute('href');

		// ⭐ ROUND 7, ITEM 5 — THE BAKE STATE IS ONE MARK, ON THE CHIP ITSELF.
		// `BakeStatusIcon` renders an animated spinner div inside the chip's
		// glyph slot, and the chip's own title carries the consequence
		// (`bakeTitle`) rather than a bare word repeated beside it.
		const stagingChipBox = stagingChip!.querySelector('.chip');
		expect(stagingChipBox?.querySelector('.animate-spin')).not.toBeNull();
		expect(stagingChipBox).toHaveAttribute('title', expect.stringContaining('still going out'));
	});

	test('item 2: the head band names the place in flight', async () => {
		const fleet = inFlightFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderDetail();

		// 1 live (dev), 1 deploying (staging) — never counted as live, and
		// never silently dropped either. The leading figure ("1") sits in its
		// own sibling span (`.rev-head-figure`), so this caption's own text
		// node reads "of 2 places run this build · 1 deploying".
		expect(screen.getByText(/of\s*2\s*places run this build\s*·\s*1\s*deploying/)).toBeInTheDocument();
	});

	test('item 3: "Running it now" keeps the neutral glyph while a sibling place is deploying', async () => {
		const fleet = inFlightFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderDetail();

		const liveHeading = screen.getByRole('heading', { level: 2, name: 'Running it now' });
		const liveCard = liveHeading.closest('section');
		expect(liveCard).not.toBeNull();
		const liveIcon = liveCard!.querySelector('header svg');
		const cls = liveIcon?.getAttribute('class') ?? '';
		// Neutral (the same treatment the not-newest case already uses), not
		// the settled green check — `dev` is this service's own newest build,
		// so a check here would be premature: `staging` has not finished
		// taking it yet.
		expect(cls).toContain('tone-mute');
		expect(cls).not.toContain('tone-live');
	});
});
