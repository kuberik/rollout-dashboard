import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import BlockingStoryLines, { gateMark, gateKindWord } from './BlockingStoryLines.svelte';
import BlockReason, { contractBlockReason } from './BlockReason.svelte';
import { blockingStory, buildGateContext, classifyGate } from '$lib/view-models/blocking-story';
import {
	CalendarWeekSolid,
	ChevronDoubleRightOutline,
	QuestionCircleSolid,
	ShareNodesSolid,
	ShieldCheckSolid,
	UserCircleSolid,
	HourglassSolid,
	ArrowRightAltSolid
} from 'flowbite-svelte-icons';

/**
 * ⭐ THE CARD-SCALE HALF OF THE SAME CONTRACT. (2026-08-31, rewritten 2026-09-02)
 *
 * `AlertPanel.svelte.test.ts` pins the disclosure for the PAGE-level banner.
 * This file pins it for the two objects that say the same thing inside a
 * CARD, and it exists for the identical reason: `subject.svelte.test.ts` and
 * `truth.test.ts` walk `textContent`, which includes a closed `<details>`, so
 * the message suite cannot tell "disclosed" from "printed". Both directions
 * have to be pinned here or neither is pinned anywhere.
 *
 * ── WHAT THE 2026-09-02 PASS CHANGED, AND WHY EACH DIRECTION IS PINNED ────
 *
 * From the human, on this exact row:
 *
 *   *"still don't like these details when we have this nonsense icon. i feel
 *   like you could better visualize this rather than just putting ascii icons
 *   in there"*
 *   *"i think i also don't like 'details' expansion. it's formatted just as
 *   text when in some cases it could be more richly formatted. i think maybe
 *   a popover would be better?"*
 *
 * Three things moved, and each one can regress silently:
 *
 *  1. **The mark now names the OBJECT.** `gateMark` is exported so the choice
 *     is arguable in a test rather than buried in markup. The two that were
 *     wrong are pinned NEGATIVELY as well: an hourglass over a `check` means
 *     *time will fix this*, which is `clock`'s meaning and the very
 *     distinction `check` exists to draw; a bare arrow over `upstream` stood
 *     for two different mechanisms at once.
 *
 *  2. **The dependency clause is DRAWN, and its sentence is not printed
 *     beside it.** One fact drawn twice is the defect this branch has paid
 *     for repeatedly. So the row must show the provider and both versions AND
 *     must NOT show `short` — while `short` must still be in the DOM, because
 *     `lib/messages/` reads it.
 *
 *  3. **The control is a popover, and it is still a `<details>`.** Flowbite's
 *     `<Popover>` renders `{#if isOpen}`: a closed one has no DOM. Swapping it
 *     in would make every string here unreachable to the census WHILE THE
 *     SUITE STAYED GREEN — the exact failure `AlertPanel.svelte.test.ts` was
 *     written to catch. `details.open === false` plus `textContent` is what
 *     proves the mechanism, and the click test is what proves a keyboard and
 *     touch user can actually get at it.
 */

const SUMMARY = 'summary';

function detailsHolding(text: string): HTMLDetailsElement {
	const node = screen.getByText(text, { exact: false });
	const details = node.closest('details');
	expect(details, `"${text}" is not inside a <details>`).not.toBeNull();
	return details as HTMLDetailsElement;
}

/**
 * The live state on `hello-dep-dev/hello-frontend-app` — one upstream
 * dependency gate, one candidate waiting. Same fixture as the banner suite, on
 * purpose: the card and the banner render ONE story, and a fixture drift
 * between the two files would hide exactly the disagreement both exist to stop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rollout: any = {
	metadata: { name: 'hello-frontend-app', namespace: 'hello-dep-dev' },
	spec: {},
	status: {
		history: [{ version: { tag: '1.66.0' } }],
		releaseCandidates: [{ tag: '1.67.0' }],
		gates: [{ name: 'dependency-hello-frontend-needs-api', allowedVersions: [] }],
		conditions: [{ type: 'GatesPassing', status: 'False' }]
	}
};

const ctx = buildGateContext({
	environments: { items: [] },
	rolloutDependencies: {
		items: [
			{
				metadata: { name: 'hello-frontend-needs-api', namespace: 'hello-dep-dev' },
				spec: { providerRef: { name: 'hello-api-app' }, contract: 'api' },
				status: {
					gateName: 'dependency-hello-frontend-needs-api',
					providedVersion: '1.66.0',
					blockedReleases: [
						{ tag: 'rel-67', requiredVersion: '^1.67.0', reason: 'ConstraintNotSatisfied' }
					]
				}
			}
		]
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// A gate with NO second party: not passing, no schedule join. `subject` is
// null, so this is the branch where the sentence legitimately survives.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const checkOnly: any = {
	...rollout,
	status: { ...rollout.status, gates: [{ name: 'some-probe', passing: false }] }
};

describe('the mark names its KIND, and the two that did not are pinned negatively', () => {
	test('each kind gets a mark that is true of that kind', () => {
		expect(gateMark({ kind: 'dependency', clears: 'upstream' })).toBe(ShareNodesSolid);
		expect(gateMark({ kind: 'promotion', clears: 'upstream' })).toBe(ChevronDoubleRightOutline);
		expect(gateMark({ kind: 'schedule', clears: 'clock' })).toBe(CalendarWeekSolid);
		expect(gateMark({ kind: 'approval', clears: 'person' })).toBe(UserCircleSolid);
		expect(gateMark({ kind: 'unknown', clears: 'unknown' })).toBe(QuestionCircleSolid);
		expect(gateMark({ kind: 'check', clears: 'check' })).toBe(ShieldCheckSolid);
	});

	test('an hourglass never stands for a `check` — that is `clock`’s meaning', () => {
		// `check` is "not passing, and NOTHING published a window": self-clearing
		// but unschedulable. An hourglass promises a clock this gate does not
		// have, and it promises it in the one place a reader looks first.
		expect(gateMark({ kind: 'check', clears: 'check' })).not.toBe(HourglassSolid);
	});

	test('the two `upstream` mechanisms never share one mark', () => {
		// A cross-service contract and a promotion order clear the same way and
		// are not the same thing. One bare arrow for both named neither.
		const dep = gateMark({ kind: 'dependency', clears: 'upstream' });
		const promo = gateMark({ kind: 'promotion', clears: 'upstream' });
		expect(dep).not.toBe(promo);
		expect([dep, promo]).not.toContain(ArrowRightAltSolid);
	});

	test('the record names the kind as a NOUN, never as a remedy', () => {
		expect(gateKindWord({ kind: 'dependency' })).toBe('service contract');
		expect(gateKindWord({ kind: 'schedule' })).toBe('deploy window');
		expect(gateKindWord({ kind: 'unknown' })).toBe('not attributed');
	});
});

describe('BlockingStoryLines: the clause is DRAWN, and drawn only once', () => {
	test('the provider and BOTH contract versions are printed, structurally', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		// ⛔ THE FIXTURE HAS TO ACTUALLY BE BLOCKED, or every assertion below is
		// vacuously true against an empty render.
		expect(story.blocked).toBe(true);
		expect(story.gates).toHaveLength(1);
		render(BlockingStoryLines, { props: { story } });

		// THE OBJECT THAT HAS TO MOVE, at full ink and outside the popover.
		expect(screen.getByText('hello-api-app').closest('details')).toBeNull();
		// THE CONTRACT AND ITS TWO ENDS. `api` renders through `.chip`, which
		// uppercases in CSS, so the DOM text is the lowercase contract name.
		expect(screen.getByText('api').closest('details')).toBeNull();
		expect(screen.getByText('1.66.0').closest('details')).toBeNull();
		expect(screen.getByText('^1.67.0').closest('details')).toBeNull();
	});

	test('and the sentence it replaces is NOT printed beside its own picture', () => {
		// ⛔ ONE FACT DRAWN TWICE is the failure this pass exists to avoid — a
		// handle printed five times on `/environments`, a rollback panel
		// restating the banner above it. If the drawing carries the fact, the
		// sentence goes.
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		render(BlockingStoryLines, { props: { story } });
		const clause = screen.getByText(story.gates[0].short, { exact: false });
		expect(
			clause.closest('details'),
			'the drawn clause and its sentence are both in the printed tier'
		).not.toBeNull();
	});

	test('a gate with NO shape keeps its sentence in the printed tier', () => {
		// The argued half of the answer. `check`, `approval` and `unknown` name
		// no second party; their only concrete object is the gate's generated id,
		// which this product deliberately took out of the printed tier. Prose is
		// what you use when you have no shape.
		const story = blockingStory(checkOnly, ctx, { subject: 'DEV' });
		expect(story.gates[0].subject).toBeNull();
		render(BlockingStoryLines, { props: { story } });
		expect(screen.getByText('A check is not passing').closest('details')).toBeNull();
	});
});

describe('BlockingStoryLines: the popover holds a RECORD, and it is in the DOM closed', () => {
	test('the sentence, the verdict and the handle are all inside ONE closed <details>', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		const { container } = render(BlockingStoryLines, { props: { story } });

		const details = detailsHolding(story.verdict);
		// ⭐ THE PROPERTY THE MESSAGE SUITE DEPENDS ON. A closed `<details>` still
		// has its subtree, so `truth.test.ts` and `subject.svelte.test.ts` read a
		// fact that is genuinely one keystroke away. A component that rendered
		// `{#if open}` would delete both assertions and turn nothing red.
		expect(details.open).toBe(false);
		expect(details.textContent).toContain('dependency-hello-frontend-needs-api');
		expect(details.textContent).toContain(story.gates[0].short);
		// ONE CONTROL PER INSTANCE — four in one `/environments` viewport was
		// noise of its own.
		expect(container.querySelectorAll('details')).toHaveLength(1);
	});

	test('the record is a definition list, not a paragraph', () => {
		// The human on the old form: *"it's formatted just as text when in some
		// cases it could be more richly formatted."* The content is a RECORD —
		// which rule, what kind, what clears it, and the raw name for `kubectl` —
		// and it is drawn as one.
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		const { container } = render(BlockingStoryLines, { props: { story } });
		const dl = container.querySelector('dl');
		expect(dl).not.toBeNull();
		const terms = Array.from(dl!.querySelectorAll('dt')).map((t) => t.textContent?.trim());
		expect(terms).toEqual(['Kind', 'Clears', 'Rule']);
		expect(dl!.textContent).toContain('service contract');
	});

	test('the trigger is a <summary>: focusable, clickable, and it COUNTS', () => {
		// KEYBOARD AND TOUCH, not hover. A `<summary>` is focusable by default,
		// Enter and Space activate it, and a tap is a click — which is what makes
		// this reachable at 390 where a hover popover is not reachable at all.
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		const { container } = render(BlockingStoryLines, { props: { story } });
		const details = container.querySelector('details') as HTMLDetailsElement;
		const summary = details.querySelector(SUMMARY) as HTMLElement;
		expect(summary.textContent?.trim()).toBe('1 rule');
		expect(details.open).toBe(false);
		summary.click();
		expect(details.open).toBe(true);
	});

	test('the label counts the rules, and the singular is not the plural', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const two: any = {
			...rollout,
			status: {
				...rollout.status,
				gates: [
					{ name: 'dependency-hello-frontend-needs-api', allowedVersions: [] },
					{ name: 'ghd-5b2wn', allowedVersions: [] }
				]
			}
		};
		const story = blockingStory(two, ctx, { subject: 'PROD' });
		expect(story.gates.length).toBe(2);
		const { container } = render(BlockingStoryLines, { props: { story } });
		expect(container.querySelectorAll('details')).toHaveLength(1);
		expect(container.querySelector(SUMMARY)?.textContent?.trim()).toBe('2 rules');
		// BOTH handles are behind that one control, each on its own `Rule` row.
		expect(container.querySelector('details')?.textContent).toContain('ghd-5b2wn');
	});

	test('the per-gate handle survives as a `title` on its own clause', () => {
		// The record cannot say WHICH gate produced WHICH row when there are two.
		// This can, and it costs no pixels. It is an ADDITION to the popover and
		// never a substitute: a `title` is unreachable on a phone, which is why
		// the `<details>` above is the load-bearing one.
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		const { container } = render(BlockingStoryLines, { props: { story } });
		expect(container.querySelector('li')).toHaveAttribute(
			'title',
			'The rule holding this: dependency-hello-frontend-needs-api'
		);
	});
});

describe('BlockReason: the consequence prints, the generated name does not', () => {
	test('the short form prints its sentence and discloses the record', () => {
		const { container } = render(BlockReason, {
			props: { awaiting: ['dependency-hello-frontend-needs-api', 'ghd-5b2wn'] }
		});

		// PRINTED.
		expect(screen.getByText('No newer version is allowed yet').closest('details')).toBeNull();

		// DISCLOSED, and reachable — not a tooltip. `ghd-5b2wn` exists to be
		// pasted after `kubectl get`; a `title` alone is unreachable on a phone
		// and uncopyable everywhere.
		const details = container.querySelector('details');
		expect(details).not.toBeNull();
		expect((details as HTMLDetailsElement).open).toBe(false);
		expect(details?.textContent).toContain('dependency-hello-frontend-needs-api');
		expect(details?.textContent).toContain('ghd-5b2wn');
		expect(details?.querySelector(SUMMARY)?.textContent).toContain('2 rules');
		// THE LONG CONSEQUENCE IS THE RECORD'S `Clears` ROW, and it is the only
		// place the short form renders it at all.
		expect(details?.textContent).toContain('No newer version is on this rule');
	});

	// THE LABEL IS A NOUN AND IT COUNTS. (2026-09-01) It was `Which rule` /
	// `Which rules` — an interrogative, one of the five different question
	// shapes the product had grown for ONE control. `BlockingStoryLines` said
	// `Details` for the same affordance until 2026-09-02, so one control had two
	// grammars one viewport apart on `/environments`; both are the count form
	// now, which is the `Show 8 ready resources ›` shape
	// `COMPOSITION-GRAMMAR.md` §8 names.
	test('the label says the KIND, and it counts', () => {
		const { container } = render(BlockReason, { props: { notPassing: ['schedule-gate-fk44d'] } });
		expect(container.querySelector(SUMMARY)?.textContent?.trim()).toBe('1 rule');
	});

	test('a branch with no handle draws no control and no empty tooltip', () => {
		// `pinned` short-circuits with `names: null`. A disclosure whose body
		// is empty is a control that lies about having something behind it.
		const { container } = render(BlockReason, { props: { pinnedTo: '2.66.0-66' } });
		expect(container.querySelector('details')).toBeNull();
		expect(container.querySelector('[title]')).toBeNull();
	});

	test('the contract branch DRAWS its three facts and discloses its sentence', () => {
		const reason = contractBlockReason({
			provider: 'hello-api-app',
			contract: 'api',
			requiredVersion: '^1.67.0',
			providedVersion: '1.66.0',
			gateName: 'dependency-hello-frontend-needs-api',
			reason: 'ConstraintNotSatisfied'
		});
		const { container } = render(BlockReason, { props: { reason } });

		expect(screen.getByText('hello-api-app').closest('details')).toBeNull();
		expect(screen.getByText('api').closest('details')).toBeNull();
		expect(screen.getByText('1.66.0').closest('details')).toBeNull();
		expect(screen.getByText('^1.67.0').closest('details')).toBeNull();
		// The sentence the picture replaced is in the record, not beside it.
		expect(screen.getByText(reason.line, { exact: false }).closest('details')).not.toBeNull();
		// ⛔ THE CONTROLLER'S ENUM IS ITS OWN ROW, NEVER GLUED TO THE GATE NAME.
		// `dependency-… · ConstraintNotSatisfied` read as one object name, and
		// the count form would then have to explain why one rule looked like two.
		expect(reason.names).toBe('dependency-hello-frontend-needs-api');
		expect(container.querySelector(SUMMARY)?.textContent?.trim()).toBe('1 rule');
		expect(container.querySelector('details')?.textContent).toContain('ConstraintNotSatisfied');
	});

	test('a contract with only one end known keeps the sentence printed', () => {
		// ⛔ NEVER DRAW HALF A RELATION. An absent `providedVersion` says the gate
		// has not READ one; it does not say the provider is behind.
		const reason = contractBlockReason({
			provider: 'hello-api-app',
			contract: 'api',
			requiredVersion: '^1.67.0',
			providedVersion: null,
			gateName: 'dependency-hello-frontend-needs-api'
		});
		render(BlockReason, { props: { reason } });
		expect(screen.getByText(reason.line, { exact: false }).closest('details')).toBeNull();
	});
});

describe('the story and the row cannot disagree, because the row is the story split', () => {
	test('`subject` + `predicate` reassemble into `clause`, verbatim', () => {
		const g = classifyGate(
			{ name: 'dependency-hello-frontend-needs-api', allowedVersions: [] },
			'hello-dep-dev',
			ctx
		);
		expect(g.subject).toBe('hello-api-app');
		expect(g.contract).toBe('api');
		expect(g.have).toBe('1.66.0');
		expect(g.need).toBe('^1.67.0');
		expect(`${g.subject} ${g.predicate}`).toBe('hello-api-app ships a newer api');
	});
});
