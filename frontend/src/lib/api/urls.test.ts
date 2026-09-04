import { describe, expect, it } from 'vitest';
import { apiPath } from './urls';

describe('apiPath', () => {
	it('prefixes with /api/clusters/<cluster> when a cluster is given', () => {
		expect(apiPath('dev', '/rollouts/hello-world-dev/hello-world-app')).toBe(
			'/api/clusters/dev/rollouts/hello-world-dev/hello-world-app'
		);
	});

	it('falls back to bare /api<path> when cluster is undefined', () => {
		expect(apiPath(undefined, '/rollouts/hello-world-prod/hello-world-app')).toBe(
			'/api/rollouts/hello-world-prod/hello-world-app'
		);
	});

	it('falls back to bare /api<path> when cluster is null', () => {
		expect(apiPath(null, '/rollouts/hello-world-prod/hello-world-app')).toBe(
			'/api/rollouts/hello-world-prod/hello-world-app'
		);
	});

	it('falls back to bare /api<path> when cluster is the empty string', () => {
		// The empty string is falsy, matching every prior `cluster ?
		// '?cluster=...' : ''` call site's own behavior (hub-local rollouts
		// pass `cluster: undefined`, never `''`, but a stray empty string
		// must not produce `/api/clusters//...`).
		expect(apiPath('', '/rollouts/hello-world-prod/hello-world-app')).toBe(
			'/api/rollouts/hello-world-prod/hello-world-app'
		);
	});

	it('encodes a cluster name that needs it', () => {
		expect(apiPath('my cluster/2', '/rollouts')).toBe('/api/clusters/my%20cluster%2F2/rollouts');
	});

	it('preserves a query string already on path', () => {
		expect(apiPath('dev', '/schedules?namespace=all')).toBe(
			'/api/clusters/dev/schedules?namespace=all'
		);
		expect(apiPath(undefined, '/schedules?namespace=all')).toBe('/api/schedules?namespace=all');
	});
});
