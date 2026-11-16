import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('AttentionCard word and age', () => {
	const card = async (recovered: boolean) => {
		const model = attentionModel({ state: 'failed', age: '5h', ageAt: new Date(T0.getTime() - 10 * 60_000).toISOString(), tier: 'prod', title: 'x', recovered });
		const { container } = render(AttentionCard, { props: { model, href: '/x', id: { name: 'orders-hub' } } as never });
		await vi.advanceTimersByTimeAsync(300);
		return { word: container.querySelector('[data-word]')!, text: container.textContent ?? '' };
	};
	it('a recovered failure reads "Failed" in neutral ink, 10m ago', async () => {
		const { word, text } = await card(true);
		expect(word.textContent).toBe('Failed');
		expect(word.className).toContain('text-fg-muted');
		expect(word.className).not.toContain('text-danger');
		expect(text).toContain('10m ago');
		expect(text).not.toContain('for 10m');
	});
	it('a failure live now reads "Failing" in danger ink, for 10m', async () => {
		const { word, text } = await card(false);
		expect(word.textContent).toBe('Failing');
		expect(word.className).toContain('text-danger');
		expect(text).toContain('for 10m');
	});
});

describe('AttentionCard actions (one set per state, the same on every list surface)', () => {
	const props = (state: 'failed' | 'approval', recovered: boolean) => ({
		model: attentionModel({ state, age: '5h', tier: 'prod', title: 'x', recovered }),
		href: '/rollouts/hub/ns/x', id: { name: 'x' }, compact: true,
		rollbackHref: '/rollouts/hub/ns/x?action=rollback', retryHref: '/rollouts/hub/ns/x', openHref: '/rollouts/hub/ns/x'
	});
	const rows = (state: 'failed' | 'approval', recovered: boolean) => {
		const { container } = render(AttentionCard, { props: props(state, recovered) as never });
		return [...container.querySelectorAll<HTMLElement>('[data-actions] a.btn')].map((a) => ({ key: a.getAttribute('data-action'), primary: a.classList.contains('btn-primary'), cls: a.className }));
	};
	it('failing now: Roll back is the blue primary, Open rollout the secondary; no Retry', () => {
		const r = rows('failed', false);
		expect(r.map((x) => x.key)).toEqual(['rollback', 'open']);
		expect(r.map((x) => x.primary)).toEqual([true, false]);
	});
	it('recovered: Roll back then Retry, both secondary (no blue on the quietest card)', () => {
		const r = rows('failed', true);
		expect(r.map((x) => x.key)).toEqual(['rollback', 'retry']);
		expect(r.some((x) => x.primary)).toBe(false);
	});
	it('the buttons hug their label: no stretch rule in the card, only the phone one', () => {
		const s = readFileSync(resolve(__dirname, 'AttentionCard.svelte'), 'utf8');
		const container = s.slice(s.indexOf('@container'), s.indexOf('.ac-fig {'));
		expect(container).not.toMatch(/flex:\s*1/);
	});
	it('the figure card\'s foot ends at the same bottom padding as the title card, so adjacent cards\' action rows line up', () => {
		const s = readFileSync(resolve(__dirname, 'AttentionCard.svelte'), 'utf8');
		expect(s).toMatch(/border-t border-line px-4 py-3 sm:px-5 sm:py-5/);
		expect(s).toMatch(/gap-3\.5 p-4 sm:p-5/);
		expect(s).toMatch(/ac-act relative z-\[1\] mt-auto/);
	});
});
