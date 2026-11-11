import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('./UnavailableCard.svelte', async () => ({ default: (await import('$lib/testing/UnavailableCardStub.svelte')).default }));

import HealthChecksCard from './HealthChecksCard.svelte';

/** QA30 M4: the health card drew the unavailable state inline and nothing failed, because the rendered text was identical. It must RENDER the shared `UnavailableCard`. */
describe('HealthChecksCard renders the shared UnavailableCard when the load failed (batch4)', () => {
	test('the failed state is the shared component, carrying the health sentence', () => {
		render(HealthChecksCard, { props: { healthChecks: [], emptyState: true, loadError: true, onRetry: () => {} } as never });
		const stub = screen.getByTestId('unavailable-card-stub');
		expect(stub).toHaveTextContent(/Health checks couldn't be loaded/);
	});
	test('a successful empty list does not render it', () => {
		render(HealthChecksCard, { props: { healthChecks: [], emptyState: true } as never });
		expect(screen.queryByTestId('unavailable-card-stub')).toBeNull();
	});
});
