import { describe, it, expect } from 'vitest';
import { dedupedConsequences, heldExplanation } from './HeldBanner.svelte';
import type { BlockingStory } from '$lib/view-models/blocking-story';

function story(consequence: string): BlockingStory {
	return { consequence } as unknown as BlockingStory;
}

describe('dedupedConsequences — finding 3 (name every gate, once each)', () => {
	it('keeps one sentence per distinct cause', () => {
		const out = dedupedConsequences([
			story('Nothing promotes itself until hello-api-app ships a newer api than 1.66.0.'),
			story('Nothing promotes itself until hello-world-manual-approval clears.')
		]);
		expect(out).toEqual([
			'Nothing promotes itself until hello-api-app ships a newer api than 1.66.0.',
			'Nothing promotes itself until hello-world-manual-approval clears.'
		]);
	});

	it('collapses TWO held places blocked by the identical contract to ONE sentence', () => {
		// hello-frontend-app in prod AND staging both carry `allowedVersions:
		// []` gates for the same missing api version — the exact live-cluster
		// shape finding 3 names. Without the dedupe this would print the same
		// clause twice, once per place.
		const sameCause = 'Nothing promotes itself until hello-api-app ships a newer api than 1.66.0.';
		const out = dedupedConsequences([story(sameCause), story(sameCause)]);
		expect(out).toEqual([sameCause]);
	});

	it('drops empty consequences and returns an empty list for nothing held', () => {
		expect(dedupedConsequences([])).toEqual([]);
		expect(dedupedConsequences([story('')])).toEqual([]);
	});
});

describe('heldExplanation — finding 3 (indefinite vs waiting)', () => {
	it('passes the sentence through unchanged when the hold is not indefinite', () => {
		const s = 'Nothing promotes itself until hello-api-app ships a newer api than 1.66.0.';
		expect(heldExplanation([story(s)], false)).toBe(s);
	});

	it('appends the indefinite clause when no newer build of the dependency exists anywhere', () => {
		const s = 'Nothing promotes itself until hello-api-app ships a newer api than 1.66.0.';
		const out = heldExplanation([story(s)], true);
		expect(out).toContain(s);
		expect(out).toMatch(/held indefinitely/);
		expect(out).not.toBe(s);
	});

	it('is the empty string, not a dangling "held indefinitely" fragment, when nothing is held', () => {
		expect(heldExplanation([], true)).toBe('');
	});
});
