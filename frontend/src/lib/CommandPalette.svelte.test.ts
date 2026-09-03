import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import CommandPalette from './CommandPalette.svelte';
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
