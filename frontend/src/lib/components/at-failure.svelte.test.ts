import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AttentionCard from './AttentionCard.svelte';
import FailureSourceRow from './FailureSourceRow.svelte';
import { attentionModel } from '$lib/view-models/attention';
import type { ObsRow } from '$lib/view-models/health-failures';

/** A recovered failure's measured figure is the reading at failure, labelled so: "72% at failure" is never mistaken for the current value. */
const obs = { name: 'catalog cache hit ratio', kind: 'Threshold', value: '72', limit: '80', direction: 'Below', unit: '%', window: '5m', healthy: false } as never;

describe('AttentionCard hero figure', () => {
	const card = (recovered: boolean) => {
		const model = attentionModel({ state: 'failed', age: '5h', tier: 'prod', title: 'x', recovered, observations: [obs] });
		return render(AttentionCard, { props: { model, href: '/x', id: { name: 'catalog-api' } } as never }).container;
	};
	it('recovered: the figure says "at failure"', () => {
		const c = card(true);
		expect(c.querySelector('.ac-fig')!.textContent).toContain('72');
		expect(c.querySelector('.ac-fig [data-at-failure]')!.textContent).toBe('at failure');
	});
	it('failing now: no such label', () => {
		expect(card(false).querySelector('[data-at-failure]')).toBeNull();
	});
});

describe('FailureSourceRow figure', () => {
	const row = (state: ObsRow['state']) => ({ key: 'k', state, cls: 'datadog', name: 'catalog cache hit ratio', figure: { value: '72%', note: 'under 80%, 5m window' }, obs } as ObsRow);
	it('recovered: "72% at failure" before the budget', () => {
		const t = render(FailureSourceRow, { props: { row: row('recovered') } }).container.querySelector('[data-testid="failure-figure"]')!.textContent!.replace(/\s+/g, ' ').trim();
		expect(t).toBe('72% at failure under 80%, 5m window');
	});
	it('failing: the reading is current, unlabelled', () => {
		const t = render(FailureSourceRow, { props: { row: row('failing') } }).container.querySelector('[data-testid="failure-figure"]')!.textContent!.replace(/\s+/g, ' ').trim();
		expect(t).toBe('72% under 80%, 5m window');
	});
});
