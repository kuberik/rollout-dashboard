/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

if (!Element.prototype.animate) {
	Element.prototype.animate = function () {
		return { cancel() {}, finish() {}, set onfinish(_f: unknown) {}, currentTime: 0, playState: 'finished' } as unknown as Animation;
	};
}
if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () { this.open = true; };
	HTMLDialogElement.prototype.show = function () { this.open = true; };
	HTMLDialogElement.prototype.close = function () { this.open = false; };
}

/**
 * Roll back and Retry in a rollout tab's header open their confirm IN PLACE: on Logs (and Gates, History) the page stays, the URL stays,
 * nothing navigates, and Cancel leaves you where you were. (They used to link to the Overview with ?action=.)
 */
const state = vi.hoisted(() => ({
	page: {
		params: { cluster: 'prod', namespace: 'orders-hub-prod-default', name: 'orders-hub' } as Record<string, string>,
		url: new URL('http://localhost/rollouts/prod/orders-hub-prod-default/orders-hub/logs'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);
const gotoSpy = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto: gotoSpy, invalidateAll: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutTabHeader from './RolloutTabHeader.svelte';

const rollout = {
	metadata: { name: 'orders-hub', namespace: 'orders-hub-prod-default', labels: { environment: 'prod' } },
	spec: {},
	status: {
		history: [
			{ bakeStatus: 'Failed', version: { tag: '1.4.0', created: '2026-10-11T10:00:00Z' }, timestamp: '2026-10-11T10:00:00Z' },
			{ bakeStatus: 'Succeeded', version: { tag: '1.3.0', created: '2026-10-10T10:00:00Z' }, timestamp: '2026-10-10T10:00:00Z' }
		]
	}
};

afterEach(() => {
	vi.unstubAllGlobals();
	gotoSpy.mockClear();
});

function mount(r: any = rollout) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: any) => {
			if (/\/rollouts\/[^/]+\/[^/]+(\?|$)/.test(String(url)))
				return new Response(JSON.stringify({ rollout: r, environment: { spec: { environment: 'prod' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
			return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
		})
	);
	return render(WithQueryClient, { props: { component: RolloutTabHeader as any, props: { name: 'orders-hub', rollout: r, failingNow: true } as any } });
}
const press = async (container: HTMLElement, action: 'retry' | 'rollback') =>
	fireEvent.click(container.querySelector(`button[data-desktop-only]${action === 'retry' ? '[data-action="retry"]' : ':not([data-action])'}`) as HTMLElement);

describe('the tab header Roll back / Retry act in place', () => {
	test('Logs: Retry opens its confirm on the page; Cancel leaves the URL and the page alone', async () => {
		const { container } = mount();
		await press(container, 'retry');
		await waitFor(() => expect(document.querySelector('#rcm-title')).not.toBeNull(), { timeout: 5000 });
		expect(document.querySelector('#rcm-title')!.textContent).toMatch(/^Retry 1\.4\.0 in prod/);
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(gotoSpy).not.toHaveBeenCalled();
		expect(state.page.url.pathname).toMatch(/\/logs$/);
		expect(state.page.url.search).toBe('');
	});
	test('Logs: Roll back opens its dialog on the page; Cancel leaves the URL alone', async () => {
		const { container } = mount();
		await press(container, 'rollback');
		await waitFor(() => expect(screen.getByText(/to prod|Roll back prod/)).toBeInTheDocument(), { timeout: 5000 });
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(gotoSpy).not.toHaveBeenCalled();
		expect(state.page.url.pathname).toMatch(/\/logs$/);
	});
});

describe('Roll back in the tab header is gated on who owns the pin', () => {
	const flux = {
		...rollout,
		spec: { wantedVersion: '1.4.0' },
		metadata: { ...rollout.metadata, managedFields: [{ manager: 'flux', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }] }
	};
	const REASON = "Another controller owns this rollout's wanted version, so the dashboard cannot pin it.";
	test('another field manager owns spec.wantedVersion: Roll back is disabled with the Overview reason and opens nothing', async () => {
		const { container } = mount(flux);
		const desktop = container.querySelector('button[data-desktop-only]:not([data-action])') as HTMLButtonElement;
		const phone = container.querySelector('button[data-phone-only][data-action="rollback"]') as HTMLButtonElement;
		for (const b of [desktop, phone]) {
			expect(b.disabled).toBe(true);
			expect(b.getAttribute('title')).toBe(REASON);
		}
		expect(container.querySelector('[data-owned-reason]')?.textContent).toBe(REASON);
		await fireEvent.click(desktop);
		await new Promise((r) => setTimeout(r, 300));
		expect(document.querySelector('dialog[open]')).toBeNull();
	});
	test('the dashboard owns the pin: enabled, plain title', () => {
		const { container } = mount();
		const desktop = container.querySelector('button[data-desktop-only]:not([data-action])') as HTMLButtonElement;
		expect(desktop.disabled).toBe(false);
		expect(desktop.getAttribute('title')).toBe('Roll back to 1.3.0');
		expect(container.querySelector('[data-owned-reason]')).toBeNull();
	});
});
