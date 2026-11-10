import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import FailurePanel from './FailurePanel.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

const obs = { name: 'error rate', kind: 'Threshold', value: '4.20', limit: '1', unit: '%', direction: 'Above', healthy: false };
const rollout = { metadata: { name: 'orders-api', namespace: 'orders' }, spec: {}, status: { history: [{ version: { tag: '1.0.0' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus: 'Failed' }] } };
const props = (observations: unknown[]) => ({
	rollout, healthChecks: [], failedStepTests: [], stalledKruiseRollout: null, canUpdate: false, canModify: false,
	isDashboardManagingWantedVersion: true, onRetry: () => {},
	failedHCList: [{ name: 'error-rate', message: 'error-rate: 4.2% of requests failed, over a 1% budget', observations }]
}) as never;

describe('rollout detail failure banner', () => {
	test('leads with the measured figure and keeps the check name + budget', () => {
		const { container } = render(WithQueryClient, { props: { component: FailurePanel as never, props: props([obs]) } });
		expect(container.querySelector('[data-observation-figure]')?.textContent).toContain('4.2%');
		expect(container.textContent).toContain('over a 1% budget');
		expect(container.textContent).toContain('error-rate: over a 1% budget');
	});
	test('no observations: no figure, the sentence is unchanged', () => {
		const { container } = render(WithQueryClient, { props: { component: FailurePanel as never, props: props([]) } });
		expect(container.querySelector('[data-observation-figure]')).toBeNull();
		expect(container.textContent).toContain('of requests failed');
	});
});
