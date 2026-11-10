import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import ErrorState from './ErrorState.svelte';
import { ApiError } from '$lib/api/errors';

/**
 * ⭐ ITEM 3 (AD palette round 8, squad-rollout coordinator, 2026-10-11):
 * "Where to look" used to differ by rollout tab — Overview had Search / Back
 * to all rollouts / Home; History and Logs dropped Home (their call sites
 * passed no `backHref`, so `ErrorState`'s own default, `'/'`, made its
 * `backHref !== href('/')` guard hide the Home row); Gates said "Back to
 * this rollout" and pointed the reader AT the very page that is also down.
 *
 * Every rollout tab now passes the SAME `backHref`/`backLabel`
 * (`href('/rollouts')` / "Back to all rollouts"), and this pins the ONE rail
 * that results: Search, Back to all rollouts, Home — on a rollout page,
 * regardless of which tab's `subject`/`onRetry` differ.
 */
const state = vi.hoisted(() => ({
	page: {
		params: { cluster: 'dev', namespace: 'checkout-api-dev', name: 'checkout-api' } as Record<
			string,
			string
		>,
		url: new URL('http://localhost/rollouts/dev/checkout-api-dev/checkout-api/gates'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);

describe('ErrorState rail on a rollout tab: one link set, on every tab', () => {
	test('Search, Back to all rollouts, Home — never "Back to this rollout"', () => {
		render(ErrorState, {
			props: {
				error: new ApiError(503, 'Request failed (503)', '', '/api/rollouts/dev/checkout-api-dev/checkout-api'),
				subject: 'the gates of this rollout',
				backHref: '/rollouts',
				backLabel: 'Back to all rollouts'
			}
		});

		expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
		const back = screen.getByRole('link', { name: /back to all rollouts/i });
		expect(back).toBeInTheDocument();
		expect(back).toHaveAttribute('href', '/rollouts');
		expect(screen.getByRole('link', { name: /^home$/i })).toBeInTheDocument();

		expect(screen.queryByText(/back to this rollout/i)).toBeNull();
	});
});
