import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	ensurePrMeta,
	getPrMeta,
	notifyRevisionSeen,
	prMetaKey,
	resetPrMetaStore
} from './pr-meta.svelte';
import * as pulls from '$lib/api/pulls';

const PULL = {
	number: 42,
	title: 'Add PR pipeline view',
	htmlUrl: 'https://github.com/acme/widget/pull/42',
	author: 'octocat',
	state: 'merged' as const,
	mergedAt: '2026-09-01T00:00:00Z',
	mergeCommitSha: 'c0ffee1',
	base: 'main',
	containedIn: ['c0ffee1'],
	containedInAll: true,
	openedAt: '2026-08-30T00:00:00Z',
	headSha: 'c0ffee1def',
	changedFiles: 3
};

afterEach(() => {
	resetPrMetaStore();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('prMetaKey', () => {
	it('is owner/repo#n', () => {
		expect(prMetaKey('acme', 'widget', 42)).toBe('acme/widget#42');
	});
});

describe('ensurePrMeta', () => {
	it('creates one entry per key and fetches it exactly once', async () => {
		const spy = vi.spyOn(pulls, 'fetchPull').mockResolvedValue(PULL);
		const a = ensurePrMeta('acme', 'widget', 42);
		const b = ensurePrMeta('acme', 'widget', 42);
		expect(a).toBe(b);
		expect(spy).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(a.data).toEqual(PULL));
	});

	it('gives two different PR references two independent entries', () => {
		vi.spyOn(pulls, 'fetchPull').mockResolvedValue(PULL);
		const a = ensurePrMeta('acme', 'widget', 42);
		const b = ensurePrMeta('acme', 'widget', 43);
		expect(a).not.toBe(b);
		expect(getPrMeta('acme/widget#42')).toBe(a);
		expect(getPrMeta('acme/widget#43')).toBe(b);
	});

	it('records a fetch failure on `error`, not by throwing', async () => {
		vi.spyOn(pulls, 'fetchPull').mockRejectedValue(new Error('boom'));
		const entry = ensurePrMeta('acme', 'widget', 42);
		await vi.waitFor(() => expect(entry.loading).toBe(false));
		expect(entry.error).toBeInstanceOf(Error);
		expect(entry.data).toBeNull();
	});
});

describe('getPrMeta', () => {
	it('returns undefined for a key nobody has asked for yet', () => {
		expect(getPrMeta('nobody/asked#1')).toBeUndefined();
	});
});

describe('containedSet', () => {
	it('is mergeCommitSha plus every containedIn sha', async () => {
		vi.spyOn(pulls, 'fetchPull').mockResolvedValue(PULL);
		const entry = ensurePrMeta('acme', 'widget', 42);
		await vi.waitFor(() => expect(entry.data).not.toBeNull());
		expect(entry.containedSet).toEqual(new Set(['c0ffee1']));
	});

	it('is empty before the first fetch settles', () => {
		vi.spyOn(pulls, 'fetchPull').mockReturnValue(new Promise(() => {}));
		const entry = ensurePrMeta('acme', 'widget', 42);
		expect(entry.containedSet).toEqual(new Set());
	});
});

describe('notifyRevisionSeen', () => {
	it('is a no-op for a key with no entry', () => {
		expect(() => notifyRevisionSeen('nobody/asked#1', 'deadbeef')).not.toThrow();
	});

	it('is a no-op before the entry has data at all', async () => {
		vi.useFakeTimers();
		vi.spyOn(pulls, 'fetchPull').mockReturnValue(new Promise(() => {}));
		ensurePrMeta('acme', 'widget', 42);
		notifyRevisionSeen('acme/widget#42', 'deadbeef');
		await vi.advanceTimersByTimeAsync(10_000);
		// fetchPull was called exactly once (the initial ensure), never a
		// second time from a notify that had nothing to compare against.
		expect(pulls.fetchPull).toHaveBeenCalledTimes(1);
	});

	it('is a no-op when the revision is already in the contained set', async () => {
		vi.useFakeTimers();
		const spy = vi.spyOn(pulls, 'fetchPull').mockResolvedValue(PULL);
		const entry = ensurePrMeta('acme', 'widget', 42);
		await vi.waitFor(() => expect(entry.data).not.toBeNull());
		notifyRevisionSeen('acme/widget#42', 'c0ffee1');
		await vi.advanceTimersByTimeAsync(10_000);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('re-fetches after a 5s debounce for a genuinely new revision', async () => {
		vi.useFakeTimers();
		const spy = vi.spyOn(pulls, 'fetchPull').mockResolvedValue(PULL);
		const entry = ensurePrMeta('acme', 'widget', 42);
		await vi.waitFor(() => expect(entry.data).not.toBeNull());

		notifyRevisionSeen('acme/widget#42', 'brandnew1');
		await vi.advanceTimersByTimeAsync(4_999);
		expect(spy).toHaveBeenCalledTimes(1); // still just the initial fetch
		await vi.advanceTimersByTimeAsync(1);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('collapses a burst of notifications into ONE re-fetch', async () => {
		vi.useFakeTimers();
		const spy = vi.spyOn(pulls, 'fetchPull').mockResolvedValue(PULL);
		const entry = ensurePrMeta('acme', 'widget', 42);
		await vi.waitFor(() => expect(entry.data).not.toBeNull());

		notifyRevisionSeen('acme/widget#42', 'brandnew1');
		await vi.advanceTimersByTimeAsync(2_000);
		notifyRevisionSeen('acme/widget#42', 'brandnew2');
		await vi.advanceTimersByTimeAsync(2_000);
		notifyRevisionSeen('acme/widget#42', 'brandnew3');
		expect(spy).toHaveBeenCalledTimes(1); // the debounce keeps resetting

		await vi.advanceTimersByTimeAsync(5_000);
		expect(spy).toHaveBeenCalledTimes(2); // exactly one re-fetch, not three
	});
});
