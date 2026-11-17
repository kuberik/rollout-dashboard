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

beforeAll(() => install(true));
afterEach(() => vi.unstubAllGlobals());

afterEach(() => resetToastVisibility());

let changeStatus = 500;
function openOverview() {
	resetDemoState('calm');
	const ns = 'orders-hub-prod-default';
	state.page.params = { cluster: 'prod', namespace: ns, name: 'orders-hub' };
	state.page.url = new URL(`http://localhost/rollouts/prod/${ns}/orders-hub?action=change-version`);
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
async function deploy(closeWhileRunning: boolean) {
	openOverview();
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
		expect(toastVisibility.count).toBe(1);
		await new Promise((r) => setTimeout(r, 3600));
		expect(toastVisibility.count, 'an error toast waits to be dismissed').toBe(1);
	});
	test('a success toast hides by itself', async () => {
		changeStatus = 200;
		await deploy(false);
		await waitFor(() => expect(toastVisibility.count).toBe(1), { timeout: 8000 });
		await waitFor(() => expect(toastVisibility.count, 'closed itself').toBe(0), { timeout: 6000 });
	});
});
