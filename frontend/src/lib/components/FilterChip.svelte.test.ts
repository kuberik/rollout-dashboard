import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import FilterChip from './FilterChip.svelte';

describe('FilterChip', () => {
	it('is a pill toggle: label, tabular count, pressed state mirrors `selected`', () => {
		const { getByRole } = render(FilterChip, { label: 'Failed', count: 6, selected: true });
		const b = getByRole('button', { name: /Failed/ });
		expect(b).toHaveClass('pill');
		expect(b).toHaveAttribute('aria-pressed', 'true');
		expect(b.querySelector('[data-filter-count]')).toHaveTextContent('6');
		expect(b.querySelector('[data-filter-count]')).toHaveClass('tabular-nums');
	});
	it('prints the state dot only when given one, and no count when none is given', () => {
		const a = render(FilterChip, { label: 'dev', dot: 'bg-danger' });
		expect(a.container.querySelector('.bg-danger')).not.toBeNull();
		expect(a.container.querySelector('[data-filter-count]')).toBeNull();
		expect(a.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
	});
	it('a removable chip is pressed by definition and shows the x; a click calls onclick', async () => {
		const onclick = vi.fn();
		const { getByRole } = render(FilterChip, { label: 'prod', removable: true, onclick });
		const b = getByRole('button');
		expect(b).toHaveAttribute('aria-pressed', 'true');
		expect(b).toHaveTextContent('×');
		await fireEvent.click(b);
		expect(onclick).toHaveBeenCalledOnce();
	});
});
