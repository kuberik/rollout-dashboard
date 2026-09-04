import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/svelte';
import ResourcesCard from './ResourcesCard.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import type { ManagedResourceStatus } from '../../types';

/**
 * ⭐ PERF-2026-09-04 — `ResourcesCard`'s deployment-children panel is a real
 * TanStack query now (`DeploymentChildren.svelte`, via
 * `deploymentChildrenQueryOptions` in `$lib/api/rollouts`), not a hand-rolled
 * `setInterval` + local cache. These tests exercise it exactly the way an
 * operator would: expand a row, watch it load, watch it fail — through the
 * real component tree, stubbing only the network (`global.fetch`), the same
 * pattern `ChangeVersionModal.svelte.test.ts` uses.
 */

function deploymentResource(over: Partial<ManagedResourceStatus> = {}): ManagedResourceStatus {
	return {
		groupVersionKind: 'apps/v1/Deployment',
		name: 'hello-python',
		namespace: 'hello-world-prod',
		status: 'Current',
		message: '',
		lastModified: '2026-09-04T00:00:00Z',
		object: { status: { readyReplicas: 2, replicas: 2 } },
		...over
	};
}

function renderCard(resources: ManagedResourceStatus[]) {
	return render(WithQueryClient, {
		props: {
			component: ResourcesCard as never,
			props: {
				kustomizations: [],
				ociRepositories: [],
				filteredManagedResources: { 'hello-world-app': resources }
			}
		}
	});
}

const CHILDREN_URL = '/api/namespaces/hello-world-prod/deployments/hello-python/children';

let resolveChildren: ((body: unknown) => void) | null = null;
let rejectChildren: (() => void) | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	resolveChildren = null;
	rejectChildren = null;
	fetchMock = vi.fn((url: string) => {
		if (url === CHILDREN_URL) {
			return new Promise((resolve, reject) => {
				resolveChildren = (body: unknown) =>
					resolve(new Response(JSON.stringify(body), { status: 200 }));
				rejectChildren = () => reject(new TypeError('network error'));
			});
		}
		return Promise.resolve(new Response('{}', { status: 200 }));
	});
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ResourcesCard — Deployment row expand/collapse', () => {
	test('a ready Deployment starts collapsed and does not fetch its children', () => {
		renderCard([deploymentResource()]);

		expect(screen.getByText('hello-python')).toBeInTheDocument();
		expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalledWith(CHILDREN_URL, undefined);
	});

	// ⭐ NO POP-IN: the click and the "Loading..." row land in the SAME
	// render, before the fetch it triggers has answered — the region's
	// geometry is there from the first frame, not inserted once data shows up.
	test('expanding a row shows Loading immediately, then the fetched pods once the request resolves', async () => {
		renderCard([deploymentResource()]);

		await fireEvent.click(screen.getByRole('button', { name: 'Show pods for hello-python' }));

		expect(screen.getByText('Loading...')).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(CHILDREN_URL, undefined);

		await act(() =>
			resolveChildren?.({
				replicaSets: [
					{
						name: 'hello-python-7c9f8b',
						desiredReplicas: 2,
						readyReplicas: 2,
						isCurrentRS: true,
						pods: [
							{ name: 'hello-python-7c9f8b-abcde', phase: 'Running', ready: true, terminating: false }
						]
					}
				]
			})
		);

		await waitFor(() => expect(screen.getByText('hello-python-7c9f8b')).toBeInTheDocument());
		expect(screen.getByText('hello-python-7c9f8b-abcde')).toBeInTheDocument();
		expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
	});

	test('collapsing an expanded row hides the children region', async () => {
		renderCard([deploymentResource()]);

		const toggle = screen.getByRole('button', { name: 'Show pods for hello-python' });
		await fireEvent.click(toggle);
		expect(screen.getByText('Loading...')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Hide pods for hello-python' }));
		expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
	});

	test('a fetch failure renders "Failed to load", not an endless spinner', async () => {
		renderCard([deploymentResource()]);

		await fireEvent.click(screen.getByRole('button', { name: 'Show pods for hello-python' }));
		await act(() => rejectChildren?.());

		await waitFor(() => expect(screen.getByText('Failed to load')).toBeInTheDocument());
	});

	test('a not-ready Deployment auto-expands on mount, with no click needed', () => {
		renderCard([deploymentResource({ status: 'Pending' })]);

		expect(screen.getByText('Loading...')).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(CHILDREN_URL, undefined);
	});

	test('an empty ReplicaSet list renders "No active ReplicaSets", not a blank panel', async () => {
		renderCard([deploymentResource()]);
		await fireEvent.click(screen.getByRole('button', { name: 'Show pods for hello-python' }));
		await act(() => resolveChildren?.({ replicaSets: [] }));

		await waitFor(() => expect(screen.getByText('No active ReplicaSets')).toBeInTheDocument());
	});
});
