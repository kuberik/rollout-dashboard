/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { withPromotionHolds } from '$lib/demo/home-incident';
import * as D from '$lib/components/new/data';
import Facia from '$lib/components/new/Facia.svelte';
import { laneOf } from '$lib/components/new/Footprint.svelte';
import HoldingCard from '$lib/components/new/HoldingCard.svelte';
import StrandRow from '$lib/components/new/StrandRow.svelte';
import { strandRow } from '$lib/components/new/rollouts-page';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import AppDetail from '$lib/components/new/app/AppDetail.svelte';
import StatementBanner from '$lib/components/StatementBanner.svelte';
import CauseText from '$lib/components/CauseText.svelte';
import { gateLabel, labelPart, type Cause } from '$lib/view-models/gate-label';

vi.mock('$app/state', () => ({ page: { params: {}, url: new URL('http://localhost/'), route: { id: null }, status: 200, error: null, data: {}, form: null } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

/**
 * batch4 #75 (owner rule): "Promotion from <env>" is screen-reader text, never visible text. Every surface that carries a promotion
 * label is rendered over the served fixture (`withPromotionHolds`: telemetry-indexer prod is held by a promotion gate) and asserted
 * to hold NO visible text node containing "Promotion from"; its sr-only run is the one place the words may live.
 */
afterEach(() => installLiveSource(null));
function installPromotionFleet() {
	const src = fixtureSource();
	installLiveSource({ ...src, rollouts: withPromotionHolds({ rollouts: src.rollouts } as never).rollouts } as never);
}
/** every text node a sighted reader reads (not inside .sr-only / aria-hidden) */
export function visibleTextNodes(root: Element): string[] {
	const out: string[] = [];
	const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let n = w.nextNode(); n; n = w.nextNode()) {
		const p = n.parentElement;
		if (p && !p.closest('.sr-only,[aria-hidden="true"],script,style') && (n.textContent ?? '').trim()) out.push(n.textContent!);
	}
	return out;
}
const expectNoVisibleSentence = (root: Element, where: string) => expect(visibleTextNodes(root).filter((t) => /Promotion from/.test(t)), `${where}: visible "Promotion from"`).toEqual([]);

const APP = 'telemetry-indexer';

describe('the app tile (Facia) and the app page banner draw the promotion hold', () => {
	it('Facia: the held tile draws » [DEV], no "Promotion from" in visible text', () => {
		installPromotionFleet();
		const m = D.apps('incident');
		const item = m.items.find((a) => a.app === APP)!;
		const { lane, last } = laneOf(item, m.R.c.m as never, m.R.c.events as never);
		const { container } = render(Facia, { props: { item, lane, approvals: m.R.rows, scenario: 'incident', lead: false, attention: false, last, recent: [] } as never });
		expect(container.querySelector('[data-gate-label="promotion"]'), 'the tile draws the label').not.toBeNull();
		expectNoVisibleSentence(container, 'Facia');
	});
	it('AppDetail: the banner title and message draw » [DEV]', async () => {
		installPromotionFleet();
		const { container } = render(WithQueryClient, { props: { component: AppDetail as any, props: { state: 'incident', name: APP } } });
		await waitFor(() => expect(container.querySelector('[data-ad-statement]')).not.toBeNull());
		expect(container.querySelector('[data-ad-statement] [data-gate-label="promotion"]'), 'the banner draws the label').not.toBeNull();
		expectNoVisibleSentence(container, 'AppDetail');
	});
});

describe('StatementBanner takes a typed cause as its title and message', () => {
	const cause: Cause = ['Held by ', labelPart(gateLabel({ kind: 'promotion', name: 'ghd-x' }, null, 'staging')), ' in production'];
	it('draws the label through GateLabel in both slots', () => {
		const { container } = render(StatementBanner, { props: { severity: 'info', title: cause, message: cause } as never });
		expect(container.querySelectorAll('[data-gate-label="promotion"]')).toHaveLength(2);
		expectNoVisibleSentence(container, 'StatementBanner');
	});
	it('a plain string title still prints as text', () => {
		const { container } = render(StatementBanner, { props: { severity: 'info', title: 'Held by Business Hours' } as never });
		expect(container.textContent).toContain('Held by Business Hours');
	});
});

describe('every surface carrying a promotion label: no visible "Promotion from"', () => {
	it('Holding card, /rollouts row, CauseText', () => {
		installPromotionFleet();
		const held = D.heldCauses('incident').filter((h) => h.parts.some((p) => typeof p !== 'string'));
		expect(held.length, 'the fixture has a promotion-held cause').toBeGreaterThan(0);
		const hc = render(HoldingCard, { holds: held as never });
		expectNoVisibleSentence(hc.container, 'HoldingCard');
		const row = D.rollouts('incident').rows.find((r) => r.app === APP && r.group === 'held')!;
		const sr = render(StrandRow, { row: strandRow(row, 'incident') });
		expect(sr.container.querySelector('[data-gate-label="promotion"]')).not.toBeNull();
		expectNoVisibleSentence(sr.container, 'StrandRow');
		const ct = render(CauseText, { parts: ['Held by ', labelPart(gateLabel({ kind: 'promotion', name: 'x' }, null, null))] });
		expectNoVisibleSentence(ct.container, 'CauseText');
	});
});
