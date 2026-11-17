import { describe, expect, it, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import FailureToasts from './FailureToasts.svelte';
import { failureToasts, reportFailure, resetFailureToasts } from '$lib/stores/failure-toasts.svelte';

beforeEach(resetFailureToasts);

describe('FailureToasts', () => {
	it('draws nothing while there is no failure', () => {
		const { container } = render(FailureToasts);
		expect(container.querySelector('[data-failure-toasts]')).toBeNull();
	});
	it('shows each failure with its target, docked at the bottom above the tab bar on a phone', () => {
		const { container } = render(FailureToasts);
		reportFailure('orders-hub in prod', 'Failed to roll back: denied');
		return Promise.resolve().then(() => {
			const dock = container.querySelector<HTMLElement>('[data-failure-toasts]')!;
			expect(dock.textContent).toContain('orders-hub in prod: Failed to roll back: denied');
			expect(dock.className).toContain('bottom-[calc(var(--tabbar-h,0px)+8px)]');
			expect(dock.className).not.toMatch(/(^|\s)top-/);
		});
	});
	it('a failure outlives the page that reported it: a new page changes nothing, only the X removes it', async () => {
		const first = render(FailureToasts);
		reportFailure('orders-hub in prod', 'Failed to roll back: denied');
		await Promise.resolve();
		first.unmount();
		// the layout stays mounted across navigation; a fresh mount stands for "the next page" reading the same store
		const next = render(FailureToasts);
		expect(next.container.textContent).toContain('orders-hub in prod: Failed to roll back: denied');
		await fireEvent.click(next.getByRole('button', { name: 'Dismiss' }));
		expect(failureToasts.items).toEqual([]);
	});
});
