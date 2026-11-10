import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { RocketOutline } from 'flowbite-svelte-icons';
import KpiTile from './KpiTile.svelte';

describe('KpiTile', () => {
	it('leads with one t-stat figure, its unit small, and the caption', () => {
		const { container } = render(KpiTile, { icon: RocketOutline, label: 'Deploys', value: 170, sub: '24 a day · last 7 days' });
		expect(container.querySelectorAll('.t-stat')).toHaveLength(1);
		expect(container.querySelector('.t-stat')?.textContent?.trim()).toBe('170');
		expect(container.textContent).toContain('24 a day · last 7 days');
		expect(container.querySelector('a')).toBeNull();
	});
	it('draws a duration as parts with small units and inks an adverse delta', () => {
		const { container } = render(KpiTile, {
			label: 'Lead time to prod',
			parts: [{ v: '3', u: 'h' }, { v: '18', u: 'm' }],
			delta: { text: '+12%', tone: 'adverse', dir: 'up' }
		});
		expect(container.querySelectorAll('.kpi-unit')).toHaveLength(2);
		expect(container.querySelector('.text-danger')?.textContent).toContain('+12%');
	});
	it('is a door when given an href', () => {
		const { container } = render(KpiTile, { label: 'Failed', value: 1, href: '/activity?outcome=failed' });
		expect(container.querySelector('a.tile-link')?.getAttribute('href')).toBe('/activity?outcome=failed');
	});
});

describe('KpiTile resolved', () => {
	it('drops the alarm ink and says resolved instead of a delta', () => {
		const { container } = render(KpiTile, {
			label: 'Failed',
			value: 1,
			valueClass: 'text-danger',
			resolved: true,
			delta: { text: '+1', tone: 'adverse' }
		});
		expect(container.querySelector('.text-danger')).toBeNull();
		expect(container.textContent).toContain('resolved');
		expect(container.textContent).not.toContain('+1');
	});
});
