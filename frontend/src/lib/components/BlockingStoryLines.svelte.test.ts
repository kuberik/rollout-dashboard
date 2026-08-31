import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import BlockingStoryLines from './BlockingStoryLines.svelte';
import BlockReason from './BlockReason.svelte';
import { blockingStory, buildGateContext } from '$lib/view-models/blocking-story';

/**
 * ⭐ THE CARD-SCALE HALF OF THE SAME CONTRACT. (2026-08-31)
 *
 * `AlertPanel.svelte.test.ts` pins the disclosure for the PAGE-level banner.
 * This file pins it for the two objects that say the same thing inside a
 * CARD, and it exists for the identical reason: `subject.svelte.test.ts` and
 * `truth.test.ts` walk `textContent`, which includes a closed `<details>`, so
 * the message suite cannot tell "disclosed" from "printed". Both directions
 * have to be pinned here or neither is pinned anywhere.
 *
 * ── WHAT WAS MEASURED, AND WHY IT IS A REPETITION BUG ────────────────────
 *
 * The human, after the banner pass: *"also too much raw text in some other
 * places."* At 1440 on the live cluster, in ONE viewport:
 *
 *   `/environments`   `rule: dependency-hello-frontend-needs-api` 3×, plus
 *                     `rule: ghd-9qcnj` and `rule: ghd-5b2wn` — FIVE handle
 *                     lines — and *"Nobody has to approve anything — this
 *                     clears when the deploy in front of it lands."* 3×.
 *   `/apps/<name>`    the same five handles and the same verdict 3×, inside
 *                     ONE card titled *"Waiting, nothing to do"* — i.e. the
 *                     verdict was the card's own title, restated per row.
 *   `/envs/prod`      `rule: dependency-hello-frontend-needs-api, ghd-5b2wn`
 *                     wrapped to THREE lines in a 205px cell, with
 *                     `break-all` splitting `ghd-5b2wn` mid-name, AND the
 *                     banner 250px above printing both names again.
 *
 * One fact printed N times in one viewport is worse than one long sentence.
 * Nothing was deleted: every string is still produced by its view-model, still
 * pinned by `truth.test.ts`, and still in the DOM here.
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
				status: { gateName: 'dependency-hello-frontend-needs-api', providedVersion: '1.66.0' }
			}
		]
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

describe('BlockingStoryLines: the clause prints, the verdict and the handle do not', () => {
	test('every gate clause is printed and none of them is inside the disclosure', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		// ⛔ THE FIXTURE HAS TO ACTUALLY BE BLOCKED, or every assertion below is
		// vacuously true against an empty render.
		expect(story.blocked).toBe(true);
		expect(story.gates).toHaveLength(1);
		render(BlockingStoryLines, { props: { story } });

		// PRINTED — the one line that says what is actually holding this
		// rollout. This is the line the cut exists to protect; it must never
		// end up behind the control that was added to make room for it.
		const clause = screen.getByText(story.gates[0].short, { exact: false });
		expect(clause.closest('details')).toBeNull();
	});

	test('the verdict and the `rule:` handle are in the DOM, inside ONE closed <details>', () => {
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		render(BlockingStoryLines, { props: { story } });

		const details = detailsHolding(story.verdict);
		expect(details.open).toBe(false);
		expect(details.textContent).toContain('rule: dependency-hello-frontend-needs-api');
		expect(details.querySelector(SUMMARY)?.textContent).toContain('What clears this');
	});

	test('ONE control per instance — not one per gate line', () => {
		// The reason this is pinned: porting the banner's disclosure per GATE
		// would have put four controls in one `/environments` viewport, which
		// is its own kind of noise. Two gates, one control.
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
		// BOTH handles are behind that one control — a joined list, the same
		// string `BlockingStoryPanel`'s footnote carries.
		expect(container.querySelector('details')?.textContent).toContain('ghd-5b2wn');
	});

	test('the per-gate handle survives as a `title` on its own clause', () => {
		// The joined list in the disclosure cannot say WHICH gate produced
		// WHICH clause. This can, and it costs no pixels. It is an ADDITION to
		// the disclosure and never a substitute: a `title` is unreachable on a
		// phone, which is why the `<details>` above is the load-bearing one.
		const story = blockingStory(rollout, ctx, { subject: 'DEV' });
		const { container } = render(BlockingStoryLines, { props: { story } });
		expect(container.querySelector('li')).toHaveAttribute(
			'title',
			'The rule holding this: dependency-hello-frontend-needs-api'
		);
	});
});

describe('BlockReason: the consequence prints, the generated name does not', () => {
	test('the short form prints its sentence and discloses the handle', () => {
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
		expect(details?.textContent).toContain('rule: dependency-hello-frontend-needs-api, ghd-5b2wn');
		expect(details?.querySelector(SUMMARY)?.textContent).toContain('Which rules');
	});

	test('the label says the KIND, and it counts', () => {
		const { container } = render(BlockReason, { props: { notPassing: ['schedule-gate-fk44d'] } });
		expect(container.querySelector(SUMMARY)?.textContent).toContain('Which rule');
		expect(container.querySelector(SUMMARY)?.textContent).not.toContain('Which rules');
	});

	test('a branch with no handle draws no control and no empty tooltip', () => {
		// `pinned` short-circuits with `names: null`. A disclosure whose body
		// is empty is a control that lies about having something behind it.
		const { container } = render(BlockReason, { props: { pinnedTo: '2.66.0-66' } });
		expect(container.querySelector('details')).toBeNull();
		expect(container.querySelector('[title]')).toBeNull();
	});
});
