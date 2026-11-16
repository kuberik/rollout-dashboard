import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import type { HealthCheck } from '../../types';
import { poolOf } from '$lib/view-models/health-failures';
import FailureDetails from './FailureDetails.svelte';

const hc = (name: string, cls: string, status: Record<string, unknown>): HealthCheck => ({ metadata: { name }, spec: { class: cls }, status } as unknown as HealthCheck);
const obs = (name: string, healthy: boolean | undefined) => ({ name, kind: 'State', value: 'Alert', healthy });

describe('the failure banner Details: each check leads with its state mark, in the card order', () => {
	test('failing before pending, each with the Health checks card mark', () => {
		const pending = hc('kust', 'kustomization', { status: 'Pending', lastChangeTime: '2026-11-15T10:06:00Z', observations: [obs('Deployment orders/worker', undefined)] });
		const dd = hc('dd', 'datadog', { status: 'Unhealthy', lastChangeTime: '2026-11-15T10:02:00Z', observations: [obs('payment errors', false)] });
		const prom = hc('prom', 'prometheus-alert', { status: 'Unhealthy', lastChangeTime: '2026-11-15T10:04:00Z', observations: [obs('HighBacklog', false)] });
		const snaps = [{ name: 'dd' }, { name: 'kust' }, { name: 'prom' }];
		const { container } = render(FailureDetails, { props: { pool: poolOf([dd, pending, prom], snaps, null) } });
		const blocks = [...container.querySelectorAll('[data-testid="failure-source"]')].map((li) => li.getAttribute('data-state'));
		expect(blocks).toEqual(['failing', 'failing', 'pending']);
		expect(container.querySelectorAll('[data-check-mark="failing"]')).toHaveLength(2);
		expect(container.querySelectorAll('svg[data-check-mark="pending"], [data-testid="status-spinner"], .animate-spin').length).toBeGreaterThanOrEqual(1);
	});

	test('a Flux check name breaks only at a slash, never at a hyphen', () => {
		const kust = hc('kust', 'kustomization', { status: 'Unhealthy', lastChangeTime: '2026-11-15T10:06:00Z', observations: [obs('orders/orders-worker', false)] });
		const { container } = render(FailureDetails, { props: { pool: poolOf([kust], [{ name: 'kust' }], null) } });
		const segs = [...container.querySelectorAll('[data-name-segment]')].map((e) => e.textContent);
		expect(segs).toEqual(['orders/', 'orders-worker']);
		expect(container.querySelector('[data-testid="failure-source"] [title="orders/orders-worker"]')?.textContent).toBe('orders/orders-worker');
		expect(container.querySelector('[data-name-segment]')?.className).toContain('whitespace-nowrap');
	});
});
