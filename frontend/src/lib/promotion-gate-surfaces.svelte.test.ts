import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import * as D from '$lib/components/new/data';
import HoldingCard from '$lib/components/new/HoldingCard.svelte';
import StrandRow from '$lib/components/new/StrandRow.svelte';
import ApprovalLayer from '$lib/components/new/ApprovalLayer.svelte';
import { approvalUi } from '$lib/components/new/approvals.svelte';
import CauseText from '$lib/components/CauseText.svelte';
import { strandRow, sentenceParts, sentenceOf } from '$lib/components/new/rollouts-page';
import { gateLabel, causeText, labelPart, joinCause, type Cause } from '$lib/view-models/gate-label';

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
/** what a sighted reader reads: the text without the screen-reader-only run and aria-hidden glyphs */
export const visibleText = (el: Element): string => {
	const c = el.cloneNode(true) as Element;
	c.querySelectorAll('.sr-only,[aria-hidden="true"]').forEach((n) => n.remove());
	return c.textContent ?? '';
};
const drawn = (el: Element) => {
	expect(el.querySelector('[data-gate-label="promotion"]')).not.toBeNull();
	expect(visibleText(el)).not.toContain('Promotion from');
	/* a screen reader still hears the kind (QA71 F4) */
	expect(el.querySelector('[data-gate-label="promotion"] .sr-only')?.textContent).toContain('Promotion from');
};

const promo = (src: string | null): Cause => ['Held by ', labelPart(gateLabel({ kind: 'promotion', name: 'ghd-x' }, null, src))];

describe('CauseText', () => {
	it('draws the label and the unknown source as the word', () => {
		const a = render(CauseText, { parts: promo('staging') });
		drawn(a.container);
		expect(a.container.querySelector('[data-gate-source="staging"]')).not.toBeNull();
		const b = render(CauseText, { parts: promo(null) });
		expect(b.container.querySelectorAll('[data-gate-label="promotion"]')[0]?.textContent).toContain('Promotion');
	});
	it('causeText is the one plain form, with no invisible characters', () => {
		expect(causeText(promo('staging'))).toBe('Held by Promotion from staging');
		expect(causeText(promo(null))).toBe('Held by Promotion');
		expect(joinCause('a', 'b', promo('x'), ' tail').map((p) => typeof p)).toEqual(['string', 'object', 'string']);
	});
});

describe('surfaces', () => {
	it('the Holding card cause', () => {
		promotionHeld();
		const row = D.rollouts('incident').rows.find((r) => r.group === 'held')!;
		const holds = [{ key: 'k', cause: 'Held by Promotion from staging', parts: promo('staging'), places: ['orders-api · staging'], rows: [row] }];
		const { container } = render(HoldingCard, { holds: holds as never });
		drawn(container);
		expect(container.querySelector('[data-truth-cause]')?.getAttribute('data-truth-cause')).toBe('Held by Promotion from staging');
	});
	it('the row cause on /rollouts (StrandRow)', () => {
		promotionHeld();
		const row = D.rollouts('incident').rows.find((r) => r.group === 'held')!;
		const { container } = render(StrandRow, { row: { ...strandRow(row, 'incident'), lead: promo('staging') } });
		drawn(container);
	});
	it('the Approved toast (ApprovalLayer) draws the label', () => {
		if (!Element.prototype.animate) Element.prototype.animate = function () { return { cancel() {}, finish() {}, onfinish: null, finished: Promise.resolve() } as unknown as Animation; };
		approvalUi.ask = null;
		approvalUi.done = { target: { app: 'orders-api', build: 'abc', where: 'staging', count: 1, places: [], cause: promo('dev'), waitsOn: null, deploys: null } as never, error: null };
		const { container } = render(ApprovalLayer);
		const toast = document.querySelector('[data-approve-toast]') ?? container;
		drawn(toast);
		approvalUi.done = null;
	});
});

describe('the data layer hands surfaces a typed label, never plain text', () => {
	it('a place held by a promotion gate carries a promotion label (PlaceHold.gate.label)', () => {
		installLiveSource(fixtureSource() as never);
		const ps = D.apps('incident').items.flatMap((a) => D.placeHolds(a.app, 'incident')).filter((p) => p.gate?.label.kind === 'promotion');
		expect(ps.length).toBeGreaterThan(0);
		for (const p of ps) expect(p.gate!.name).toBe(p.gate!.label.kind === 'promotion' && p.gate!.label.source ? `Promotion from ${p.gate!.label.source}` : 'Promotion');
	});
	it('holdLabelOf and holdCause (the one cause formatter) type a promotion gate', () => {
		installLiveSource(fixtureSource() as never);
		const p = D.apps('incident').items.flatMap((a) => D.placeHolds(a.app, 'incident').map((x) => ({ a: a.app, x }))).find((e) => e.x.gate?.label.kind === 'promotion')!;
		const g = { name: 'ghd-x', kind: 'promotion' } as never;
		expect(D.holdLabelOf(p.x.href, g, 'incident', p.a, null).kind).toBe('promotion');
		expect(D.holdCause(p.x.href, g, 'incident', p.a, null).some((x) => typeof x !== 'string' && x.kind === 'promotion')).toBe(true);
	});
	it('the row sentence keeps the label: sentenceParts typed, sentenceOf its plain text', () => {
		promotionHeld();
		const row = D.rollouts('incident').rows.find((r) => r.group === 'held' && D.gateName(r, 'incident')?.label.kind === 'promotion');
		expect(row, 'a row held by a promotion gate').toBeTruthy();
		const [lead] = sentenceParts(row!, 'incident');
		expect(lead.filter((x) => typeof x !== 'string')).toHaveLength(1);
		expect(sentenceOf(row!, 'incident')[0]).toMatch(/^Held by Promotion from /);
	});
	it('the Holding card cause (heldCauses) carries the label and keys on its plain text', () => {
		promotionHeld();
		const h = D.heldCauses('incident').find((c) => c.parts.some((x) => typeof x !== 'string'));
		expect(h, 'a promotion cause').toBeTruthy();
		expect(h!.cause).toBe(causeText(h!.parts));
		const { container } = render(HoldingCard, { holds: [h!] as never });
		drawn(container);
	});
	it('approvalTarget carries waitsOnLabel beside the plain waitsOn', () => {
		promotionHeld();
		const t = D.rollouts('incident').rows.map((r) => D.approvalTarget(r, 'incident')).find((x) => x?.waitsOnLabel?.kind === 'promotion');
		if (t) { expect(t.waitsOn).toMatch(/^Promotion/); expect(t.cause?.some((x) => typeof x !== 'string')).toBe(true); }
	});
});

describe('no invisible marker characters (the rejected approach)', () => {
	it('no U+2063 / U+2064 anywhere in src', async () => {
		const { readdirSync, readFileSync, statSync } = await import('node:fs');
		const { join } = await import('node:path');
		const bad: string[] = [];
		const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'paraglide') walk(p); } else if (/\.(ts|svelte|js|css)$/.test(f) && !/promotion-gate-surfaces/.test(f)) { const t = readFileSync(p, 'utf8'); if (/[\u2063\u2064]/.test(t) || /GATE_MARK|gateLabelMarked|splitGateText|plainGateText/.test(t)) bad.push(p); } } };
		walk(join(process.cwd(), 'src'));
		expect(bad).toEqual([]);
	});
});

describe('rollout-cards: the other hold beside an approval ask (QA71 F2 / Q2)', () => {
	it('a promotion gate is its kind, never displayName or label; a dependency is its provider; any other its display name', async () => {
		const { otherHoldLabel } = await import('$lib/rollout-cards');
		const SENTENCE = 'Previous environment not ready yet';
		expect(otherHoldLabel({ kind: 'promotion', promotionSource: 'staging', displayName: SENTENCE, label: 'after staging' }, 'ghd-x')).toEqual({ kind: 'promotion', source: 'staging' });
		expect(otherHoldLabel({ kind: 'promotion', displayName: SENTENCE, label: 'after its upstream environment' }, 'ghd-x')).toEqual({ kind: 'promotion', source: null });
		expect(otherHoldLabel({ kind: 'dependency', subject: 'payments-svc', displayName: 'Dep gate', label: 'x' } as never, 'g')).toEqual({ kind: 'named', text: 'payments-svc' });
		expect(otherHoldLabel({ kind: 'check', displayName: 'Smoke check', label: 'x' }, 'g')).toEqual({ kind: 'named', text: 'Smoke check' });
		expect(otherHoldLabel(null, 'raw-gate')).toEqual({ kind: 'named', text: 'raw-gate' });
	});
});
