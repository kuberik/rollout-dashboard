import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import RolloutHeaderFlows from './RolloutHeaderFlows.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

const goto = vi.fn();
vi.mock('$app/navigation', async (orig) => ({ ...(await orig<Record<string, unknown>>()), goto: (...a: unknown[]) => goto(...a) }));

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

const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const KRUISE = 'rollouts.kruise.io/v1beta1/Rollout';
const TEST = 'rollout.kuberik.com/v1alpha1/RolloutTest';

/** a rollout whose label says only `env`; `failed` puts a Failed build first so Retry has something to retry */
function rolloutOf(env: string, failed: boolean) {
	return {
		metadata: { name: 'invoice-api', namespace: 'invoice-api-prod-eu-west', labels: { environment: env } },
		spec: {},
		status: {
			availableReleases: [
				{ tag: 'old', version: '0afab6f', created: day(10) },
				{ tag: 'new', version: '064b655', created: day(1) }
			],
			gates: [{ name: 'open', passing: true, allowedVersions: null }],
			conditions: [{ type: 'GatesPassing', status: 'True' }],
			history: [{ version: { tag: 'new', version: '064b655', created: day(1) }, bakeStatus: failed ? 'Failed' : 'Succeeded', timestamp: day(1) }]
		}
	};
}

/** another manager owns `spec.wantedVersion` */
const withOwner = (r: ReturnType<typeof rolloutOf>, owner: string) => ({ ...r, metadata: { ...r.metadata, managedFields: [{ manager: owner, operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }] }, spec: { wantedVersion: 'old' } });

type Calls = { url: string; body: unknown }[];
let calls: Calls;
let changeStatus = 200;
let retryStatus = 200;
let delayMs = 0;
let managed: unknown[] = [];
let rolloutBody: unknown;

function stubFetch() {
	calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (init?.method === 'POST') calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
			if (delayMs && (url.includes('/change-version') || url.includes('/retry'))) await new Promise((r) => setTimeout(r, delayMs));
			if (url.includes('/change-version')) return new Response(JSON.stringify(changeStatus === 200 ? {} : { details: 'boom' }), { status: changeStatus });
			if (url.includes('/retry')) return new Response(retryStatus === 200 ? '{}' : JSON.stringify({ error: 'nope' }), { status: retryStatus });
			if (url.includes('/managed-resources')) return new Response(JSON.stringify({ managedResources: managed }), { status: 200 });
			if (/\/rollouts\/invoice-api-prod-eu-west\/invoice-api$/.test(url)) return new Response(JSON.stringify(rolloutBody), { status: 200 });
			return new Response('{}', { status: 200 });
		})
	);
}

beforeEach(() => {
	goto.mockClear();
	changeStatus = 200;
	retryStatus = 200;
	delayMs = 0;
	managed = [];
	stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

function mount(over: { env: string; failed: boolean; owner?: string; site?: string; kustomized?: boolean; request?: number; rollbackRequest?: number }) {
	rolloutBody = {
		rollout: over.owner ? withOwner(rolloutOf(over.env, over.failed), over.owner) : rolloutOf(over.env, over.failed),
		environment: { metadata: { name: 'invoice-api', namespace: 'invoice-api-prod-eu-west' }, spec: { environment: over.env, ...(over.site ? { site: over.site } : {}) } },
		kustomizations: { items: over.kustomized ? [{ metadata: { name: 'app', namespace: 'invoice-api-prod-eu-west' } }] : [] }
	};
	return render(WithQueryClient, {
		props: {
			component: RolloutHeaderFlows as never,
			props: { cluster: 'prod', namespace: 'invoice-api-prod-eu-west', name: 'invoice-api', request: over.request ?? 0, rollbackRequest: over.rollbackRequest ?? 0 } as never
		}
	});
}

async function confirmRollback() {
	const go = await screen.findByRole('button', { name: /^Roll back$/i });
	await fireEvent.input(screen.getByPlaceholderText('Why are you rolling back?'), { target: { value: 'because' } });
	await fireEvent.click(go);
}

describe('header Roll back reports its result where the operator is', () => {
	test('a failed change-version request shows "Failed to change version"', async () => {
		changeStatus = 500;
		mount({ env: 'dev', failed: false, rollbackRequest: 1 });
		await confirmRollback();
		expect(await screen.findByText(/^Failed to change version/)).toBeInTheDocument();
	});
	test('a failed request prints the server\'s reason inside the OPEN dialog (a toast would sit under its backdrop)', async () => {
		changeStatus = 500;
		mount({ env: 'dev', failed: false, rollbackRequest: 1 });
		await confirmRollback();
		const err = await waitFor(() => {
			const e = document.querySelector('[data-deploy-error]');
			expect(e).not.toBeNull();
			return e!;
		});
		expect(err.textContent).toBe('Failed to change version: boom');
		expect(screen.getByPlaceholderText('Why are you rolling back?')).toBeInTheDocument();
	});
	test('an accepted one shows the success toast', async () => {
		mount({ env: 'dev', failed: false, rollbackRequest: 1 });
		await confirmRollback();
		expect(await screen.findByText('Successfully pinned and deployed version')).toBeInTheDocument();
		expect(calls.some((c) => c.url.includes('/change-version'))).toBe(true);
	});
	test('the success toast is the Overview\'s: one line, no "View logs" action', async () => {
		mount({ env: 'dev', failed: false, rollbackRequest: 1 });
		await confirmRollback();
		await screen.findByText('Successfully pinned and deployed version');
		expect(screen.queryByText('View logs')).toBeNull();
	});
	test('another controller owning the wanted version: Roll back opens nothing', async () => {
		mount({ env: 'dev', failed: false, rollbackRequest: 1, owner: 'flux-controller' });
		await new Promise((r) => setTimeout(r, 300));
		expect(screen.queryByPlaceholderText('Why are you rolling back?')).toBeNull();
	});
});

describe('the confirm names the Environment\'s site when the rollout label says only prod', () => {
	test('Retry: "Retry 064b655 in prod · eu-west?"', async () => {
		mount({ env: 'prod', failed: true, site: 'eu-west', request: 1 });
		await waitFor(() => expect(document.querySelector('#rcm-title')).not.toBeNull());
		expect(document.querySelector('#rcm-title')!.textContent).toBe('Retry 064b655 in prod · eu-west?');
	});
	test('Roll back names prod · eu-west', async () => {
		mount({ env: 'prod', failed: false, site: 'eu-west', rollbackRequest: 1 });
		await waitFor(() => expect(document.body.textContent).toMatch(/prod · eu-west/));
	});
});

describe('header Retry failures', () => {
	test('prod: the typed confirm stays open and prints the failure inside itself', async () => {
		retryStatus = 500;
		mount({ env: 'prod', failed: true, site: 'eu-west', request: 1 });
		await waitFor(() => expect(document.querySelector('#rcm-title')).not.toBeNull());
		await fireEvent.input(document.querySelector('#rcm-confirm')!, { target: { value: '064b655' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
		await waitFor(() => expect(document.querySelector('[data-retry-error]')?.textContent).toBe('Failed to retry: nope'));
		expect(document.querySelector('#rcm-title')).not.toBeNull();
	});
	test('dev: no confirm is open, so the failure is a toast', async () => {
		retryStatus = 500;
		mount({ env: 'dev', failed: true, request: 1 });
		expect(await screen.findByText('Failed to retry: nope')).toBeInTheDocument();
	});
});

describe('header Retry decisions', () => {
	test('a stalled Kruise Rollout\'s name rides along in the POST', async () => {
		managed = [{ groupVersionKind: KRUISE, object: { metadata: { name: 'invoice-canary' }, status: { conditions: [{ type: 'Stalled', status: 'True' }] } } }];
		mount({ env: 'dev', failed: true, kustomized: true, request: 1 });
		await waitFor(() => expect(calls.find((c) => c.url.endsWith('/retry'))).toBeTruthy());
		expect(calls.find((c) => c.url.endsWith('/retry'))!.body).toEqual({ kruiseRolloutName: 'invoice-canary', testAction: '' });
	});
	test('a no-risk Retry (dev) fires directly, with no confirm', async () => {
		mount({ env: 'dev', failed: true, request: 1 });
		await waitFor(() => expect(calls.find((c) => c.url.endsWith('/retry'))).toBeTruthy());
		expect(document.querySelector('#rcm-title')).toBeNull();
		expect(goto).not.toHaveBeenCalled();
	});
	test('a failed step test hands back to the Overview, and posts nothing', async () => {
		managed = [
			{ groupVersionKind: KRUISE, object: { metadata: { name: 'invoice-canary' }, status: {} } },
			{ groupVersionKind: TEST, object: { metadata: { name: 't1' }, spec: { rolloutName: 'invoice-canary' }, status: { phase: 'Failed' } } }
		];
		mount({ env: 'dev', failed: true, kustomized: true, request: 1 });
		await waitFor(() => expect(goto).toHaveBeenCalled());
		expect(String(goto.mock.calls[0][0])).toContain('action=retry');
		expect(calls.find((c) => c.url.endsWith('/retry'))).toBeUndefined();
	});
});

/** A request still in flight when the dialog is closed: the failure goes to a toast with the same sentence; while the dialog is open it stays inline only. */
describe('a failure after the dialog was closed is still reported', () => {
	const cancelBtn = () => [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent?.trim() === 'Cancel')!;
	const sentences = (re: RegExp) => (document.body.textContent ?? '').match(new RegExp(re, 'g'))?.length ?? 0;

	test('Roll back: closed, then fails -> one toast with the dialog\'s sentence', async () => {
		changeStatus = 500;
		delayMs = 400;
		mount({ env: 'dev', failed: false, rollbackRequest: 1 });
		await confirmRollback();
		await fireEvent.click(cancelBtn());
		expect(await screen.findByText('Failed to change version: boom', {}, { timeout: 3000 })).toBeInTheDocument();
		expect(document.querySelector('[data-deploy-error]')).toBeNull();
	});
	test('Roll back: still open when it fails -> inline only, no toast', async () => {
		changeStatus = 500;
		delayMs = 100;
		mount({ env: 'dev', failed: false, rollbackRequest: 1 });
		await confirmRollback();
		await waitFor(() => expect(document.querySelector('[data-deploy-error]')).not.toBeNull(), { timeout: 3000 });
		await new Promise((r) => setTimeout(r, 300));
		expect(sentences(/Failed to change version: boom/)).toBe(1);
	});
	test('Retry: closed, then fails -> one toast with the dialog\'s sentence', async () => {
		retryStatus = 500;
		delayMs = 400;
		mount({ env: 'prod', failed: true, site: 'eu-west', request: 1 });
		await waitFor(() => expect(document.querySelector('#rcm-title')).not.toBeNull());
		await fireEvent.input(document.querySelector('#rcm-confirm')!, { target: { value: '064b655' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
		await fireEvent.click(cancelBtn());
		expect(await screen.findByText('Failed to retry: nope', {}, { timeout: 3000 })).toBeInTheDocument();
		expect(document.querySelector('[data-retry-error]')).toBeNull();
	});
	test('Retry: still open when it fails -> inline only, no toast', async () => {
		retryStatus = 500;
		delayMs = 100;
		mount({ env: 'prod', failed: true, site: 'eu-west', request: 1 });
		await waitFor(() => expect(document.querySelector('#rcm-title')).not.toBeNull());
		await fireEvent.input(document.querySelector('#rcm-confirm')!, { target: { value: '064b655' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
		await waitFor(() => expect(document.querySelector('[data-retry-error]')).not.toBeNull(), { timeout: 3000 });
		await new Promise((r) => setTimeout(r, 300));
		expect(sentences(/Failed to retry: nope/)).toBe(1);
	});
});

describe('pressing again after a failure', () => {
	test('Roll back: a second press after an error sends the request again and succeeds', async () => {
		changeStatus = 500;
		mount({ env: 'dev', failed: false, rollbackRequest: 1 });
		await confirmRollback();
		await waitFor(() => expect(document.querySelector('[data-deploy-error]')).not.toBeNull());
		changeStatus = 200;
		await fireEvent.click(screen.getByRole('button', { name: /^Roll back$/i }));
		expect(await screen.findByText('Successfully pinned and deployed version')).toBeInTheDocument();
		expect(calls.filter((c) => c.url.includes('/change-version'))).toHaveLength(2);
	});
	test('Retry: a second press after an error sends the request again, clears the error and succeeds', async () => {
		retryStatus = 500;
		mount({ env: 'prod', failed: true, site: 'eu-west', request: 1 });
		await waitFor(() => expect(document.querySelector('#rcm-title')).not.toBeNull());
		await fireEvent.input(document.querySelector('#rcm-confirm')!, { target: { value: '064b655' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
		await waitFor(() => expect(document.querySelector('[data-retry-error]')).not.toBeNull());
		retryStatus = 200;
		await fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
		expect(await screen.findByText(/Retry started/)).toBeInTheDocument();
		expect(calls.filter((c) => c.url.includes('/retry'))).toHaveLength(2);
		expect(document.querySelector('[data-retry-error]')).toBeNull();
	});
});
