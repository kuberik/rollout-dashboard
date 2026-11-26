/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

/**
 * QA1-1 / QA1-3: on the rollout page the Ready=False banner and the surface that owns a reason are never both drawn.
 * The controller writes Ready=False with the SAME reason the owning banner reads (ReleaseSourceRequired on Ready and
 * ReleasesUpdated; BakeTimeFailed beside history[0].bakeStatus=Failed), so each pair is rendered here through the real
 * page wiring, plus one control where the Ready banner is the only statement. In its own file because `vi.mock` is
 * hoisted per file.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutDetail from '../../routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte';
import { fleet, respond } from '$lib/messages/fleet-fixture';

afterEach(() => vi.unstubAllGlobals());

const DETAIL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;
const at = '2026-08-31T01:00:00Z';
const SOURCE_MSG =
	'spec.releaseSourceRef is not set, so this Rollout has no releases. Create a ReleaseSource for its artifact and reference it from spec.releaseSourceRef.';
const HELM =
	'HelmRelease alpha-dev/alpha-app: spec.values.image.tag is also set by "gitops-demo". Remove it from the manifest in Git so kuberik owns it.';

type Edit = (one: any) => void;

async function mount(edit: Edit) {
	state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
	const payload = fleet();
	const one: any = JSON.parse(JSON.stringify(payload.rollouts.items[0]));
	edit(one);
	const list = respond(payload) as any;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: any) => {
			const url = String(typeof input === 'string' ? input : (input?.url ?? input));
			if (url.includes('/permissions'))
				return new Response(JSON.stringify({ permissions: { update: true, patch: true } }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			if (DETAIL.test(url))
				return new Response(
					JSON.stringify({ rollout: one, environment: payload.environments.items[0], rolloutGates: { items: [] } }),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			return list(input);
		})
	);
	const r = render(WithQueryClient, { props: { component: RolloutDetail as any } });
	await waitFor(() => expect(screen.getAllByText(/alpha-app/i).length).toBeGreaterThan(0), { timeout: 5000 });
	return r.container;
}

const readyBanner = (c: HTMLElement) => c.querySelector('[data-tour="ready-banner"]');

describe('the Ready banner never repeats a fact another banner states', () => {
	test('no release source: ReleaseSourceNotice speaks, the Ready banner does not', { timeout: 30000 }, async () => {
		const c = await mount((one) => {
			for (const f of ['availableReleases', 'releaseCandidates', 'gatedReleaseCandidates']) delete one.status[f];
			one.status.conditions = [
				{ type: 'ReleasesUpdated', status: 'False', reason: 'ReleaseSourceRequired', message: SOURCE_MSG, lastTransitionTime: at },
				{ type: 'Ready', status: 'False', reason: 'ReleaseSourceRequired', message: SOURCE_MSG, lastTransitionTime: at }
			];
		});
		await waitFor(() => expect(screen.getAllByText('No release source', { exact: true }).length).toBeGreaterThan(0), { timeout: 25000 });
		expect(readyBanner(c)).toBeNull();
	});

	test('a failed bake: FailurePanel speaks, the Ready banner does not', { timeout: 30000 }, async () => {
		const c = await mount((one) => {
			one.status.history[0].bakeStatus = 'Failed';
			one.status.conditions = [
				{ type: 'Ready', status: 'False', reason: 'BakeTimeFailed', message: 'Health check alpha-slo failed during bake.', lastTransitionTime: at }
			];
		});
		await waitFor(() => expect(screen.getAllByText('Deployment failed').length).toBeGreaterThan(0), { timeout: 25000 });
		expect(readyBanner(c)).toBeNull();
	});

	test('a field conflict: the Ready banner is the one statement, its path copies clean', { timeout: 30000 }, async () => {
		const c = await mount((one) => {
			one.status.conditions = [
				{ type: 'Ready', status: 'False', reason: 'HelmReleaseFieldConflict', message: HELM, lastTransitionTime: at }
			];
		});
		await waitFor(() => expect(readyBanner(c)).not.toBeNull(), { timeout: 25000 });
		const b = readyBanner(c)!;
		expect(b.textContent).toContain('Deploy refused');
		expect(b.textContent).toContain('HelmReleaseFieldConflict on spec.values.image.tag, also set by gitops-demo');
		expect(/[​‌‍⁠]/.test(b.textContent ?? ''), 'no zero-width characters to copy').toBe(false);
		const path = b.querySelector('[data-ready-path]')!;
		expect(path.textContent).toBe('spec.values.image.tag');
		expect(path.querySelectorAll('wbr').length).toBe(3);
		expect(b.querySelector('[data-ready-next]')!.textContent).toContain('stop that tool from setting it');
		expect(b.querySelector('[data-ready-by]')!.textContent).toBe('gitops-demo');
		expect(screen.queryByText('No release source', { exact: true })).toBeNull();
		expect(screen.queryByText('Deployment failed')).toBeNull();
	});
});
