/**
 * The palette's Needs-you rows over the health-failures fleet: the page wiring of the failing / failed rule.
 *   - a row whose check fails now says "health check failing" (glyph text and the option's name), a recovered one "failed its health check";
 *   - failing-now rows sort above recovered ones.
 */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
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
