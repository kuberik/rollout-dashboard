/**
 * The palette over the health-failures fleet, on navigation:
 *   - it closes when the location changes (a row's name is a plain link: a tap or a click follows it, no handler of the palette runs),
 *     and stays open while the location holds still;
 *   - once the open rollout is one of the Needs-you rows, the list keeps the Attention order (failing now first), it does not pin
 *     the open rollout above a failure live now.
 */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', async () => ({ page: (await import('$lib/testing/reactive-page.svelte')).reactivePage }));
import { reactivePage } from '$lib/testing/reactive-page.svelte';

// jsdom has no `<dialog>` showModal/close and no Web Animations API. Polyfilled
// so that IF a choice wrongly opened ChangeVersionModal it would render, and the
// "opens no dialog" assertions below would catch it instead of crashing. Same
// file-scoped polyfill `change-version-param.svelte.test.ts` uses.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.removeAttribute('open');
	};
}
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(Element.prototype as any).animate = () => ({
		finished: Promise.resolve(),
		cancel: () => {},
		play: () => {},
		pause: () => {},
		addEventListener: () => {},
		removeEventListener: () => {}
	});
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
		open: true,
		scope: null,
		rollouts: (l.rollouts?.items ?? []) as Rollout[],
		environments: (l.environments?.items ?? []) as Environment[],
		rolloutDependencies: l.rolloutDependencies?.items ?? [],
		gateContext: buildGateContext({ environments: { items: l.environments.items }, rolloutDependencies: { items: l.rolloutDependencies?.items ?? [] } }),
		localClusterName: 'hub'
	};
}

function needsYouRows(): HTMLElement[] {
	const header = [...document.body.querySelectorAll('[role="presentation"]')].find((h) => h.textContent?.trim().startsWith('Needs you'));
	const group = header?.parentElement;
	return group ? [...group.querySelectorAll<HTMLElement>('[role="option"]')] : [];
}
const rec = vi.hoisted(() => ({ live: '' }));
vi.mock('$lib/components/new/data', async (orig) => {
	const m = await orig<typeof import('$lib/components/new/data')>();
	return { ...m, failureRecovered: (href: string) => !!rec.live && !href.endsWith(`/${rec.live}`) };
});
beforeAll(() => install(true));
afterEach(() => installLiveSource(null));
const names = (rs: HTMLElement[]) => rs.map((r) => r.getAttribute('aria-label')!.split(' · ')[0]);
const draw = (extra: Record<string, unknown> = {}) => {
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
	return render(WithQueryClient, { props: { component: CommandPalette as never, props: { ...props(), ...extra } } });
};
const isOpen = () => !!document.body.querySelector('[role="dialog"]');

describe('the palette and navigation', { timeout: 30_000 }, () => {
	test('a row link that navigates closes it; a location that holds still does not', async () => {
		reactivePage.url = new URL('http://localhost/');
		draw();
		const rows = needsYouRows();
		const link = rows[0].querySelector<HTMLAnchorElement>('a.tap-link')!;
		expect(isOpen()).toBe(true);
		link.addEventListener('click', (e) => e.preventDefault());
		await fireEvent.click(link);
		await tick();
		expect(isOpen()).toBe(true);
		// the router lands on the link's target
		reactivePage.url = new URL(link.href, 'http://localhost');
		await tick();
		expect(isOpen()).toBe(false);
	});
	test('the Needs-you order stays the Attention order when the open rollout is a recovered one', () => {
		const first = (() => { rec.live = ''; draw(); const n = names(needsYouRows()); cleanup(); return n; })();
		rec.live = first[2];
		reactivePage.url = new URL('http://localhost/');
		const p = props();
		const open = p.rollouts.find((r) => r.metadata?.name === first[0] && /prod/.test(r.metadata?.namespace ?? ''))!;
		draw({ currentNamespace: open.metadata?.namespace, currentName: first[0] });
		expect(names(needsYouRows())[0]).toBe(first[2]);
	});
});
