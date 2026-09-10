import { describe, expect, it } from 'vitest';
import { gitRef, revisionSha } from './git-ref';

describe('gitRef', () => {
	it('prefers the revision sha over the version tag', () => {
		expect(gitRef('9f10e494d560c1db', '2.67.0-67')).toBe('9f10e494d560c1db');
	});
	it('takes the sha out of the flux <tag>@sha1:<sha> form', () => {
		expect(gitRef('2.67.0-67@sha1:9f10e494d560', '2.67.0-67')).toBe('9f10e494d560');
	});
	it('falls back to the version when there is no usable revision', () => {
		expect(gitRef(undefined, '2.67.0-67')).toBe('2.67.0-67');
		expect(gitRef(null, 'v1.2.3')).toBe('v1.2.3');
		expect(gitRef('not a sha', 'v1.2.3')).toBe('v1.2.3');
	});
	it('revisionSha is empty for anything that is not a sha', () => {
		expect(revisionSha('')).toBe('');
		expect(revisionSha('main')).toBe('');
	});
});
