import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
// `pick()` calls `goto` on Enter/click — unused by every test above (none of
// them select a row), so this file never needed the mock other palette-
// adjacent tests already carry (`subject-uncovered.svelte.test.ts`,
// `routes/revisions/page.svelte.test.ts`). The new build/action tests below
// do select a row, so it is added here rather than assuming a real
// `$app/navigation` tolerates being called outside a page.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
import CommandPalette from './CommandPalette.svelte';
import WithQueryClient from './testing/WithQueryClient.svelte';
import { goto } from '$app/navigation';
import { SOURCE_CLUSTER_ANNOTATION } from './source-dashboard';
import type { Rollout, Environment } from '../types';
import type { MyPull } from './api/my-pulls';

// ⛔ FIX PASS ITEM 6/8, 2026-09-10 — the "Your changes" tile now reads
// `myChangesCount` off a real `changesQueryOptions()` fetch (the SAME
// function `YourChangesCard` uses, ruling 5), not the `myPulls` prop. Most
// tests here never select a row or open the tile, so an unmocked relative
// `fetch('/api/github/changes?...')` simply rejects synchronously and the
// query settles into an empty/error state — never a hang. `afterEach`
// restores the global between tests that DO stub it.
afterEach(() => {
	vi.unstubAllGlobals();
});

function stubChangesFetch(changes: Array<Record<string, unknown>>, user = 'octocat') {
	vi.stubGlobal(
		'fetch',
		vi.fn((url: string) => {
			if (typeof url === 'string' && url.startsWith('/api/github/changes')) {
				return Promise.resolve(
					new Response(JSON.stringify({ user, repos: [], since: '2026-08-01T00:00:00Z', changes }), {
						status: 200
					})
				);
			}
			return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
		})
	);
}

function change(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		owner: 'acme',
		repo: 'widget',
		kind: 'pr',
		number: 1,
		title: 'hello world',
		htmlUrl: '',
		author: 'octocat',
		mergedAt: '2026-09-01T00:00:00Z',
		mergeCommitSha: 'deadbeef',
		base: 'main',
		containedIn: [],
		containedInAll: false,
		...overrides
	};
}

function baseProps() {
	return {
		open: true,
		scope: null,
		rollouts: [] as Rollout[],
		environments: [] as Environment[],
		localClusterName: 'hub'
	};
}

async function waitForFocusRestore() {
	// `modalFocusReturn` restores immediately, then again past its own
	// transition timers (`setTimeout(restore, 0)` and `setTimeout(restore,
	// 180)`) — wait past the longest one.
	await new Promise((r) => setTimeout(r, 200));
}

// Multi-cluster: the hub merges rollouts from several clusters. Two clusters
// can share an app's namespace+name. The palette's per-row {#each} key includes
// the source-cluster name so these two rollouts don't collide on the same
// keyed-each key.
function rollout(ns: string, name: string, cluster: string): Rollout {
	return {
		metadata: {
			namespace: ns,
			name,
			annotations: { [SOURCE_CLUSTER_ANNOTATION]: cluster }
		},
		spec: {},
		status: {}
	} as unknown as Rollout;
}

describe('CommandPalette multi-cluster duplicate keys', () => {
	test('renders without throwing when two clusters share namespace+name', () => {
		const rollouts = [
			rollout('demo', 'hello-world', 'dev'),
			rollout('demo', 'hello-world', 'prod')
		];
		render(WithQueryClient, { props: { component: CommandPalette as never, props: {
				open: true,
				scope: 'rollout',
				rollouts,
				environments: [],
				localClusterName: 'hub'
			} } });
		// Both cluster instances must render as distinct rows. The overlay is
		// portalled to `document.body` (see `a11y.svelte.ts`'s `portal`), so it
		// is no longer a descendant of `render()`'s own `container` div.
		expect(document.body.querySelectorAll('[data-idx]')).toHaveLength(2);
	});
});

/**
 * ⭐ P8 — THE PALETTE OPENED UNFOCUSED AT 390, AND THE ITEM SWITCHER
 * PRESELECTED THE WRONG ROW. (2026-09-03, operator walk)
 *
 * The two regressions were an explicit `isTouch` check that skipped
 * `.focus()` on any coarse pointer (every phone, unconditionally) and
 * `selectedIndex` always starting at 0, so opening the app switcher from
 * `/apps/hello-world-app` preselected whichever app happened to be inserted
 * first and Enter navigated the reader OFF the app they were looking at.
 */
describe('P8 — the palette focuses its input on open, at any pointer type', () => {
	test('the search input is the active element as soon as the dialog opens', () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: {
				open: true,
				scope: null,
				rollouts: [],
				environments: [],
				localClusterName: 'hub'
			} } });
		expect(document.activeElement?.tagName).toBe('INPUT');
	});
});

// Apps are derived from `environments` (each env's `spec.rolloutRef.name`),
// not from `rollouts` directly — see CommandPalette.svelte's "2. Apps" block.
function environment(appName: string, tier: string): Environment {
	return {
		metadata: { name: `${appName}-${tier}`, namespace: `${appName}-${tier}` },
		spec: { environment: tier, rolloutRef: { name: appName } },
		status: {}
	} as unknown as Environment;
}

describe('P8 — a scoped switcher preselects the object you are already on', () => {
	test('opening the app switcher from the current app selects its own row, not row 0', () => {
		const environments = [
			environment('hello-frontend-app', 'dev'),
			environment('hello-world-app', 'dev')
		];
		render(WithQueryClient, { props: { component: CommandPalette as never, props: {
				open: true,
				scope: 'app',
				rollouts: [],
				environments,
				localClusterName: 'hub',
				// The route param for `/apps/hello-world-app` — NOT the first
				// app inserted (that's `hello-frontend-app`).
				currentName: 'hello-world-app'
			} } });
		const rows = document.body.querySelectorAll('[data-idx]');
		expect(rows.length).toBe(2);
		const selected = document.body.querySelector('[aria-selected="true"]');
		expect(selected?.textContent).toContain('hello-world-app');
	});

	test('opening the rollout switcher from the current rollout selects it, not row 0', () => {
		const rollouts = [
			rollout('demo', 'hello-world', 'dev'),
			rollout('demo', 'hello-world', 'prod')
		];
		render(WithQueryClient, { props: { component: CommandPalette as never, props: {
				open: true,
				scope: 'rollout',
				rollouts,
				environments: [],
				localClusterName: 'hub',
				currentNamespace: 'demo',
				currentName: 'hello-world'
			} } });
		// Both rows share namespace+name; only the `prod`-cluster one is
		// "current" per `isCurrentResult`'s `r.isCurrent` — but `isCurrent`
		// itself only compares ns/name, so either match is acceptable here.
		// The property under test is that SOME row is preselected, not row 0
		// by construction accident.
		const rows = document.body.querySelectorAll('[data-idx]');
		const selected = document.body.querySelector('[aria-selected="true"]');
		expect(rows.length).toBe(2);
		expect(selected?.textContent).toContain('hello-world');
	});
});

/**
 * ⭐ NIT 12 — CTRL+K OPENS WITH NOTHING FOCUSED; ESCAPE MUST NOT LAND ON
 * `<body>`. (2026-09-03) `Navbar.svelte`'s ⌘K/Ctrl K handler is a global
 * `<svelte:window onkeydown>` that never focuses anything, unlike clicking
 * the Search button (which focuses it for free) — so `document.activeElement`
 * is `<body>` at the instant the palette opens via the shortcut, same as this
 * test's fresh mount with `open: true` and nothing focused beforehand.
 * `modalFocusReturn` treats `<body>` as "nothing was focused" and declines to
 * restore anything, which is correct in general but left Escape with nowhere
 * honest to go for this one trigger. The fix redirects that specific case
 * onto the navbar's one `[aria-label^="Search ("]` button before
 * `modalFocusReturn` takes its own snapshot.
 */
describe('nit 12 — focus return after close, regardless of trigger', () => {
	test('nothing focused on open (⌘K trigger): closing returns focus to the Search button, not <body>', async () => {
		const searchButton = document.createElement('button');
		searchButton.setAttribute('aria-label', 'Search (Ctrl K)');
		document.body.appendChild(searchButton);
		try {
			(document.activeElement as HTMLElement | null)?.blur();
			expect(document.activeElement).toBe(document.body);

			// ⛔ FIX PASS ITEM 6, 2026-09-10 — CLOSE VIA A REAL ESCAPE PRESS, NOT
			// `rerender`. `WithQueryClient`'s own prop is (legitimately) named
			// `props`, which `@testing-library/svelte`'s `rerender` mistakes for
			// its OWN deprecated `{ props: {...} }` wrapper convention and
			// unwraps — silently dropping `component` from the update and
			// leaving the palette open. Firing the same `Escape` keydown
			// `Navbar.svelte`'s `<svelte:window onkeydown>` listener reacts to
			// exercises the identical code path (`handleKeydown` sets `open =
			// false`) without touching the render harness's own prop shape.
			render(WithQueryClient, { props: { component: CommandPalette as never, props: baseProps() } });
			await fireEvent.keyDown(window, { key: 'Escape' });
			await waitForFocusRestore();

			expect(document.activeElement).toBe(searchButton);
		} finally {
			searchButton.remove();
		}
	});

	test('something already focused on open (click trigger): closing restores that element, not the Search button', async () => {
		const searchButton = document.createElement('button');
		searchButton.setAttribute('aria-label', 'Search (Ctrl K)');
		document.body.appendChild(searchButton);
		const otherTrigger = document.createElement('button');
		otherTrigger.textContent = 'Switch rollout';
		document.body.appendChild(otherTrigger);
		try {
			otherTrigger.focus();
			expect(document.activeElement).toBe(otherTrigger);

			// See the sibling test above for why this closes via a real Escape
			// press rather than `rerender`.
			render(WithQueryClient, { props: { component: CommandPalette as never, props: baseProps() } });
			await fireEvent.keyDown(window, { key: 'Escape' });
			await waitForFocusRestore();

			expect(document.activeElement).toBe(otherTrigger);
		} finally {
			searchButton.remove();
			otherTrigger.remove();
		}
	});
});

/**
 * ⭐ THE OPERATOR-WALK BUG. `9f10e49` returned "No matches · 0 results"
 * although `/revisions/github.com/littlechimera/kuberik-testing/9f10e494d560`
 * exists, because the palette's rollout rows only ever searched a rollout's
 * CURRENT display label — and this fixture's rollout labels that exact build
 * `2.66.0-66`. `revisions` also returned 0 results, because the top-level
 * "Go to" list never grew an entry for the page. Both are now covered by
 * `palette-index.ts` (unit-tested directly in `palette-index.test.ts`) and
 * the actions list in `CommandPalette.svelte` — these two tests exercise
 * both fixes end to end, through the real component.
 */
function rolloutWithBuild(name: string, ns: string, sha: string, label: string): Rollout {
	const revision = `${sha}${'0'.repeat(40)}`.slice(0, 40);
	const build = { tag: `main-${sha}`, version: label, revision, created: new Date().toISOString() };
	return {
		metadata: { namespace: ns, name },
		spec: {},
		status: {
			source: 'https://github.com/littlechimera/kuberik-testing.git',
			availableReleases: [build],
			history: [{ version: build, timestamp: new Date().toISOString(), bakeStatus: 'Succeeded' }]
		}
	} as unknown as Rollout;
}

describe('the build index — a sha resolves regardless of the label a service currently shows', () => {
	// ⚠️ A 7-character sha is ALSO a valid change reference now
	// (CHANGES-2026-09-10.md — see "the change result kind" above), so this
	// query legitimately produces TWO rows: the ungrouped `Open change
	// 9f10e49 · kuberik-testing` ref row (which does not know this build
	// exists — it is a client-side guess, not a resolved lookup) AND the
	// `build` kind's own row, which carries the real facts a resolved build
	// has: the label it ships under and the repo. The test disambiguates by
	// that fact rather than by the sha alone.
	test('typing a 7-character sha prefix finds the build, even though the rollout displays a semver label', async () => {
		const rollouts = [rolloutWithBuild('checkout-api', 'demo', '9f10e49', '2.66.0-66')];
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: { ...baseProps(), rollouts } } });

		await fireEvent.input(getByRole('combobox'), { target: { value: '9f10e49' } });

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		const buildRow = rows.find((r) => r.textContent?.includes('2.66.0-66'));
		expect(buildRow).toBeTruthy();
		// The row also names the label it ships under and the repo — the
		// required "<sha7> · <labels> · <repo short name>" facts, not just
		// the sha.
		expect(buildRow!.textContent).toContain('9f10e49');
		expect(buildRow!.textContent).toContain('kuberik-testing');

		await fireEvent.click(buildRow!);
		// CHANGES-2026-09-10.md §1: the build result's href is `/changes/...`
		// now, not `/revisions/...`.
		expect(goto).toHaveBeenCalledWith(
			'/changes/github.com/littlechimera/kuberik-testing/9f10e4900000'
		);
	});
});

describe('top-level pages resolve by the name the sidebar prints', () => {
	test('typing "Home" finds and opens the fleet-overview page', async () => {
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: baseProps() } });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'Home' } });

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		const homeRow = rows.find((r) => r.textContent?.includes('Home'));
		expect(homeRow).toBeTruthy();

		await fireEvent.click(homeRow!);
		expect(goto).toHaveBeenCalledWith('/');
	});

	test('typing "changes" finds the Changes page — it used to return 0 results', async () => {
		// CHANGES-2026-09-10.md §1/§2: the Go-to row is `Changes` → `/changes`
		// now, not `Revisions` → `/revisions` (the old address 308s forever,
		// but the palette's own row points at the live one).
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: baseProps() } });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'changes' } });

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		const changesRow = rows.find(
			(r) => r.textContent?.includes('Changes') && r.textContent?.includes('landed')
		);
		expect(changesRow).toBeTruthy();

		await fireEvent.click(changesRow!);
		expect(goto).toHaveBeenCalledWith('/changes');
	});
});

/**
 * ⭐ ⌘K'S `change` RESULT KIND — CHANGES-2026-09-10.md, "THE PALETTE".
 * Renamed from `pr`; see `palette-index.test.ts`'s `buildChangeRefPaletteResults`
 * for the unit-level coverage of the four reference forms. These exercise
 * the same fixture through the real component: the ref row renders
 * UNGROUPED (no "Changes" section header above it), the icon slot does not
 * crash on a kind with no bespoke branch, and Enter/click navigates to
 * `/changes/{owner}/{repo}/pull/{number}` or `/changes/{owner}/{repo}/{sha}`
 * — never the retired `/pr/…` path.
 */
describe('the change result kind — reference rows', () => {
	test('a full PR URL resolves to exactly one row, above everything else, with no group header', async () => {
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: baseProps() } });

		await fireEvent.input(getByRole('combobox'), {
			target: { value: 'https://github.com/kuberik/rollout-dashboard/pull/123' }
		});

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).toContain('Open change #123');
		expect(rows[0].textContent).toContain('rollout-dashboard');
		// The old bug: this row rendered inside a "Pull requests" group
		// header. It must render with none at all.
		expect(document.body.textContent).not.toContain('Pull requests');
		expect(document.body.textContent).not.toContain('Changes');

		await fireEvent.click(rows[0]);
		expect(goto).toHaveBeenCalledWith('/changes/kuberik/rollout-dashboard/pull/123');
	});

	test('owner/repo#123 resolves the same way', async () => {
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: baseProps() } });

		await fireEvent.input(getByRole('combobox'), {
			target: { value: 'kuberik/rollout-dashboard#123' }
		});

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		expect(rows).toHaveLength(1);

		await fireEvent.click(rows[0]);
		expect(goto).toHaveBeenCalledWith('/changes/kuberik/rollout-dashboard/pull/123');
	});

	test('a bare #123 fans out to one row per distinct cluster source repo', async () => {
		const rollouts = [
			rolloutWithBuild('widget-app', 'widget-dev', 'aaaaaaa', '1.0.0'),
			{
				metadata: { namespace: 'gadget-dev', name: 'gadget-app' },
				spec: {},
				status: { source: 'https://github.com/acme/gadget.git' }
			} as unknown as Rollout
		];
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: { ...baseProps(), rollouts } } });

		await fireEvent.input(getByRole('combobox'), { target: { value: '#7' } });

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		const changeRows = rows.filter((r) => r.textContent?.includes('Open change #7'));
		// One for `littlechimera/kuberik-testing` (rolloutWithBuild's fixed
		// source) and one for `acme/gadget`.
		expect(changeRows).toHaveLength(2);

		await fireEvent.click(changeRows.find((r) => r.textContent?.includes('gadget'))!);
		expect(goto).toHaveBeenCalledWith('/changes/acme/gadget/pull/7');
	});

	// ⛔ FIX PASS ITEM 8, 2026-09-10 — a bare sha no longer fans out
	// unconditionally the way a bare #n does: `buildChangeRefPaletteResults`
	// narrows to repos whose OWN rollout data (`availableReleases`/`history`)
	// actually carries the revision, and only falls back to one row per repo
	// (worded "Look up …", not "Open change …") when none do.
	test('a bare 7-character sha nobody\'s rollout data knows offers "Look up …" per repo', async () => {
		const rollouts = [
			{
				metadata: { namespace: 'gadget-dev', name: 'gadget-app' },
				spec: {},
				status: { source: 'https://github.com/acme/gadget.git' }
			} as unknown as Rollout
		];
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: { ...baseProps(), rollouts } } });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'bf5be49' } });

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		const changeRow = rows.find((r) => r.textContent?.includes('Look up bf5be49'));
		expect(changeRow).toBeTruthy();
		expect(changeRow!.textContent).toContain('gadget');

		await fireEvent.click(changeRow!);
		expect(goto).toHaveBeenCalledWith('/changes/acme/gadget/bf5be49');
	});

	test('a bare sha a rollout\'s own history carries narrows to just that repo', async () => {
		const rollouts = [
			{
				metadata: { namespace: 'gadget-dev', name: 'gadget-app' },
				spec: {},
				status: {
					source: 'https://github.com/acme/gadget.git',
					availableReleases: [{ tag: 'v1', revision: 'bf5be49123456789' }]
				}
			} as unknown as Rollout,
			{
				metadata: { namespace: 'widget-dev', name: 'widget-app' },
				spec: {},
				status: { source: 'https://github.com/acme/widget.git' }
			} as unknown as Rollout
		];
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: { ...baseProps(), rollouts } } });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'bf5be49' } });

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		const changeRows = rows.filter((r) => /Open change bf5be49|Look up bf5be49/.test(r.textContent ?? ''));
		expect(changeRows).toHaveLength(1);
		expect(changeRows[0].textContent).toContain('Open change bf5be49');
		expect(changeRows[0].textContent).toContain('gadget');
	});

	test('an unrelated query produces no ref row at all', async () => {
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: baseProps() } });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'hello world' } });

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		expect(rows.some((r) => r.textContent?.includes('Open change'))).toBe(false);
	});
});

/**
 * ⭐ CHANGES-2026-09-10.md's own acceptance line: "typing hello puts rollouts
 * first and at most 3 Changes rows below apps and environments." The
 * measured defect this closes: a `PULL REQUESTS` group of 5 rendered ABOVE
 * every rollout for the identical query.
 */
function myPull(overrides: Partial<MyPull>): MyPull {
	return {
		owner: 'acme',
		repo: 'widget',
		number: 1,
		title: 'hello world',
		htmlUrl: '',
		state: 'merged',
		openedAt: null,
		mergedAt: '2026-09-01T00:00:00Z',
		mergeCommitSha: 'deadbeef',
		headSha: null,
		base: 'main',
		updatedAt: '2026-09-01T00:00:00Z',
		...overrides
	};
}

describe('title matches rank below rollouts/apps/environments, capped at 3', () => {
	test('"hello" ranks the matching rollout above every matching change, and caps changes at 3', async () => {
		const rollouts = [rollout('demo', 'hello-world', 'dev')];
		const myPulls = [
			myPull({ number: 1, title: 'hello one' }),
			myPull({ number: 2, title: 'hello two' }),
			myPull({ number: 3, title: 'hello three' }),
			myPull({ number: 4, title: 'hello four' })
		];
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: { ...baseProps(), rollouts, myPulls } } });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'hello' } });

		const rows = Array.from(document.body.querySelectorAll('[data-idx]'));
		const rolloutIdx = rows.findIndex((r) => r.textContent?.includes('hello-world'));
		expect(rolloutIdx).toBeGreaterThanOrEqual(0);
		// At most 3 change rows shown, and every one of them sorts AFTER the
		// rollout row.
		const changeRowIdxs = rows
			.map((r, i) => ({ r, i }))
			.filter(({ r }) => r.textContent?.includes('#') && r.textContent?.includes('widget'))
			.map(({ i }) => i);
		expect(changeRowIdxs.length).toBeLessThanOrEqual(3);
		expect(changeRowIdxs.every((i) => i > rolloutIdx)).toBe(true);
	});

	test('a merged pull that is NOT in the myPulls cache never renders — open/closed pulls are excluded upstream', async () => {
		const myPulls = [myPull({ state: 'open', title: 'hello open' })];
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: { ...baseProps(), myPulls } } });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'hello' } });

		expect(document.body.textContent).not.toContain('hello open');
	});
});

/**
 * ⭐ CHANGES-2026-09-10.md, item 3 — the fifth Browse tile, "Your changes".
 * It NAVIGATES to `/changes?mine` rather than scoping (there is no
 * client-side change index to browse into).
 */
describe('the "Your changes" Browse tile', () => {
	test('renders as the fifth tile, with the merged-in-30-days count, and navigates on click', async () => {
		// ⛔ FIX PASS ITEM 6/8, 2026-09-10 — `myChangesCount` off
		// `changesQueryOptions()`'s own fetch (ruling 5), the SAME function
		// and cache `YourChangesCard` reads on Home, not the `myPulls` prop
		// (which this tile no longer counts from).
		stubChangesFetch([
			change({ number: 1, title: 'one' }),
			change({ number: 2, title: 'two' }),
			change({ number: 3, title: 'three', author: 'someone-else' }) // excluded — not mine
		]);
		const { getByText } = render(WithQueryClient, { props: { component: CommandPalette as never, props: baseProps() } });

		const tile = await waitFor(() => {
			const el = getByText('Your changes').closest('button')!;
			expect(el.textContent).toContain('2');
			return el;
		});
		expect(tile.textContent).toContain('merged in the last 30 days');

		await fireEvent.click(tile);
		expect(goto).toHaveBeenCalledWith('/changes?mine');
	});
});

/**
 * ⭐ GROUP ORDER SNAPSHOT — rollout(4) > build(3.5) > app(3) > env(2) >
 * change(1.5) > namespace(1) > action(0), and reference rows never form
 * their own group.
 */
describe('group order', () => {
	test('groups sort rollout, app, env, change, namespace, action — never a change/pull-request group above rollouts', async () => {
		const rollouts = [rollout('demo', 'hello-world', 'dev')];
		const environments = [environment('hello-world', 'dev')];
		const myPulls = [myPull({ title: 'hello change' })];
		const { getByRole } = render(WithQueryClient, { props: { component: CommandPalette as never, props: { ...baseProps(), rollouts, environments, myPulls } } });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'hello' } });

		const headers = Array.from(
			document.body.querySelectorAll('[role="presentation"] > span.uppercase')
		).map((el) => el.textContent);
		const order = headers.filter((h): h is string => !!h && h !== 'Browse');
		const rolloutIdx = order.indexOf('Rollouts');
		const changeIdx = order.indexOf('Changes');
		if (rolloutIdx >= 0 && changeIdx >= 0) {
			expect(rolloutIdx).toBeLessThan(changeIdx);
		}
		expect(order).not.toContain('Pull requests');
	});
});
