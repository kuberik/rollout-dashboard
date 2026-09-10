import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchPull, FetchPullError, pullQueryOptions } from './pulls';

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

const PULL = {
	number: 123,
	title: 'Add PR pipeline view',
	htmlUrl: 'https://github.com/kuberik/rollout-dashboard/pull/123',
	author: 'octocat',
	state: 'merged' as const,
	mergedAt: '2026-09-10T00:00:00Z',
	mergeCommitSha: 'abc1234',
	base: 'main',
	containedIn: ['abc1234'],
	containedInAll: true,
	openedAt: '2026-09-08T00:00:00Z',
	headSha: 'abc1234def',
	changedFiles: 4
};

describe('fetchPull', () => {
	it('resolves the pull request on 200', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(200, PULL))
		);
		const pr = await fetchPull('kuberik', 'rollout-dashboard', 123);
		expect(pr).toEqual(PULL);
	});

	it('builds the cluster-scoped path form', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, PULL));
		vi.stubGlobal('fetch', fetchMock);
		await fetchPull('kuberik', 'rollout-dashboard', 123, 'spoke-1');
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/clusters/spoke-1/github/pulls/kuberik/rollout-dashboard/123'
		);
	});

	it('throws not_connected on a 401', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(401, { error: 'github_not_connected' }))
		);
		await expect(fetchPull('kuberik', 'rollout-dashboard', 123)).rejects.toMatchObject({
			reason: 'not_connected'
		});
	});

	it('throws not_connected on the github_not_connected sentinel even off a non-401 status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(403, { error: 'github_not_connected' }))
		);
		await expect(fetchPull('kuberik', 'rollout-dashboard', 123)).rejects.toMatchObject({
			reason: 'not_connected'
		});
	});

	it('throws not_found scope=repo on a 404 with no scope field (older backend, or the cluster-scope check itself) — the cluster sentence', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not_found' }))
		);
		await expect(fetchPull('kuberik', 'rollout-dashboard', 123)).rejects.toMatchObject({
			reason: 'not_found',
			scope: 'repo',
			message: 'No service on this cluster deploys kuberik/rollout-dashboard'
		});
	});

	it('throws not_found scope=repo when the backend says scope=repo — the repo is not deployed here', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not_found', scope: 'repo' }))
		);
		await expect(fetchPull('kuberik', 'rollout-dashboard', 123)).rejects.toMatchObject({
			reason: 'not_found',
			scope: 'repo',
			message: 'No service on this cluster deploys kuberik/rollout-dashboard'
		});
	});

	it('throws not_found scope=pr when the backend says scope=pr — a wrong PR number, not a wrong repo', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not_found', scope: 'pr' }))
		);
		await expect(fetchPull('kuberik', 'rollout-dashboard', 999)).rejects.toMatchObject({
			reason: 'not_found',
			scope: 'pr',
			message: 'PR #999 not found in kuberik/rollout-dashboard (or you cannot see it)'
		});
	});

	it('throws a generic error on anything else', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }))
		);
		await expect(fetchPull('kuberik', 'rollout-dashboard', 123)).rejects.toMatchObject({
			reason: 'error',
			status: 500
		});
	});

	it('throws error(status 0) when fetch itself never answers', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('network down'))
		);
		await expect(fetchPull('kuberik', 'rollout-dashboard', 123)).rejects.toBeInstanceOf(
			FetchPullError
		);
	});
});

describe('pullQueryOptions', () => {
	const args = { owner: 'kuberik', repo: 'rollout-dashboard', number: 123 };

	it('is never polled and never refetched on focus or reconnect', () => {
		const o = pullQueryOptions(args);
		expect(o.refetchInterval).toBe(false);
		expect(o.refetchOnWindowFocus).toBe(false);
		expect(o.refetchOnReconnect).toBe(false);
	});

	it('is disabled with an incomplete reference', () => {
		expect(pullQueryOptions({ ...args, owner: '' }).enabled).toBe(false);
		expect(pullQueryOptions({ ...args, repo: '' }).enabled).toBe(false);
		expect(pullQueryOptions({ ...args, enabled: false }).enabled).toBe(false);
	});

	it('does not retry a typed pull-fetch failure', () => {
		const o = pullQueryOptions(args);
		expect(o.retry(0, new FetchPullError('not_connected', 'nope', 401))).toBe(false);
		expect(o.retry(0, new Error('socket hang up'))).toBe(true);
		expect(o.retry(1, new Error('socket hang up'))).toBe(false);
	});
});
