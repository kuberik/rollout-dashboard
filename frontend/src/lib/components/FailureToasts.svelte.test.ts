import { describe, expect, it, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Toast from './Toast.svelte';
import FailureToasts from './FailureToasts.svelte';
import { failureToasts, reportFailure, resetFailureToasts } from '$lib/stores/failure-toasts.svelte';

beforeEach(resetFailureToasts);

describe('FailureToasts', () => {
	it('the dock is empty while there is no failure', () => {
		const { container } = render(FailureToasts);
		expect(container.querySelector('[data-toast-dock]')!.children.length).toBe(0);
	});
	it('shows each failure with its target, docked at the bottom above the tab bar on a phone', () => {
		const { container } = render(FailureToasts);
		reportFailure('orders-hub in prod', 'Failed to roll back: denied');
		return Promise.resolve().then(() => {
			const dock = container.querySelector<HTMLElement>('[data-toast-dock]')!;
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

	it('a failure and a success toast stack in the same column, newest last, each in flow (never at the same coordinates)', async () => {
		const { container } = render(FailureToasts);
		reportFailure('orders-hub in prod', 'Failed to roll back: denied');
		await Promise.resolve();
		render(Toast, { open: true, tone: 'success', message: 'Retry started' });
		await Promise.resolve();
		const dock = container.querySelector<HTMLElement>('[data-toast-dock]')!;
		const kids = [...dock.children] as HTMLElement[];
		expect(kids.map((k) => k.textContent!.trim().slice(0, 14))).toEqual(['orders-hub in ', 'Retry started']);
		for (const k of kids) {
			expect(k.className).toContain('relative');
			expect(k.className).not.toMatch(/(^|\s)fixed(\s|$)/);
		}
	});

	describe('Esc', () => {
		const esc = () => fireEvent.keyDown(window, { key: 'Escape' });
		it('dismisses the newest failure first', async () => {
			render(FailureToasts);
			reportFailure('a in prod', 'Failed to retry: one');
			reportFailure('b in prod', 'Failed to retry: two');
			await esc();
			expect(failureToasts.items.map((t) => t.message)).toEqual(['a in prod: Failed to retry: one']);
			await esc();
			expect(failureToasts.items).toEqual([]);
		});
		it('does nothing while a dialog is open (Esc closes that first)', async () => {
			render(FailureToasts);
			reportFailure('a in prod', 'Failed to retry: one');
			const d = document.createElement('dialog');
			d.setAttribute('open', '');
			document.body.appendChild(d);
			await esc();
			expect(failureToasts.items.length).toBe(1);
			d.remove();
		});
		it('does nothing while focus is in a text field', async () => {
			render(FailureToasts);
			reportFailure('a in prod', 'Failed to retry: one');
			const i = document.createElement('input');
			document.body.appendChild(i);
			i.focus();
			await esc();
			expect(failureToasts.items.length).toBe(1);
			i.remove();
		});
	});

	it('the dismiss X is a 44px target on a phone', () => {
		const { getByRole } = render(Toast, { open: true, tone: 'danger', message: 'x' });
		expect(getByRole('button', { name: 'Dismiss' }).className).toContain('max-sm:min-h-11');
		expect(getByRole('button', { name: 'Dismiss' }).className).toContain('max-sm:min-w-11');
	});
});
