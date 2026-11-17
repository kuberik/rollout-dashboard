/**
 * The palette's Needs-you rows over the health-failures fleet: the page wiring of the failing / failed rule.
 *   - a row whose check fails now says "health check failing" (glyph text and the option's name), a recovered one "failed its health check";
 *   - failing-now rows sort above recovered ones.
 */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

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

/* the palette must ask `failureRecovered` with the rollout's own path: the test names the one rollout whose check still fails now */
const rec = vi.hoisted(() => ({ live: '' }));
vi.mock('$lib/components/new/data', async (orig) => {
	const m = await orig<typeof import('$lib/components/new/data')>();
	return { ...m, failureRecovered: (href: string) => !!rec.live && !href.endsWith(`/${rec.live}`) };
});

beforeAll(() => install(true));
afterEach(() => installLiveSource(null));

const names = (rs: HTMLElement[]) => rs.map((r) => r.getAttribute('aria-label')!.split(' · ')[0]);
let alphabetical: string[] = [];

describe('palette Needs-you rows follow the failing / failed rule', { timeout: 30_000 }, () => {
	test('every check failing now: the glyph and the option name say failing', () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		const rows = needsYouRows();
		expect(rows.length).toBe(3);
		expect(rows.every((r) => /^[\w-]+ · prod · health check failing — /.test(r.getAttribute('aria-label')!))).toBe(true);
		expect(rows.every((r) => r.querySelector('[data-blocked-kind="failed"]')!.textContent!.includes('failing'))).toBe(true);
		alphabetical = names(rows);
	});
	test('only the last is failing now: the others read failed, and sort below it', () => {
		rec.live = alphabetical[2];
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		const rows = needsYouRows();
		expect(names(rows)[0]).toBe(rec.live);
		expect(rows[0].getAttribute('aria-label')).toMatch(/health check failing — /);
		for (const r of rows.slice(1)) {
			expect(r.getAttribute('aria-label')).toMatch(/ · prod · failed its health check — /);
			expect(r.querySelector('[data-blocked-kind="failed"]')!.textContent).not.toContain('failing');
			expect(r.textContent).toContain('Failed its health check');
		}
	});
});

describe('palette Needs-you rows: one tap target per row, actions as their own buttons, the key beside its action', { timeout: 30_000 }, () => {
	const draw = () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		return needsYouRows();
	};
	test('the row\'s own link opens the rollout, never an action dialog (a touch tap on the name)', () => {
		rec.live = alphabetical[0];
		const rows = draw();
		expect(rows.length).toBeGreaterThan(1);
		for (const r of rows) {
			const link = r.querySelector<HTMLAnchorElement>('a.tap-link')!;
			expect(link.getAttribute('href')).not.toMatch(/[?&]action=/);
			expect(link.getAttribute('href')).toMatch(/\/rollouts\/[^/]+\/[^/]+\/[^/]+$/);
		}
	});
	test('Roll back (live) and Retry (recovered) are their own links, with their own params', () => {
		rec.live = alphabetical[0];
		const rows = draw();
		const live = rows.find((r) => r.getAttribute('aria-label')!.startsWith(`${alphabetical[0]} `))!;
		expect(live.querySelector('a[data-action="rollback"]')!.getAttribute('href')).toContain('action=rollback');
		const rec1 = rows.find((r) => !r.getAttribute('aria-label')!.startsWith(`${alphabetical[0]} `))!;
		expect(rec1.querySelector('a[data-action="retry"]')!.getAttribute('href')).toContain('action=retry');
	});
	test('no row carries a ↵ run-key chip: Enter opens, so the footer says it once', () => {
		rec.live = alphabetical[0];
		const rows = draw();
		expect(rows.some((r) => r.querySelector('kbd'))).toBe(false);
	});
	test('a failure live now leads, recovered rows come last', () => {
		rec.live = alphabetical[1];
		const rows = draw();
		expect(names(rows)[0]).toBe(alphabetical[1]);
		const kinds = rows.map((r) => /failed its health check/.test(r.getAttribute('aria-label')!));
		expect(kinds).toEqual([...kinds].sort((a, b) => Number(a) - Number(b)));
	});
});

describe('palette counts of a recovered-only failure read in neutral ink', { timeout: 30_000 }, () => {
	const search = async (q: string) => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		const input = document.body.querySelector<HTMLInputElement>('input')!;
		await fireEvent.input(input, { target: { value: q } });
		return [...document.body.querySelectorAll<HTMLElement>('[data-meta="needs"]')];
	};
	test('every check recovered: no count is danger ink', async () => {
		rec.live = 'none-of-them';
		const counts = await search('catalog');
		expect(counts.length).toBeGreaterThan(0);
		for (const c of counts) expect(c.className).not.toContain('text-danger');
	});
	test('a check failing now keeps the danger ink on its own counts', async () => {
		rec.live = 'catalog-api';
		const counts = await search('catalog');
		expect(counts.some((c) => c.className.includes('text-danger'))).toBe(true);
	});
});
