import { describe, it, expect, vi } from 'vitest';

/** Under a sub-path build (the /demo embed) the rollout page asks with a base-prefixed href (`rolloutPath` goes through `href()`); the fleet model's places are the base-less `/rollouts/...`. The ask must be the same either way. */
vi.mock('$app/paths', () => ({ base: '/demo' }));

import { approvalAskAt, rollouts } from './data';
import { rolloutPath } from '$lib/source-dashboard';

describe('approvalAskAt under a base path', () => {
	const row = () => rollouts('incident').rows.find((r) => r.app === 'payments-core' && r.tier === 'prod')!;
	it('answers for the base-prefixed page href the rollout page passes', () => {
		const place = row().href;
		const parts = place.split('/').filter(Boolean);
		const i = parts.indexOf('rollouts');
		const page = rolloutPath(parts[i + 1], parts[i + 2], parts[i + 3]);
		expect(page.startsWith('/demo/rollouts/')).toBe(true);
		expect(place.startsWith('/demo/rollouts/'), 'the fleet model builds its places through the same base helper').toBe(true);
		expect(approvalAskAt(page, 'incident')?.key).toBe(approvalAskAt(place, 'incident')?.key);
		expect(approvalAskAt(page, 'incident')).not.toBeNull();
		expect(approvalAskAt(`${page}/gates`, 'incident')).not.toBeNull();
	});
});
