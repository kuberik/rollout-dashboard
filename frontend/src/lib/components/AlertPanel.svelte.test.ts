import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import AlertPanel from './AlertPanel.svelte';
import BlockingStoryPanel from './BlockingStoryPanel.svelte';
import BlockingStoryLines from './BlockingStoryLines.svelte';
import { blockingStory, buildGateContext } from '$lib/view-models/blocking-story';
import { rollbackWent, rollbackNext, rollbackStory } from '$lib/view-models/auto-deploy';

/**
 * ⭐ THE DISCLOSURE IS A CONTRACT, NOT AN ACCIDENT. (2026-08-31)
 *
 * ── WHAT THE HUMAN SAID, AND WHAT IT MEASURED ────────────────────────────
 *
 * *"I feel like we're rendering too much text by default for these alert style
 * blocks."* At 390 on `/rollouts/dev/hello-dep-dev/hello-frontend-app`, each
 * `AlertPanel` was **226px tall, 314 characters, 50 words**, and two stacked —
 * the gate banner and the rollback panel — spending **456px of an 844px
 * viewport before the status card that says what is actually deployed**. On a
 * phone the page opened on prose.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * Every sentence in those blocks was written to fix a real defect, and
 * `lib/messages/` pins most of them. So the fix was DISCLOSURE, not deletion:
 * the footnote moved behind a `<details>` inside the banner. That guard —
 * `subject.svelte.test.ts` and `truth.test.ts` walk `textContent`, which
 * includes a closed `<details>` — is exactly why the message suite kept
 * passing unchanged, and it is ALSO why the suite cannot tell the difference
 * between "disclosed" and "printed".
 *
 * Nothing else in the product would notice if a future edit swapped the
 * `<details>` back for a printed `<p>` (the defect returns silently) or for
 * `{#if expanded}` (the fact becomes unreachable, and the message suite goes
 * red for a reason nobody can read). Both directions are pinned here.
 */

const SUMMARY = 'summary';

function detailsHolding(text: string): HTMLDetailsElement {
	const node = screen.getByText(text, { exact: false });
	const details = node.closest('details');
	expect(details, `"${text}" is not inside a <details>`).not.toBeNull();
	return details as HTMLDetailsElement;
}

describe('AlertPanel: the footnote is available, not printed', () => {
	test('the footnote is in the DOM, inside a closed <details>', () => {
		render(AlertPanel, {
			props: {
				severity: 'warning',
				title: 'Automatic deploys are paused',
				message: 'Health checks are unhealthy.',
				footnote: 'A deploy you start by hand still applies immediately.'
			}
		});

		// REACHABLE. The message suite's axis walk and the truth matrix both
		// read `textContent`, so this is the property that lets a pinned
		// sentence move tier without the assertion moving with it.
		const details = detailsHolding('A deploy you start by hand still applies immediately.');
		expect(details.open).toBe(false);
	});

	test('the headline and the consequence are NOT disclosed — they are the printed tier', () => {
		render(AlertPanel, {
			props: {
				severity: 'warning',
				title: 'Automatic deploys are paused',
				message: 'Health checks are unhealthy.',
				footnote: 'A deploy you start by hand still applies immediately.'
			}
		});
		expect(screen.getByText('Automatic deploys are paused').closest('details')).toBeNull();
		expect(screen.getByText('Health checks are unhealthy.').closest('details')).toBeNull();
	});

	test('the control is labelled, and `Details` is the honest default', () => {
		render(AlertPanel, {
			props: { severity: 'info', title: 'Rolled back', footnote: 'Rolled back by admin.' }
		});
		const details = detailsHolding('Rolled back by admin.');
		expect(details.querySelector(SUMMARY)?.textContent?.trim()).toBe('Details');
	});

	test('a caller that knows the kind says the kind', () => {
		render(AlertPanel, {
			props: {
				severity: 'info',
				title: 'Rolled back',
				footnote: 'Rolled back by admin.',
				footnoteLabel: 'What happens next'
			}
		});
		expect(detailsHolding('Rolled back by admin.').querySelector(SUMMARY)?.textContent).toContain(
			'What happens next'
		);
	});

	test('no footnote, no control — an empty disclosure is a control that teaches nothing', () => {
		const { container } = render(AlertPanel, {
			props: { severity: 'info', title: 'Recovery mode', message: 'Failures will not fail this.' }
		});
		expect(container.querySelector('details')).toBeNull();
	});
});

describe('BlockingStoryPanel: the verdict and the rule handle are the disclosed tier', () => {
	/**
	 * The live state on `hello-dep-dev/hello-frontend-app`, which is what was
	 * measured: one upstream dependency gate, one candidate waiting.
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

	// The dependency join is what makes the gate an `upstream` one rather than
	// an `unknown` one. It is the live shape: a `RolloutDependency` whose
	// `status.gateName` is the gate holding the rollout.
	const ctx = buildGateContext({
		environments: { items: [] },
		rolloutDependencies: {
			items: [
				{
					metadata: { name: 'hello-frontend-needs-api', namespace: 'hello-dep-dev' },
					spec: { providerRef: { name: 'hello-api-app' }, contract: 'api' },
					status: { gateName: 'dependency-hello-frontend-needs-api', providedVersion: '1.66.0' }
				}
			]
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);

	test('the headline and the consequence print; the verdict and `rule:` do not', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		// ⛔ THE FIXTURE HAS TO ACTUALLY BE BLOCKED. `BlockingStoryPanel`
		// renders NOTHING when it is not, and every assertion below would then
		// be vacuously true against an empty banner.
		expect(story.blocked).toBe(true);
		// ⭐ (2026-09-03) A lone contract gate now names its provider the same
		// way a two-gate bucket of the same kind does — see
		// `blocking-story.ts`'s `upstreamHeadline`. This fixture's dependency
		// carries no `blockedReleases`, so `need` is null and the sentence
		// falls back to "a newer api" rather than a spelled-out range.
		expect(story.headline).toBe('DEV is waiting for hello-api-app to ship a newer api');
		render(BlockingStoryPanel, { props: { story } });

		// PRINTED — the fact with its subject, and one consequence line.
		expect(screen.getByText(story.headline).closest('details')).toBeNull();
		expect(screen.getByText(story.consequence).closest('details')).toBeNull();

		// DISCLOSED — the mechanism and the generated object id an operator
		// cannot act on directly. Still in the DOM: `subject.svelte.test.ts`
		// proves the axis, `truth.test.ts` proves the state.
		const details = detailsHolding(story.resolution);
		expect(details.open).toBe(false);
		// ⭐ THE HANDLE IS A `Rule` FIELD NOW, NOT `· rule: <id>` GLUED TO THE
		// END OF A SENTENCE. (2026-09-02) The id itself is the assertion: it is
		// the string an operator pastes after `kubectl`, and it must stay
		// reachable whatever shape the record takes.
		expect(details.textContent).toContain('dependency-hello-frontend-needs-api');
		expect(details.textContent).toContain('Rule');
		// THE CONTROL IS LABELLED, AND THE LABEL IS A NOUN. (2026-09-01) The
		// human on the old wording: *"i'm not sure i particularly like that
		// format 'what clears this'."* `/environments` was printing four
		// disclosures in one viewport, all four asking the same question. What
		// this test is for is unchanged and is the half that matters: the
		// summary must carry TEXT, because a chevron on its own is an
		// unlabelled control and the footnote behind it becomes unreachable to
		// anyone who cannot see the arrow.
		//
		// ⭐ AND IT IS THE COUNT FORM. (2026-09-02) It said `Details` while the
		// CARD scale of the same gates said `1 rule`, 90px below it on
		// `/environments`. `lib/disclosure.ts` owns the choice now.
		expect(details.querySelector(SUMMARY)?.textContent?.trim()).toBe('1 rule');
	});

	test('the manual-deploy clause is never lost, only moved', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		render(BlockingStoryPanel, { props: { story } });
		// The promise that stops a reader treating every banner as an outage.
		// It is also stated again inside `ChangeVersionModal`, where the
		// decision is actually made (`manualDeployNote`).
		//
		// ⛔ NOT THE GENERIC SENTENCE FOR THIS FIXTURE. (2026-09-03, coordinator
		// follow-up) This rollout is held by a CONTRACT gate, and
		// `upstreamVerdict` now states the hand-started-deploy escape hatch
		// itself — `resolution` no longer appends the generic
		// `A deploy you start by hand still applies immediately.` on top of
		// it, because that read as the identical fact twice back to back.
		// The clause is still never LOST — it rides in the verdict's own
		// sentence instead.
		expect(document.body.textContent).toContain(
			'the only way forward is a hand-started deploy, which bypasses the check'
		);
		expect(document.body.textContent).not.toContain(
			'A deploy you start by hand still applies immediately.'
		);
	});
});

describe('the rollback splits into two tiers and loses nothing', () => {
	const back = { from: '2.67.0-67', to: '2.66.0-66', by: 1 };

	test('`rollbackStory` still returns the two halves assembled, verbatim', () => {
		for (const state of [
			{ paused: true, reasons: ['pin'] as const, gateNames: [] },
			{ paused: false, reasons: [] as const, gateNames: [] },
			{ paused: true, reasons: ['gates'] as const, gateNames: [] }
		]) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const s = state as any;
			expect(rollbackStory(back, s)).toBe(`${rollbackWent(back, s)} ${rollbackNext(back, s)}`);
		}
	});

	test('the printed half names BOTH versions — that is the fact the banner exists for', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const went = rollbackWent(back, { paused: true, reasons: ['gates'], gateNames: [] } as any);
		expect(went).toContain('2.67.0-67');
		expect(went).toContain('2.66.0-66');
		// ⛔ AND IT DOES NOT CARRY THE MECHANISM. On the live rollout that half
		// said *"a rule is holding it"* directly under an amber banner already
		// saying *"Nothing promotes itself until hello-api-app ships a newer
		// api than 1.66.0"* — one fact, twice, in two colours, stacked.
		expect(went).not.toContain('a rule is holding it');
	});
});

/**
 * ⭐ THE RECORD TIER, PINNED IN BOTH DIRECTIONS. (2026-09-02)
 *
 * `footnoteBody` is the second shape the disclosure can hold, and it has the
 * same two failure modes the paragraph had — and the same reason nothing else
 * in the product would notice either of them:
 *
 *   · printed instead of disclosed  → the defect returns silently, because the
 *     message suite walks `textContent` and a printed `<dl>` reads identically
 *     to a disclosed one.
 *   · unmounted instead of hidden   → every field becomes unreachable to
 *     `lib/messages/` WHILE THE SUITE STAYS GREEN. That is precisely why
 *     `RulePopover` is a native `<details>` and not flowbite's `<Popover>`.
 */
describe('AlertPanel: a record is disclosed, not printed — and stays reachable', () => {
	test('the fields are in the DOM, inside a closed <details>', () => {
		render(AlertPanel, {
			props: {
				severity: 'error',
				title: 'Cannot reach the dashboard server',
				message: 'This is a failed request, not an empty result.',
				footnoteBody: createRawSnippet(() => ({
					render: () => '<dl><dt>Address</dt><dd>/api/rollouts</dd></dl>'
				}))
			}
		});
		const details = detailsHolding('/api/rollouts');
		expect(details.open).toBe(false);
		// REACHABLE. The label is half the fact: a value with no field name is
		// a string nobody can interpret.
		expect(details.textContent).toContain('Address');
	});

	test('the headline and the consequence are still the PRINTED tier', () => {
		render(AlertPanel, {
			props: {
				severity: 'error',
				title: 'Cannot reach the dashboard server',
				message: 'This is a failed request, not an empty result.',
				footnoteBody: createRawSnippet(() => ({ render: () => '<dl><dd>x</dd></dl>' }))
			}
		});
		expect(screen.getByText('Cannot reach the dashboard server').closest('details')).toBeNull();
		expect(
			screen.getByText('This is a failed request, not an empty result.').closest('details')
		).toBeNull();
	});

	test('no body and no footnote, no control — an empty disclosure teaches nothing', () => {
		const { container } = render(AlertPanel, {
			props: { severity: 'info', title: 'Recovery mode', message: 'Failures will not fail this.' }
		});
		expect(container.querySelector('details')).toBeNull();
	});
});

/**
 * ⭐ THE TRIGGER GRAMMAR. One rule, stated in `lib/disclosure.ts`, and the
 * reason it is stated once is that it has now collapsed twice: five question
 * shapes for one control (2026-09-01), then `Details` at banner scale against
 * `N rules` at card scale on the same content one viewport apart (2026-09-02).
 */
describe('the disclosure trigger: a count for a SET, a noun for one record', () => {
	function summaryOf(props: Record<string, unknown>): string {
		const { container } = render(AlertPanel, {
			props: { title: 'x', footnote: 'y', ...props } as never
		});
		return container.querySelector(SUMMARY)?.textContent?.trim() ?? '';
	}

	test('a count of one is singular, and it is still the count form', () => {
		// ⛔ NOT `Details`. A one-gate banner and a two-gate banner must not read
		// as different KINDS of control.
		expect(summaryOf({ footnoteCount: 1 })).toBe('1 rule');
	});

	test('a count of more than one pluralises, in one place', () => {
		expect(summaryOf({ footnoteCount: 3 })).toBe('3 rules');
	});

	test('the noun is the caller-s, because only the caller knows what it counted', () => {
		expect(summaryOf({ footnoteCount: 2, footnoteNoun: 'service' })).toBe('2 services');
		expect(summaryOf({ footnoteCount: 1, footnoteNoun: 'contract' })).toBe('1 contract');
	});

	test('no count, no noun: `Details` is still the honest default for a sentence', () => {
		expect(summaryOf({})).toBe('Details');
	});
});

/**
 * ⭐ THE DEFECT THE HUMAN NAMED, PINNED AS ONE ASSERTION. (2026-09-02)
 *
 * *"There are few more 'details' that have not been redesigned."* On
 * `/environments` at 1440 the banner and the card below it render the SAME
 * gates off the SAME story, 90px apart, and they read `Details` and `2 rules`.
 * Nothing in the product could see that, because each object's own tests were
 * green: the inconsistency lives BETWEEN them.
 */
describe('the banner and the card are one affordance over one content', () => {
	const rollout = {
		metadata: { name: 'hello-frontend-app', namespace: 'hello-dep-dev' },
		spec: {},
		status: {
			history: [{ version: { tag: '1.66.0' } }],
			releaseCandidates: [{ tag: '1.67.0' }],
			gates: [{ name: 'dependency-hello-frontend-needs-api', allowedVersions: [] }],
			conditions: [{ type: 'GatesPassing', status: 'False' }]
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
	const ctx = buildGateContext({
		environments: { items: [] },
		rolloutDependencies: {
			items: [
				{
					metadata: { name: 'hello-frontend-needs-api', namespace: 'hello-dep-dev' },
					spec: { providerRef: { name: 'hello-api-app' }, contract: 'api' },
					status: { gateName: 'dependency-hello-frontend-needs-api', providedVersion: '1.66.0' }
				}
			]
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);

	function summaryText(container: HTMLElement): string {
		return container.querySelector(SUMMARY)?.textContent?.trim() ?? '';
	}

	test('both scales spell the trigger the same way, over the same gates', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		expect(story.blocked).toBe(true);
		const banner = render(BlockingStoryPanel, { props: { story } });
		expect(summaryText(banner.container)).toBe('1 rule');
		banner.unmount();
		const card = render(BlockingStoryLines, { props: { story } });
		expect(summaryText(card.container)).toBe('1 rule');
	});

	test('both scales hold a RECORD, and the gate handle is in both', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		const banner = render(BlockingStoryPanel, { props: { story } });
		const bannerRecord = banner.container.querySelector('details');
		expect(bannerRecord?.open).toBe(false);
		expect(bannerRecord?.querySelector('dl')).not.toBeNull();
		expect(bannerRecord?.textContent).toContain('dependency-hello-frontend-needs-api');
		// ⛔ AND THE BANNER DOES NOT REPEAT ITS OWN PRINTED CONSEQUENCE. The
		// record holds what the banner does not: `consequence` already carries
		// every gate's clause, so no gate gets a `Clears` row at banner scale.
		expect(bannerRecord?.textContent).not.toContain('Clears');
		banner.unmount();

		const card = render(BlockingStoryLines, { props: { story } });
		const cardRecord = card.container.querySelector('details');
		expect(cardRecord?.open).toBe(false);
		expect(cardRecord?.querySelector('dl')).not.toBeNull();
		expect(cardRecord?.textContent).toContain('dependency-hello-frontend-needs-api');
	});
});
