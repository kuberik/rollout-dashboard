import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
// `pick()` calls `goto` on Enter/click — unused by every test above (none of
// them select a row), so this file never needed the mock other palette-
// adjacent tests already carry (`subject-uncovered.svelte.test.ts`,
// `routes/revisions/page.svelte.test.ts`). The new build/action tests below
// do select a row, so it is added here rather than assuming a real
// `$app/navigation` tolerates being called outside a page.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
import CommandPalette from './CommandPalette.svelte';
import { goto } from '$app/navigation';
import { SOURCE_CLUSTER_ANNOTATION } from './source-dashboard';
import type { Rollout, Environment } from '../types';

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
		const { container } = render(CommandPalette, {
			props: {
				open: true,
				scope: 'rollout',
				rollouts,
				environments: [],
				localClusterName: 'hub'
			}
		});
		// Both cluster instances must render as distinct rows.
		expect(container.querySelectorAll('[data-idx]')).toHaveLength(2);
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
		render(CommandPalette, {
			props: {
				open: true,
				scope: null,
				rollouts: [],
				environments: [],
				localClusterName: 'hub'
			}
		});
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
		const { container } = render(CommandPalette, {
			props: {
				open: true,
				scope: 'app',
				rollouts: [],
				environments,
				localClusterName: 'hub',
				// The route param for `/apps/hello-world-app` — NOT the first
				// app inserted (that's `hello-frontend-app`).
				currentName: 'hello-world-app'
			}
		});
		const rows = container.querySelectorAll('[data-idx]');
		expect(rows.length).toBe(2);
		const selected = container.querySelector('[aria-selected="true"]');
		expect(selected?.textContent).toContain('hello-world-app');
	});

	test('opening the rollout switcher from the current rollout selects it, not row 0', () => {
		const rollouts = [
			rollout('demo', 'hello-world', 'dev'),
			rollout('demo', 'hello-world', 'prod')
		];
		const { container } = render(CommandPalette, {
			props: {
				open: true,
				scope: 'rollout',
				rollouts,
				environments: [],
				localClusterName: 'hub',
				currentNamespace: 'demo',
				currentName: 'hello-world'
			}
		});
		// Both rows share namespace+name; only the `prod`-cluster one is
		// "current" per `isCurrentResult`'s `r.isCurrent` — but `isCurrent`
		// itself only compares ns/name, so either match is acceptable here.
		// The property under test is that SOME row is preselected, not row 0
		// by construction accident.
		const rows = container.querySelectorAll('[data-idx]');
		const selected = container.querySelector('[aria-selected="true"]');
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

			const { rerender } = render(CommandPalette, { props: baseProps() });
			await rerender({ ...baseProps(), open: false });
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

			const { rerender } = render(CommandPalette, { props: baseProps() });
			await rerender({ ...baseProps(), open: false });
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
	test('typing a 7-character sha prefix finds the build, even though the rollout displays a semver label', async () => {
		const rollouts = [rolloutWithBuild('checkout-api', 'demo', '9f10e49', '2.66.0-66')];
		const { container, getByRole } = render(CommandPalette, {
			props: { ...baseProps(), rollouts }
		});

		await fireEvent.input(getByRole('combobox'), { target: { value: '9f10e49' } });

		const rows = Array.from(container.querySelectorAll('[data-idx]'));
		const buildRow = rows.find((r) => r.textContent?.includes('9f10e49'));
		expect(buildRow).toBeTruthy();
		// The row also names the label it ships under and the repo — the
		// required "<sha7> · <labels> · <repo short name>" facts, not just
		// the sha.
		expect(buildRow!.textContent).toContain('2.66.0-66');
		expect(buildRow!.textContent).toContain('kuberik-testing');

		await fireEvent.click(buildRow!);
		expect(goto).toHaveBeenCalledWith(
			'/revisions/github.com/littlechimera/kuberik-testing/9f10e4900000'
		);
	});
});

describe('top-level pages resolve by the name the sidebar prints', () => {
	test('typing "Home" finds and opens the fleet-overview page', async () => {
		const { container, getByRole } = render(CommandPalette, { props: baseProps() });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'Home' } });

		const rows = Array.from(container.querySelectorAll('[data-idx]'));
		const homeRow = rows.find((r) => r.textContent?.includes('Home'));
		expect(homeRow).toBeTruthy();

		await fireEvent.click(homeRow!);
		expect(goto).toHaveBeenCalledWith('/');
	});

	test('typing "revisions" finds the Revisions page — it used to return 0 results', async () => {
		const { container, getByRole } = render(CommandPalette, { props: baseProps() });

		await fireEvent.input(getByRole('combobox'), { target: { value: 'revisions' } });

		const rows = Array.from(container.querySelectorAll('[data-idx]'));
		const revisionsRow = rows.find((r) => r.textContent?.includes('Revisions'));
		expect(revisionsRow).toBeTruthy();

		await fireEvent.click(revisionsRow!);
		expect(goto).toHaveBeenCalledWith('/revisions');
	});
});
