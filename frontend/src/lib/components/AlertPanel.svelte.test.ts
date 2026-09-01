import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import AlertPanel from './AlertPanel.svelte';
import BlockingStoryPanel from './BlockingStoryPanel.svelte';
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
		expect(story.headline).toBe('DEV is waiting on another deploy');
		render(BlockingStoryPanel, { props: { story } });

		// PRINTED — the fact with its subject, and one consequence line.
		expect(screen.getByText(story.headline).closest('details')).toBeNull();
		expect(screen.getByText(story.consequence).closest('details')).toBeNull();

		// DISCLOSED — the mechanism and the generated object id an operator
		// cannot act on directly. Still in the DOM: `subject.svelte.test.ts`
		// proves the axis, `truth.test.ts` proves the state.
		const details = detailsHolding(story.resolution);
		expect(details.open).toBe(false);
		expect(details.textContent).toContain('rule: dependency-hello-frontend-needs-api');
		// THE CONTROL IS LABELLED, AND THE LABEL IS A NOUN. (2026-09-01) The
		// human on the old wording: *"i'm not sure i particularly like that
		// format 'what clears this'."* `/environments` was printing four
		// disclosures in one viewport, all four asking the same question. What
		// this test is for is unchanged and is the half that matters: the
		// summary must carry TEXT, because a chevron on its own is an
		// unlabelled control and the footnote behind it becomes unreachable to
		// anyone who cannot see the arrow.
		expect(details.querySelector(SUMMARY)?.textContent?.trim()).toBe('Details');
	});

	test('the manual-deploy clause is never lost, only moved', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		render(BlockingStoryPanel, { props: { story } });
		// The promise that stops a reader treating every banner as an outage.
		// It is also stated again inside `ChangeVersionModal`, where the
		// decision is actually made (`manualDeployNote`).
		expect(document.body.textContent).toContain(
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
