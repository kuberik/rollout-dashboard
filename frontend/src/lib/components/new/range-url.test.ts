import { describe, it, expect } from 'vitest';
import { rangeUrl } from './github-read.svelte';

describe('rangeUrl (QA2 #1)', () => {
	it('a spoke rollout is asked for through its cluster', () => {
		expect(rangeUrl('hello-world-dev', 'hello-world-app', 'spoke-a')).toBe('/api/clusters/spoke-a/rollouts/hello-world-dev/hello-world-app/commits');
	});
	it('no cluster keeps the bare hub path', () => {
		expect(rangeUrl('ns', 'app')).toBe('/api/rollouts/ns/app/commits');
	});
});
