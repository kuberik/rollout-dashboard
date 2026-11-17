import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Home from './Home.svelte';
import EnvPage from './env/EnvPage.svelte';
import { envPage } from './env/env-page';
import { installEdge, uninstallEdge } from '$lib/testing/edge-source';

/** A failing-now card on Home and on /envs/<name> offers "Open rollout" beside Roll back: the page hands the card its openHref. */
afterEach(uninstallEdge);

const opens = (c: HTMLElement) => [...c.querySelectorAll('[data-truth-kind="attention"] [data-action="open"]')];
const rollbacks = (c: HTMLElement) => [...c.querySelectorAll('[data-truth-kind="attention"] [data-action="rollback"]')];

describe('Open rollout on the attention cards, rendered', () => {
	it('Home: a failing-now card has Roll back and an Open rollout link to its rollout', () => {
		installEdge();
		const c = render(WithQueryClient, { props: { component: Home as never, props: { state: 'incident' } } }).container;
		expect(rollbacks(c).length).toBeGreaterThan(0);
		const o = opens(c);
		expect(o.length).toBeGreaterThan(0);
		for (const a of o) {
			expect(a.textContent).toMatch(/Open rollout/);
			expect(a.getAttribute('href')).toMatch(/^\/rollouts\//);
		}
	});
	it('/envs/<name>: the same', () => {
		installEdge();
		const P = envPage('incident', 'prod')!;
		const c = render(WithQueryClient, { props: { component: EnvPage as never, props: { state: 'incident', P } } }).container;
		expect(rollbacks(c).length).toBeGreaterThan(0);
		const o = opens(c);
		expect(o.length).toBeGreaterThan(0);
		for (const a of o) {
			expect(a.textContent).toMatch(/Open rollout/);
			expect(a.getAttribute('href')).toMatch(/^\/rollouts\//);
		}
	});
});
