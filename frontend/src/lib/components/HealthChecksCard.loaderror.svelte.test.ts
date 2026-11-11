import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import HealthChecksCard from './HealthChecksCard.svelte';

describe('HealthChecksCard when the load failed (batch4)', () => {
	test('never says no checks select this rollout; says it could not load, with a retry', async () => {
		const onRetry = vi.fn();
		render(HealthChecksCard, { props: { healthChecks: [], emptyState: true, loadError: true, onRetry } as never });
		expect(screen.queryByText(/No health checks select this rollout/)).toBeNull();
		expect(screen.getByText(/Health checks couldn't be loaded/)).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});
	test('a successful empty list still says none select it', () => {
		render(HealthChecksCard, { props: { healthChecks: [], emptyState: true } as never });
		expect(screen.getByText(/No health checks select this rollout/)).toBeInTheDocument();
	});
	test('while retrying, the error card stays with a disabled Checking… button', () => {
		render(HealthChecksCard, { props: { healthChecks: [], emptyState: true, loadError: true, onRetry: () => {}, isRetrying: true } as never });
		expect(screen.getByText(/Health checks couldn't be loaded/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Checking…/ })).toBeDisabled();
	});
});
