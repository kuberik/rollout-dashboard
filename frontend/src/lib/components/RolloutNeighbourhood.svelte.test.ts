import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import RolloutNeighbourhood from './RolloutNeighbourhood.svelte';
import type { GraphNode } from '$lib/view-models/dependency-graph';
import type { NeighbourLink, RolloutNeighbourhood as Hood } from '$lib/view-models/rollout-neighbourhood';
import type { GateBox } from '$lib/view-models/rollout-gates';

/**
 * ⭐ GATE BOX + LINK ORDERING IN THE UPSTREAM ("Gated by") COLUMN. (2026-10-08.)
 *
 * `RolloutNeighbourhood.svelte` merges `hood.upstream` (links) and `hood.gates`
 * (boxes with no rollout on the far end) into one ordered list: held first on
 * arrival, then links before gate boxes, then name — and in the NARROW
 * (< 672px, the default in jsdom, which has no real layout) layout, held
 * items move LAST, next to the focus. This pins both rules so a regression in
 * the merge/sort — or in `StableOrder`'s reset key, which locks the order in
 * once `schedules`/`healthChecks` resolve a beat after the rollout/list
 * payload does (see that key's own comment) — fails a test instead of only
 * showing up as a box in the wrong place on a live page.
 */

function node(name: string, env: string): GraphNode {
	return {
		id: `c/ns/${name}`,
		cluster: 'c',
		namespace: 'ns',
		name,
		env,
		envRank: 0,
		unresolved: false,
		build: 'b1',
		candidateCount: 0,
		waiting: false,
		blocked: false,
		holds: []
	};
}

function link(o: { key: string; state: 'blocked' | 'clear' | 'unknown'; name: string; writer: 'promotion' | 'contract' }): NeighbourLink {
	return {
		key: o.key,
		side: 'upstream',
		writer: o.writer,
		state: o.state,
		node: node(o.name, 'dev'),
		held: o.state === 'blocked' ? ['b2'] : [],
		contract: o.writer === 'contract' ? 'api' : null,
		requiredVersion: null,
		providedVersion: null,
		cyclic: false,
		gate: `gate-${o.key}`,
		chainPredecessor: false
	};
}

function box(o: { key: string; title: string; state: 'blocked' | 'clear' | 'unknown'; kind: GateBox['kind'] }): GateBox {
	return {
		key: o.key,
		kind: o.kind,
		state: o.state,
		title: o.title,
		kindWord: o.kind === 'schedule' ? 'Deploy window' : o.kind === 'approval' ? 'Approval' : null,
		phrase: o.state === 'blocked' ? 'holding b2' : 'open now',
		held: o.state === 'blocked' ? ['b2'] : [],
		mark: { kind: 'schedule', clears: 'clock' },
		gates: [o.key]
	};
}

const focus = node('this-app', 'dev');

function upstreamKeys(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-hood-link="upstream"]')].map((el) => el.getAttribute('data-key')!);
}

describe('RolloutNeighbourhood: gate boxes and links share one ordered upstream column', () => {
	test('arrival order: held first, then links before gate boxes, then name', () => {
		const heldLink = link({ key: 'link:held', state: 'blocked', name: 'payments-svc', writer: 'contract' });
		const clearPromotion = link({ key: 'link:promo', state: 'clear', name: 'dev-env', writer: 'promotion' });
		const clearContract = link({ key: 'link:contract', state: 'clear', name: 'identity-svc', writer: 'contract' });
		const gateA = box({ key: 'gate:a-approval', title: 'A approval', state: 'clear', kind: 'approval' });
		const gateB = box({ key: 'gate:z-window', title: 'Z window', state: 'clear', kind: 'schedule' });

		const hood: Hood = {
			focus,
			upstream: [clearContract, clearPromotion, heldLink],
			downstream: [],
			gates: [gateB, gateA],
			heldLinks: 1,
			total: 5,
			holding: 1,
			heldBuilds: ['b2']
		};

		const { container } = render(RolloutNeighbourhood, { props: { hood } });

		// ONE order at every width (jsdom renders narrow, 1440 renders wide): the holding link is first, so a phone's fold never slices it;
		// everything else keeps the arrival order: links (promotion, then contract) before gate boxes, gate boxes alphabetically by title.
		expect(upstreamKeys(container)).toEqual([
			'link:held',
			'link:promo',
			'link:contract',
			'gate:gate:a-approval',
			'gate:gate:z-window'
		]);
	});

	test('item 5: a DOWNSTREAM contract tile names the CONSUMER (the far end), and its one status line never invents a provider name (round 4, item 5 — restatements removed, "needs X" only)', () => {
		// The tile's title is the rollout at the FAR end of the edge — for a
		// downstream link that is the CONSUMER (`identity-svc`), the same rule
		// every other tile on this canvas follows (`l.node.name`). The status
		// line used to also restate "this-app (identity)"/"identity-svc
		// (identity)" as a provider/consumer label; round 4 item 5 dropped
		// that restatement (the tile's OWN title already names the party).
		// Round 6 went further: a CLEAR contract link's status line is now
		// just "Nothing held" — the version clause moved to `releaseSentence`,
		// which only ever renders for a HELD tile (nothing to release when
		// clear) — so this pins that neither name, nor a version clause that
		// no longer belongs on a clear tile, appears here.
		const consumer = node('identity-svc', 'staging');
		const gating: NeighbourLink = {
			key: 'contract:gating',
			side: 'downstream',
			writer: 'contract',
			state: 'clear',
			node: consumer,
			held: [],
			contract: 'identity',
			requiredVersion: '^1.0.0',
			providedVersion: '1.2.0',
			cyclic: false,
			gate: 'contract-identity',
			chainPredecessor: false
		};
		const hood: Hood = {
			focus,
			upstream: [],
			downstream: [gating],
			gates: [],
			heldLinks: 0,
			total: 1,
			holding: 0,
			heldBuilds: []
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const el = container.querySelector('[data-hood-link="downstream"]');
		expect(el?.textContent).toContain('identity-svc');
		// Gatehouse: a passing tile says nothing about being clear (no "Nothing held"), no release line; the header names the type, the mark is passed.
		expect(el?.textContent).not.toContain('Nothing held');
		expect(el?.querySelector('[data-gate-release]')).toBeNull();
		expect(el?.getAttribute('data-gate-type')).toBe('dependency');
		expect(el?.querySelector('[data-gate-mark]')?.getAttribute('data-gate-mark')).toBe('newest');
		expect(el?.textContent).not.toContain('this-app (identity)');
		expect(el?.textContent).not.toContain('identity-svc (identity)');
	});

	test('batch4 #2 follow-up: the downstream column is not titled "Gates" and its held mark reads as downstream\'s own hold', () => {
		const held: NeighbourLink = {
			key: 'promotion:eu',
			side: 'downstream',
			writer: 'promotion',
			state: 'blocked',
			node: node('checkout-api', 'prod'),
			held: ['4.45.0-45', '4.44.0-44'],
			contract: null,
			requiredVersion: null,
			providedVersion: null,
			cyclic: false,
			gate: 'promotion-prod',
			chainPredecessor: false
		};
		const hood: Hood = { focus, upstream: [], downstream: [held], gates: [], heldLinks: 1, total: 1, holding: 0, heldBuilds: [] };
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const text = container.textContent ?? '';
		expect(text).toContain('Downstream · 1');
		expect(text).not.toMatch(/Gates · \d/);
		const el = container.querySelector('[data-hood-link="downstream"]');
		// Gatehouse: the downstream place's own hold is the held mark on its tile plus ONE release line naming the focus env and the build
		// ("After <focus env> deploys <build>"), the far end's own env chip in the identity row — never "Releases when <the box> deploys".
		// A downstream tile waits on THIS rollout, it does not hold it: never the held mark ('behind'), the line quiet, the wire drawn clear
		// (data-state keeps the real state).
		expect(el?.querySelector('[data-gate-mark]')?.getAttribute('data-gate-mark')).toBe('behind');
		expect(el?.getAttribute('data-state')).toBe('blocked');
		expect(el?.getAttribute('data-wire-state')).toBe('clear');
		expect(el?.querySelector('[data-gate-release]')).toHaveClass('text-fg-muted');
		expect(el?.querySelector('[data-gate-release]')?.textContent).toMatch(/^After \S+ deploys 4\.45\.0-45$/);
		expect(el?.textContent).not.toMatch(/Releases (to|when)/);
	});

	test('batch4 nits: an empty held list never dangles an "it", and env names are unbreakable tokens', () => {
		const held = {
			key: 'promotion:eu', side: 'downstream', writer: 'promotion', state: 'blocked', node: node('checkout-api', 'prod-us-east-2'), held: [],
			contract: null, requiredVersion: null, providedVersion: null, cyclic: false, gate: 'promotion-prod', chainPredecessor: false
		} as unknown as NeighbourLink;
		const hood = { focus: node('this-app', 'prod-eu-central'), upstream: [], downstream: [held], gates: [], heldLinks: 1, total: 1, holding: 0, heldBuilds: [] } as unknown as Hood;
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const p = container.querySelector('[data-hood-link="downstream"] [data-gate-release]');
		expect(p?.textContent).toMatch(/deploys its first build$/);
		expect(p?.textContent).not.toMatch(/ it$/);
		// the env is named by its chip (one shrink-0 token that never wraps mid-name), with the full env in its title
		const chip = container.querySelector('[data-hood-focus] [title="prod-eu-central"], [data-hood-focus] .shrink-0');
		expect(chip).not.toBeNull();
	});

	test('a gate box carries the link box shell, not a link, with no destination today', () => {
		const hood: Hood = {
			focus,
			upstream: [],
			downstream: [],
			gates: [box({ key: 'gate:window', title: 'Business hours', state: 'blocked', kind: 'schedule' })],
			heldLinks: 0,
			total: 1,
			holding: 1,
			heldBuilds: ['b2']
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const el = container.querySelector('[data-hood-link="upstream"]');
		expect(el?.tagName).toBe('DIV');
		expect(el).toHaveAttribute('data-state', 'blocked');
		expect(el?.textContent).toContain('Business hours');
	});

	/**
	 * ⭐ SPEC §7 (owner-driven, 2026-10-10, round 6): "every holding tile
	 * states its release in words" plus its own action. Pinned here: a held
	 * CONTRACT link states "Releases when … ships …" and draws "Open
	 * <provider>"; a held PROMOTION link names the specific build the
	 * upstream environment has to deploy; a held APPROVAL gate box (no
	 * `Approve` action exists in the product — grepped, none found) becomes
	 * a real link to the docs with a "How to approve" affordance, and a
	 * CLEAR tile states neither (nothing to release).
	 */
	test('SPEC §7: a held contract link states its release condition and draws its action', () => {
		const payments = node('payments-svc', 'platform-prod');
		const held: NeighbourLink = {
			key: 'contract:payments',
			side: 'upstream',
			writer: 'contract',
			state: 'blocked',
			node: payments,
			held: ['4.43.0-43'],
			contract: 'payments',
			requiredVersion: '~2.9.0',
			providedVersion: '2.4.1',
			cyclic: false,
			gate: 'dependency-payments',
			chainPredecessor: false
		};
		const hood: Hood = {
			focus,
			upstream: [held],
			downstream: [],
			gates: [],
			heldLinks: 1,
			total: 1,
			holding: 1,
			heldBuilds: ['4.43.0-43']
		};
		const { container } = render(RolloutNeighbourhood, {
			props: { hood, hrefOf: () => '/rollouts/c/ns/payments-svc' }
		});
		const el = container.querySelector('[data-hood-link="upstream"]');
		expect(el?.tagName).toBe('A');
		// Gatehouse: the tile is the link (no drawn "Open X" button); one release line names the version the provider must reach.
		expect(el?.querySelector('[data-gate-release]')?.textContent).toBe('Needs ~2.9.0');
		expect(el?.textContent).toContain('payments-svc');
		expect(el?.textContent).not.toContain('Open payments-svc');
		expect(el?.getAttribute('data-gate-type')).toBe('dependency');
		expect(el?.querySelector('[class*="pointer-events-none"]')).toBeNull();
	});

	test('SPEC §7: a held promotion link names the specific build the upstream env must deploy', () => {
		const staging = node('checkout-api', 'staging');
		const held: NeighbourLink = {
			key: 'promotion:staging',
			side: 'upstream',
			writer: 'promotion',
			state: 'blocked',
			node: staging,
			held: ['4.45.0-45', '4.44.0-44'],
			contract: null,
			requiredVersion: null,
			providedVersion: null,
			cyclic: false,
			gate: 'promotion-prod',
			chainPredecessor: false
		};
		const hood: Hood = {
			focus,
			upstream: [held],
			downstream: [],
			gates: [],
			heldLinks: 1,
			total: 1,
			holding: 1,
			heldBuilds: ['4.45.0-45', '4.44.0-44']
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood, hrefOf: () => '/rollouts/c/ns/checkout-api' } });
		const el = container.querySelector('[data-hood-link="upstream"]');
		expect(el?.querySelector('[data-gate-release]')?.textContent).toMatch(/^After \S+ deploys 4\.45\.0-45$/);
		expect(el?.querySelector('[data-gate-release]')?.textContent).not.toContain('4.44.0-44');
		expect(el?.tagName).toBe('A');
		expect(el?.textContent).not.toContain('Open staging');
		expect(el?.getAttribute('data-gate-type')).toBe('promotion');
	});

	test('SPEC §7: a held approval gate box has no in-product Approve action, so it links to the docs instead', () => {
		const hood: Hood = {
			focus,
			upstream: [],
			downstream: [],
			gates: [
				{
					...box({ key: 'gate:approval', title: 'Release approval', state: 'blocked', kind: 'approval' }),
					mark: { kind: 'approval', clears: 'person' }
				}
			],
			heldLinks: 0,
			total: 1,
			holding: 1,
			heldBuilds: ['b2']
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const el = container.querySelector('[data-hood-link="upstream"]');
		expect(el?.tagName).toBe('A');
		expect(el).toHaveAttribute('href', 'https://docs.kuberik.com/concepts/gates#approvals');
		// Gatehouse: no fake "How to approve" button; the whole tile is the docs link, marked by an external glyph in the one 28px approval row.
		expect(el?.getAttribute('target')).toBe('_blank');
		expect(el?.getAttribute('data-gate-type')).toBe('approval');
		// no drawn "How to approve" text and no external-link glyph: the dashed "can't approve" slot in the row says it, the line says "Needs approval"
		expect(el?.querySelector('[data-approval-row]')).not.toBeNull();
		expect(el?.querySelector('[data-approve-none]')?.getAttribute('title')).toBe("You can't approve this build here");
		expect(el?.querySelector('[data-gate-release]')?.textContent?.trim()).toBe('Needs approval');
		expect(el?.textContent).not.toContain('How to approve');
		expect(el?.getAttribute('title')).toBe('How to approve a held build');
		expect(el?.querySelector('button')).toBeNull();
	});

	test('SPEC §7: a CLEAR tile states no release sentence and draws no action', () => {
		const payments = node('payments-svc', 'platform-prod');
		const clear: NeighbourLink = {
			key: 'contract:payments-clear',
			side: 'upstream',
			writer: 'contract',
			state: 'clear',
			node: payments,
			held: [],
			contract: 'payments',
			requiredVersion: '~2.9.0',
			providedVersion: '2.9.0',
			cyclic: false,
			gate: 'dependency-payments',
			chainPredecessor: false
		};
		const hood: Hood = {
			focus,
			upstream: [clear],
			downstream: [],
			gates: [],
			heldLinks: 0,
			total: 1,
			holding: 0,
			heldBuilds: []
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const el = container.querySelector('[data-hood-link="upstream"]');
		expect(el?.querySelector('[data-gate-release]')).toBeNull();
		expect(el?.textContent).not.toContain('Needs ');
		expect(el?.textContent).not.toContain('Open payments-svc');
	});
});

/**
 * ⭐ THE FOCUS NODE'S OWN HELD STATE IS WORDS, NEVER THE FILLED "HELD HERE"
 * CHIP. (squad-rollout spec §3, design language §2.7, 2026-10-09.) The
 * owner's held-glyph rule: "Held" carries the fact in held ink, and a filled
 * chip is `STUCK`'s alone — a held focus box used to draw an uppercase
 * `Chip role="held" label="held here"` beside the build, which is exactly
 * the glyph-and-word-together (and filled-chip-for-a-non-stuck-state) shape
 * the rule forbids. This pins that the box states it in prose instead.
 */
describe('RolloutNeighbourhood: the focus node states its own held state in words', () => {
	test('a held focus names the build in held-ink prose, not a chip', () => {
		const hood: Hood = {
			focus,
			upstream: [],
			downstream: [],
			gates: [],
			heldLinks: 0,
			total: 1,
			holding: 1,
			heldBuilds: ['4.43.0-43']
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const focusBox = container.querySelector('[data-hood-focus]');
		const held = focusBox?.querySelector('[data-focus-held]');
		expect(held?.textContent?.replace(/\s+/g, ' ').trim()).toBe('4.43.0-43 held here');
		expect(focusBox?.textContent).not.toContain('Held:');
		// ⭐ qa11b, item 2 correction (squad-rollout gates-2 follow-up,
		// 2026-10-11): "here", never "waits here" — "wait(s)" is reserved
		// for a build merely queued behind an earlier stage.
		expect(focusBox?.textContent).not.toMatch(/waits?\s+here/i);
		// No chip — a held focus is a word in held ink, never a filled label.
		expect(held?.querySelector('.chip, [class*="chip-"]')).toBeNull();
	});

	test('several held builds read the plural noun, still no "wait" and no chip', () => {
		const hood: Hood = {
			focus,
			upstream: [],
			downstream: [],
			gates: [],
			heldLinks: 0,
			total: 1,
			holding: 1,
			heldBuilds: ['4.43.0-43', '4.44.0-44']
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const focusBox = container.querySelector('[data-hood-focus]');
		const held = focusBox?.querySelector('[data-focus-held]');
		// one line, the builds named once, then "held here" (no "N builds here" sentence above a second list)
		expect(held?.textContent).toContain('4.43.0-43');
		expect(held?.textContent).toContain('4.44.0-44');
		expect(held?.textContent).toContain('held here');
		expect(focusBox?.textContent).not.toMatch(/builds here/);
		expect(focusBox?.textContent).not.toMatch(/waits?\s+here/i);
	});

	test('a calm focus (nothing held) still names no build held, no chip', () => {
		const hood: Hood = {
			focus,
			upstream: [],
			downstream: [],
			gates: [],
			heldLinks: 0,
			total: 1,
			holding: 0,
			heldBuilds: []
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const focusBox = container.querySelector('[data-hood-focus]');
		// a calm focus prints nothing: no held line, and no "No build held here" sentence about nothing
		expect(focusBox?.querySelector('[data-focus-held]')).toBeNull();
		expect(focusBox?.textContent).not.toContain('held here');
		expect(focusBox?.textContent).not.toContain('No build held');
		expect(focusBox?.querySelector('.chip, [class*="chip-"]')).toBeNull();
	});
});

/**
 * ⭐ NO APPROVE BUTTON, NO DIALOG. (squad-rollout gates-2 follow-up,
 * 2026-10-11, coordinator correction.) There is no approval endpoint:
 * `ChangeVersionModal` POSTs `/change-version`, which bypasses the gate
 * rather than approving it, so a held APPROVAL gate box must never carry
 * a control that opens that dialog — only the docs-link fallback (SPEC
 * §7), or nothing. This pins the regression a later "give it an action"
 * pass could reintroduce: no `<button>` inside the gate-box tile, and the
 * one link it may carry leaves the product entirely (docs.kuberik.com),
 * never a same-page `ChangeVersionModal`/`ChangeVersionFlow` trigger.
 */
describe('RolloutNeighbourhood: a held approval gate box never opens the change-version dialog', () => {
	test('no button inside the tile, and its one link is the external docs page', () => {
		const approvalBox = box({ key: 'release-approval', title: 'Release approval', state: 'blocked', kind: 'approval' });
		approvalBox.mark = { kind: 'approval', clears: 'person' };
		const hood: Hood = {
			focus,
			upstream: [],
			downstream: [],
			gates: [approvalBox],
			heldLinks: 0,
			total: 1,
			holding: 1,
			heldBuilds: ['b2']
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const tile = container.querySelector('[data-key="gate:release-approval"]');
		expect(tile).not.toBeNull();
		// No interactive control that could POST a change-version request.
		expect(tile!.querySelector('button')).toBeNull();
		// The tile itself may be an `<a>`, but only to the docs host — never
		// a same-page action, and never anything carrying an `onclick`.
		if (tile!.tagName === 'A') {
			expect(tile!.getAttribute('href')).toMatch(/^https:\/\/docs\.kuberik\.com\//);
			expect(tile!.getAttribute('target')).toBe('_blank');
		}
	});
});

/**
 * ⭐ "Gated by · N" EXCLUDES A CHAIN PREDECESSOR TOO (qa11b, item 1,
 * squad-rollout gates-2 follow-up, 2026-10-11). The column head used to add
 * `hood.upstream.length + displayedGates.length` — still counting a chain
 * predecessor (not a real gate for this rollup's purposes) alongside the
 * "Held builds" card's own corrected count, so the canvas read "Gated by · 2"
 * beside a card reading "1 gate holding" for the identical rollout.
 */
describe('RolloutNeighbourhood: "Gated by · N" counts gates only and names the chain predecessor', () => {
	test('chain-predecessor link + real contract link: head counts the gate and names the predecessor (QA #15)', () => {
		const chainLink: NeighbourLink = {
			...link({ key: 'link:chain', state: 'blocked', name: 'staging-env', writer: 'promotion' }),
			chainPredecessor: true
		};
		const realLink = link({ key: 'link:contract', state: 'blocked', name: 'payments-svc', writer: 'contract' });
		const hood: Hood = {
			focus,
			upstream: [chainLink, realLink],
			downstream: [],
			gates: [],
			heldLinks: 1,
			total: 2,
			holding: 1,
			heldBuilds: ['b2']
		};
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const label = container.querySelector('.hood-label')?.textContent ?? '';
		expect(label.replace(/\s+/g, ' ')).toBe('Gated by · 1');
		// the predecessor's env is named in the head's title, not in its text
		expect(container.querySelector('.hood-label [title]')?.getAttribute('title') ?? '').toMatch(/1 gate, after /);
		// A9: one meaning per slot — the predecessor's status line names its KIND (Promotion), never an environment, and the head label stays in the label case
		expect(container.querySelector('.hood-label .normal-case')).toBeNull();
		expect(container.querySelectorAll('.hood-up .hood-list > *').length).toBe(2);
	});
});

/** batch4 #128: the upstream promotion tile names the edge's KIND in its header (type glyph + "Promotion" word, `data-gate-type`). */
describe('RolloutNeighbourhood: a promotion tile draws its kind', () => {
	test('the chain-predecessor status line carries the drawn promotion label', () => {
		const pred = { ...link({ key: 'link:staging', state: 'clear', name: 'app-staging', writer: 'promotion' }), chainPredecessor: true };
		const hood: Hood = { focus, upstream: [pred], downstream: [], gates: [], heldLinks: 0, total: 1, holding: 0, heldBuilds: [] };
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const tile = container.querySelector('[data-hood-link="upstream"]')!;
		// Gatehouse: the 36px header names the kind (type word + glyph); a passed predecessor is never drawn held and never says "Nothing held".
		// AD r2: the type is a glyph + sr-only "Promotion:" word on the tile root (`data-gate-type`), no visible header.
		expect(tile.getAttribute('data-gate-type')).toBe('promotion');
		expect(tile.querySelector('.sr-only')?.textContent).toContain('Promotion');
		expect(tile.querySelector('[data-gate-mark]')?.getAttribute('data-gate-mark')).toBe('newest');
		expect(tile.textContent).not.toContain('Nothing held');
		expect(tile.querySelector('[data-gate-release]')).toBeNull();
	});
	test('QA71 Q5: a gate box that is a promotion draws its label, not the published sentence (GateBox.title is only the plain form)', () => {
		const SENTENCE = 'Previous environment not ready yet';
		const box = { key: 'gate:ghd', kind: 'gate', state: 'blocked', title: 'Promotion from staging', kindWord: null, phrase: 'waiting', held: [], mark: { kind: 'check', clears: 'check' }, gates: ['ghd'], label: { kind: 'promotion', source: 'staging' } };
		const hood = { focus, upstream: [], downstream: [], gates: [box], heldLinks: 0, total: 0, holding: 0, heldBuilds: [] } as unknown as Hood;
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const drawn = container.querySelector('[data-gate-label="promotion"][data-gate-source="staging"]');
		expect(drawn, 'the box draws the label').not.toBeNull();
		const c = container.cloneNode(true) as Element;
		c.querySelectorAll('.sr-only,[aria-hidden="true"]').forEach((n) => n.remove());
		expect(c.textContent).not.toContain('Promotion from');
		expect(container.textContent).not.toContain(SENTENCE);
	});
});

describe('RolloutNeighbourhood: Gatehouse tile details', () => {
	const winBox = (over: Record<string, unknown>) =>
		({
			...box({ key: 'schedule:w', title: 'Business hours', state: 'blocked', kind: 'schedule' }),
			window: { action: 'Allow', timezone: 'UTC', rules: [{ timeRange: { start: '09:00', end: '17:00' }, dateRange: { start: '2000-01-01', end: '2000-01-02' } }], active: false, when: 'Mon 09:00 UTC' },
			...over
		}) as GateBox;
	const renderBox = (b: GateBox) =>
		render(RolloutNeighbourhood, { props: { hood: { focus, upstream: [], downstream: [], gates: [b], heldLinks: 0, total: 1, holding: 1, heldBuilds: ['b2'] } as unknown as Hood } }).container;

	test('a holding window draws its shut hours in held ink, the now tick held, and the words on the held line', () => {
		const c = renderBox(winBox({}));
		const tile = c.querySelector('[data-hood-link="upstream"]');
		expect(tile?.getAttribute('data-gate-type')).toBe('window');
		expect(tile?.querySelector('[data-window-bar] .gh-bar-shut')).not.toBeNull();
		expect(tile?.querySelector('[data-window-bar] .gh-bar-now')).toHaveClass('gh-bar-now--held');
		expect(tile?.querySelector('[data-gate-release]')?.textContent?.trim()).toBe('Closed · opens Mon 09:00 UTC');
	});

	test('a passing window draws the bar with no shut spans and no caption line (the words are in the title)', () => {
		const c = renderBox(winBox({ state: 'clear', held: [], window: { action: 'Allow', timezone: 'UTC', rules: [{}], active: true, when: 'Fri 18:00 UTC' } }));
		const tile = c.querySelector('[data-hood-link="upstream"]');
		expect(tile?.querySelector('[data-window-bar]')).not.toBeNull();
		expect(tile?.querySelector('.gh-bar-shut')).toBeNull();
		expect(tile?.querySelector('[data-gate-release]')).toBeNull();
		expect(tile?.getAttribute('title')).toContain('Open · closes Fri 18:00 UTC');
	});

	test('a Deny schedule is a freeze tile, held line "Frozen · until …"', () => {
		const c = renderBox(winBox({ window: { action: 'Deny', timezone: 'UTC', rules: [{}], active: true, when: 'Mon 06:00 UTC' } }));
		const tile = c.querySelector('[data-hood-link="upstream"]');
		expect(tile?.getAttribute('data-gate-type')).toBe('freeze');
		expect(tile?.querySelector('[data-gate-release]')?.textContent?.trim()).toBe('Frozen · until Mon 06:00 UTC');
	});

	test('a held dependency says "Needs <requiredVersions[0]>", preferring it over requiredVersion; without either, "Needs a newer version"', () => {
		const dep = (over: Partial<NeighbourLink>): NeighbourLink => ({
			...link({ key: 'contract:p', state: 'blocked', name: 'payments-svc', writer: 'contract' }),
			...over
		});
		const text = (l: NeighbourLink) =>
			render(RolloutNeighbourhood, { props: { hood: { focus, upstream: [l], downstream: [], gates: [], heldLinks: 1, total: 1, holding: 1, heldBuilds: ['b2'] } as unknown as Hood } }).container
				.querySelector('[data-hood-link="upstream"] [data-gate-release]')?.textContent?.trim();
		expect(text(dep({ requiredVersions: ['^3.0.0', '~2.9.0'], requiredVersion: '~2.9.0' }))).toBe('Needs ^3.0.0');
		expect(text(dep({ requiredVersions: [], requiredVersion: '~2.9.0' }))).toBe('Needs ~2.9.0');
		expect(text(dep({ requiredVersions: undefined, requiredVersion: null }))).toBe('Needs a newer version');
	});

	test('a promotion tile carries its build in the title, not in the tile: "Open <app> in <env> (runs <build>)"', () => {
		const l = { ...link({ key: 'promotion:s', state: 'clear', name: 'this-app', writer: 'promotion' }), node: { ...node('this-app', 'staging'), build: '4.45.0-45' } } as NeighbourLink;
		const { container } = render(RolloutNeighbourhood, {
			props: { hood: { focus, upstream: [l], downstream: [], gates: [], heldLinks: 0, total: 1, holding: 0, heldBuilds: [] } as unknown as Hood, hrefOf: () => '/rollouts/c/ns/this-app' }
		});
		const tile = container.querySelector('[data-hood-link="upstream"]');
		expect(tile?.getAttribute('title')).toBe('Open this-app in staging (runs 4.45.0-45)');
		expect(tile?.querySelector('[data-gate-version]')).toBeNull();
	});
});
