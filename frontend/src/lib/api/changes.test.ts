import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchChanges, FetchChangesError, changesQueryOptions, changesQueryKey } from './changes';

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

const RESPONSE = {
	user: 'octocat',
	repos: ['kuberik/rollout-dashboard'],
	since: '2026-08-11T00:00:00Z',
	changes: [
		{
			owner: 'kuberik',
			repo: 'rollout-dashboard',
			kind: 'pr' as const,
			number: 4,
			title: 'fix(frontend): retry on 502',
			htmlUrl: 'https://github.com/kuberik/rollout-dashboard/pull/4',
			author: 'octocat',
			mergedAt: '2026-09-10T10:26:38Z',
			mergeCommitSha: 'bf5be49',
			headSha: '5d5557e',
			base: 'master',
			containedIn: [],
			containedInAll: false
		}
	]
};

describe('fetchChanges', () => {
	it('resolves the changes list on 200', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, RESPONSE)));
		const res = await fetchChanges(30);
		expect(res).toEqual(RESPONSE);
	});

	it('requests the unfiltered days-only query string', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, RESPONSE));
		vi.stubGlobal('fetch', fetchMock);
		await fetchChanges(30);
		expect(fetchMock).toHaveBeenCalledWith('/api/github/changes?days=30');
	});

	it('builds the cluster-scoped path form', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, RESPONSE));
		vi.stubGlobal('fetch', fetchMock);
		await fetchChanges(30, 'spoke-1');
		expect(fetchMock).toHaveBeenCalledWith('/api/clusters/spoke-1/github/changes?days=30');
	});

	it('throws not_connected on a 401', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(401, { error: 'github_not_connected' }))
		);
		await expect(fetchChanges(30)).rejects.toMatchObject({ reason: 'not_connected' });
	});

	it('throws not_connected on the github_not_connected sentinel off a non-401 status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(403, { error: 'github_not_connected' }))
		);
		await expect(fetchChanges(30)).rejects.toMatchObject({ reason: 'not_connected' });
	});

	it('throws not_found on a 404 with scope=repo', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not_found', scope: 'repo' }))
		);
		await expect(fetchChanges(30)).rejects.toMatchObject({ reason: 'not_found', status: 404 });
	});

	it('throws a generic error, status carried, on a transient 502', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(502, { error: 'bad gateway' })));
		await expect(fetchChanges(30)).rejects.toMatchObject({ reason: 'error', status: 502 });
	});

	it('throws error(status 0) when fetch itself never answers', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
		await expect(fetchChanges(30)).rejects.toBeInstanceOf(FetchChangesError);
	});
});

describe('changesQueryKey', () => {
	it('is stable for the same args and distinguishes on days/cluster', () => {
		expect(changesQueryKey(30)).toEqual(['github-changes', 30, undefined]);
		expect(changesQueryKey(30, 'spoke-1')).not.toEqual(changesQueryKey(30));
	});
});

describe('changesQueryOptions', () => {
	it('polls every 5 minutes when healthy', () => {
		const o = changesQueryOptions();
		expect(o.refetchInterval({ state: { status: 'success', error: null } })).toBe(300_000);
	});

	it('does not retry a typed changes-fetch failure, but does retry an unknown one once', () => {
		const o = changesQueryOptions();
		expect(o.retry(0, new FetchChangesError('not_connected', 'nope', 401))).toBe(false);
		expect(o.retry(0, new Error('socket hang up'))).toBe(true);
		expect(o.retry(1, new Error('socket hang up'))).toBe(false);
	});

	it('backs off to the recovery interval on a retryable (5xx) error and stops on a 4xx', () => {
		const o = changesQueryOptions();
		const err5xx = new FetchChangesError('error', 'bad gateway', 502);
		const err4xx = new FetchChangesError('not_connected', 'nope', 401);
		expect(o.refetchInterval({ state: { status: 'error', error: err5xx } })).toBe(30000);
		expect(o.refetchInterval({ state: { status: 'error', error: err4xx } })).toBe(false);
	});

	it('is disabled when told to be', () => {
		expect(changesQueryOptions({ enabled: false }).enabled).toBe(false);
	});
});
