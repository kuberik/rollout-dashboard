import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import BlockingStoryPanel from './BlockingStoryPanel.svelte';
import type { BlockingStory, ClassifiedGate } from '$lib/view-models/blocking-story';

/**
 * ⭐ THE HERO GATE CLAIM MUST NOT PRINT BEFORE ITS KIND IS KNOWN.
 * (2026-09-04, load-state audit finding 4) `blockingStory()`'s own tests
 * (`blocking-story.test.ts`) pin the MODEL half of this fix —
 * `kindPending`/`ClassifiedGate.pending` — this file pins the RENDER half:
 * a `kindPending` story must never show `story.consequence` as printed
 * text, on this page's own hero banner.
 */

function pendingCheckGate(): ClassifiedGate {
	return {
		id: 'check-gate-unattributed',
		kind: 'check',
		clears: 'check',
		label: 'check-gate-unattributed',
		clause: 'a check starts passing',
		short: 'A check is not passing',
		clearsAt: null,
		timezone: null,
		subject: null,
		subjectKind: null,
		predicate: null,
		contract: null,
		have: null,
		need: null,
		pending: true
	};
}

function pendingStory(): BlockingStory {
	const gate = pendingCheckGate();
	return {
		blocked: true,
		candidateCount: 1,
		pinnedTo: null,
		pinnedToDisplay: null,
		gates: [gate],
		person: [],
		clock: [],
		upstream: [],
		checks: [gate],
		unknown: [],
		clearsAt: null,
		selfClearing: true,
		headline: 'hello-world-app is held',
		consequence: 'Nothing promotes itself until a check starts passing.',
		verdict: 'This clears on its own once the check passes.',
		resolution:
			'This clears on its own once the check passes. A deploy you start by hand still applies immediately.',
		severity: 'warning',
		iconKind: 'pending',
		kindPending: true
	};
}

describe('BlockingStoryPanel: kindPending withholds the reason line', () => {
	test('the printed message is NOT the possibly-wrong consequence sentence', () => {
		render(BlockingStoryPanel, { props: { story: pendingStory() } });
		expect(screen.queryByText('Nothing promotes itself until a check starts passing.')).toBeNull();
	});

	test('the headline still prints — only the gate-kind-dependent claim is withheld', () => {
		render(BlockingStoryPanel, { props: { story: pendingStory() } });
		expect(screen.getByText('hello-world-app is held')).toBeInTheDocument();
	});

	test('a resolved (non-pending) story prints the consequence as before', () => {
		const gate = { ...pendingCheckGate(), pending: false };
		const story: BlockingStory = {
			...pendingStory(),
			gates: [gate],
			checks: [gate],
			kindPending: false,
			iconKind: 'check'
		};
		render(BlockingStoryPanel, { props: { story } });
		expect(
			screen.getByText('Nothing promotes itself until a check starts passing.')
		).toBeInTheDocument();
	});
});
