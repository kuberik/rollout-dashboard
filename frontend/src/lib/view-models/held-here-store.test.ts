import { it, expect } from 'vitest';
import { publishHeldHere, heldHereOf, heldKey, heldKeyOfHref } from './held-here.svelte';

/* a page re-derives from this store, so re-publishing an unchanged answer must not write (it crashed /envs/prod in an effect loop) */
it('an unchanged answer is not rewritten', () => {
	publishHeldHere('a/b', { count: 2, ids: new Set(['x', 'y']), waiting: 0, stage: null });
	const first = heldHereOf('a/b');
	publishHeldHere('a/b', { count: 2, ids: new Set(['y', 'x']), waiting: 0, stage: null });
	expect(heldHereOf('a/b')).toBe(first);
	publishHeldHere('a/b', { count: 3, ids: new Set(['x', 'y', 'z']), waiting: 1, stage: 'staging' });
	expect(heldHereOf('a/b')?.count).toBe(3);
});

it('round 3: keys carry the cluster, so two clusters\' same-named rollouts never share an answer', () => {
	expect(heldKeyOfHref('/rollouts/prod/hello-world-prod/hello-world-app')).toBe(heldKey('prod', 'hello-world-prod', 'hello-world-app'));
	expect(heldKeyOfHref('/rollouts/dev/hello-world-prod/hello-world-app')).not.toBe(heldKeyOfHref('/rollouts/prod/hello-world-prod/hello-world-app'));
	expect(heldHereOf(heldKey('nowhere', 'x', 'y'))).toBeNull();
});
