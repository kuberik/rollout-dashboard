/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

// jsdom has no `<dialog>` showModal/close and no Web Animations API; the
// real ChangeVersionModal needs both. Same file-scoped polyfill the
// Overview's `../change-version-param.svelte.test.ts` uses.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.removeAttribute('open');
	};
}
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

/**
 * unused
 * Roll back on History follows the ownership rule of the header and the Overview: when another controller owns `spec.wantedVersion`, every Roll back is
 * disabled with the same reason and the `?action=rollback` link opens nothing.
 * History reads the page through `$app/stores`, so the mock is a writable store.
 */
const store = vi.hoisted(() => ({ value: null as any, set: null as any }));
vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const page = writable({
		params: { cluster: 'prod', namespace: 'orders-hub-prod-default', name: 'orders-hub' },
		url: new URL(
			'http://localhost/rollouts/prod/orders-hub-prod-default/orders-hub/history'
		),
		route: { id: null },
		status: 200,
		error: null,
		data: {},
		form: null,
		state: {}
	});
	store.value = page;
	return {
		page,
		navigating: writable(null),
		updated: { subscribe: writable(false).subscribe, check: async () => false }
	};
});

const nav = vi.hoisted(() => ({ afterNavigateCb: null as null | (() => void) }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn((url: URL) => {
		store.value.update((p: any) => ({
			...p,
			url: url instanceof URL ? url : new URL(String(url), p.url)
		}));
	}),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn((cb: () => void) => {
		nav.afterNavigateCb = cb;
	})
}));


import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import History from './+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';
import { beforeAll } from 'vitest';
import { toastVisibility, resetToastVisibility } from '$lib/stores/toast-visibility.svelte';

beforeAll(() => install(true));
afterEach(() => vi.unstubAllGlobals());

function openHistory(onPost?: (url: string) => Promise<Response | null>) {
	resetDemoState('calm');
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: any, init?: any) => {
			const url = String(typeof input === 'string' ? input : (input?.url ?? input));
			const method = (init?.method ?? 'GET') as string;
			if (method === 'POST' && onPost) { const r = await onPost(url); if (r) return r; }
			const r = respond(method, url.replace(/^https?:\/\/[^/]+/, ''));
			return new Response(r.body ?? '', { status: r.status, headers: r.headers });
		})
	);
	document.body.innerHTML = '';
	render(WithQueryClient, { props: { component: History as any } });
}

describe('History: the current row chip takes the header pill\'s input', () => {
	test('a check failing right now: the row chip says failing, as the header does', async () => {
		openHistory();
		await waitFor(() => {
			const chips = [...document.querySelectorAll('.chip')].map((e) => e.textContent!.trim().toLowerCase());
			expect(chips.filter((c) => c === 'failing').length).toBeGreaterThanOrEqual(2);
			// no chip anywhere (the current row's included) spells the same state "failed" while a check is failing now
			expect(chips).not.toContain('failed');
		}, { timeout: 15_000 });
	}, 30_000);
});

describe('History: a Roll back closed while in flight, then failing', () => {
	afterEach(() => resetToastVisibility());
	const dlgs = () => [...document.querySelectorAll<HTMLElement>('dialog[open]')];
	const press = (root: ParentNode, re: RegExp) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent!.trim())) as HTMLButtonElement | undefined;

	test('the failure is a toast that waits to be dismissed', async () => {
		openHistory(async (url) => {
			if (!/\/change-version$/.test(url)) return null;
			await new Promise((r) => setTimeout(r, 400));
			return new Response('{"details":"boom"}', { status: 500, headers: { 'Content-Type': 'application/json' } });
		});
		await waitFor(() => expect(document.querySelector('button[data-action="rollback"][aria-label="Roll back to this build"]:not([disabled])')).not.toBeNull(), { timeout: 15_000 });
		await fireEvent.click(document.querySelector('button[data-action="rollback"][aria-label="Roll back to this build"]:not([disabled])')!);
		await waitFor(() => expect(dlgs().length).toBeGreaterThan(0), { timeout: 5000 });
		const warn = dlgs().map((d) => press(d, /^Continue$/)).find(Boolean);
		if (warn) await fireEvent.click(warn);
		await waitFor(() => expect(dlgs().some((d) => d.querySelector('button[data-version-row]') || d.querySelector('textarea'))).toBe(true), { timeout: 5000 });
		const rows = dlgs().flatMap((d) => [...d.querySelectorAll<HTMLButtonElement>('button[data-version-row]')]);
		if (rows.length) await fireEvent.click(rows[rows.length - 1]);
		await waitFor(() => expect(dlgs().some((d) => press(d, /^Roll back/))).toBe(true), { timeout: 5000 });
		const dlg = dlgs().find((d) => press(d, /^Roll back/))!;
		await fireEvent.input(dlg.querySelector('textarea')!, { target: { value: 'because' } });
		const typed = dlg.querySelector<HTMLInputElement>('input[type="text"]');
		if (typed) { const label = typed.closest('div')?.parentElement?.textContent?.match(/Type (\S+) to confirm/)?.[1]; if (label) await fireEvent.input(typed, { target: { value: label } }); }
		await fireEvent.click(press(dlg, /^Roll back/)!);
		await fireEvent.click(press(dlg, /^Cancel$/)!);
		await waitFor(() => expect(document.body.textContent).toMatch(/Failed to roll back: boom/), { timeout: 5000 });
		expect(toastVisibility.count).toBe(1);
		await new Promise((r) => setTimeout(r, 3600));
		expect(toastVisibility.count, 'an error toast waits to be dismissed').toBe(1);
	}, 40_000);
});
