/**
 * The palette's Needs-you order among failures that are all failing now: the longest-failing first (the age every other surface prints),
 * ties by name, a failure with no known start last. Rendered over the health-failures fleet with each rollout's start stubbed.
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

// the fixture is read once for the file: every draw below only changes the stubbed failure starts and the fleet's order
let fixture: { l: any; gh: any; hc: any } | null = null;
function props(reverse = false) {
	if (!fixture) {
		resetDemoState('calm');
		fixture = {
			l: JSON.parse(respond('GET', '/api/rollouts').body ?? '{}'),
			gh: JSON.parse(respond('GET', '/api/github/changes?days=365').body!),
			hc: JSON.parse(respond('GET', '/api/health-checks').body ?? 'null')
		};
	}
	const { l, gh, hc } = fixture;
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
	return {
		open: true,
		scope: null,
		rollouts: (reverse ? [...(l.rollouts?.items ?? [])].reverse() : (l.rollouts?.items ?? [])) as Rollout[],
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

/* every check fails now; the test names when each rollout's failure began */
const since = vi.hoisted(() => ({ at: {} as Record<string, string | undefined> }));
vi.mock('$lib/components/new/data', async (orig) => {
	const m = await orig<typeof import('$lib/components/new/data')>();
	const app = (href: string) => href.split('/').pop()!;
	return { ...m, failureRecovered: () => false, failureSinceAt: (href: string) => since.at[app(href)] };
});

beforeAll(() => install(true));
afterEach(() => installLiveSource(null));

const names = (rs: HTMLElement[]) => rs.map((r) => r.getAttribute('aria-label')!.split(' · ')[0]);
const draw = (reverse = false) => {
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
	render(WithQueryClient, { props: { component: CommandPalette as never, props: props(reverse) } });
	return names(needsYouRows());
};
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe('palette Needs-you: failures failing now, longest-failing first', { timeout: 30_000 }, () => {
	test('oldest start first, whatever the names', () => {
		const alpha = (since.at = {}, draw());
		expect(alpha.length).toBe(3);
		since.at = { [alpha[0]]: ago(5), [alpha[1]]: ago(50), [alpha[2]]: ago(20) };
		document.body.innerHTML = '';
		expect(draw()).toEqual([alpha[1], alpha[2], alpha[0]]);
	});
	test('equal starts: by name, not by the order the fleet arrived in', () => {
		since.at = {};
		const forward = draw();
		const same = ago(15);
		since.at = Object.fromEntries(forward.map((n) => [n, same]));
		document.body.innerHTML = '';
		expect(draw(true)).toEqual([...forward].sort((a, b) => a.localeCompare(b)));
	});
	test('a failure with no known start comes after the dated ones', () => {
		since.at = {};
		const alpha = draw();
		since.at = { [alpha[0]]: undefined, [alpha[1]]: ago(5), [alpha[2]]: ago(50) };
		document.body.innerHTML = '';
		expect(draw()).toEqual([alpha[2], alpha[1], alpha[0]]);
	});
});
