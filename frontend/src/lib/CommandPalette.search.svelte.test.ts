/**
 * The palette's highlight while searching: a new query (or scope) always starts on the first result, so Enter opens the best match.
 * (The highlight follows its item only when the list re-sorts under the same query; that is pinned in the navigate spec.)
 */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { goto } from '$app/navigation';
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


const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
const selectedText = () => (options().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent ?? '').replace(/\s+/g, ' ').trim();
const type = async (input: HTMLInputElement, q: string) => {
	await fireEvent.input(input, { target: { value: q } });
	await tick();
	await tick();
};

describe('the palette search highlight', { timeout: 60_000 }, () => {
	const PREFIXES = ['c', 'ch', 'che', 'chec'];
	// what each prefix highlights when it is typed into a fresh palette (the best match: result #0)
	const fresh: Record<string, string> = {};
	test('a fresh palette highlights the first result for each prefix', async () => {
		for (const q of PREFIXES) {
			rec.live = '';
			reactivePage.url = new URL('http://localhost/');
			draw();
			await type(document.body.querySelector<HTMLInputElement>('input')!, q);
			fresh[q] = selectedText();
			// the highlight is the first result drawn (the flat index is the on-screen order)
			expect(options()[0].getAttribute('aria-selected'), `first row for "${q}"`).toBe('true');
			expect(fresh[q], q).not.toBe('');
			cleanup();
		}
	});
	test('with nothing typed, the highlight is the first row drawn', () => {
		rec.live = '';
		reactivePage.url = new URL('http://localhost/');
		draw();
		expect(options()[0].getAttribute('aria-selected')).toBe('true');
		cleanup();
	});
	test('typing letter by letter after arrowing down leaves the highlight on the same first result, and Enter opens it', async () => {
		rec.live = '';
		reactivePage.url = new URL('http://localhost/');
		draw();
		const input = document.body.querySelector<HTMLInputElement>('input')!;
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		for (const q of PREFIXES) {
			await type(input, q);
			expect(selectedText(), `query "${q}"`).toBe(fresh[q]);
			expect(options()[0].getAttribute('aria-selected'), `first row for "${q}"`).toBe('true');
		}
		// Enter acts on that result (a failing rollout's primary action opens its page with the action)
		vi.mocked(goto).mockClear();
		const hl = options().find((o) => o.getAttribute('aria-selected') === 'true')!;
		const href = hl.querySelector('a')?.getAttribute('href');
		await fireEvent.keyDown(input, { key: 'Enter' });
		if (href) expect(String(vi.mocked(goto).mock.calls[0]?.[0])).toContain(href.split("?")[0]);
	});
});
