import { describe, test, expect, vi, afterEach } from 'vitest';
import { toastHideTimer } from './toast-timer';

afterEach(() => vi.useRealTimers());

describe('toast hide timer', () => {
	test('hides after its time', () => {
		vi.useFakeTimers();
		const hide = vi.fn();
		toastHideTimer(hide)();
		vi.advanceTimersByTime(2999);
		expect(hide).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(hide).toHaveBeenCalledTimes(1);
	});
	test('a second toast inside the window keeps its full time: the first one\'s timer does not hide it', () => {
		vi.useFakeTimers();
		const hide = vi.fn();
		const arm = toastHideTimer(hide);
		arm(); // failure at 0s
		vi.advanceTimersByTime(2000);
		arm(); // success at 2s
		vi.advanceTimersByTime(1500); // 3.5s: the first timer would have fired at 3s
		expect(hide).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1500); // 5s = 2s + 3s
		expect(hide).toHaveBeenCalledTimes(1);
	});
	test('an error toast has no timer; a success after it hides on its own', () => {
		vi.useFakeTimers();
		const hide = vi.fn();
		const arm = toastHideTimer(hide);
		arm('danger');
		vi.advanceTimersByTime(60_000);
		expect(hide).not.toHaveBeenCalled();
		arm('success');
		vi.advanceTimersByTime(3000);
		expect(hide).toHaveBeenCalledTimes(1);
	});
});
