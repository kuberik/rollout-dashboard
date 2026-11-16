import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('../change/detail-model', async (orig) => ({ ...(await orig<typeof import('../change/detail-model')>()), failedPartsOfHrefs: () => ['1 failing', '1 failed'] }));

import AppBuilds from './AppBuilds.svelte';

/** The Builds header rollup inks like every other rollup: a check failing now in danger, a recovered failure in the header's own neutral ink. */
describe('AppBuilds header rollup', () => {
	it('failing is danger, failed is neutral', () => {
		const places = [{ state: 'failed', href: '/a' }, { state: 'failed', href: '/b' }] as never;
		const { container, getByText } = render(AppBuilds, { props: { stops: [], places, view: () => ({}) as never, onDeploy: () => {} } });
		const failing = getByText('1 failing');
		expect(failing.className).toContain('text-danger');
		expect(failing.className).not.toContain('text-fg ');
		const failed = getByText('1 failed');
		expect(failed.className).not.toContain('text-danger');
		expect(failed.className).not.toContain('text-fg');
		expect(container.querySelectorAll('[data-failing-part]')).toHaveLength(1);
	});

	it('joins its facts with the shared dot list, so "1 failed" never runs into the next fact', () => {
		const places = [{ state: 'failed', href: '/a' }, { state: 'failed', href: '/b' }] as never;
		const { container } = render(AppBuilds, { props: { stops: [], places, view: () => ({}) as never, onDeploy: () => {} } });
		const row = container.querySelector('[data-builds-rollup]');
		expect(row?.classList.contains('dot-list-row')).toBe(true);
		expect(row?.parentElement?.classList.contains('dot-list')).toBe(true);
		const facts = [...(row?.children ?? [])].map((c) => c.textContent?.trim());
		expect(facts.slice(0, 2)).toEqual(['1 failing', '1 failed']);
		expect(facts).toHaveLength(3);
	});
});
