import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import BlockingStoryPanel from './BlockingStoryPanel.svelte';
import { NOT_BLOCKED, type BlockingStory, type ClassifiedGate } from '$lib/view-models/blocking-story';

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

/**
 * ⭐ A `null` TITLE OVERRIDE FALLS BACK TO `story.headline` — INCLUDING WHILE
 * THE BANNER IS COLLAPSING. (2026-10-10, QA finding.) The rollout detail
 * page's Overview banner passes `title={holdCausePhrase(blockStory, {...})}`
 * straight through — no `|| ` of its own. `holdCausePhrase` used to return
 * `''` for "nothing is held", and `''` is not nullish, so
 * `title={titleOverride ?? story.headline}` below never reached the
 * fallback: the instant a held rollout cleared, `blockStory` flipped to
 * `NOT_BLOCKED` (whose own `headline` is also `''`), `holdCausePhrase`
 * handed the panel that same empty string, and the headline went BLANK for
 * the frame the banner was collapsing out, instead of keeping the held
 * story's own words on screen (`story` here is frozen to the last blocked
 * value precisely so the collapse does not re-render from the cleared one —
 * see this file's own `let story = $state.raw(...)` and its comment).
 * `holdCausePhrase` now returns `null` for that case (see its own doc
 * comment), which IS nullish, so the fallback fires correctly.
 */
function personBlockedStory(): BlockingStory {
	const gate: ClassifiedGate = {
		id: 'manual-approval',
		kind: 'approval',
		clears: 'person',
		label: 'manual-approval',
		clause: 'someone approves it',
		short: 'Needs a person to approve',
		clearsAt: null,
		timezone: null,
		subject: null,
		subjectKind: null,
		predicate: null,
		contract: null,
		have: null,
		need: null
	};
	return {
		blocked: true,
		candidateCount: 1,
		pinnedTo: null,
		pinnedToDisplay: null,
		gates: [gate],
		person: [gate],
		clock: [],
		upstream: [],
		checks: [],
		unknown: [],
		clearsAt: null,
		selfClearing: false,
		headline: 'prod is waiting on an approval',
		consequence: 'Nothing promotes itself until someone approves it.',
		verdict: 'Someone has to approve this before it can promote.',
		resolution:
			'Someone has to approve this before it can promote. A deploy you start by hand still applies immediately.',
		severity: 'warning',
		iconKind: 'person',
		kindPending: false
	};
}

describe('BlockingStoryPanel: title=null falls back to story.headline, even through the collapse', () => {
	test('while blocked, a null title shows story.headline (the ordinary gate-only banner)', () => {
		render(BlockingStoryPanel, { props: { story: personBlockedStory(), title: null, open: true } });
		expect(screen.getByText('prod is waiting on an approval')).toBeInTheDocument();
	});

	test('once cleared, a null title (what holdCausePhrase now returns for "nothing held") keeps the FROZEN headline through the collapse — never blank', async () => {
		const { rerender } = render(BlockingStoryPanel, {
			props: { story: personBlockedStory(), title: null, open: true }
		});
		expect(screen.getByText('prod is waiting on an approval')).toBeInTheDocument();
		await rerender({ story: { ...NOT_BLOCKED }, title: null, open: false });
		expect(screen.getByText('prod is waiting on an approval')).toBeInTheDocument();
	});
});
