import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { QueryClient, createQueries } from '@tanstack/svelte-query';

/**
 * Regression: ChangeVersionModal's per-pair title queries. svelte-query 6.0.12
 * `createRawRef` deletes array keys one by one, each delete doing `length--`,
 * so an ARRAY result that shrinks by 2+ throws "'deleteProperty' on proxy:
 * trap returned falsish" (clicking an env in the lane switched to a rollout
 * with a shorter ladder). The modal wraps results via `combine` into an object.
 */
function run(wrap: boolean) {
	const client = new QueryClient();
	let n = $state(6);
	let result: any;
	const cleanup = $effect.root(() => {
		result = createQueries(() => ({
			queries: Array.from({ length: n }, (_, i) => ({
				queryKey: ['t', i],
				queryFn: async () => i,
				enabled: false
			})),
			...(wrap ? { combine: (rs: any[]) => ({ items: rs.map((r) => ({ data: r.data })) }) } : {})
		}), () => client);
	});
	flushSync();
	n = 3;
	flushSync();
	const out = wrap ? result.items.length : result.length;
	cleanup();
	return out;
}

describe('createQueries array shrink', () => {
	it('survives a shrink by 3 when results are wrapped in an object', () => {
		expect(run(true)).toBe(3);
	});
});
