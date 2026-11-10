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
const CL = "rollout-dashboard.kuberik.com/source-cluster";
function fetchWithErrors(one: any, env: any, input: any, cluster: string) {
	const list = { rollouts: { items: input.rollouts }, environments: { items: input.environments }, rolloutDependencies: input.rolloutDependencies, clusters: [{ name: cluster, url: "https://x" }], clusterErrors: [{ name: cluster, url: "https://x", error: "dial tcp: i/o timeout" }] };
	const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
	return async (req: any) => {
		const url = String(typeof req === "string" ? req : (req?.url ?? req));
		if (/\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/.test(url)) return json({ rollout: one, environment: env, rolloutGates: { items: [] } });
		if (url.includes("/schedules") || url.includes("/health-checks") || url.includes("/rollout-tests")) return json({ items: [] });
		if (url.includes("/permissions")) return json({ canDeploy: true, canPin: true });
		if (url.includes("/api/cluster")) return json({ name: cluster, clusters: list.clusters });
		if (url.includes("/api/commits") || url.includes("/api/github")) return json({ connected: false });
		return json(list);
	};
}
for (const withCands of [true, false]) {
	test(`QA #3: stale-cluster notice renders on rollout detail (releaseCandidates ${withCands ? ">0" : "=0"})`, async () => {
		const input = homeInput();
		const one: any = input.rollouts.find((r: any) => withCands ? (r.status?.releaseCandidates?.length ?? 0) > 0 : (r.status?.releaseCandidates?.length ?? 0) === 0 && (r.status?.history?.length ?? 0) > 0)!;
		const env = input.environments.find((e: any) => e.metadata?.namespace === one.metadata.namespace && e.spec?.rolloutRef?.name === one.metadata.name);
		const cluster = one.metadata.annotations?.[CL] ?? "prod";
		const p = { cluster, namespace: one.metadata.namespace, name: one.metadata.name };
		state.page.params = p;
		state.page.url = new URL(`http://localhost/rollouts/${p.cluster}/${p.namespace}/${p.name}`);
		vi.stubGlobal("fetch", vi.fn(fetchWithErrors(one, env, input, cluster)));
		const { container } = render(WithQueryClient, { props: { component: RolloutDetail as any } });
		await waitFor(() => expect(container.querySelector("h1")?.textContent ?? "").toContain(p.name), { timeout: 8000 });
		await new Promise((r) => setTimeout(r, 1500));
		const text = container.textContent ?? "";
		expect(text).toMatch(/did not answer|unreachable/);
	});
}
