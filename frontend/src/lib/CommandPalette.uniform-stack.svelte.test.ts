/**
 * A group of blocked rows is ONE arrangement: when any row needs the two-line form (its fact and action do not fit beside the name), every row
 * in the group takes it. jsdom has no layout, so `offsetTop` is stubbed: one row's meta line sits below its name, the others on it.
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

afterEach(() => { vi.restoreAllMocks(); });
const stubTop = (stackedName: string | null) =>
	vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
		if (!stackedName || !this.hasAttribute('data-meta-line')) return 0;
		return this.parentElement?.querySelector('a.tap-link')?.textContent === stackedName ? 30 : 0;
	});
const group = () => [...document.body.querySelectorAll<HTMLElement>('[role="presentation"]')].find((h) => h.textContent?.trim().startsWith('Needs you'))!.parentElement!;
const names = () => [...group().querySelectorAll('[data-blocked-kind] a.tap-link')].map((a) => a.textContent!);

describe('a Needs-you group uses one arrangement', { timeout: 60_000 }, () => {
	test('one row that needs two lines makes every row in the group use two', () => {
		reactivePage.url = new URL('http://localhost/');
		draw();
		const n = names();
		expect(n.length).toBeGreaterThan(1);
		cleanup();
		stubTop(n[n.length - 1]);
		draw();
		expect(group().getAttribute('data-stack-all')).toBe('true');
	});
	test('when every row fits on one line, no row is forced to two', () => {
		reactivePage.url = new URL('http://localhost/');
		stubTop(null);
		draw();
		expect(group().hasAttribute('data-stack-all')).toBe(false);
	});
	test('the row\'s meta line takes the group\'s setting', async () => {
		const src = (await import('node:fs')).readFileSync((await import('node:path')).resolve(__dirname, 'components/BlockedRow.svelte'), 'utf8');
		expect(src).toMatch(/data-meta-line[^>]*group-data-\[stack-all=true\]\/gl:basis-full/);
	});
});

describe('a typed-search group of blocked rows uses one arrangement too', { timeout: 60_000 }, () => {
	const typedGroups = () => [...document.body.querySelectorAll<HTMLElement>('.group\\/gl')].filter((g) => g.querySelector('[data-blocked-kind]') && !g.parentElement?.textContent?.trim().startsWith('Needs you'));
	test('one row that needs two lines makes every row of the typed group use two', async () => {
		reactivePage.url = new URL('http://localhost/');
		draw();
		const input = document.body.querySelector('input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'a' } });
		await new Promise((r) => setTimeout(r, 300));
		const g = typedGroups().find((x) => x.querySelectorAll('[data-blocked-kind]').length > 1);
		expect(g).toBeTruthy();
		const last = [...g!.querySelectorAll('[data-blocked-kind] a.tap-link')].pop()!.textContent!;
		cleanup();
		stubTop(last);
		draw();
		await fireEvent.input(document.body.querySelector('input') as HTMLInputElement, { target: { value: 'a' } });
		await new Promise((r) => setTimeout(r, 300));
		await tick();
		const g2 = typedGroups().find((x) => x.querySelectorAll('[data-blocked-kind]').length > 1);
		expect(g2?.getAttribute('data-stack-all')).toBe('true');
	});
});
