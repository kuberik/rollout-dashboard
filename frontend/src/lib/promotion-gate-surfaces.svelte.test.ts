import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import * as D from '$lib/components/new/data';
import HoldingCard from '$lib/components/new/HoldingCard.svelte';
import StrandRow from '$lib/components/new/StrandRow.svelte';
import AppGates from '$lib/components/new/app/AppGates.svelte';
import GateText from '$lib/components/GateText.svelte';
import { holdRows } from '$lib/components/new/app/app-model';
import { strandRow } from '$lib/components/new/rollouts-page';
import { doneWords } from '$lib/components/new/approvals.svelte';
import { gateLabel, gateLabelMarked, plainGateText } from '$lib/view-models/gate-label';

/**
 * batch4 #128 (owner ruling 2026-11-12): EVERY visible surface draws a promotion gate as the » glyph and the source chip
 * (`GateLabel`), never as the text "Promotion from <env>". One test per surface; each is given a place held by a promotion gate
 * and asserts the surface holds a [data-gate-label] and that the visible text carries no "Promotion from".
 */
afterEach(() => installLiveSource(null));

/** the incident fixture with its first check-held place held by a PROMOTION gate instead (the backend's kind) */
function promotionHeld() {
	const src = fixtureSource();
	const rollouts = structuredClone(src.rollouts) as typeof src.rollouts;
	let n = 0;
	for (const r of rollouts) for (const g of r.status?.gates ?? []) if ((g as { name: string }).name === 'integration-tests') { (g as { kind?: string }).kind = 'promotion'; n++; }
	installLiveSource({ ...src, rollouts } as never);
	return n;
}
const drawn = (el: Element) => {
	expect(el.querySelector('[data-gate-label="promotion"]')).not.toBeNull();
	expect(el.textContent).not.toContain('Promotion from');
};

describe('the marked string', () => {
	it('survives as text with no marks visible to a plain sink', () => {
		const m = gateLabelMarked(gateLabel({ kind: 'promotion', name: 'x' }, null, 'staging'));
		expect(plainGateText(m)).toBe('Promotion from staging');
	});
	it('GateText draws the label and the unknown source as the word', () => {
		const a = render(GateText, { text: `Held by ${gateLabelMarked(gateLabel({ kind: 'promotion', name: 'x' }, null, 'staging'))}` });
		drawn(a.container);
		expect(a.container.querySelector('[data-gate-source="staging"]')).not.toBeNull();
		const b = render(GateText, { text: gateLabelMarked(gateLabel({ kind: 'promotion', name: 'x' }, null, null)) });
		expect(b.container.querySelector('[data-gate-label="promotion"]')?.textContent).toContain('Promotion');
	});
});

const marked = (src: string | null) => gateLabelMarked(gateLabel({ kind: 'promotion', name: 'ghd-x' }, null, src));

describe('surfaces', () => {
	it('the Holding card cause', () => {
		promotionHeld();
		const row = D.rollouts('incident').rows.find((r) => r.group === 'held')!;
		const holds = [{ key: 'k', cause: `Held by ${marked('staging')}`, places: ['orders-api · staging'], rows: [row] }];
		const { container } = render(HoldingCard, { holds: holds as never });
		drawn(container);
		expect(container.querySelector('[data-truth-cause]')?.getAttribute('data-truth-cause')).toBe('Held by Promotion from staging');
	});
	it('the row cause on /rollouts (StrandRow)', () => {
		promotionHeld();
		const row = D.rollouts('incident').rows.find((r) => r.group === 'held')!;
		const { container } = render(StrandRow, { row: { ...strandRow(row, 'incident'), lead: `Held by ${marked('staging')}` } });
		drawn(container);
	});
	it('the app Holding card (AppGates) names a promotion gate by kind', () => {
		const gi = { id: 'g', name: marked('staging'), kind: 'promotion', sentence: '', holding: true, heldPending: false, places: ['prod'], holdsAt: ['prod'], held: ['b1'], releasedBy: '' } as never;
		const rows = holdRows([gi], [], null, 'orders-api');
		const { container } = render(AppGates, { rows });
		drawn(container);
	});
	it('the Approved toast detail (ApprovalLayer renders it through GateText)', () => {
		const t = { app: 'orders-api', build: 'abc', where: 'staging', cause: `Held by ${marked('dev')}`, waitsOn: null, deploys: null } as never;
		const { container } = render(GateText, { text: doneWords(t).detail });
		drawn(container);
	});
});
