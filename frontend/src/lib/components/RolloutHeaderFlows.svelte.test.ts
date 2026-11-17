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

type Calls = { url: string; body: unknown }[];
let calls: Calls;
let changeStatus = 200;
let managed: unknown[] = [];
let rolloutBody: unknown;

function stubFetch() {
	calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (init?.method === 'POST') calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
			if (url.includes('/change-version')) return new Response(JSON.stringify(changeStatus === 200 ? {} : { details: 'boom' }), { status: changeStatus });
			if (url.includes('/retry')) return new Response('{}', { status: 200 });
			if (url.includes('/managed-resources')) return new Response(JSON.stringify({ managedResources: managed }), { status: 200 });
			if (/\/rollouts\/invoice-api-prod-eu-west\/invoice-api$/.test(url)) return new Response(JSON.stringify(rolloutBody), { status: 200 });
			return new Response('{}', { status: 200 });
		})
	);
}

beforeEach(() => {
	goto.mockClear();
	changeStatus = 200;
	managed = [];
	stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

function mount(over: { env: string; failed: boolean; site?: string; kustomized?: boolean; request?: number; rollbackRequest?: number }) {
	rolloutBody = {
		rollout: rolloutOf(over.env, over.failed),
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
		expect(await screen.findByText('Failed to change version')).toBeInTheDocument();
	});
	test('an accepted one shows the success toast', async () => {
		mount({ env: 'dev', failed: false, rollbackRequest: 1 });
		await confirmRollback();
		expect(await screen.findByText('Successfully pinned and deployed version')).toBeInTheDocument();
		expect(calls.some((c) => c.url.includes('/change-version'))).toBe(true);
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
