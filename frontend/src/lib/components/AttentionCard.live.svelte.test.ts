import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import AttentionCard from './AttentionCard.svelte';
import { attentionModel } from '$lib/view-models/attention';

/** A failure's age counts against the live clock (the banners' rule): one failure, one age, and it ticks. */
const T0 = new Date('2026-11-16T10:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => vi.useRealTimers());

describe('AttentionCard age', () => {
	it('prints the age from ageAt against the live clock, not the model\'s frozen string', async () => {
		const model = attentionModel({ state: 'failed', age: '99h', ageAt: new Date(T0.getTime() - 4 * 60_000).toISOString(), tier: 'prod', title: 'x' });
		const { container } = render(AttentionCard, { props: { model, href: '/x', id: { name: 'orders-hub' } } as never });
		await vi.advanceTimersByTimeAsync(300);
		expect(container.textContent).toContain('for 4m');
		expect(container.textContent).not.toContain('99h');
		await vi.advanceTimersByTimeAsync(3 * 60_000);
		expect(container.textContent).toContain('for 7m');
	});
	it('with no ageAt it prints the model\'s own age', () => {
		const model = attentionModel({ state: 'failed', age: '5h', tier: 'prod', title: 'x' });
		const { container } = render(AttentionCard, { props: { model, href: '/x', id: { name: 'orders-hub' } } as never });
		expect(container.textContent).toContain('for 5h');
	});
});

describe('AttentionCard mark', () => {
	const mark = (recovered: boolean) => {
		const model = attentionModel({ state: 'failed', age: '5h', tier: 'prod', title: 'x', recovered });
		return render(AttentionCard, { props: { model, href: '/x', id: { name: 'orders-hub' } } as never }).container.querySelector('span.rounded-full')!.className;
	};
	it('a recovered failure is the ring, a failing one the solid disc', () => {
		expect(mark(true)).toContain('ring-[1.5px]');
		expect(mark(true)).not.toContain('bg-danger-solid');
		expect(mark(false)).toContain('bg-danger-solid');
	});
});
