import { describe, it, expect } from 'vitest';
import { reviewHref, spanLabel } from './change-view';

describe('changes-10', () => {
	it('an approval is reviewed on the rollout Gates tab, whoever can approve it', () => {
		expect(reviewHref({ state: 'approval', href: '/rollouts/prod/a/a' }, null)).toBe('/rollouts/prod/a/a/gates');
		expect(reviewHref({ state: 'approval', href: '/rollouts/prod/a/a' }, { kind: 'approve', href: '/rollouts/prod/a/a/' })).toBe('/rollouts/prod/a/a/gates');
		expect(reviewHref({ state: 'failed', href: '/x' }, null)).toBeNull();
	});
	it('a batch row reads one wording in every state', () => {
		expect(spanLabel(4, 1)).toBe('4 changes · 1 held build');
		expect(spanLabel(4, 0)).toBe('4 changes · 1 build');
	});
});
