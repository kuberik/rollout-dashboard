import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import EnvPage from './EnvPage.svelte';
import { envPage } from './env-page';
import { installEdge, uninstallEdge } from '$lib/testing/edge-source';

/**
 * /envs/prod over the `home-edge` scenario (src/lib/demo/home-edge.ts): the first fixture that reaches the Behind section on prod, and one place per
 * reason it can be behind. Each assertion pins what the product SHOWS today. The Behind row says "N behind" and one of two reasons ("nothing inbound",
 * "N to deploy"); it never names a pin, a follower or a paused wave. That is the deferred HIGH-2 of the QA50/ux50 verdict (newest-catalogue), not
 * something this test papers over: when the row learns to say why, these expectations change on purpose.
 */
const mount = () => {
	const P = envPage('incident', 'prod')!;
	return render(WithQueryClient, {
		props: { component: EnvPage as never, props: { state: 'incident', P } }
	}).container;
};
const rows = (c: HTMLElement) =>
	[...c.querySelectorAll('[data-instep-behind] a')].map((a) => ({
		href: a.getAttribute('href'),
		text: (a.textContent ?? '').replace(/\s+/g, ' ').trim()
	}));
const rowOf = (c: HTMLElement, app: string) => rows(c).find((r) => r.href?.endsWith(`/${app}`));

beforeEach(installEdge);
afterEach(uninstallEdge);

describe('/envs/prod Behind section (home-edge)', () => {
	it('is reached: its header counts the three apps on an older build', () => {
		const c = mount();
		const sec = c.querySelector('[data-section="behind"]')!;
		expect(sec).toBeTruthy();
		expect(sec.textContent).toMatch(/Behind\s*3 apps on an older build/);
		expect(rows(c).map((r) => r.href)).toEqual([
			'/rollouts/prod/auth-proxy-prod-ap-south/auth-proxy',
			'/rollouts/prod/media-resizer-prod-eu-west/media-resizer',
			'/rollouts/prod/search-indexer-prod/search-indexer'
		]);
	});
	it('search-indexer (one prod place; dev has not taken the newer build yet): "1 behind · nothing inbound", no place prefix', () => {
		expect(rowOf(mount(), 'search-indexer')!.text).toMatch(
			/search-indexer\s*1 behind · nothing inbound$/
		);
	});
	it('media-resizer, failed follower: the lagging site is named, the row says "nothing inbound" and not that the follower did not follow', () => {
		const t = rowOf(mount(), 'media-resizer')!.text;
		expect(t).toMatch(/eu-west · 1 behind · nothing inbound$/);
		expect(t).not.toMatch(/follow|leader|us-east/i);
	});
	it('auth-proxy, paused wave: the lagging site is named, the row says "1 to deploy" and not that wave 2 waits for wave 1', () => {
		const t = rowOf(mount(), 'auth-proxy')!.text;
		expect(t).toMatch(/ap-south · 1 behind · 1 to deploy$/);
		expect(t).not.toMatch(/wave|paus|bak/i);
	});
	it('mail-relay, pinned: a pin is a hold, so the app is under Held ("Pinned") and never listed as Behind', () => {
		const c = mount();
		expect(rowOf(c, 'mail-relay')).toBeUndefined();
		const tile = c.querySelector('[data-section="held"] [data-truth-app="mail-relay"]')!;
		expect(tile.getAttribute('data-truth-group')).toBe('held');
		expect(tile.textContent).toMatch(/Pinned/);
	});
	it('the Behind model agrees with the markup (same rows, same reasons)', () => {
		const P = envPage('incident', 'prod')!;
		const edge = P.gangway.behind
			.filter((b) => /search-indexer|media-resizer|auth-proxy/.test(b.app))
			.map((b) => `${b.app}|${b.place}|${b.n}|${b.why}`);
		expect(edge).toEqual([
			'auth-proxy|ap-south|1|1 to deploy',
			'media-resizer|eu-west|1|nothing inbound',
			'search-indexer||1|nothing inbound'
		]);
	});
});
