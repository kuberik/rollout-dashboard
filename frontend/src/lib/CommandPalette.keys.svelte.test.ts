/**
 * The palette's keys do what they say: Tab from the search box walks to the HIGHLIGHTED row's action, a focused action runs on Enter or
 * Space (the palette's own Enter, "open the highlighted row", belongs to the search box), and the footer names Tab only where it does something.
 */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { goto } from '$app/navigation';
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', async () => ({ page: (await import('$lib/testing/reactive-page.svelte')).reactivePage }));
import { reactivePage } from '$lib/testing/reactive-page.svelte';

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(Element.prototype as any).animate = () => ({ finished: Promise.resolve(), cancel: () => {}, play: () => {}, pause: () => {}, addEventListener: () => {}, removeEventListener: () => {} });
}

import CommandPalette from './CommandPalette.svelte';
import WithQueryClient from './testing/WithQueryClient.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { buildGateContext } from '$lib/view-models/blocking-story';
import type { Rollout, Environment } from '../types';

function props() {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
	return {
		open: true, scope: null,
		rollouts: (l.rollouts?.items ?? []) as Rollout[],
		environments: (l.environments?.items ?? []) as Environment[],
		rolloutDependencies: l.rolloutDependencies?.items ?? [],
		gateContext: buildGateContext({ environments: { items: l.environments.items }, rolloutDependencies: { items: l.rolloutDependencies?.items ?? [] } }),
		localClusterName: 'hub'
	};
}
const draw = () => {
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
	return render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
};
beforeAll(() => install(true));
afterEach(() => { installLiveSource(null); cleanup(); });

const input = () => document.body.querySelector<HTMLInputElement>('input')!;
const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
const selected = () => options().find((o) => o.getAttribute('aria-selected') === 'true')!;
const linkOf = (row: HTMLElement) => row.querySelector<HTMLAnchorElement>('[data-meta="action"] a[data-action]');
const down = async (n = 1) => { for (let i = 0; i < n; i++) await fireEvent.keyDown(input(), { key: 'ArrowDown' }); await tick(); };
const footerTab = () => [...document.body.querySelectorAll('kbd')].find((k) => k.textContent === 'Tab')?.parentElement?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

/** ArrowDown until the highlighted row carries a separate action link (Roll back / Retry); returns it */
async function toRowWithAction() {
	for (let i = 0; i < options().length; i++) {
		const a = linkOf(selected());
		if (a) return a;
		await down();
	}
	throw new Error('no Needs-you row with an action link');
}

describe('palette Tab, Enter and Space', { timeout: 60_000 }, () => {
	test('Tab from the search box lands on the HIGHLIGHTED row\'s action, not on row one\'s link', async () => {
		reactivePage.url = new URL('http://localhost/');
		draw();
		const act = await toRowWithAction();
		const row = selected();
		const notPrevented = await fireEvent.keyDown(input(), { key: 'Tab' });
		expect(notPrevented).toBe(false);
		expect(document.activeElement).toBe(act);
		expect(row.contains(document.activeElement)).toBe(true);
	});
	test('Enter on a focused action is not taken by the palette: it runs the action', async () => {
		reactivePage.url = new URL('http://localhost/');
		draw();
		const act = await toRowWithAction();
		act.focus();
		vi.mocked(goto).mockClear();
		const notPrevented = await fireEvent.keyDown(act, { key: 'Enter' });
		expect(notPrevented).toBe(true);
		expect(goto).not.toHaveBeenCalled();
	});
	test('Space on a focused action clicks it', async () => {
		reactivePage.url = new URL('http://localhost/');
		draw();
		const act = await toRowWithAction();
		act.focus();
		const clicked = vi.fn((e: Event) => e.preventDefault());
		act.addEventListener('click', clicked);
		await fireEvent.keyDown(act, { key: ' ' });
		expect(clicked).toHaveBeenCalledTimes(1);
	});
	test('Enter in the search box still opens the highlighted row', async () => {
		reactivePage.url = new URL('http://localhost/');
		draw();
		await toRowWithAction();
		vi.mocked(goto).mockClear();
		await fireEvent.keyDown(input(), { key: 'Enter' });
		expect(goto).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(goto).mock.calls[0][0])).not.toContain('action=');
	});
});

describe('the footer names Tab only where it does something', { timeout: 60_000 }, () => {
	test('on a Needs-you row it says Tab action; on a Jump to tile that scopes, Tab scope; on "Your changes", nothing', async () => {
		reactivePage.url = new URL('http://localhost/');
		draw();
		expect(footerTab()).toBe('Tab action');
		const total = options().length;
		await down(total);
		// the last option is the Your changes tile (it navigates, there is nothing to scope into)
		expect(footerTab()).toBeNull();
		await fireEvent.keyDown(input(), { key: 'ArrowUp' });
		await tick();
		expect(footerTab()).toBe('Tab scope');
	});
});
