/** The list cards' action set and the Retry link that opens its confirm on arrival. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import AttentionCard from './AttentionCard.svelte';
import FailurePanel from './FailurePanel.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import { attentionModel } from '$lib/view-models/attention';
import { failedRowAction } from '$lib/view-models/failure-actions';
import { retryActionHref } from '$lib/components/new/rollout-view';

if (!Element.prototype.animate) {
	Element.prototype.animate = function () {
		return { cancel() {}, finish() {}, set onfinish(_f: unknown) {}, currentTime: 0, playState: 'finished' } as unknown as Animation;
	};
}
if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () { this.open = true; };
	HTMLDialogElement.prototype.show = function () { this.open = true; };
	HTMLDialogElement.prototype.close = function () { this.open = false; };
}

const card = (o: { recovered: boolean; state?: 'failed' | 'approval' }, p: Record<string, unknown> = {}) =>
	render(AttentionCard, { props: { model: attentionModel({ state: o.state ?? 'failed', age: '5m', tier: 'prod', title: 'x', recovered: o.recovered, recoveredAt: '09:34' }), href: '/rollouts/prod/ns/app', id: { name: 'app' }, rollbackHref: '/rollouts/prod/ns/app?action=rollback', retryHref: '/rollouts/prod/ns/app', openHref: '/rollouts/prod/ns/app', ...p } as never }).container;
const acts = (c: HTMLElement) => [...c.querySelectorAll('[data-actions] [data-action]')].map((e) => `${(e as HTMLElement).dataset.action}:${/btn-primary/.test(e.className) ? 'primary' : 'secondary'}`);

describe('one action set on every list card', () => {
	it('failing now: Roll back (blue) and Open rollout, when the page passes its openHref', () => {
		expect(acts(card({ recovered: false }))).toEqual(['rollback:primary', 'open:secondary']);
	});
	it('recovered: Roll back and Retry, equal weight, Open rollout left to the card itself', () => {
		expect(acts(card({ recovered: true }))).toEqual(['rollback:secondary', 'retry:secondary']);
	});
});

describe('Retry links to the rollout with ?action=retry', () => {
	it('the card\'s Retry carries the param, as Roll back carries its own', () => {
		const c = card({ recovered: true });
		expect(c.querySelector('[data-action="retry"]')!.getAttribute('href')).toBe('/rollouts/prod/ns/app?action=retry');
		expect(c.querySelector('[data-action="rollback"]')!.getAttribute('href')).toContain('action=rollback');
	});
	it('the helper keeps an existing query and never doubles the param', () => {
		expect(retryActionHref('/r/a?x=1')).toBe('/r/a?x=1&action=retry');
		expect(retryActionHref('/r/a?action=retry')).toBe('/r/a?action=retry');
	});
	it('the palette\'s recovered row runs Retry on the rollout with the param; a live one still rolls back', () => {
		expect(failedRowAction(true, false)).toMatchObject({ label: 'Retry', query: 'action=retry' });
		expect(failedRowAction(false, false)).toMatchObject({ label: 'Roll back', query: 'action=rollback' });
	});
	const history = [{ version: { tag: '1.0.1' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus: 'Failed' }, { version: { tag: '1.0.0' }, timestamp: '2026-11-09T10:00:00Z', bakeStatus: 'Succeeded' }];
	const panel = (requestRetry: boolean, onRequestHandled: () => void) =>
		render(WithQueryClient, { props: { component: FailurePanel as never, props: {
			rollout: { metadata: { name: 'app', namespace: 'ns' }, spec: {}, status: { history } }, healthChecks: [], failedStepTests: [], stalledKruiseRollout: null,
			canUpdate: true, canModify: true, isDashboardManagingWantedVersion: true, environmentName: 'prod', onRetry: async () => {}, requestRetry, onRequestHandled,
			failedHCList: [{ name: 'error-rate', message: 'error-rate: 4.2% of requests failed' }]
		} as never } });
	it('arriving with ?action=retry opens the Retry confirm and clears the request', () => {
		const handled = vi.fn();
		panel(true, handled);
		expect(document.querySelector('#rcm-title')?.textContent).toMatch(/^Retry /);
		expect(handled).toHaveBeenCalled();
	});
	it('arriving without the param opens nothing', () => {
		const handled = vi.fn();
		document.body.innerHTML = '';
		panel(false, handled);
		expect(document.querySelector('#rcm-title')).toBeNull();
		expect(handled).not.toHaveBeenCalled();
	});
});

describe('a recovered card says the sentence the banners say', () => {
	it('"Recovered at 09:34, so a retry is reasonable."', () => {
		const m = attentionModel({ state: 'failed', age: '5m', tier: 'prod', title: 'x', recovered: true, recoveredAt: '09:34', check: { name: 'hit ratio', message: 'at 72%' }, observations: [{ name: 'hit ratio', kind: 'Threshold', value: '72', limit: '80', unit: '%', direction: 'Below', healthy: false } as never] });
		expect(m.fact?.message).toBe('Recovered at 09:34, so a retry is reasonable.');
	});
});

describe('Home and /envs/<name> pass the card its Open rollout', () => {
	for (const f of ['new/Home.svelte', 'new/env/EnvPage.svelte']) {
		it(f, () => {
			const src = readFileSync(resolve(__dirname, f), 'utf8');
			expect(/<AttentionCard[^>]*openHref=\{a\.href\}/.test(src)).toBe(true);
		});
	}
});

describe('the change page banner keeps its pair on a phone', () => {
	it('ChangeDetail does not cut the banner\'s phone row to one action', () => {
		const src = readFileSync(resolve(__dirname, 'new/change/ChangeDetail.svelte'), 'utf8');
		const banner = src.slice(src.indexOf('<StatementBanner severity="failed"'));
		expect(banner.slice(0, banner.indexOf('/>'))).not.toContain('phoneMax');
	});
});
