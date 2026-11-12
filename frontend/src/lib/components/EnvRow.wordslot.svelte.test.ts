import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import EnvRow from './EnvRow.svelte';
import PromotionLane from './PromotionLane.svelte';
import { laneOf } from './new/Footprint.svelte';

// NOTHING MOVES AS STATE CHANGES (owner 2026-11-12): a strip box keeps its width when its state word appears or goes.
// jsdom has no layout, so this pins the mechanism (the same invisible words under the real one, in every state) and the
// rules it hangs on; the measured result (0px across every beat, App view + Rollout overview, 390 and 1440) is in the PR.
const SLOT = ['Failing', 'Stuck', 'Deploying', 'Checking', 'Held', 'Waiting'];

describe('EnvRow word slot', () => {
	for (const sites of [false, true]) {
		it(`a box reserves the same ghost words with and without a state word (${sites ? 'sites' : 'plain'} box)`, () => {
			const mk = (word?: string) => ({
				key: 'prod',
				label: 'prod',
				word,
				wordSlot: SLOT,
				...(sites ? { sites: [{ key: 'a', name: 'a', wave: null, state: 'done' as const, word: 'Deployed' }] } : {})
			});
			const quiet = render(EnvRow, { cells: [mk(undefined)] }).container;
			const loud = render(EnvRow, { cells: [mk('Deploying')] }).container;
			const ghosts = (c: HTMLElement) => [...c.querySelectorAll('[data-env-word-slot] .env-word-ghost')].map((g) => g.textContent);
			expect(ghosts(quiet)).toEqual(SLOT);
			expect(ghosts(loud)).toEqual(SLOT);
			expect(quiet.querySelector('.env-word')).toBeNull();
			expect(loud.querySelector('[data-env-word-slot] .env-word')?.textContent).toBe('Deploying');
			// the mark's slot too (a plain box): present with and without a mark
			if (!sites) expect(quiet.querySelectorAll('.env-mk').length).toBe(1);
		});
	}
	it('a box without a slot is still its content (other surfaces keep their natural width)', () => {
		const { container } = render(EnvRow, { cells: [{ key: 'prod', label: 'prod', word: 'Checking' }] });
		expect(container.querySelector('[data-env-word-slot]')).toBeNull();
		expect(container.querySelector('.env-word')?.textContent).toBe('Checking');
	});
	it('the slot is hidden by the same container rules as the word, and its ghosts take no height', () => {
		const src = readFileSync('src/lib/components/EnvRow.svelte', 'utf8');
		expect(src).toContain('.env-word-slot { display: none; }');
		expect(src).toMatch(/\.env-word-ghost \{\s*visibility: hidden;\s*height: 0;/);
		expect(src).toMatch(/\.env-word-slot > \* \{\s*grid-area: 1 \/ 1;/);
	});
});

const place = (tier: string, over: Record<string, unknown> = {}) => ({ env: tier, label: tier, tier, state: 'healthy', href: `/${tier}`, version: 'bbb', onNewest: true, onBuild: true, currency: 'newest', ...over });
const laneIn = (state: string) =>
	laneOf(
		{ app: 'a', newest: 'bbb', placeList: [place('dev'), place('staging', { state }), place('prod')] } as never,
		{ apps: [] } as never,
		[{ t: 1, app: 'a', sha: 'bbb' }] as never
	).lane;

describe('PromotionLane: every box has the slot in every state', () => {
	for (const fill of ['L', 'M'] as const) {
		it(`same slot words for healthy / checking / deploying / failed (fill ${fill}), word only when adverse`, () => {
			const seen = new Set<string>();
			for (const state of ['healthy', 'checking', 'deploying', 'failed']) {
				const { container } = render(PromotionLane, { props: { lane: laneIn(state), hrefFor: () => '/x', fill } as never });
				for (const t of ['dev', 'staging', 'prod']) {
					const slot = container.querySelector(`[data-tier="${t}"] [data-env-word-slot]`);
					expect(slot, `${t} in ${state}`).not.toBeNull();
					seen.add([...slot!.querySelectorAll('.env-word-ghost')].map((g) => g.textContent).join('|'));
				}
			}
			expect([...seen]).toEqual([SLOT.join('|')]);
		});
	}
});
