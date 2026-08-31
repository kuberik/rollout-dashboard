import { describe, it, expect } from 'vitest';
import { upToDateHeadline, upToDateCaption } from './up-to-date';

/**
 * ⛔ THE SPLICE. (`/apps`, live critique 2026-08-31)
 *
 *     0 of 3 up to date
 *     in all 3 environments
 *
 * Two lines of one object, printed together, saying opposite things. The
 * second is the tail of the `All up to date` sentence and was reached by
 * fall-through out of a chain that had nothing else to say.
 */
describe('UpToDate never completes the wrong headline', () => {
	const CONVERGED_BEHIND = {
		onHead: 0,
		deployed: 3,
		total: 3,
		spread: 1,
		pending: 0,
		diverged: 0,
		unknown: 0
	};

	it('THE REPORTED PAIR — converged but behind never says `in all N environments`', () => {
		expect(upToDateHeadline(CONVERGED_BEHIND)).toBe('0 of 3 up to date');
		expect(upToDateCaption(CONVERGED_BEHIND)).not.toContain('in all');
		expect(upToDateCaption(CONVERGED_BEHIND)).toBe('all 3 on one older version');
	});

	it('keeps `in all N environments` where it belongs — and only there', () => {
		const current = { ...CONVERGED_BEHIND, onHead: 3 };
		expect(upToDateHeadline(current)).toBe('All up to date');
		expect(upToDateCaption(current)).toBe('in all 3 environments');
	});

	it('the caption never contradicts the headline, over the whole grid', () => {
		// The invariant, not the instance: `in all …` is a claim that
		// everything is current, so it may appear ONLY under `All up to date`.
		for (let deployed = 1; deployed <= 4; deployed++) {
			for (let onHead = 0; onHead <= deployed; onHead++) {
				for (const spread of [1, 2]) {
					for (const pending of [0, 1]) {
						const f = { onHead, deployed, total: deployed + pending, spread, pending };
						const caption = upToDateCaption(f);
						if (caption.startsWith('in all')) {
							expect(upToDateHeadline(f)).toBe('All up to date');
						}
					}
				}
			}
		}
	});

	it('still leads with the facts a distance cannot carry', () => {
		expect(upToDateCaption({ onHead: 1, deployed: 3, total: 3, spread: 2 })).toBe(
			'2 versions live'
		);
		expect(upToDateCaption({ onHead: 1, deployed: 2, total: 3, spread: 1, pending: 1 })).toBe(
			'1 never deployed'
		);
		expect(upToDateCaption({ onHead: 0, deployed: 1, total: 1, spread: 1, diverged: 1 })).toBe(
			'1 unreleased'
		);
	});

	it('says nothing about currency when nothing is deployed', () => {
		const none = { onHead: 0, deployed: 0, total: 2, spread: 1 };
		expect(upToDateHeadline(none)).toBe('Never deployed');
		expect(upToDateCaption(none)).toBe('2 environments waiting');
	});

	it('declines the plural on one', () => {
		expect(upToDateCaption({ onHead: 1, deployed: 1, total: 1, spread: 1 })).toBe(
			'in all 1 environment'
		);
		expect(upToDateCaption({ onHead: 0, deployed: 0, total: 1, spread: 1 })).toBe(
			'1 environment waiting'
		);
	});
});
