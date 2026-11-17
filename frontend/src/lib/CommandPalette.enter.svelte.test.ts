/**
 * Enter in the palette opens the highlighted row in every mode; a rollout that needs a person keeps Roll back / Retry as a link, and its row
 * carries no ↵ chip.
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

const lastGoto = () => String(vi.mocked(goto).mock.calls.at(-1)?.[0] ?? '');
const selected = () => options().find((o) => o.getAttribute('aria-selected') === 'true')!;
const actionOf = (row: HTMLElement) => row.querySelector<HTMLAnchorElement>('[data-meta="action"] a[data-action]');

describe('Enter on a rollout that needs a person', { timeout: 60_000 }, () => {
	test('with nothing typed, Enter opens the highlighted Needs-you rollout, never its action, and no ↵ chip sits on the row', async () => {
		rec.live = '';
		reactivePage.url = new URL('http://localhost/');
		draw();
		const sel = selected();
		expect(actionOf(sel)).not.toBeNull();
		expect(sel.querySelector('kbd')).toBeNull();
		vi.mocked(goto).mockClear();
		await fireEvent.keyDown(document.body.querySelector<HTMLInputElement>('input')!, { key: 'Enter' });
		expect(lastGoto()).not.toContain('action=');
		expect(lastGoto()).toMatch(/\/rollouts\/[^/]+\/[^/]+\/[^/?]+$|\/[^/?]+$/);
		cleanup();
	});
	test.each(['catalog', 'invoice', 'se'])('under the query "%s", Enter opens the rollout, not its action; the action is still a link', async (q) => {
		rec.live = '';
		reactivePage.url = new URL('http://localhost/');
		draw();
		const input = document.body.querySelector<HTMLInputElement>('input')!;
		await type(input, q);
		const sel = selected();
		expect(options()[0].getAttribute('aria-selected')).toBe('true');
		expect(sel.querySelector('kbd')).toBeNull();
		const act = actionOf(sel);
		vi.mocked(goto).mockClear();
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(lastGoto()).not.toContain('action=');
		if (act) expect(act.getAttribute('href')).toContain('action=');
		cleanup();
	});
});

describe('a new query or scope starts the highlight on the first drawn row, and Enter opens it', { timeout: 60_000 }, () => {
	const arrowDown = async (input: HTMLInputElement, n: number) => {
		for (let i = 0; i < n; i++) await fireEvent.keyDown(input, { key: 'ArrowDown' });
	};
	test.each([
		['d', 'ds', /checkout-api/],
		['d', 'be', /search-indexer/],
		['o', 'os', /apps/],
		['v', 'vi', /activity/]
	])('after "%s" and two ArrowDowns, typing "%s" puts the highlight back on row one; Enter opens that row', async (first, q, dest) => {
		rec.live = '';
		reactivePage.url = new URL('http://localhost/');
		draw();
		const input = document.body.querySelector<HTMLInputElement>('input')!;
		await type(input, first);
		await arrowDown(input, 2);
		expect(options()[0].getAttribute('aria-selected')).toBe('false');
		await type(input, q);
		const rows = options();
		expect(rows[0].getAttribute('aria-selected'), `first row for "${q}"`).toBe('true');
		expect(rows.filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(1);
		vi.mocked(goto).mockClear();
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(vi.mocked(goto)).toHaveBeenCalledTimes(1);
		expect(lastGoto()).toMatch(dest);
		expect(lastGoto()).not.toContain('action=');
		cleanup();
	});
	test('a scope change (Tab on a Jump-to row) starts the highlight on the first drawn row', async () => {
		rec.live = '';
		reactivePage.url = new URL('http://localhost/');
		draw();
		const input = document.body.querySelector<HTMLInputElement>('input')!;
		for (let i = 0; i < 40 && !/^Rollouts\b/.test(selectedText()); i++) await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(selectedText()).toMatch(/^Rollouts\b/);
		await fireEvent.keyDown(input, { key: 'Tab' });
		await tick();
		await tick();
		expect(options()[0].getAttribute('aria-selected')).toBe('true');
		expect(options().filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(1);
		cleanup();
	});
});
