import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import LeadBar from './LeadBar.svelte';

describe('LeadBar', () => {
	test('two hops of one tier that start in the same instant (two prod regions) both draw', () => {
		const t = Date.parse('2026-11-21T14:18:11Z');
		const { container } = render(LeadBar, { props: { hops: [{ tier: 'prod', start: t, end: t + 60_000 }, { tier: 'prod', start: t, end: t + 120_000 }], scaleMs: 600_000 } });
		expect(container.querySelectorAll('rect.lb-run')).toHaveLength(2);
	});
});
