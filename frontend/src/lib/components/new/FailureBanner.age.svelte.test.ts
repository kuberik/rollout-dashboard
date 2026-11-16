import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import FailureBanner from './FailureBanner.svelte';

/** The banner's health line carries the failure's age ("2 health checks failing · 12m"), counted from `sinceAt` against the live clock; a recovered failure carries none. */
const T0 = new Date('2026-11-16T10:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => vi.useRealTimers());

const banner = (recovered: boolean) => ({
	evidence: { observations: [], check: { name: 'orders/orders' }, message: '2 health checks failing', recovered, pool: [] },
	title: 'orders-hub failing in prod',
	check: null,
	line: null,
	change: null,
	meta: { since: '99h', sinceAt: new Date(T0.getTime() - 12 * 60_000).toISOString(), build: null },
	openHref: '/x',
	rollbackHref: null
});

describe('FailureBanner health line age', () => {
	it('a failing-now banner prints the live age on the health line', async () => {
		const { container } = render(FailureBanner, { props: { b: banner(false) as never } });
		await vi.advanceTimersByTimeAsync(300);
		const t = container.textContent!.replace(/ /g, ' ');
		expect(t).toContain('2 health checks failing · 12m');
		expect(t).not.toContain('99h');
		await vi.advanceTimersByTimeAsync(3 * 60_000);
		expect(container.textContent!.replace(/ /g, ' ')).toContain('2 health checks failing · 15m');
	});
	it('a recovered banner prints no age on the line', () => {
		const { container } = render(FailureBanner, { props: { b: banner(true) as never } });
		const t = container.textContent!.replace(/ /g, ' ');
		expect(t).toContain('2 health checks failing');
		expect(t).not.toContain('2 health checks failing · ');
	});
});
