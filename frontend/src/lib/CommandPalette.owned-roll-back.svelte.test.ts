/**
 * The palette's Needs-you rows over the incident fleet:
 *   - a failing row's Roll back follows the wanted-version ownership rule of the header and the Overview: when another controller owns the
 *     field it is a disabled button carrying the same reason, never a link;
 *   - an approval row's "Review approval in ..." text sits on the NAME line (its own right side), so the row keeps two lines.
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


import { WANTED_VERSION_OWNED_REASON } from '$lib/view-models/pin-hold';

const owned = (owner: string | null) => {
	const p = props();
	const r = p.rollouts.find((x) => x.metadata?.name === 'checkout-worker' && x.metadata?.namespace === 'checkout-worker-staging') as unknown as { metadata: Record<string, unknown>; spec: Record<string, unknown> };
	if (owner) {
		r.metadata.managedFields = [{ manager: owner, operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }];
		r.spec = { ...(r.spec ?? {}), wantedVersion: 'pinned' };
	}
	return p;
};

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
});
afterEach(() => vi.unstubAllGlobals());

describe('palette Roll back and approval hint', { timeout: 20_000 }, () => {
	test('a failing row owned by another controller: Roll back is a disabled button with the reason', () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: owned('flux-controller') } });
		const b = needsYouRows()[0].querySelector<HTMLElement>('[data-action="rollback"]')!;
		expect(b.tagName).toBe('BUTTON');
		expect((b as HTMLButtonElement).disabled).toBe(true);
		expect(b.getAttribute('title')).toBe(WANTED_VERSION_OWNED_REASON);
	});
	test('a failing row the dashboard owns: Roll back is a link', () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: owned(null) } });
		expect(needsYouRows()[0].querySelector('[data-action="rollback"]')!.tagName).toBe('A');
	});
	test('an approval row puts its hint on the name line, before the meta line', () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		const row = needsYouRows()[1];
		const up = row.querySelector('[data-trailing-up]');
		expect(up).not.toBeNull();
		expect(up!.textContent).toContain('Review approval');
		const meta = row.querySelector('[data-meta-line]')!;
		expect(up!.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
	test('a failing row keeps its action on the meta line', () => {
		render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
		expect(needsYouRows()[0].querySelector('[data-trailing-up]')).toBeNull();
	});
});
