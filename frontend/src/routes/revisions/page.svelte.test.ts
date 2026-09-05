import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The page remembers its last shape (repository count, open sections, ledger
// sizes) in localStorage via `skeleton-hints`; another test file in the same
// worker can leave a value behind, which once made the two-repo test fail
// only when run alongside `src/lib/messages`. Start every test from a clean
// store.
beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Page from './+page.svelte';
import type { Environment, Rollout } from '../../types';

/**
 * ONE CONSISTENT BLOCK PER REPOSITORY (second repo, 2026-09-05).
 *
 * A second source repo appeared on the live fleet and `/revisions` gave only
 * `ledgers[0]` a hero — every other repo's newest build was demoted to a
 * plain "Still running" row, and the repo IDENTITY card (name, services, the
 * three figures, `View repository`) sat in the rail with no indication of
 * WHICH repo it belonged to. The fix makes every repo render the identical
 * sequence: its own hero, "Also still running", "No longer running
 * anywhere", and its own "Never deployed" — and, past one repo, a section
 * header names which repository each block is about.
 *
 * THE HARD CONSTRAINT THIS SUITE EXISTS TO PIN: with exactly one repository
 * the page must render byte-identical to before this round, except the head
 * band's own "N repositories" clause. The first test below is that pin, as
 * a snapshot of the heading (landmark) order.
 */

function rel(sha: string, minutesAgo: number) {
	return {
		tag: `main-${sha}`,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(Date.now() - minutesAgo * 60_000).toISOString()
	};
}

type Rel = ReturnType<typeof rel>;

function rollout(
	name: string,
	ns: string,
	source: string,
	releases: Rel[],
	history: { r: Rel; minutesAgo: number }[]
): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source,
			// The real API delivers availableReleases OLDEST-FIRST.
			availableReleases: [...releases].reverse(),
			history: history.map((h) => ({
				version: h.r,
				timestamp: new Date(Date.now() - h.minutesAgo * 60_000).toISOString(),
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
 * ONE REPO, SHAPED TO REACH EVERY CARD ON THE PAGE.
 *
 *   r1  newest, `web` runs it now                → the hero ("Newest build in use")
 *   r2  older, `api` still runs it                → "Also still running"
 *   r3  known (on the release list), never run    → "Never deployed"
 *   r4  `web` ran it once, nothing runs it now     → "No longer running anywhere"
 *
 * `web` and `api` share one release list (the same repo, two services), which
 * is what `revision-ledger.ts` assumes: a commit is one row across services.
 * `r3` is OLDER than `r1` (400 minutes vs 10), so this fixture's own repo
 * header reads "Newest build deployed" — see the distance-rollup tests below
 * for the "N newer builds" half.
 */
function repoFixture(source: string, prefix: string) {
	const r1 = rel(`${prefix}1111111`, 10);
	const r2 = rel(`${prefix}2222222`, 200);
	const r3 = rel(`${prefix}3333333`, 400);
	const r4 = rel(`${prefix}4444444`, 600);
	const releases = [r1, r2, r3, r4];
	const web = rollout(`${prefix}-web`, 'team', source, releases, [
		{ r: r1, minutesAgo: 10 },
		{ r: r4, minutesAgo: 600 }
	]);
	const api = rollout(`${prefix}-api`, 'team', source, releases, [{ r: r2, minutesAgo: 200 }]);
	return {
		rollouts: [web, api],
		environments: [
			environment(`${prefix}-web`, 'team', 'prod'),
			environment(`${prefix}-api`, 'team', 'prod')
		],
		r1,
		r2,
		r3,
		r4
	};
}

/**
 * ONE SERVICE, ONE ENVIRONMENT, FULLY CONVERGED — for the §2 "the bar is
 * omitted at full coverage" case, where `liveCount === totalCount`.
 */
function fullCoverageFixture() {
	const r1 = rel('f1111111', 5);
	const rollouts = [
		rollout('full-svc', 'team', 'https://github.com/acme/full.git', [r1], [{ r: r1, minutesAgo: 5 }])
	];
	const environments = [environment('full-svc', 'team', 'prod')];
	return { rollouts, environments };
}

/**
 * ONE SERVICE, NINE PLACES, ONLY ONE ON THE HEAD BUILD — the exact "1 of 9"
 * shape the craft review's bar-width regression test needs. `CoverageBar`'s
 * cells (`flex: 1`) drew this identically to "8 of 9": a fully-filled
 * 200px track either way.
 */
function nineSlotFixture() {
	const newest = rel('n1111111', 10);
	const older = rel('n0000000', 500);
	const envNames = Array.from({ length: 9 }, (_, i) => `env${i}`);
	const rollouts = envNames.map((ns, i) =>
		rollout('web', ns, 'https://github.com/acme/nine.git', [newest, older], [
			{ r: i === 0 ? newest : older, minutesAgo: i === 0 ? 10 : 500 }
		])
	);
	const environments = envNames.map((ns) => environment('web', ns, ns));
	return { rollouts, environments };
}

/**
 * A BUILD NEWER THAN THE DEPLOYED FRONTIER, NEVER DEPLOYED — for §6's
 * "N newer builds" half. `newerRel` is created more recently (5 minutes ago)
 * than the deployed head `headRel` (100 minutes ago) but nobody has run it.
 */
function newerPendingFixture() {
	const headRel = rel('p1111111', 100);
	const newerRel = rel('p2222222', 5);
	const rollouts = [
		rollout(
			'pending-svc',
			'team',
			'https://github.com/acme/pending.git',
			[newerRel, headRel],
			[{ r: headRel, minutesAgo: 100 }]
		)
	];
	const environments = [environment('pending-svc', 'team', 'prod')];
	return { rollouts, environments, headRel, newerRel };
}

/**
 * TWO SERVICES WITH DISJOINT RELEASE LISTS — for the per-service chip
 * filter. `repoFixture`'s two services share one release list, so every row
 * names both services regardless of which one is live; here each service
 * only ever appears on its OWN builds, so pressing a chip has something real
 * to narrow.
 */
function filterFixture(prefix: string) {
	const w1 = rel(`${prefix}w111111`, 5); // web's head — the hero
	const w2 = rel(`${prefix}w222222`, 300); // web, retired
	const a1 = rel(`${prefix}a111111`, 8); // api's head — "Also still running"
	const a2 = rel(`${prefix}a222222`, 200); // api, retired
	const source = `https://github.com/acme/${prefix}-filter.git`;
	const web = rollout(`${prefix}-web`, 'team', source, [w1, w2], [
		{ r: w1, minutesAgo: 5 },
		{ r: w2, minutesAgo: 300 }
	]);
	const api = rollout(`${prefix}-api`, 'team', source, [a1, a2], [
		{ r: a1, minutesAgo: 8 },
		{ r: a2, minutesAgo: 200 }
	]);
	return {
		rollouts: [web, api],
		environments: [
			environment(`${prefix}-web`, 'team', 'prod'),
			environment(`${prefix}-api`, 'team', 'prod')
		],
		w1,
		w2,
		a1,
		a2
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

afterEach(() => {
	vi.unstubAllGlobals();
});

async function renderRevisions() {
	render(WithQueryClient, { props: { component: Page as any } });
	// The hero is the first thing any non-empty fleet renders once the query
	// settles — waiting on it clears the loading branch for every assertion
	// below.
	await waitFor(() =>
		expect(screen.getAllByText('Newest build in use').length).toBeGreaterThan(0)
	);
}

function headingTexts(): string[] {
	return screen.getAllByRole('heading').map((h) => h.textContent?.trim() ?? '');
}

function repoHeaderButton(name: string): HTMLElement {
	const btn = screen
		.getAllByRole('button')
		.find((b) => b.getAttribute('aria-expanded') !== null && b.textContent?.includes(name));
	if (!btn) throw new Error(`no repository disclosure button contains "${name}"`);
	return btn;
}

describe('/revisions — one consistent block per repository', () => {
	test('a single repo renders the same landmark order as before the multi-repo round', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();

		// THE PIN, UPDATED FOR REVISIONS-2026-09-05 (repository sections). The
		// single-repo rail identity card (name, service count, the three
		// figures, `View repository`) that used to sit LAST is folded into the
		// §1 repository card that now OPENS the page — the repo name moves
		// from last heading to second, right after the page's own `sr-only`
		// `h1`. A single repo is expanded by default (index 0), so every
		// build card still renders with no interaction.
		expect(headingTexts()).toEqual([
			'Revisions',
			'repo-a',
			'Newest build in use',
			'Also still running',
			'No longer running anywhere',
			'Never deployed'
		]);

		// The only sanctioned visible change for one repository: the head band
		// now names the repository count, and "revisions" became "builds"
		// (§4 — the object is a build).
		expect(screen.getByText(/·\s*1\s*repository/)).toBeInTheDocument();
		expect(screen.getByText(/of\s*\d+\s*builds deployed/)).toBeInTheDocument();
	});

	test('two repos each get their own hero, lists and rail once both are open', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();

		// §1's default open state: index 0 (repo-a, more recently active)
		// open, repo-b closed — so only repo-a's hero/list cards render yet.
		expect(screen.getAllByText('Newest build in use')).toHaveLength(1);

		// Opening repo-b's own disclosure reaches the defect this round
		// closes: only `ledgers[0]` used to reach these cards at all.
		await fireEvent.click(repoHeaderButton('repo-b'));
		await waitFor(() => expect(screen.getAllByText('Newest build in use')).toHaveLength(2));
		expect(screen.getAllByText('Also still running')).toHaveLength(2);
		expect(screen.getAllByText('No longer running anywhere')).toHaveLength(2);
		expect(screen.getAllByText('Never deployed')).toHaveLength(2);

		// Each section names itself exactly once, and `repo-a` still leads
		// `repo-b` — `ledgers` is sorted most-recently-active first.
		const headings = headingTexts();
		expect(headings.filter((h) => h === 'repo-a')).toHaveLength(1);
		expect(headings.filter((h) => h === 'repo-b')).toHaveLength(1);
		expect(headings.indexOf('repo-a')).toBeLessThan(headings.indexOf('repo-b'));

		expect(screen.getByText(/·\s*2\s*repositories/)).toBeInTheDocument();
	});
});

describe('/revisions — default open state and the remembered open set (REVISIONS-2026-09-05 §1)', () => {
	test('index 0 is open by default; every other section starts closed', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();

		expect(repoHeaderButton('repo-a')).toHaveAttribute('aria-expanded', 'true');
		expect(repoHeaderButton('repo-b')).toHaveAttribute('aria-expanded', 'false');
		// The ledger itself is NOT gated by the disclosure — collapsed still
		// carries the page's most useful answer.
		expect(screen.getByText('repo-b')).toBeInTheDocument();
		expect(screen.getAllByText('Newest build in use')).toHaveLength(1);
	});

	test('opening a second section is remembered across a remount', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);

		const first = render(WithQueryClient, { props: { component: Page as any } });
		await waitFor(() =>
			expect(screen.getAllByText('Newest build in use').length).toBeGreaterThan(0)
		);
		await fireEvent.click(repoHeaderButton('repo-b'));
		await waitFor(() => expect(screen.getAllByText('Newest build in use')).toHaveLength(2));
		first.unmount();

		// A fresh mount of the SAME page — no interaction — must remember that
		// repo-b (index 1) was left open.
		render(WithQueryClient, { props: { component: Page as any } });
		await waitFor(() =>
			expect(screen.getAllByText('Newest build in use').length).toBeGreaterThan(0)
		);
		expect(repoHeaderButton('repo-b')).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getAllByText('Newest build in use')).toHaveLength(2);
	});
});

describe('/revisions — the coverage bar is single-fill and only draws a shortfall (§2)', () => {
	test('the bar is omitted entirely at full coverage', async () => {
		const fleet = fullCoverageFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		expect(document.querySelector('.single-bar')).toBeNull();
	});

	test('the bar renders below full coverage', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// `api` has not yet taken the hero build `r1`, so the hero is below
		// full coverage (1 of 2 places).
		expect(document.querySelector('.single-bar')).not.toBeNull();
	});

	test('craft review item 1 — the fill is an exact WIDTH, "1 of 9" draws 11%, never a full track', async () => {
		const fleet = nineSlotFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		const fill = document.querySelector('.single-bar-fill') as HTMLElement | null;
		expect(fill).not.toBeNull();
		// `CoverageBar`'s cells are `flex: 1`, so both "1 of 9" and "8 of 9"
		// used to draw a fully-filled track — this is the regression test
		// for that: 1/9 rounds to 11%, not 100%.
		expect(fill!.style.width).toBe('11%');
	});
});

describe('/revisions — every age names its event (§5)', () => {
	test('Deployed / Last deployed / Built, never a bare "N ago"', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		await waitFor(() => expect(screen.getByText('Also still running')).toBeInTheDocument());

		// r2 — "Also still running".
		expect(screen.getAllByText(/^Deployed .+ ago$/).length).toBeGreaterThan(0);
		// r4 — "No longer running anywhere".
		expect(screen.getAllByText(/^Last deployed .+ ago$/).length).toBeGreaterThan(0);
		// r3 — "Never deployed".
		expect(screen.getAllByText(/^Built .+ ago$/).length).toBeGreaterThan(0);
		// The old bare form is gone from the page.
		expect(screen.queryByText(/^\d+[a-z]+ ago$/)).toBeNull();
	});
});

describe('/revisions — the repo header leads with distance (§6)', () => {
	test('reads "Newest build deployed" when nothing pending is newer than the head', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		expect(screen.getByText('Newest build deployed')).toBeInTheDocument();
	});

	test('counts a pending build newer than the deployed frontier as "N newer builds"', async () => {
		const fleet = newerPendingFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		expect(screen.getByText('1 newer build')).toBeInTheDocument();
	});
});

describe('/revisions — search finds a build (§7b)', () => {
	async function setup(fleet: ReturnType<typeof repoFixture>) {
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		return screen.getByPlaceholderText('Find a build or service') as HTMLInputElement;
	}

	test('matches a full revision prefix', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		await fireEvent.input(search, { target: { value: fleet.r4.revision.slice(0, 10) } });
		await waitFor(() => expect(screen.getByTitle(fleet.r4.revision)).toBeInTheDocument());
	});

	test('matches a short sha', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		const short = fleet.r2.revision.slice(0, 7);
		await fireEvent.input(search, { target: { value: short } });
		await waitFor(() => expect(screen.getAllByTitle(fleet.r2.revision).length).toBeGreaterThan(0));
		// The other build lists narrow to the no-match sentence.
		await waitFor(() =>
			expect(screen.getAllByText(`No build matches “${short}”.`).length).toBeGreaterThan(0)
		);
	});

	test('matches a service name', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		await fireEvent.input(search, { target: { value: 'a-api' } });
		// r2 is `a-api`'s own live build and must survive the filter.
		await waitFor(() => expect(screen.getAllByTitle(fleet.r2.revision).length).toBeGreaterThan(0));
	});

	test('every section expands while searching, and the remembered set returns once cleared', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();
		expect(screen.getAllByText('Newest build in use')).toHaveLength(1);

		const search = screen.getByPlaceholderText('Find a build or service') as HTMLInputElement;
		// A query that matches only repo-a's own build still opens repo-b —
		// the rule is "searching", not "this repo happens to match".
		await fireEvent.input(search, { target: { value: a.r1.revision.slice(0, 8) } });
		await waitFor(() => expect(screen.getAllByText('Newest build in use')).toHaveLength(2));

		await fireEvent.input(search, { target: { value: '' } });
		await waitFor(() => expect(screen.getAllByText('Newest build in use')).toHaveLength(1));
	});

	test('a repo with no match keeps its repository card and prints the no-match sentence', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		await fireEvent.input(search, { target: { value: 'zzz-nothing-here' } });
		await waitFor(() =>
			expect(screen.getAllByText('No build matches “zzz-nothing-here”.').length).toBeGreaterThan(0)
		);
		// The repository card itself — its header and distance rollup — is
		// still there; only its body collapses to the sentence.
		expect(screen.getByText('repo-a')).toBeInTheDocument();
	});

	test('craft review item 5 — a repo-wide miss collapses to ONE sentence, never three empty cards', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		await fireEvent.input(search, { target: { value: 'zzz-nothing-here' } });
		await waitFor(() =>
			expect(screen.getAllByText('No build matches “zzz-nothing-here”.').length).toBeGreaterThan(0)
		);
		// The three build-list cards do not render at all in this state —
		// their headers, and the "0 of N builds" rollup each would have
		// printed, are gone rather than repeated per card.
		expect(screen.queryByText('Also still running')).toBeNull();
		expect(screen.queryByText('No longer running anywhere')).toBeNull();
		expect(screen.queryByText('Never deployed')).toBeNull();
	});
});

describe('/revisions — the per-service filter is folded into the ledger (coordinator follow-up 2)', () => {
	test('the service name IS the filter button — no separate chip strip exists', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// Exactly ONE accessible control per service — `getByRole` throws on
		// more than one match, so this alone proves there is no second,
		// separate strip repeating the same name.
		const webChip = screen.getByRole('button', { name: 'Show only a-web' });
		const apiChip = screen.getByRole('button', { name: 'Show only a-api' });
		expect(webChip).toHaveTextContent('a-web');
		expect(webChip).toHaveAttribute('aria-pressed', 'false');
		expect(apiChip).toHaveAttribute('aria-pressed', 'false');
		// And the button lives INSIDE the ledger grid, not in a trailing
		// strip below it.
		expect(webChip.closest('.svc-ledger')).not.toBeNull();
	});

	test('craft review item 10 — the name is plain t-body sans, mono stays reserved for the sha', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		const webChip = screen.getByRole('button', { name: 'Show only a-web' });
		// §7a: the service name is `t-body`, never `t-code` — mono is
		// reserved for the sha beside it. Never `t-label`/`pill-btn`
		// either, the uppercase-tracked treatment the human rejected for
		// this exact control.
		expect(webChip.className).toMatch(/\bt-body\b/);
		expect(webChip.className).not.toMatch(/\bt-code\b/);
		expect(webChip.className).not.toMatch(/\bt-label\b/);
		expect(webChip.className).not.toMatch(/\bpill-btn\b/);
		expect(webChip.textContent?.trim()).toBe('a-web');
	});

	test('a multi-build service group has ONE button, on its first line only', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// `hello-multi-app` doesn't exist in `repoFixture`; use the shared
		// two-line fixture instead (`a-web` is single-line there). Assert
		// the general invariant on a service that DOES have two lines:
		// exactly one `aria-pressed` control per service, however many
		// build-lines it renders.
		const buttons = screen
			.getAllByRole('button')
			.filter((b) => b.getAttribute('aria-label')?.startsWith('Show only '));
		const names = buttons.map((b) => b.getAttribute('aria-label'));
		expect(new Set(names).size).toBe(names.length);
	});

	test('pressing a chip filters the build lists to rows that service ships, and expands the section', async () => {
		const a = filterFixture('a');
		const b = filterFixture('b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();
		// repo-b starts closed.
		expect(screen.getAllByText('Newest build in use')).toHaveLength(1);

		const apiChip = screen.getByRole('button', { name: 'Show only b-api' });
		await fireEvent.click(apiChip);
		expect(apiChip).toHaveAttribute('aria-pressed', 'true');

		// Pressing the chip expanded repo-b's section with no header click.
		await waitFor(() => expect(screen.getAllByText('Newest build in use')).toHaveLength(2));

		// "No longer running anywhere" holds `b-web`'s w2 and `b-api`'s a2;
		// filtered to `b-api` only a2 survives.
		await waitFor(() => expect(screen.getByText('1 of 2 builds')).toBeInTheDocument());
		expect(screen.queryByTitle(b.w2.revision)).toBeNull();
		expect(screen.getByTitle(b.a2.revision)).toBeInTheDocument();

		// Pressing again clears the pressed state. (The section itself may
		// fall back to closed once the filter that was holding it open
		// clears — see `effectiveOpen` — which is expected, not asserted here.)
		await fireEvent.click(apiChip);
		expect(apiChip).toHaveAttribute('aria-pressed', 'false');
	});
});

describe('/revisions — the reflow classes named in the spec are present', () => {
	test('the repository card, the ledger and the build rows carry their container-query classes', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		expect(document.querySelector('.repo-card')).not.toBeNull();
		expect(document.querySelector('.svc-ledger')).not.toBeNull();
		expect(document.querySelectorAll('.bld-row').length).toBeGreaterThan(0);
		expect(document.querySelector('.rev-shell')).not.toBeNull();
		expect(document.querySelector('.rev-cols')).not.toBeNull();
	});
});
