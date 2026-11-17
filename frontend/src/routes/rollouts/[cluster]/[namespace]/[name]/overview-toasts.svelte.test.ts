/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor, fireEvent } from '@testing-library/svelte';

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.removeAttribute('open');
	};
}
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	(Element.prototype as any).animate = () => ({ finished: Promise.resolve(), cancel: () => {}, play: () => {}, pause: () => {}, addEventListener: () => {}, removeEventListener: () => {} });
}

const state = vi.hoisted(() => ({
	page: { params: {} as Record<string, string>, url: new URL('http://localhost/rollouts/prod/x/y'), route: { id: null as string | null }, status: 200, error: null, data: {}, form: null }
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn((url: URL) => {
		state.page.url = url instanceof URL ? url : new URL(String(url), state.page.url);
	}),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutDetail from './+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';
import { toastVisibility, resetToastVisibility } from '$lib/stores/toast-visibility.svelte';
import { failureToasts, resetFailureToasts } from '$lib/stores/failure-toasts.svelte';

beforeAll(() => install(true));
afterEach(() => vi.unstubAllGlobals());

afterEach(() => { resetToastVisibility(); resetFailureToasts(); });

let changeStatus = 500;
function openOverview(app = 'orders-hub', query = '?action=change-version') {
	resetDemoState('calm');
	const ns = `${app}-prod-default`;
	state.page.params = { cluster: 'prod', namespace: ns, name: app };
	state.page.url = new URL(`http://localhost/rollouts/prod/${ns}/${app}${query}`);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: any, init?: any) => {
			const url = String(typeof input === 'string' ? input : (input?.url ?? input));
			if ((init?.method ?? 'GET') === 'POST' && /\/change-version$/.test(url)) {
				await new Promise((r) => setTimeout(r, 400));
				return new Response(changeStatus === 200 ? '{}' : '{"details":"boom"}', { status: changeStatus, headers: { 'Content-Type': 'application/json' } });
			}
			const r = respond((init?.method ?? 'GET') as string, url.replace(/^https?:\/\/[^/]+/, ''));
			return new Response(r.body ?? '', { status: r.status, headers: r.headers });
		})
	);
	document.body.innerHTML = '';
	render(WithQueryClient, { props: { component: RolloutDetail as any } });
}
const dlgs = () => [...document.querySelectorAll<HTMLElement>('dialog[open]')];
const press = (root: ParentNode, re: RegExp) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent!.trim())) as HTMLButtonElement | undefined;

/** The Overview's own Change version flow, confirmed, then (optionally) closed while the request runs. */
async function deploy(closeWhileRunning: boolean, viaButton = false) {
	if (viaButton) {
		openOverview('orders-hub', '');
		await waitFor(() => expect(document.querySelector('#status-change-version-btn:not([disabled])')).not.toBeNull(), { timeout: 15_000 });
		const opener = document.querySelector<HTMLButtonElement>('#status-change-version-btn')!;
		opener.focus();
		await fireEvent.click(opener);
	} else openOverview();
	await waitFor(() => expect(dlgs().length).toBeGreaterThan(0), { timeout: 15_000 });
	const warn = dlgs().map((d) => press(d, /^Continue$/)).find(Boolean);
	if (warn) await fireEvent.click(warn);
	await waitFor(() => expect(dlgs().some((d) => d.querySelector('button[data-version-row]'))).toBe(true), { timeout: 10_000 });
	const rows = dlgs().flatMap((d) => [...d.querySelectorAll<HTMLButtonElement>('button[data-version-row]')]);
	await fireEvent.click(rows[rows.length - 1]);
	await waitFor(() => expect(dlgs().some((d) => d.querySelector('textarea') && press(d, /^(Roll back|Deploy)/))).toBe(true), { timeout: 10_000 });
	const dlg = dlgs().find((d) => d.querySelector('textarea') && press(d, /^(Roll back|Deploy)/))!;
	await fireEvent.input(dlg.querySelector('textarea')!, { target: { value: 'because' } });
	const typed = dlg.querySelector<HTMLInputElement>('input[type="text"]');
	if (typed) {
		const want = dlg.textContent?.match(/Type (\S+) to confirm/)?.[1];
		if (want) await fireEvent.input(typed, { target: { value: want } });
	}
	await fireEvent.click(press(dlg, /^(Roll back|Deploy)/)!);
	if (closeWhileRunning) await fireEvent.click(press(dlg, /^Cancel$/)!);
}

describe('rollout page: the Change version flow reports where the operator is', { timeout: 60_000 }, () => {
	test('closed while in flight, then failing: a toast that waits to be dismissed', async () => {
		changeStatus = 500;
		await deploy(true);
		await waitFor(() => expect(document.body.textContent).toMatch(/Failed to (change version|roll back): boom/), { timeout: 8000 });
		expect(failureToasts.items.length).toBe(1);
		expect(failureToasts.items[0].message).toMatch(/^orders-hub in prod: Failed to (change version|roll back): boom$/);
		await new Promise((r) => setTimeout(r, 3600));
		expect(failureToasts.items.length, 'an error toast waits to be dismissed').toBe(1);
	});
	test('a success toast hides by itself', async () => {
		changeStatus = 200;
		await deploy(false);
		await waitFor(() => expect(toastVisibility.count).toBe(1), { timeout: 8000 });
		await waitFor(() => expect(toastVisibility.count, 'closed itself').toBe(0), { timeout: 6000 });
	});
});

describe('rollout page: the header after a Change version submit', () => {
	const opener = () => document.querySelector<HTMLButtonElement>('#status-change-version-btn')!;
	test('a refused request clears "Deploy requested — starting" and re-enables Change version at once', async () => {
		changeStatus = 500;
		await deploy(false, true);
		await waitFor(() => expect(document.body.textContent).toContain('Deploy requested — starting'), { timeout: 3000 });
		await waitFor(() => expect(document.querySelector('[data-deploy-error]')).not.toBeNull(), { timeout: 8000 });
		expect(document.body.textContent).not.toContain('Deploy requested — starting');
		expect(opener().getAttribute('aria-disabled')).toBeNull();
		// closing after the inline failure returns focus to the button as well
		await fireEvent.click(press(dlgs().find((d) => d.querySelector('[data-deploy-error]'))!, /^Cancel$/)!);
		await waitFor(() => expect(document.activeElement).toBe(opener()), { timeout: 2000 });
	}, 40_000);
	test('closing the dialog in flight hands focus back to Change version, which stays focusable', async () => {
		changeStatus = 500;
		await deploy(true, true);
		await new Promise((r) => setTimeout(r, 100));
		expect(document.activeElement, 'focus is on the opener while the request still runs').toBe(opener());
		expect(opener().disabled).toBe(false);
	}, 40_000);
});

describe('rollout page: a pin another controller owns', () => {
	test('every disabled Clear pin gives the same reason as Roll back (title and aria-describedby)', async () => {
		openOverview('inventory-api', '');
		const pins = () => [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent!.trim() === 'Clear pin');
		await waitFor(() => expect(pins().length).toBeGreaterThan(0), { timeout: 15_000 });
		for (const b of pins()) {
			expect(b.disabled).toBe(true);
			expect(b.getAttribute('title')).toBe("Another controller owns this rollout's wanted version, so the dashboard cannot pin it.");
			expect(b.getAttribute('aria-describedby')).toBe('owned-reason');
		}
	}, 40_000);
});
