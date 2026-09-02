import { describe, it, expect } from 'vitest';
import {
	isCommitSha,
	isImmutableRange,
	commitsQueryOptions,
	FetchCommitsError
} from './github';

/**
 * The whole caching policy for commits rests on one question — "can this
 * answer change?" — so that question gets tests. A wrong `true` here is the
 * bad failure: it would serve a stale range forever.
 */
describe('isCommitSha', () => {
	it('accepts a full sha, a short sha and the OCI @sha1: spelling', () => {
		expect(isCommitSha('064b655b51595b593262fb780e2d8121e7348f84')).toBe(true);
		expect(isCommitSha('064b655')).toBe(true);
		expect(isCommitSha('ghcr.io/x/y@sha1:064b655b51595b593262fb780e2d8121e7348f84')).toBe(true);
	});

	it('rejects anything that can move', () => {
		expect(isCommitSha('main')).toBe(false);
		expect(isCommitSha('v1.2.3')).toBe(false);
		expect(isCommitSha('release/2026-09')).toBe(false);
		// 'abcdef' is hex but too short to be a sha, and 'deadbeef…' past 40 is not one either.
		expect(isCommitSha('abcdef')).toBe(false);
		expect(isCommitSha('0'.repeat(41))).toBe(false);
		expect(isCommitSha('')).toBe(false);
		expect(isCommitSha(null)).toBe(false);
		expect(isCommitSha(undefined)).toBe(false);
	});

	it('needs BOTH ends fixed for the range to be immutable', () => {
		expect(isImmutableRange('064b655', '991829b')).toBe(true);
		expect(isImmutableRange('main', '991829b')).toBe(false);
		expect(isImmutableRange('064b655', 'main')).toBe(false);
	});
});

describe('commitsQueryOptions', () => {
	const args = { namespace: 'ns', name: 'app', cluster: 'prod' };

	it('never refetches a range between two shas — it cannot have changed', () => {
		const o = commitsQueryOptions({ ...args, base: '064b655', head: '991829b' });
		expect(o.staleTime).toBe(Infinity);
		expect(o.gcTime).toBe(60 * 60_000);
	});

	it('lets a range against a branch go stale, because the branch moves', () => {
		const o = commitsQueryOptions({ ...args, base: 'main', head: '991829b' });
		expect(o.staleTime).toBe(5 * 60_000);
	});

	it('is never polled and never refetched on focus or reconnect', () => {
		// ⛔ The app-wide default is `refetchInterval: 5000`, which is right for
		// rollout state and pure waste for a commit range.
		const o = commitsQueryOptions({ ...args, base: '064b655', head: '991829b' });
		expect(o.refetchInterval).toBe(false);
		expect(o.refetchOnWindowFocus).toBe(false);
		expect(o.refetchOnReconnect).toBe(false);
	});

	it('asks for nothing when the range is empty, incomplete or the same sha twice', () => {
		expect(commitsQueryOptions({ ...args, base: '064b655', head: '064b655' }).enabled).toBe(false);
		expect(commitsQueryOptions({ ...args, base: null, head: '064b655' }).enabled).toBe(false);
		expect(commitsQueryOptions({ ...args, base: '064b655', head: null }).enabled).toBe(false);
		expect(
			commitsQueryOptions({ ...args, base: '064b655', head: '991829b', enabled: false }).enabled
		).toBe(false);
		expect(commitsQueryOptions({ ...args, base: '064b655', head: '991829b' }).enabled).toBe(true);
	});

	it('does not retry an auth failure, which cannot be retried into success', () => {
		const o = commitsQueryOptions({ ...args, base: '064b655', head: '991829b' });
		expect(o.retry(0, new FetchCommitsError('not_connected', 'nope', 401))).toBe(false);
		expect(o.retry(0, new FetchCommitsError('no_access', 'nope', 403))).toBe(false);
		expect(o.retry(0, new Error('socket hang up'))).toBe(true);
		expect(o.retry(1, new Error('socket hang up'))).toBe(false);
	});

	it('keys the range, so two ranges of one rollout are two cache entries', () => {
		const a = commitsQueryOptions({ ...args, base: '064b655', head: '991829b' });
		const b = commitsQueryOptions({ ...args, base: '991829b', head: '0afab6f' });
		expect(a.queryKey).not.toEqual(b.queryKey);
		expect(a.queryKey).toEqual(['rollout-commits', 'ns', 'app', '064b655', '991829b', 'prod']);
	});
});
