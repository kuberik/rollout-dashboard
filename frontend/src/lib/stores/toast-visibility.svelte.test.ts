import { describe, test, expect, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { ScrollDirectionTracker } from '$lib/scroll-direction.svelte';
import Toast from '$lib/components/Toast.svelte';
import { toastVisibility, showToast, hideToast, resetToastVisibility } from './toast-visibility.svelte';

afterEach(() => resetToastVisibility());

describe('toastVisibility counter', () => {
	test('starts at zero', () => {
		expect(toastVisibility.count).toBe(0);
	});

	test('show/hide pair back to zero', () => {
		showToast();
		expect(toastVisibility.count).toBe(1);
		hideToast();
		expect(toastVisibility.count).toBe(0);
	});

	test('two overlapping toasts: the count only reaches zero once both are gone', () => {
		showToast();
		showToast();
		expect(toastVisibility.count).toBe(2);
		hideToast();
		expect(toastVisibility.count).toBe(1);
		hideToast();
		expect(toastVisibility.count).toBe(0);
	});

	test('never goes negative, however many extra hide() calls arrive', () => {
		hideToast();
		hideToast();
		expect(toastVisibility.count).toBe(0);
		showToast();
		hideToast();
		hideToast();
		expect(toastVisibility.count).toBe(0);
	});
});

// Exercises the real header logic a reader would hit: the root layout's
// `data-hidden` is `headerScroll.hidden && toastVisibility.count === 0`
// (`src/routes/+layout.svelte`). These tests drive that same expression
// against a real `Toast` mount so the mount/unmount wiring in
// `Toast.svelte`'s `$effect` is covered, not just the counter in isolation.
describe('header auto-hide suspended while a toast is showing (qa9 B2)', () => {
	const hiddenFor = (headerScroll: ScrollDirectionTracker) => headerScroll.hidden && toastVisibility.count === 0;

	test('header stays revealed through a scroll that would hide it while a toast is mounted', () => {
		const headerScroll = new ScrollDirectionTracker(24);
		const toast = render(Toast, { open: true, message: 'Pin cleared' });
		expect(toastVisibility.count).toBe(1);

		headerScroll.update(10);
		headerScroll.update(600); // downward past the threshold: would normally hide
		expect(headerScroll.hidden).toBe(true);
		expect(hiddenFor(headerScroll)).toBe(false); // but the toast keeps it revealed

		toast.unmount();
	});

	test('header resumes auto-hide once the toast is gone', () => {
		const headerScroll = new ScrollDirectionTracker(24);
		const toast = render(Toast, { open: true, message: 'Pin cleared' });
		headerScroll.update(10);
		headerScroll.update(600);
		expect(hiddenFor(headerScroll)).toBe(false);

		toast.unmount();
		expect(toastVisibility.count).toBe(0);

		// a fresh downward scroll now hides it, same as with no toast ever shown
		headerScroll.update(10);
		headerScroll.update(600);
		expect(hiddenFor(headerScroll)).toBe(true);
	});

	test('two toasts: the header only resumes auto-hide once both are gone', () => {
		const headerScroll = new ScrollDirectionTracker(24);
		const first = render(Toast, { open: true, message: 'Pin cleared' });
		const second = render(Toast, { open: true, message: 'Deploy started' });
		expect(toastVisibility.count).toBe(2);

		headerScroll.update(10);
		headerScroll.update(600);
		expect(hiddenFor(headerScroll)).toBe(false);

		first.unmount();
		expect(toastVisibility.count).toBe(1);
		expect(hiddenFor(headerScroll)).toBe(false); // second toast still showing

		second.unmount();
		expect(toastVisibility.count).toBe(0);
		expect(hiddenFor(headerScroll)).toBe(true);
	});
});
