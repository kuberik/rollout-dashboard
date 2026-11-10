import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ActivityDayHeader from './ActivityDayHeader.svelte';

describe('ActivityDayHeader', () => {
	it('names the day and its count; the bar is the share of the busiest day', () => {
		const { container } = render(ActivityDayHeader, { props: { label: 'Today', count: 5, busiest: 10 } });
		expect(container.textContent).toContain('Today');
		expect(container.textContent).toContain('5 deploys');
		const bar = container.querySelector('span.block') as HTMLElement;
		expect(bar.style.width).toBe('50%');
	});
	it('an open failure is danger ink; a resolved one is neutral and says so', () => {
		const open = render(ActivityDayHeader, { props: { label: 'Today', count: 3, busiest: 3, failed: 1, open: 1 } });
		const o = open.container.querySelector('[data-failed-open]')!;
		expect(o.getAttribute('data-failed-open')).toBe('true');
		expect(o.className).toContain('text-danger');
		expect(o.textContent).not.toContain('resolved');
		const resolved = render(ActivityDayHeader, { props: { label: 'Yesterday', count: 3, busiest: 3, failed: 1, open: 0 } });
		const r = resolved.container.querySelector('[data-failed-open]')!;
		expect(r.getAttribute('data-failed-open')).toBe('false');
		expect(r.className).not.toContain('text-danger');
		expect(r.textContent).toContain('1 failed · resolved');
	});
	it('no failure, no failure clause; one deploy is singular', () => {
		const { container } = render(ActivityDayHeader, { props: { label: 'Today', count: 1, busiest: 4 } });
		expect(container.querySelector('[data-failed-open]')).toBeNull();
		expect(container.textContent).toContain('1 deploy');
		expect(container.textContent).not.toContain('deploys');
	});
});
