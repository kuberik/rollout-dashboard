/**
 * ⭐ PALROW r9 (2026-10-11): NEEDS YOU LISTS BUILDS HELD BY APPROVAL.
 *
 * The palette's "Needs you" read only `isNeedsYou` (failed / stuck), so a
 * build waiting on a person, the one hold that never clears by itself, was
 * on Home's Needs-you card and missing here. It now reads the fleet's shared
 * predicate (`isHeldByApproval`, view-models/held.ts), so the two lists
 * cannot name different sets. The fixture is the demo's incident scenario,
 * built exactly the way `held-predicate-agreement.test.ts` builds it:
 * checkout-worker/staging has failed, telemetry-indexer/prod waits on an
 * approval.
 *
 * Pinned here:
 *   - order: failures, then stalls, then approvals;
 *   - the approval row is a held BlockedRow with the approval mark, the
 *     label NextStep's table gives for a review that navigates
 *     (`stepLabel('approve', { navigate: true, env })`), and its gate named;
 *   - choosing it (↵ or click) goes to that rollout's Gates tab and opens NO
 *     dialog: there is no approval endpoint, and the change-version confirm
 *     would bypass the very gate (squad-rollout correction, 2026-10-11);
 *   - an approval hold alone is enough for Needs you to lead.
 */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';

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
import { goto } from '$app/navigation';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { stepLabel } from '$lib/components/NextStep.svelte';
import type { Rollout, Environment } from '../types';

function incidentFleet() {
	resetDemoState('incident');
	const payload = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const rollouts = (payload.rollouts?.items ?? []) as Rollout[];
	const environments = (payload.environments?.items ?? []) as Environment[];
	const rolloutDependencies = payload.rolloutDependencies?.items ?? [];
	return { rollouts, environments, rolloutDependencies };
}

function props(opts: { withoutFailed?: boolean } = {}) {
	const f = incidentFleet();
	const rollouts = opts.withoutFailed
		? f.rollouts.filter((r) => !(r.metadata?.name === 'checkout-worker' && r.metadata?.namespace === 'checkout-worker-staging'))
		: f.rollouts;
	return {
		open: true,
		scope: null,
		rollouts,
		environments: f.environments,
		rolloutDependencies: f.rolloutDependencies,
		gateContext: buildGateContext({
			environments: { items: f.environments },
			rolloutDependencies: { items: f.rolloutDependencies }
		}),
		localClusterName: 'hub'
	};
}

/** The rows under the "Needs you" header, in order, as their blocked kinds. */
function needsYouRows(): HTMLElement[] {
	const header = [...document.body.querySelectorAll('[role="presentation"]')].find((h) =>
		h.textContent?.trim().startsWith('Needs you')
	);
	const group = header?.parentElement;
	return group ? [...group.querySelectorAll<HTMLElement>('[role="option"]')] : [];
}

beforeEach(() => {
	// Any fetch the confirm makes (commits, permissions) answers empty.
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
	vi.mocked(goto).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

// Each test mounts the whole palette over the full mock fleet; under full-suite
// load that render alone has exceeded the 5s default (pre-existing flake).
describe('Needs you lists builds held by approval', { timeout: 20_000 }, () => {
	test('failures first, then approvals; the approval row says Approve with the approval mark', () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		const rows = needsYouRows();
		const kinds = rows.map((r) => r.querySelector('[data-blocked-kind]')?.getAttribute('data-blocked-kind'));
		expect(kinds).toEqual(['failed', 'held']);
		expect(rows[0].textContent).toContain('checkout-worker');
		expect(rows[1].textContent).toContain('telemetry-indexer');
		const label = stepLabel('approve', { navigate: true, env: 'prod' });
		expect(rows[1].textContent).toContain(label);
		expect(rows[1].getAttribute('aria-label')).toContain(`— ${label}`);
		// The approval mark, never the orange rule-hold pause.
		expect(rows[1].querySelector('[data-blocked-kind="held"]')).not.toBeNull();
	});

	test('an approval hold alone makes Needs you the first section', () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props({ withoutFailed: true }) } });
		const firstHeader = document.body.querySelector('[role="presentation"]');
		expect(firstHeader?.textContent?.trim().startsWith('Needs you')).toBe(true);
		const rows = needsYouRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].querySelector('[data-blocked-kind]')?.getAttribute('data-blocked-kind')).toBe('held');
	});

	test('Enter on the approval row goes to its Gates tab and opens no dialog', async () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		await fireEvent.mouseEnter(needsYouRows()[1]);
		await fireEvent.keyDown(window, { key: 'Enter' });
		expect(goto).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(goto).mock.calls[0][0])).toMatch(/telemetry-indexer.*\/gates$/);
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByPlaceholderText(/Search builds/i)).toBeNull();
		expect(document.querySelector('dialog[open]')).toBeNull();
	});

	test("the approval row's own link points at the Gates tab (a click opens no dialog)", async () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		const link = needsYouRows()[1].querySelector('a');
		expect(link?.getAttribute('href') ?? '').toMatch(/telemetry-indexer.*\/gates$/);
		await fireEvent.click(link!);
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByPlaceholderText(/Search builds/i)).toBeNull();
		expect(document.querySelector('dialog[open]')).toBeNull();
	});

	test('a failed row still navigates to its logs (unchanged)', async () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		await fireEvent.mouseEnter(needsYouRows()[0]);
		await fireEvent.keyDown(window, { key: 'Enter' });
		expect(goto).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(goto).mock.calls[0][0])).toMatch(/checkout-worker.*\/logs$/);
	});

	test('QA C7: the word "approval" finds the rollout that waits for one (state words are indexed)', async () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		const input = document.body.querySelector('input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'approval' } });
		await waitFor(() => expect(document.body.textContent).toContain('telemetry-indexer'));
		expect(document.body.textContent).not.toContain('No results');
	});
});
