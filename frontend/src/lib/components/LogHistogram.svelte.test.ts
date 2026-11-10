import { describe, test, expect, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LogHistogram, {
	chooseHistogramWindow,
	chooseBuildWindow,
	computeHistogramBuckets,
	histogramWindowEnd,
	formatHistogramWindow,
	formatHistogramBucket,
	shortRange,
	type HistogramEntry
} from './LogHistogram.svelte';

const MIN = 60_000;

describe('chooseHistogramWindow: a fixed window ending at now, chosen from what is loaded', () => {
	test('the window is the smallest one that holds the oldest loaded line', () => {
		expect(chooseHistogramWindow(40_000, 0).windowMs).toBe(1 * MIN);
		expect(chooseHistogramWindow(2.5 * MIN, 0).windowMs).toBe(3 * MIN);
		expect(chooseHistogramWindow(12 * MIN, 0).windowMs).toBe(15 * MIN);
		expect(chooseHistogramWindow(5 * 60 * MIN, 0).windowMs).toBe(6 * 60 * MIN);
	});

	test('anything older than a day is clamped to the 24 h window', () => {
		expect(chooseHistogramWindow(3 * 24 * 60 * MIN, 0).windowMs).toBe(24 * 60 * MIN);
	});

	test('15 min is 90 bars of 10s at a 1440 plot, 180 of 5s at 1920, 60 of 15s on a phone', () => {
		expect(chooseHistogramWindow(14 * MIN, 1000, 8)).toEqual({ windowMs: 15 * MIN, bucketMs: 10_000 });
		expect(chooseHistogramWindow(14 * MIN, 1500, 8)).toEqual({ windowMs: 15 * MIN, bucketMs: 5_000 });
		expect(chooseHistogramWindow(14 * MIN, 260, 4)).toEqual({ windowMs: 15 * MIN, bucketMs: 15_000 });
	});

	test('a sparse stream gets wider bars (about 1.5 lines each), never fewer than 30', () => {
		// 60 lines over 100s at a 1440 plot: 1s-2s bars would hold one line each.
		const sparse = chooseHistogramWindow(100_000, 1000, 8, 60);
		expect(sparse.windowMs).toBe(2 * MIN);
		expect(sparse.bucketMs).toBe(3_000);
		// 10 lines over 100s: the density rule wants 15s bars, the floor keeps 30.
		const verySparse = chooseHistogramWindow(100_000, 1000, 8, 10);
		expect(2 * MIN / verySparse.bucketMs).toBeGreaterThanOrEqual(30);
		// a dense stream keeps the thin bars the width allows
		expect(chooseHistogramWindow(14 * MIN, 1000, 8, 50_000).bucketMs).toBe(10_000);
	});

	test('with no measured width it aims for about 90 bars', () => {
		const { windowMs, bucketMs } = chooseHistogramWindow(14 * MIN, 0);
		expect(windowMs / bucketMs).toBeLessThanOrEqual(90);
		expect(windowMs / bucketMs).toBeGreaterThanOrEqual(45);
	});
});

describe('computeHistogramBuckets', () => {
	const end = 1_000_000;

	test('every bucket exists, empty ones included: an empty bucket is a gap, not a missing column', () => {
		const buckets = computeHistogramBuckets([], end, MIN, 10_000);
		expect(buckets).toHaveLength(6);
		expect(buckets.every((b) => b.total === 0)).toBe(true);
		expect(buckets[5].end).toBe(end);
		expect(buckets[0].start).toBe(end - MIN);
	});

	test('a line lands in the bucket that holds its instant; levels are split', () => {
		const entries: HistogramEntry[] = [
			{ timestamp: end - 5_000, level: 'error' },
			{ timestamp: end - 6_000, level: 'warn' },
			{ timestamp: end - 7_000, level: 'info' },
			{ timestamp: end - 55_000, level: null }
		];
		const buckets = computeHistogramBuckets(entries, end, MIN, 10_000);
		expect(buckets[5]).toMatchObject({ total: 3, errors: 1, warnings: 1 });
		expect(buckets[0]).toMatchObject({ total: 1, errors: 0, warnings: 0 });
	});

	test('a line older than the window is not drawn; one stamped past now lands in the last bucket', () => {
		const buckets = computeHistogramBuckets(
			[
				{ timestamp: end - 2 * MIN, level: 'info' },
				{ timestamp: end + 3_000, level: 'error' }
			],
			end,
			MIN,
			10_000
		);
		expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(1);
		expect(buckets[5].errors).toBe(1);
	});

	test('the right edge is now rounded up to a bucket, so bars step instead of sliding', () => {
		expect(histogramWindowEnd(1_234_567, 10_000)).toBe(1_240_000);
		expect(histogramWindowEnd(1_240_000, 10_000)).toBe(1_240_000);
	});

	test('the phone range is compact enough for its 68px gutter', () => {
		expect(shortRange('12:22', '12:23')).toBe('12:22–23');
		expect(shortRange('12:23', '12:23')).toBe('12:23');
		expect(shortRange('12:58', '13:01')).toBe('12:58–13:01');
	});

	test('labels say the window and the bar width in words', () => {
		expect(formatHistogramWindow(15 * MIN)).toBe('15 min');
		expect(formatHistogramWindow(6 * 60 * MIN)).toBe('6 h');
		expect(formatHistogramBucket(10_000)).toBe('10s');
		expect(formatHistogramBucket(5 * MIN)).toBe('5m');
	});
});

describe('LogHistogram', () => {
	const now = 10 * MIN;
	const entries: HistogramEntry[] = Array.from({ length: 30 }, (_, i) => ({
		timestamp: now - (30 - i) * 2_000,
		level: i % 5 === 0 ? 'error' : 'info'
	}));

	function renderStrip(props: Partial<ComponentProps<typeof LogHistogram>> = {}) {
		const onselect = vi.fn();
		const onclear = vi.fn();
		const utils = render(LogHistogram, {
			props: { entries, oldest: entries[0].timestamp, now, selection: null, onselect, onclear, ...props }
		});
		return { ...utils, onselect, onclear };
	}

	test('it leads with the error count and when the axis starts, and "now" at the right edge', () => {
		// LOGOPEN r8, item 2.iii: the left gutter is a lead number, not the
		// window's name.
		const { container } = renderStrip();
		expect(container.querySelector('[data-histogram-lead]')!.textContent).toMatch(/\d+\s*errors?/);
		expect(screen.getByText(/^since \d/)).toBeInTheDocument();
		expect(screen.getByText('Now')).toBeInTheDocument();
	});

	test('a line stamped after the page clock (a pinned capture clock) is inside the window, in the last bar', () => {
		const ahead = now + 90_000;
		const { container } = renderStrip({
			entries: [...entries, { timestamp: ahead, level: 'error' }],
			newest: ahead
		});
		const bars = Array.from(container.querySelectorAll<HTMLElement>('[data-histogram-bar]'));
		expect(Number(bars[bars.length - 1].dataset.errors)).toBe(1);
		const total = bars.reduce((sum, b) => sum + Number(b.dataset.total), 0);
		expect(total).toBe(entries.length + 1);
		expect(screen.getByText('Now')).toBeInTheDocument();
	});

	test('a window with nothing in it is a baseline and a sentence, never a blank strip', () => {
		const { container } = renderStrip({ entries: [], levelNote: 'errors' });
		expect(container.querySelector('[data-log-histogram]')).not.toBeNull();
		expect(screen.getByText('No errors in the last 1 min')).toBeInTheDocument();
	});

	test('LOGOPEN r8: bars are one neutral fill of total volume; errors are a tick row under the axis', () => {
		const mixed: HistogramEntry[] = [
			{ timestamp: now - 5_000, level: 'info' },
			{ timestamp: now - 5_000, level: 'warn' },
			{ timestamp: now - 5_000, level: 'error' }
		];
		const { container } = renderStrip({ entries: mixed, oldest: now - 40_000 });
		const bar = Array.from(container.querySelectorAll<HTMLElement>('[data-histogram-bar]')).find(
			(b) => Number(b.dataset.errors) > 0
		)!;
		const segments = Array.from(bar.querySelectorAll<HTMLElement>('[data-segment]')).map(
			(s) => s.dataset.segment
		);
		expect(segments).toEqual(['total']);
		expect(container.querySelectorAll('[data-error-tick]').length).toBe(1);
		// The lead number states the errors on the axis.
		expect(container.querySelector('[data-histogram-lead]')!.textContent).toMatch(/1\s*error\b/);
	});

	test('LOGOPEN r8: the axis starts at the build, or at now - 15 min for a younger build', () => {
		const old = chooseBuildWindow(now - 6 * 60 * MIN, now, 1000);
		expect(old.windowMs).toBeGreaterThanOrEqual(6 * 60 * MIN);
		expect(old.windowMs).toBeLessThan(6 * 60 * MIN + old.bucketMs);
		const young = chooseBuildWindow(now - 3 * MIN, now, 1000);
		expect(young.windowMs).toBe(15 * MIN);
		expect(15 * MIN / young.bucketMs).toBeLessThanOrEqual(125);
	});

	test('a committed selection draws a band behind the bars and puts Clear in the right gutter', async () => {
		const { container, onclear } = renderStrip({
			selection: { start: now - 20_000, end: now - 10_000 }
		});
		expect(container.querySelector('[data-histogram-band]')).not.toBeNull();
		expect(screen.queryByText('Now')).not.toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /Clear time window/ }));
		expect(onclear).toHaveBeenCalledOnce();
	});

	test('keyboard: arrows move through buckets with a tooltip, Enter selects, Escape clears', async () => {
		const { onselect, onclear, rerender } = renderStrip();
		const plot = screen.getByRole('slider');
		await fireEvent.keyDown(plot, { key: 'ArrowLeft' });
		const tip = screen.getByRole('tooltip');
		expect(tip).toHaveTextContent(/line/);
		expect(tip).toHaveTextContent('Error');
		await fireEvent.keyDown(plot, { key: 'Enter' });
		expect(onselect).toHaveBeenCalledOnce();
		const range = onselect.mock.calls[0][0];
		expect(range.end - range.start).toBe(1_000);

		await rerender({ selection: range });
		await fireEvent.keyDown(plot, { key: 'Escape' });
		expect(onclear).toHaveBeenCalledOnce();
	});
});
