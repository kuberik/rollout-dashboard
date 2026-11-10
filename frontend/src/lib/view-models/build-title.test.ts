import { describe, it, expect } from 'vitest';
import { buildTitle, headCommitTitle, consecutiveTagPairs, rootPairIndices } from './build-title';

describe('buildTitle', () => {
	it('reads a range commit`s `message`', () => {
		expect(buildTitle({ message: 'Add dead-letter queue for failed checkout events' })).toBe(
			'Add dead-letter queue for failed checkout events'
		);
	});

	it('reads a bare-commit lookup`s `subject`', () => {
		expect(buildTitle({ subject: 'Bump connection pool size' })).toBe('Bump connection pool size');
	});

	it('is null for null/undefined/empty', () => {
		expect(buildTitle(null)).toBeNull();
		expect(buildTitle(undefined)).toBeNull();
		expect(buildTitle({ message: '' })).toBeNull();
	});

	it('takes only the first line', () => {
		expect(buildTitle({ message: 'Title line\n\nBody paragraph.' })).toBe('Title line');
	});
});

describe('headCommitTitle', () => {
	it('is the LAST commit in an oldest-to-newest list', () => {
		expect(
			headCommitTitle([{ message: 'Update dependency lockfile' }, { message: 'Add rate limiting per API key' }])
		).toBe('Add rate limiting per API key');
	});

	it('is null for an empty or missing list', () => {
		expect(headCommitTitle([])).toBeNull();
		expect(headCommitTitle(null)).toBeNull();
		expect(headCommitTitle(undefined)).toBeNull();
	});

	// AD round 6, item 1: "one sha, two titles." A history ROW must never
	// feed this function a base/head compare range, because a rollback row's
	// own `head` (its own sha) is chronologically BEHIND its `base` (the
	// entry it replaced) — the range between them lists the commits being
	// REVERTED, oldest first, ending in `base`'s own commit. Reading this
	// function's "last item" for that range names the WRONG build.
	it('documents why a history row must not use this: a rollback range\'s last item is the PREVIOUS build, not the row\'s own', () => {
		// checkout-edge, measured live: 55f1a2c (a rollback) is redeployed
		// after 62d1c05 (the build it replaces). base=62d1c05, head=55f1a2c —
		// the revert range between them, oldest to newest, ends in 62d1c05's
		// own commit.
		const revertRangeForRollbackRow = [
			{ message: 'Fix pagination bug in order history' },
			{ message: 'Add retry budget to payment webhook' } // 62d1c05's own title
		];
		expect(headCommitTitle(revertRangeForRollbackRow)).toBe('Add retry budget to payment webhook');
		// The row is 55f1a2c, not 62d1c05 — its own single-sha lookup is the
		// only correct source, which is why the history page now asks
		// `commitQueryOptions` (a bare-commit lookup, `buildTitle`'s other
		// branch) for every row instead of this function.
		expect(buildTitle({ subject: 'Bump dependency lockfile' })).toBe('Bump dependency lockfile');
	});
});

describe('consecutiveTagPairs', () => {
	it('pairs each ladder step with its predecessor', () => {
		expect(consecutiveTagPairs(['a', 'b', 'c'])).toEqual([
			{ base: 'a', head: 'b' },
			{ base: 'b', head: 'c' }
		]);
	});

	it('is empty for 0 or 1 tags', () => {
		expect(consecutiveTagPairs([])).toEqual([]);
		expect(consecutiveTagPairs(['a'])).toEqual([]);
	});

	it('skips a pair whose base and head are the same tag', () => {
		expect(consecutiveTagPairs(['a', 'a', 'b'])).toEqual([{ base: 'a', head: 'b' }]);
	});
});

describe('rootPairIndices', () => {
	it('names the one-deploy row — a single history entry has no base at all', () => {
		// hello-world-prod's own gated fixture: one `history` entry, index 0,
		// nothing older for a two-sha compare to diff against.
		expect(rootPairIndices([{ i: 0, base: undefined, head: 'a1b2c3d' }])).toEqual([0]);
	});

	it('names only the OLDEST row in a multi-entry history, not every row', () => {
		expect(
			rootPairIndices([
				{ i: 0, base: 'b', head: 'c' },
				{ i: 1, base: 'a', head: 'b' },
				{ i: 2, base: undefined, head: 'a' }
			])
		).toEqual([2]);
	});

	it('excludes a row with neither base nor head (no revision recorded)', () => {
		expect(rootPairIndices([{ i: 0, base: undefined, head: undefined }])).toEqual([]);
	});

	it('excludes every row that already has a base to compare against', () => {
		expect(
			rootPairIndices([
				{ i: 0, base: 'a', head: 'b' },
				{ i: 1, base: 'x', head: 'a' }
			])
		).toEqual([]);
	});
});
