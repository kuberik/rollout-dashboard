import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import BlockedRow, { blockedBuild, blockedFact } from './BlockedRow.svelte';
import type { RolloutCard } from '$lib/rollout-cards';

/** A held rollout: 7b3c9f1 RUNS; 4a8d2e6 is the candidate an approval gate refuses. */
const heldCard = {
	name: 'telemetry-indexer',
	ns: 'telemetry-indexer-prod',
	envDisplay: 'prod',
	theme: null,
	statusKey: 'succeeded',
	checkFailure: null,
	version: '7b3c9f1',
	timestamp: new Date().toISOString(),
	stuck: null,
	rollout: {
		metadata: { name: 'telemetry-indexer', namespace: 'telemetry-indexer-prod' },
		status: {
			history: [{ version: { tag: '7b3c9f1', version: '7b3c9f1' }, timestamp: new Date().toISOString(), bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ tag: '7b3c9f1', version: '7b3c9f1' },
				{ tag: '4a8d2e6', version: '4a8d2e6' }
			],
			releaseCandidates: [{ tag: '4a8d2e6', version: '4a8d2e6' }],
			gates: [{ name: 'approval', passing: false, allowedVersions: [] }]
		}
	}
} as unknown as RolloutCard;

describe('BlockedRow', () => {
	// ⭐ shared/approval-words (2026-10-12, coordinator ruling). Was: "names
	// the build that WAITS, not the one that runs" — the old fix only
	// dropped the running sha, leaving a reader no way to tell the two
	// builds apart at all. The full fix names BOTH, each labelled, so
	// neither can be mistaken for the other.
	it('a held row names both builds — the one that runs, and the one that waits', () => {
		expect(blockedBuild(heldCard, 'held')).toBe('running 7b3c9f1 · 4a8d2e6 waits for you');
		const { container } = render(BlockedRow, { card: heldCard, kind: 'held', href: '/r' });
		expect(container.textContent).toContain('running 7b3c9f1');
		expect(container.textContent).toContain('4a8d2e6 waits for you');
		expect(container.textContent).toContain('Waiting on an approval in prod');
	});
	it('a failed row names what runs, and the row is one link', () => {
		const failed = { ...heldCard, name: 'checkout-worker', statusKey: 'failed', version: 'a02f1c4', envDisplay: 'staging' } as unknown as RolloutCard;
		expect(blockedFact(failed, 'failed')).toBe('Deploy failed');
		const { container } = render(BlockedRow, { card: failed, kind: 'failed', href: '/x' });
		expect(container.querySelectorAll('a')).toHaveLength(1);
		expect(container.querySelector('a.tap-link')?.getAttribute('href')).toBe('/x');
		expect(container.textContent).toContain('a02f1c4');
	});
	it('the palette size is one 40px line with no action', () => {
		const { container } = render(BlockedRow, {
			card: heldCard,
			kind: 'held',
			href: '/r',
			size: 'palette',
			action: { label: 'Review', run: () => {} }
		});
		expect(container.querySelector('.br')?.className).toContain('h-10');
		expect(container.querySelector('button')).toBeNull();
	});
});

describe('BlockedRow held cause', () => {
	it('takes the classified story through holdCausePhrase', () => {
		const story = { gates: [{}], blocked: true, person: [{}], unknown: [], upstream: [] } as never;
		expect(blockedFact(heldCard, 'held', story)).toBe('Waiting on an approval in prod');
	});
});

describe('BlockedRow palette wrap', () => {
	it('gives the fact its own line below sm without leaving the palette density', () => {
		const { container } = render(BlockedRow, { card: heldCard, kind: 'held', href: '/r', size: 'palette', wrap: true });
		const row = container.querySelector('.br')!;
		expect(row.className).toContain('sm:h-10');
		expect(row.className).toContain('flex-wrap');
		expect(container.querySelector('.basis-full .dot-list')).not.toBeNull();
		expect(container.querySelector('button')).toBeNull();
	});
});

import { heldSentence } from './BlockedRow.svelte';
describe('heldSentence', () => {
	it('speaks the state first, sentence case, place after', () => {
		expect(heldSentence('\u0000 is waiting for ledger-core 2.4.0', 'staging')).toBe('Waiting for ledger-core 2.4.0 in staging');
		expect(heldSentence('\u0000 is held', 'prod')).toBe('Held in prod');
		expect(heldSentence('', 'prod')).toBe('Waiting on an approval in prod');
	});
});

import { createRawSnippet } from 'svelte';
describe('BlockedRow palette squeeze order and trailing', () => {
	const trailing = createRawSnippet(() => ({ render: () => '<span data-trailing>Open logs</span>' }));
	it('the chip gives way before the name in the palette; the card row keeps both fixed', () => {
		const pal = render(BlockedRow, { card: heldCard, kind: 'held', href: '/r', size: 'palette' }).container;
		const name = pal.querySelector('a.tap-link')!;
		expect(name.className).toMatch(/(^|\s)shrink(\s|$)/);
		expect(name.className).not.toContain('shrink-0');
		expect(pal.querySelector('.shrink-\\[1000\\]')).not.toBeNull();
		const card = render(BlockedRow, { card: heldCard, kind: 'held', href: '/r' }).container;
		expect(card.querySelector('.shrink-\\[1000\\]')).toBeNull();
		expect(card.querySelector('a.tap-link')!.className).not.toMatch(/(^|\s)shrink(\s|$)/);
	});
	it('renders trailing last on the single line', () => {
		const { container } = render(BlockedRow, { card: heldCard, kind: 'held', href: '/r', size: 'palette', trailing });
		const row = container.querySelector('.br')!;
		expect(row.lastElementChild!.querySelector('[data-trailing]')).not.toBeNull();
	});
	it('with wrap, trailing ends the fact line (line 2 below sm, line 1 from sm)', () => {
		const { container } = render(BlockedRow, { card: heldCard, kind: 'held', href: '/r', size: 'palette', wrap: true, trailing });
		const factLine = container.querySelector('.basis-full')!;
		expect(factLine.lastElementChild!.className).toContain('ms-auto');
		expect(factLine.lastElementChild!.querySelector('[data-trailing]')).not.toBeNull();
	});
	it('no trailing, no wrapper', () => {
		const { container } = render(BlockedRow, { card: heldCard, kind: 'held', href: '/r', size: 'palette', wrap: true });
		expect(container.querySelector('.ms-auto')).toBeNull();
	});
});

describe('BlockedRow: an approval hold wears the approval mark (home-map, 2026-10-11)', () => {
	it('approval: the person mark, never the orange pause of a rule hold', () => {
		const { container } = render(BlockedRow, { card: heldCard, kind: 'held', href: '#', approval: true });
		expect(container.querySelector('.sm-ask')).not.toBeNull();
		expect(container.querySelector('.ring-held-line')).toBeNull();
	});
	it('a rule hold keeps the pause', () => {
		const { container } = render(BlockedRow, { card: heldCard, kind: 'held', href: '#' });
		expect(container.querySelector('.sm-ask')).toBeNull();
		expect(container.querySelector('.ring-held-line')).not.toBeNull();
	});
});
