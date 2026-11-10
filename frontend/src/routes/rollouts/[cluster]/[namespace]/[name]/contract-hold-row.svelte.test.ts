/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';

// (the dialog/animate polyfills are copied from change-version-param.svelte.test.ts)
// jsdom does not implement `<dialog>`'s `showModal`/`close` (a known,
// long-standing gap — https://github.com/jsdom/jsdom/issues/3294). The
// REAL `ChangeVersionModal` renders a native dialog via flowbite-svelte's
// `Dialog`, and this file deliberately opens it twice, so the gap is no
// longer avoidable by accident the way a single-open test can dodge it.
// Minimal polyfill, scoped to this file.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.removeAttribute('open');
	};
}
// Same jsdom gap, the Web Animations API this time (Svelte's own
// `in:`/`out:` transitions on the dialog call `element.animate()`).
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	(Element.prototype as any).animate = () => ({
		finished: Promise.resolve(),
		cancel: () => {},
		play: () => {},
		pause: () => {},
		addEventListener: () => {},
		removeEventListener: () => {}
	});
}

const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);

const nav = vi.hoisted(() => ({
	afterNavigateCb: null as null | (() => void)
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	// Mocked to actually mutate `state.page.url`, the same object the
	// component reads back — a real `replaceState` does this too, just via
	// the browser's History API instead of a direct assignment.
	replaceState: vi.fn((url: URL) => {
		state.page.url = url instanceof URL ? url : new URL(String(url), state.page.url);
	}),
	beforeNavigate: vi.fn(),
	// Captures the callback instead of running it, so the test can fire it
	// on demand — exactly the "a navigation just completed" event SvelteKit
	// itself would deliver on a same-route, query-only `goto()`.
	afterNavigate: vi.fn((cb: () => void) => {
		nav.afterNavigateCb = cb;
	})
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutDetail from './+page.svelte';
import { homeInput } from '$lib/view-models/home/fixture';

afterEach(() => vi.unstubAllGlobals());

const ROLLOUT_DETAIL_URL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;
const CL = 'rollout-dashboard.kuberik.com/source-cluster';

/** The pinned Home incident fixture, served the way `/api/rollouts` and the detail GET answer. */
function incidentFetch(ns: string, name: string) {
	const input = homeInput();
	const one = input.rollouts.find(
		(r) => r.metadata?.namespace === ns && r.metadata?.name === name
	)!;
	const env = input.environments.find(
		(e) => e.metadata?.namespace === ns && e.spec?.rolloutRef?.name === name
	);
	const clusters = [
		...new Set(input.rollouts.map((r) => r.metadata?.annotations?.[CL]).filter(Boolean))
	];
	const list = {
		rollouts: { items: input.rollouts },
		environments: { items: input.environments },
		rolloutDependencies: input.rolloutDependencies,
		clusters: clusters.map((c) => ({ name: c, url: `https://${c}` })),
		clusterErrors: []
	};
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	return async (req: any) => {
		const url = String(typeof req === 'string' ? req : (req?.url ?? req));
		if (ROLLOUT_DETAIL_URL.test(url))
			return json({ rollout: one, environment: env, rolloutGates: { items: [] } });
		if (
			url.includes('/schedules') ||
			url.includes('/health-checks') ||
			url.includes('/rollout-tests')
		)
			return json({ items: [] });
		if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
		if (url.includes('/api/cluster')) return json({ name: 'prod', clusters: list.clusters });
		if (url.includes('/api/commits') || url.includes('/api/github'))
			return json({ connected: false });
		return json(list);
	};
}

/**
 * fix8 F3 (QA v2-5): the Overview's newer-builds row names the contract hold of ITS build, from
 * the per-build hold source the Gates tab, /apps and the blocked banner read
 * (`contractHoldsForRollout`), never the graph edge's `requiredVersion`. checkout-api's held builds
 * disagree on what they need of payments-svc (b-43 ~2.9.0, b-44 3.0.0, b-45 ^3.0.0), so the edge
 * carries no range and the row used to read "Needs payments-svc · has 2.4.1".
 */
describe("Overview newer builds: a contract hold names its own build's requirement", () => {
	test('checkout-api prod ap-southeast-2: 4.43.0-43 reads ~2.9.0, as the Gates tab does', async () => {
		const p = {
			cluster: 'prod',
			namespace: 'checkout-api-prod-ap-southeast-2',
			name: 'checkout-api'
		};
		state.page.params = p;
		state.page.url = new URL(`http://localhost/rollouts/${p.cluster}/${p.namespace}/${p.name}`);
		vi.stubGlobal('fetch', vi.fn(incidentFetch(p.namespace, p.name)));

		const { container } = render(WithQueryClient, { props: { component: RolloutDetail as any } });

		await waitFor(
			() => expect(container.textContent).toMatch(/Needs payments-svc ~2\.9\.0\s*has 2\.4\.1/),
			{ timeout: 8000 }
		);
		const text = container.textContent ?? '';
		// b-43 is the one build held HERE (b-44, b-45 wait for staging); never the rangeless edge clause
		// (r5 TB28: the cause is two slots — "Needs …" | "has …" — the dot between them is drawn in CSS)
		expect(text).toMatch(/4\.43\.0-43[^]*?Needs payments-svc ~2\.9\.0\s*has 2\.4\.1/);
		expect(text).not.toContain('Needs payments-svc · has');
	});
});

describe('Overview newer builds on a phone: the fold never hides a held build (TB22)', () => {
	test('390px: 4.43.0-43 (held here) stays visible; a lone at-rest row never folds', async () => {
		const p = {
			cluster: 'prod',
			namespace: 'checkout-api-prod-ap-southeast-2',
			name: 'checkout-api'
		};
		state.page.params = p;
		state.page.url = new URL(`http://localhost/rollouts/${p.cluster}/${p.namespace}/${p.name}`);
		vi.stubGlobal('fetch', vi.fn(incidentFetch(p.namespace, p.name)));
		vi.stubGlobal(
			'matchMedia',
			vi.fn((q: string) => ({
				matches: q.includes('max-width: 639px'),
				media: q,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {}
			}))
		);

		const { container } = render(WithQueryClient, { props: { component: RolloutDetail as any } });

		await waitFor(
			() => expect(container.textContent).toMatch(/Needs payments-svc ~2\.9\.0\s*has 2\.4\.1/),
			{ timeout: 8000 }
		);
		const text = container.textContent ?? '';
		expect(text).toContain('4.43.0-43');
		// r7 TB33: a fold never hides a single row (the button is taller than the row), so the lone
		// at-rest 4.44.0-44 between the newest and the held build stays drawn.
		expect(text).toContain('4.44.0-44');
		expect(text).not.toMatch(/Show 1 older build/);
	});
});
