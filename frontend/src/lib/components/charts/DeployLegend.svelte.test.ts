import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import DeployLegend from './DeployLegend.svelte';
import { bucketize } from '$lib/view-models/deploy-bars';

const H = 3_600_000;

describe('DeployLegend', () => {
	it('shows only what the chart draws', () => {
		const buckets = bucketize([H], 0, 24 * H, 24);
		const { container } = render(DeployLegend, { buckets });
		expect(container.textContent).toContain('deploys');
		expect(container.textContent).not.toContain('reached prod');
		expect(container.textContent).not.toContain('before');
	});
	it('adds reached prod when a bucket is emphasised, and the previous window when given', () => {
		const buckets = bucketize([H], 0, 24 * H, 24).map((b, i) => (i === 1 ? { ...b, emphasis: true } : b));
		const previous = bucketize([2 * H], 0, 24 * H, 24);
		const { container } = render(DeployLegend, { buckets, previous, previousLabel: 'the 7 days before' });
		expect(container.textContent).toContain('reached prod');
		expect(container.textContent).toContain('the 7 days before');
	});
});

describe('DeployLegend placement', () => {
	it('below: a phone-only one-line key, previous window included', () => {
		const buckets = bucketize([H], 0, 24 * H, 24);
		const previous = bucketize([2 * H], 0, 24 * H, 24);
		const { container } = render(DeployLegend, { buckets, previous, previousLabel: 'the day before', placement: 'below' });
		const el = container.querySelector('.dl')!;
		expect(el.className).toContain('sm:hidden');
		expect(el.className).not.toContain('sm:inline-flex');
		expect(el.textContent).toContain('the day before');
	});
});
