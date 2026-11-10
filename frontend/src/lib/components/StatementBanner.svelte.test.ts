import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import StatementBanner from './StatementBanner.svelte';

const threshold = { name: 'error rate', kind: 'Threshold', value: '4.20', limit: '1', unit: '%', direction: 'Above', healthy: false } as never;
const check = { name: 'error-rate', message: 'error-rate: 4.2% of requests failed, over a 1% budget' };

describe('StatementBanner failure figure', () => {
	test('a drawable observation leads as a figure and the check line keeps the budget', () => {
		const { container } = render(StatementBanner, { severity: 'failed', title: 'Deployment failed', check, observations: [threshold] });
		const fig = container.querySelector('[data-observation-figure]');
		expect(fig).toBeInTheDocument();
		expect(fig!.textContent).toContain('4.2%');
		expect(fig!.textContent).toContain('error rate');
		expect(container.textContent).toContain('over a 1% budget');
		expect(container.textContent).not.toContain('of requests failed');
	});
	test('no observations: no figure, the check line is unchanged', () => {
		const { container } = render(StatementBanner, { severity: 'failed', title: 'Deployment failed', check });
		expect(container.querySelector('[data-observation-figure]')).toBeNull();
		expect(container.textContent).toContain('of requests failed');
	});
	test('a healthy or State observation is never the figure', () => {
		const { container } = render(StatementBanner, { severity: 'failed', title: 'Deployment failed', check, observations: [{ ...(threshold as object), healthy: true } as never, { name: 's', kind: 'State', state: 'Firing' } as never] });
		expect(container.querySelector('[data-observation-figure]')).toBeNull();
	});
});
