/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import ControlCenter from '$lib/ControlCenter.svelte';
import RolloutGrid from '$lib/RolloutGrid.svelte';
import Apps from '../../routes/apps/+page.svelte';
import Environments from '../../routes/environments/+page.svelte';
import Activity from '../../routes/activity/+page.svelte';
import { fleet, respond } from './fleet-fixture';
import { BAKE_WORD } from '$lib/bake-status';

/**
 * TWO PROPERTIES THAT ARE ABOUT PAIRS OF SENTENCES RATHER THAN ONE.
 *
 *   A. A CONTROL'S VISIBLE TEXT, ITS `title` AND ITS `aria-label` AGREE.
 *      A badge and its tooltip disagreed for hours on this branch. A tooltip
 *      is not a second opinion; a screen-reader name is not a third.
 *
 *   B. ADJACENT SURFACES DO NOT CONTRADICT EACH OTHER ABOUT ONE FACT.
 *      This is the finding that opened both critiques: `/apps` said
 *      "This will not clear on its own" while rollout detail said it cleared
 *      at 1:00 PM, and `/rollouts` said `Attention 0` on a fleet `/` filed
 *      under Trailing. Six months of that is why the view-models were
 *      extracted; this is the test that keeps them shared.
 */

afterEach(() => vi.unstubAllGlobals());

const PAGES: Array<[string, unknown]> = [
	['/', ControlCenter],
	['/rollouts', RolloutGrid],
	['/apps', Apps],
	['/environments', Environments],
	['/activity', Activity]
];

async function mount(Comp: unknown, payload = fleet()) {
	vi.stubGlobal('fetch', vi.fn(respond(payload)));
	const r = render(WithQueryClient, { props: { component: Comp as any } });
	await waitFor(() => expect(screen.getAllByText(/alpha-app|r1aaaaa/i).length).toBeGreaterThan(0), {
		timeout: 5000
	});
	return r;
}

/** Words that mean the same thing, so `checking` and `is being watched` agree. */
const SYNONYM: Array<[RegExp, RegExp]> = [
	[/^deploy succeeded$/, /finished and passed its checks|succeeded/i],
	[/^deploy failed$/, /fail/i],
	[/^checking$/, /(being watched|check)/i],
	[/^deploying$/, /(going out|deploy)/i],
	[/^stopped$/, /stopped/i],
	[/^no deploy yet$/, /(nothing has been deployed|no deploy)/i]
];

describe('a control says one thing in text, in title and to a screen reader', () => {
	for (const [name, Comp] of PAGES) {
		test(`${name}: no title or aria-label contradicts the text beside it`, async () => {
			const { container } = await mount(Comp);
			const problems: string[] = [];

			for (const el of Array.from(container.querySelectorAll('[title], [aria-label]'))) {
				const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
				if (!text) continue;
				const title = el.getAttribute('title')?.trim() ?? '';
				const aria = el.getAttribute('aria-label')?.trim() ?? '';

				// A LABEL WITH NOTHING IN IT. `Cluster  — the Kubernetes cluster
				// these rollouts run on` was a real one: the mark drew the word
				// `cluster` and then an empty span.
				for (const [attr, v] of [
					['title', title],
					['aria-label', aria]
				] as const) {
					if (!v) continue;
					if (/\s{2,}|\(\s*\)|—\s*$|:\s*$/.test(v)) {
						problems.push(`  ${attr} has an empty slot in it: ${JSON.stringify(v)}`);
					}
				}

				// A STATE WORD AND ITS TOOLTIP MUST BE THE SAME STATE.
				for (const [word, consequence] of SYNONYM) {
					if (!word.test(text)) continue;
					if (title && !consequence.test(title)) {
						problems.push(
							`  the text says ${JSON.stringify(text)} and its title says ${JSON.stringify(title)}`
						);
					}
					if (aria && !consequence.test(aria) && !aria.includes(text)) {
						problems.push(
							`  the text says ${JSON.stringify(text)} and its aria-label says ${JSON.stringify(aria)}`
						);
					}
				}
			}

			if (problems.length) {
				throw new Error(
					`${name}: ${problems.length} control(s) say two things at once.\n` +
						[...new Set(problems)].join('\n') +
						`\n\n  A tooltip is the same fact with room for the unit, never a second\n` +
						`  opinion. If they disagree, one of them is the defect — decide which.\n`
				);
			}
		});
	}
});

/**
 * THE PRODUCT'S OWN VOCABULARY, ENFORCED WHERE IT IS ACTUALLY RENDERED.
 *
 * `bake` is the CRD's field name. The rename to `checking` was measured as
 * landed on the view-model, and `bake-status.ts` holds the ruling -- but a
 * page can still spell it itself, and two did. This reads the DOM rather than
 * the source, so a hand-written label cannot slip past by not importing the
 * table.
 */
describe('no rendered label spells the product own jargon', () => {
	for (const [name, Comp] of PAGES) {
		test(`${name} says none of bake / baking / InProgress to a reader`, async () => {
			const { container } = await mount(Comp);
			const offenders: string[] = [];
			const visit = (v: string, where: string) => {
				if (/\b(bake|baking|baked)\b/i.test(v) || /\bInProgress\b/.test(v))
					offenders.push(`  ${where}: ${JSON.stringify(v.slice(0, 120))}`);
			};
			visit((container.textContent ?? '').replace(/\s+/g, ' '), 'visible text');
			for (const el of Array.from(container.querySelectorAll('[title], [aria-label]'))) {
				const t = el.getAttribute('title');
				const a = el.getAttribute('aria-label');
				if (t) visit(t, 'title');
				if (a) visit(a, 'aria-label');
			}
			if (offenders.length) {
				throw new Error(
					`${name} renders the CRD's own field name to a reader:\n` +
						offenders.join('\n') +
						`\n\n  The word is decided in bake-status.ts: ${Object.values(BAKE_WORD).join(' / ')}.\n`
				);
			}
		});
	}
});

/**
 * ONE FACT, EVERY SURFACE. The fleet below is SIX rollouts, all healthy
 * deploys, all two builds behind, all held by an approval gate. Every page
 * has a way of saying that, and they must not disagree about it.
 */
describe('adjacent surfaces do not contradict each other about one fleet', () => {
	test('nothing is called healthy, up to date or clear while six places are held', async () => {
		for (const [name, Comp] of PAGES) {
			const { container, unmount } = await mount(Comp);
			const text = (container.textContent ?? '').replace(/\s+/g, ' ');

			// The two claims that would send a woken operator back to bed.
			expect(text, `${name} says nothing is behind while six places are`).not.toMatch(
				/\bNo healthy rollouts yet\b/
			);
			expect(text, `${name} claims the fleet is current`).not.toMatch(
				/\b(everything is up to date|all up to date everywhere|everything is on the newest|all on the newest everywhere)\b/i
			);
			unmount();
			vi.unstubAllGlobals();
		}
	});

	/**
	 * A FAILING HEALTH CHECK AFTER A SUCCESSFUL DEPLOY. The controller writes
	 * `DeploymentBlocked: True, reason: UnhealthyHealthChecks`; the deploy's
	 * own verdict is still `Succeeded`. Four list surfaces read the deploy's
	 * verdict and printed the word `healthy`.
	 */
	test('a failing check is attention on every list surface, not healthy on any', async () => {
		const payload = fleet((app, tier) => ({
			hold: 'none',
			at: 2,
			failingCheck: app === 'alpha-app' && tier === 'prod' ? 'payment-latency' : null
		}));

		for (const [name, Comp] of [PAGES[0], PAGES[1]] as Array<[string, unknown]>) {
			const { container, unmount } = await mount(Comp, payload);
			const text = (container.textContent ?? '').replace(/\s+/g, ' ');
			expect(text, `${name} counted a blown SLO as nothing to look at`).not.toMatch(
				/Attention 0|Needs you now 0/
			);
			// And the reason is on the page, in the check's own words.
			expect(container.innerHTML, `${name} never names the failing check`).toMatch(
				/payment-latency/
			);
			unmount();
			vi.unstubAllGlobals();
		}
	});
});
