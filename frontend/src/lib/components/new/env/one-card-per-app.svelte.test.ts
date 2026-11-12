import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import EnvPage_ from './EnvPage.svelte';
import { envPage } from './env-page';
import { installEdge, uninstallEdge } from '$lib/testing/edge-source';

afterEach(uninstallEdge);
describe('the rendered page', () => {
	it('prints the failing app once and its newer build as a note on the card; no Ready tile names it', () => {
		installEdge();
		const P = envPage('incident', 'prod')!;
		const c = render(WithQueryClient, { props: { component: EnvPage_ as never, props: { state: 'incident', P } } }).container;
		const card = [...c.querySelectorAll('[data-truth-kind="attention"]')].find((e) => e.getAttribute('data-truth-app') === 'deploy-pin-fail')!;
		expect(card.querySelector('[data-note]')?.textContent).toBe('Newer build dp-3 from dev · Held by the pin');
		expect(c.querySelectorAll('#ready a[href*="deploy-pin-fail"]').length).toBe(0);
		expect([...c.querySelectorAll('a[href*="deploy-pin-fail"]')].filter((a) => a.closest('#ready, #held, #behind, #in-step')).length).toBe(0);
	});
});
