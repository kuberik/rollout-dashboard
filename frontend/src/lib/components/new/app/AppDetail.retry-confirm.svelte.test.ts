import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import Harness from './AppDetail.retry-harness.svelte';
import { respond } from '../../../demo/respond';
import { resetDemoState } from '../../../demo/state';
import { install } from '../../../demo/health-failures-fixtures';
import { failureToasts, resetFailureToasts } from '$lib/stores/failure-toasts.svelte';
import FailureToasts from '../../FailureToasts.svelte';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';

/** Retry on the app page asks exactly as the rollout Overview's failure panel does (view-models/retry-confirm.ts). */
const posts: string[] = [];
let siteOfProd: string | null = null;
let retryStatus = 200;
let retryDelay = 0;
let owner: string | null = null;
const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	if (owner) for (const r of l.rollouts.items) if (r.metadata?.name === 'search-indexer') { r.metadata.managedFields = [{ manager: owner, operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }]; r.spec = { ...(r.spec ?? {}), wantedVersion: 'pinned' }; }
	if (siteOfProd) for (const e of l.environments.items) if (e.spec?.environment === 'prod') e.spec.site = siteOfProd;
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};
const mountApp = (app: string) => {
	load();
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		if (method === 'POST' && /\/retry$/.test(String(url))) { posts.push(String(url)); if (retryDelay) await new Promise((r) => setTimeout(r, retryDelay)); return new Response(retryStatus === 200 ? '{}' : JSON.stringify({ error: 'nope' }), { status: retryStatus }); }
		const r = respond(method, String(url));
		if (siteOfProd && r.body?.includes('"environments"')) {
			const j = JSON.parse(r.body);
			for (const e of j.environments?.items ?? []) if (e.spec?.environment === 'prod') e.spec.site = siteOfProd;
			r.body = JSON.stringify(j);
		}
		return new Response(r.body ?? '{}', { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
	});
	resetFailureToasts();
	render(FailureToasts);
	return render(Harness, { props: { name: app } });
};

if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () { this.open = true; };
	HTMLDialogElement.prototype.show = function () { this.open = true; };
	HTMLDialogElement.prototype.close = function () { this.open = false; };
}

describe('AppDetail Retry confirmation', () => {
	beforeAll(() => {
		install(true);
		if (!Element.prototype.animate) Element.prototype.animate = (() => ({ finished: Promise.resolve(), cancel() {}, onfinish: null, play() {}, pause() {}, addEventListener() {} })) as never;
	});
	afterEach(() => { siteOfProd = null; retryStatus = 200; retryDelay = 0; owner = null; installLiveSource(null); posts.length = 0; vi.unstubAllGlobals(); });
	it('a production failed place: Retry opens the confirm; the POST follows the confirm', async () => {
		const { findByRole, findByLabelText, getByRole } = mountApp('search-indexer');
		await fireEvent.click(await findByRole('button', { name: /^Retry$/ }));
		await new Promise((r) => setTimeout(r, 50));
		expect(posts).toEqual([]);
		expect(await findByRole('dialog')).toBeTruthy();
		const input = (await findByLabelText(/to confirm/)) as HTMLInputElement;
		const confirm = [...getByRole('dialog').querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Retry') as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		await fireEvent.input(input, { target: { value: input.labels?.[0]?.querySelector('span')?.textContent ?? '' } });
		await fireEvent.click(confirm);
		await waitFor(() => expect(posts.length).toBe(1));
	});
	it('Roll back opens its confirm on the app page (a button, not a link to the Overview)', async () => {
		const { findByRole, queryByRole } = mountApp('search-indexer');
		const btn = await findByRole('button', { name: /^Roll back$/ });
		expect(queryByRole('link', { name: /^Roll back$/ })).toBeNull();
		await fireEvent.click(btn);
		expect(await findByRole('dialog', {}, { timeout: 5000 })).toBeTruthy();
		expect(location.pathname).not.toMatch(/\/rollouts\//);
	});
	it('the confirm names the Environment\'s site when the rollout label says only prod', async () => {
		siteOfProd = 'eu-west';
		const { findByRole } = mountApp('search-indexer');
		await fireEvent.click(await findByRole('button', { name: /^Retry$/ }));
		await findByRole('dialog');
		expect(document.querySelector('#rcm-title')!.textContent).toMatch(/ in prod · eu-west\?$/);
	});
	const typedRetry = async (m: ReturnType<typeof mountApp>) => {
		await fireEvent.click(await m.findByRole('button', { name: /^Retry$/ }));
		const input = (await m.findByLabelText(/to confirm/)) as HTMLInputElement;
		await fireEvent.input(input, { target: { value: input.labels?.[0]?.querySelector('span')?.textContent ?? '' } });
		await fireEvent.click([...m.getByRole('dialog').querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Retry') as HTMLButtonElement);
	};
	it('a failed Retry prints its reason inside the open confirm', async () => {
		retryStatus = 500;
		await typedRetry(mountApp('search-indexer'));
		await waitFor(() => expect(document.querySelector('[data-retry-error]')?.textContent).toBe('Failed to retry: nope'));
		expect(document.querySelector('#rcm-title')).not.toBeNull();
	});
	it('closing the confirm while the request is in flight: a failure then is a toast, not lost', async () => {
		retryStatus = 500;
		retryDelay = 400;
		const m = mountApp('search-indexer');
		await typedRetry(m);
		await waitFor(() => expect(posts.length).toBe(1));
		await fireEvent.click([...m.getByRole('dialog').querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Cancel') as HTMLButtonElement);
		await waitFor(() => expect(document.body.textContent).toContain('Failed to retry: nope'), { timeout: 3000 });
		expect(document.querySelector('[data-retry-error]')).toBeNull();
		// focus stays on the Retry button through its "Retry failed" label swap, never on <body>
		await waitFor(() => expect((document.activeElement as HTMLElement | null)?.getAttribute('data-action')).toBe('retry'));
		expect(document.activeElement!.textContent).toContain('Retry failed');
		// and the label resets on its own, as it does on every other path
		await waitFor(() => expect(document.querySelector('[data-action="retry"]')!.textContent).not.toContain('Retry failed'), { timeout: 4500 });
		expect(document.activeElement!.getAttribute('data-action')).toBe('retry');
	}, 10_000);
	it('an accepted Retry closes the confirm and says "Retry started"', async () => {
		await typedRetry(mountApp('search-indexer'));
		await waitFor(() => expect(document.body.textContent).toContain('Check restarted'));
		expect(document.querySelector('[data-retry-error]')).toBeNull();
	});
	it('Roll back is disabled, with the reason, when another controller owns the wanted version', async () => {
		owner = 'flux-controller';
		const { findByRole } = mountApp('search-indexer');
		const btn = (await findByRole('button', { name: /^Roll back$/ })) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute('title')).toBe("Another controller owns this rollout's wanted version, so the dashboard cannot pin it.");
	});
});
