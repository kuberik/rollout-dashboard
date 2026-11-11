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
		expect(el?.textContent).toContain('Nothing held');
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
		expect(el?.textContent).toContain('held downstream');
		// batch4 nits: the release line names both ends (releases TO the box WHEN the focus deploys), never "Releases when <the box> deploys"
		expect(el?.textContent).toMatch(/Releases to \S+ when \S+ deploys 4\.45\.0-45/);
		expect(el?.textContent).not.toMatch(/Releases when/);
	});

	test('batch4 nits: an empty held list never dangles an "it", and env names are unbreakable tokens', () => {
		const held = {
			key: 'promotion:eu', side: 'downstream', writer: 'promotion', state: 'blocked', node: node('checkout-api', 'prod-us-east-2'), held: [],
			contract: null, requiredVersion: null, providedVersion: null, cyclic: false, gate: 'promotion-prod', chainPredecessor: false
		} as unknown as NeighbourLink;
		const hood = { focus: node('this-app', 'prod-eu-central'), upstream: [], downstream: [held], gates: [], heldLinks: 1, total: 1, holding: 0, heldBuilds: [] } as unknown as Hood;
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const p = container.querySelector('[data-hood-link="downstream"] p.break-words');
		expect(p?.textContent).toMatch(/deploys its first build$/);
		expect(p?.textContent).not.toMatch(/ it$/);
		const nb = [...(p?.querySelectorAll('span.whitespace-nowrap') ?? [])].map((e) => e.textContent);
		expect(nb).toContain('prod-eu-central');
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
		expect(el?.textContent).toContain('Releases when payments-svc ships');
		expect(el?.textContent).toContain('Open payments-svc');
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
		const { container } = render(RolloutNeighbourhood, { props: { hood } });
		const el = container.querySelector('[data-hood-link="upstream"]');
		expect(el?.textContent).toContain('Releases when staging deploys 4.45.0-45');
		expect(el?.textContent).toContain('Open staging');
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
		expect(el?.textContent).toContain('Releases when someone approves');
		expect(el?.textContent).toContain('How to approve');
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
		expect(el?.textContent).not.toContain('Releases when');
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
		expect(focusBox?.textContent).toContain('Held:');
		expect(focusBox?.textContent).toContain('4.43.0-43');
		// ⭐ qa11b, item 2 correction (squad-rollout gates-2 follow-up,
		// 2026-10-11): "here", never "waits here" — "wait(s)" is reserved
		// for a build merely queued behind an earlier stage.
		expect(focusBox?.textContent).toContain('build here');
		expect(focusBox?.textContent).not.toMatch(/waits?\s+here/i);
		// No chip — a held focus is a word in held ink, never a filled label.
		expect(focusBox?.querySelector('.chip, [class*="chip-"]')).toBeNull();
		expect(focusBox?.textContent).not.toMatch(/held here/i);
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
		expect(focusBox?.textContent).toContain('builds here');
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
		expect(focusBox?.textContent).toContain('No build held here');
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
		expect(label.replace(/\s+/g, ' ')).toBe('Gated by · 1 + dev')
		// A9: one meaning per slot — the predecessor's status line names its KIND (Promotion), never an environment, and the head label stays in the label case
		expect(container.querySelector('.hood-label .normal-case')).toBeNull();
		expect(container.querySelectorAll('.hood-up .hood-list > *').length).toBe(2);
	});
});
