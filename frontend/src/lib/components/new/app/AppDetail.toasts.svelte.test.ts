import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import Harness from './AppDetail.retry-harness.svelte';
import { respond } from '../../../demo/respond';
import { resetDemoState } from '../../../demo/state';
import { install } from '../../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { toastVisibility, resetToastVisibility } from '$lib/stores/toast-visibility.svelte';

/** The app page's toasts: a late failure of a closed dialog is reported, an error waits to be dismissed, a success hides by itself. */
let retryStatus = 200;
let changeStatus = 200;
const delay = 300;
const mountApp = (app: string) => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		if (method === 'POST' && /\/retry$/.test(String(url))) { await new Promise((r) => setTimeout(r, delay)); return new Response(retryStatus === 200 ? '{}' : JSON.stringify({ error: 'nope' }), { status: retryStatus }); }
		if (method === 'POST' && /\/change-version$/.test(String(url))) { await new Promise((r) => setTimeout(r, delay)); return new Response(changeStatus === 200 ? '{}' : JSON.stringify({ details: 'boom' }), { status: changeStatus }); }
		const r = respond(method, String(url));
		return new Response(r.body ?? '{}', { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
	});
	document.body.innerHTML = '';
	return render(Harness, { props: { name: app } });
};
if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () { this.open = true; };
	HTMLDialogElement.prototype.show = function () { this.open = true; };
	HTMLDialogElement.prototype.close = function () { this.open = false; };
}
const cancel = (_m: ReturnType<typeof mountApp>) => fireEvent.click([...[...document.querySelectorAll('dialog[open]')].pop()!.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Cancel') as HTMLButtonElement);
const typedRetry = async (m: ReturnType<typeof mountApp>) => {
	await fireEvent.click(await m.findByRole('button', { name: /^Retry$/ }));
	const input = (await m.findByLabelText(/to confirm/)) as HTMLInputElement;
	await fireEvent.input(input, { target: { value: input.labels?.[0]?.querySelector('span')?.textContent ?? '' } });
	await fireEvent.click([...m.getByRole('dialog').querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Retry') as HTMLButtonElement);
};

describe('AppDetail toasts', { timeout: 20_000 }, () => {
	beforeAll(() => {
		install(true);
		if (!Element.prototype.animate) Element.prototype.animate = (() => ({ finished: Promise.resolve(), cancel() {}, onfinish: null, play() {}, pause() {}, addEventListener() {} })) as never;
	});
	afterEach(() => { retryStatus = 200; changeStatus = 200; installLiveSource(null); vi.unstubAllGlobals(); resetToastVisibility(); });

	it('a Deploy whose dialog is closed while in flight, then fails, is reported as a toast', async () => {
		changeStatus = 500;
		const m = mountApp('search-indexer');
		const btn = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent!.trim()));
		await waitFor(() => expect(btn(/^1\.5\.0/)).toBeTruthy(), { timeout: 5000 });
		await fireEvent.click(btn(/^1\.5\.0/)!);
		await waitFor(() => expect(btn(/^Deploy$/)).toBeTruthy(), { timeout: 5000 });
		await fireEvent.click(btn(/^Deploy$/)!);
		const warn = await m.findByRole('dialog', {}, { timeout: 5000 });
		await fireEvent.click([...warn.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Continue') as HTMLButtonElement);
		let dlg!: HTMLElement;
		await waitFor(() => { dlg = [...document.querySelectorAll<HTMLElement>('dialog[open]')].find((d) => d.querySelector('textarea'))!; expect(dlg).toBeTruthy(); }, { timeout: 5000 });
		await fireEvent.input(dlg.querySelector('textarea')!, { target: { value: 'because' } });
		const go = [...dlg.querySelectorAll('button')].filter((b) => /Deploy/.test(b.textContent!)).pop() as HTMLButtonElement;
		await fireEvent.click(go);
		await fireEvent.click([...dlg.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Cancel') as HTMLButtonElement);
		await waitFor(() => expect(document.body.textContent).toContain('Failed to change version: boom'), { timeout: 4000 });
		// reported as a toast: the closed dialog prints nothing inline
		expect(document.querySelector('[data-deploy-error]')).toBeNull();
	});

	it('an error toast waits to be dismissed', async () => {
		retryStatus = 500;
		const m = mountApp('search-indexer');
		await typedRetry(m);
		await cancel(m);
		await waitFor(() => expect(toastVisibility.count).toBe(1), { timeout: 4000 });
		await new Promise((r) => setTimeout(r, 3600));
		expect(toastVisibility.count, 'still open past the success lifetime').toBe(1);
	});

	it('a success toast hides by itself', async () => {
		const m = mountApp('search-indexer');
		await typedRetry(m);
		await waitFor(() => expect(toastVisibility.count).toBe(1), { timeout: 4000 });
		await waitFor(() => expect(toastVisibility.count, 'closed itself').toBe(0), { timeout: 5000 });
	});
});
