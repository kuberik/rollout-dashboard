import { describe, it, expect } from 'vitest';
import { parsePrRef, prPath } from './pr-ref';

describe('parsePrRef', () => {
	it('parses a full GitHub PR URL', () => {
		expect(parsePrRef('https://github.com/kuberik/rollout-dashboard/pull/123')).toEqual({
			kind: 'full',
			owner: 'kuberik',
			repo: 'rollout-dashboard',
			number: 123
		});
	});

	it('parses a URL with no scheme', () => {
		expect(parsePrRef('github.com/kuberik/rollout-dashboard/pull/123')).toEqual({
			kind: 'full',
			owner: 'kuberik',
			repo: 'rollout-dashboard',
			number: 123
		});
	});

	it('parses a URL with a www prefix', () => {
		expect(parsePrRef('https://www.github.com/kuberik/rollout-dashboard/pull/123')).toEqual({
			kind: 'full',
			owner: 'kuberik',
			repo: 'rollout-dashboard',
			number: 123
		});
	});

	it('parses a URL with a trailing path, e.g. /files', () => {
		expect(parsePrRef('https://github.com/kuberik/rollout-dashboard/pull/123/files')).toEqual({
			kind: 'full',
			owner: 'kuberik',
			repo: 'rollout-dashboard',
			number: 123
		});
	});

	it('parses a URL with a query string tail', () => {
		expect(parsePrRef('https://github.com/kuberik/rollout-dashboard/pull/123?diff=split')).toEqual(
			{ kind: 'full', owner: 'kuberik', repo: 'rollout-dashboard', number: 123 }
		);
	});

	it('parses a URL with a fragment tail', () => {
		expect(
			parsePrRef('https://github.com/kuberik/rollout-dashboard/pull/123#issuecomment-1')
		).toEqual({ kind: 'full', owner: 'kuberik', repo: 'rollout-dashboard', number: 123 });
	});

	it('preserves a repo name that contains a dot (foo.js is not truncated to foo)', () => {
		expect(parsePrRef('https://github.com/kuberik/foo.js/pull/9')).toEqual({
			kind: 'full',
			owner: 'kuberik',
			repo: 'foo.js',
			number: 9
		});
	});

	it('parses owner/repo#123', () => {
		expect(parsePrRef('kuberik/rollout-dashboard#123')).toEqual({
			kind: 'full',
			owner: 'kuberik',
			repo: 'rollout-dashboard',
			number: 123
		});
	});

	it('parses a bare #123', () => {
		expect(parsePrRef('#123')).toEqual({ kind: 'bare', number: 123 });
	});

	it('trims surrounding whitespace', () => {
		expect(parsePrRef('  #123  ')).toEqual({ kind: 'bare', number: 123 });
	});

	it('returns null for an empty string', () => {
		expect(parsePrRef('')).toBeNull();
		expect(parsePrRef('   ')).toBeNull();
	});

	it('returns null for a string naming nothing', () => {
		expect(parsePrRef('hello world')).toBeNull();
		expect(parsePrRef('hello-world-app')).toBeNull();
	});

	it('returns null for a non-GitHub host', () => {
		expect(parsePrRef('https://gitlab.com/kuberik/rollout-dashboard/pull/123')).toBeNull();
	});

	it('returns null for a PR number of zero or non-numeric', () => {
		expect(parsePrRef('#abc')).toBeNull();
	});
});

describe('prPath', () => {
	it('builds the /pr/{owner}/{repo}/{number} route', () => {
		expect(prPath('kuberik', 'rollout-dashboard', 123)).toBe('/pr/kuberik/rollout-dashboard/123');
	});

	it('encodes owner/repo segments', () => {
		expect(prPath('ku berik', 'foo/bar', 1)).toBe('/pr/ku%20berik/foo%2Fbar/1');
	});
});
