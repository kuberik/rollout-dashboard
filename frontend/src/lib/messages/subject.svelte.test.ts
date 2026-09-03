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
import { fleet, respond, CLUSTERS } from './fleet-fixture';
import { SURFACES, AXES, type Axis } from './registry';
import { subjectViolations, applyPending, formatViolation, type Pending } from './axis';

/**
 * PROPERTY 2 -- THE SENTENCE NAMES ITS SUBJECT FOR THE PAGE IT IS ON.
 *
 * This is the half nobody had tested, and it cannot be tested on a pure
 * function: the same string is exact on one surface and vague on another.
 *
 *   rollout detail   "DEV is waiting on an approval"   the page IS one
 *                                                      rollout -- exact.
 *   /apps            same string, one card per app     which app is DEV?
 *   /environments    same string, one card per env     which app at all?
 *
 * -- THE INVARIANT ---------------------------------------------------------
 *
 * A message must name every axis the surface does not already fix. A surface
 * fixes an axis when the page, or the enclosing card, states it.
 *
 * -- HOW THAT IS MADE CHECKABLE -------------------------------------------
 *
 * `resolveAxis` walks from the sentence's own element up towards `<body>` and
 * stops at the FIRST ancestor whose text carries any value of the axis. The
 * axis is resolved iff that ancestor carries EXACTLY ONE.
 *
 * That is the structural form of "unambiguous in context", and it gets the
 * known cases right with no per-page special casing:
 *
 *   - `/apps/<name>`: one app exists anywhere on the page, so the first
 *     ancestor carrying an app name carries exactly one. Resolved, correctly
 *     and trivially -- the PAGE fixed it.
 *   - `/apps`: a card headed `alpha-app` holds one app and three
 *     environments, so `app` resolves at the card and the ROW must supply the
 *     environment.
 *   - `/`: six rows under one heading. Nothing resolves above the row.
 *
 * -- WHY `cluster` IS NOT IN THE GENERAL CHECK ----------------------------
 *
 * An axis only competes when two subjects on the page differ on it AND agree
 * on everything the sentence does name. Two different apps on two different
 * clusters are told apart by their names; demanding the cluster as well would
 * be testing a page nobody designed. The cluster earns its own test below,
 * for the state where it is the ONLY discriminator -- one rollout name, one
 * namespace, two clusters -- which is exactly what the hub/spoke topology
 * produces and what `CLUSTER_NAME=prod|dev` makes ambiguous in words.
 *
 * -- THE FIXTURE IS THE TEST ----------------------------------------------
 *
 * Two apps, three environments, two clusters, gates named the way
 * `generateName` names them. A one-app fixture cannot fail this test, which
 * is why three audits of a two-app cluster kept missing it.
 */

afterEach(() => vi.unstubAllGlobals());

type Case = {
	surface: string;
	Comp: unknown;
	hold: 'approval' | 'schedule' | 'dependency' | 'none';
	check?: boolean;
	/** Distinguishes two cases over the same surface in the test name. */
	label?: string;
};

/**
 * ── VIOLATIONS THAT ARE REAL AND NOT YET DECIDED ─────────────────────────
 *
 * Each of these FIRES. It is listed so the rest of the surface stays under
 * test, and `applyPending` fails if one stops firing -- an exemption that has
 * silently become true is an assertion nobody is making.
 *
 * There is a matching `test.skip('DECISION NEEDED: …')` at the bottom of this
 * file for each, in the convention `truth.test.ts` already uses for the
 * `unknown`-rank-under-Steady question.
 */
const PENDING: Record<string, Pending[]> = {
	'/': [
		{
			claim: 'health failure title',
			axis: 'environment',
			why:
				"`checkFailureTitle` renders as a Chip tooltip and reads *Health check payment-latency " +
				'is failing … Automatic deploys HERE are paused until it passes*. On `/` the word ' +
				'`here` has no antecedent inside the tooltip and the card names its environment ' +
				'AFTER the chip, so a reader who hovers -- or a screen-reader user who is handed ' +
				'the accessible name alone -- is told a check is failing somewhere. On ' +
				'`/rollouts` the same tooltip is fine: the namespace group header is above it. ' +
				'The fix is a `subject` argument on `checkFailureTitle`, which changes a sentence ' +
				'pinned by `truth.test.ts` on the LANDING PAGE -- an owner decision, not a test one.'
		}
	]
};

const LIST_SURFACES: Case[] = [
	{ surface: '/', Comp: ControlCenter, hold: 'approval', check: true },
	{ surface: '/rollouts', Comp: RolloutGrid, hold: 'approval', check: true },
	{ surface: '/apps', Comp: Apps, hold: 'approval' },
	{ surface: '/environments', Comp: Environments, hold: 'approval' },
	{ surface: '/activity', Comp: Activity, hold: 'approval', check: true },
	/**
	 * ⭐ THE STATE IN THE SCREENSHOT. `upstream` -- a `RolloutDependency`
	 * whose provider has not shipped the contract yet -- is the branch that
	 * produces *"... is waiting on another deploy"*, and it is the branch
	 * whose panel holds TWO app names: the PROVIDER in the body and the
	 * WAITER on the button. Until `fleet-fixture` grew `hold: 'dependency'`
	 * no test in this suite rendered it, so the resolver was never handed the
	 * case it got wrong. That is the third reason this suite passed while the
	 * defect it was written for shipped.
	 */
	{ surface: '/apps', Comp: Apps, hold: 'dependency', label: 'blocked on another deploy' },
	{
		surface: '/environments',
		Comp: Environments,
		hold: 'dependency',
		label: 'blocked on another deploy'
	},
	{
		surface: '/',
		Comp: ControlCenter,
		hold: 'dependency',
		check: true,
		label: 'blocked on another deploy'
	},
	{
		surface: '/rollouts',
		Comp: RolloutGrid,
		hold: 'dependency',
		check: true,
		label: 'blocked on another deploy'
	}
];

async function renderSurface(Comp: unknown, c: Case) {
	// `/` and `/rollouts` do not read the blocking story; the claims they DO
	// render are the health-check and rank ones, so those states are staged.
	const payload = fleet((app, tier) => ({
		hold: c.hold,
		failingCheck: c.check && tier === 'prod' ? 'payment-latency' : null
	}));
	vi.stubGlobal('fetch', vi.fn(respond(payload)));
	const r = render(WithQueryClient, { props: { component: Comp as any } });
	await waitFor(() => expect(screen.getAllByText(/alpha-app|r1aaaaa/i).length).toBeGreaterThan(0), {
		timeout: 5000
	});
	return r;
}

describe('every operator claim names its subject for the surface it renders on', () => {
	for (const c of LIST_SURFACES) {
		const spec = SURFACES.find((s) => s.route === c.surface)!;
		// `version` is not a competing axis on a rollout-oriented list -- a
		// sentence about a place is about whatever that place is running, and
		// the row prints it. `cluster` has its own test, below.
		const competing = (a: Axis) => a !== 'version' && a !== 'cluster';
		const axes = spec.mustName.filter(competing);
		// ⭐ A READ-FIRST SENTENCE TAKES ONLY `pageFixes` ON TRUST. `cardFixes`
		// is a claim about what is true INSIDE a card, and a page-level banner
		// is inside no card -- `/apps` declaring `cardFixes: ['app']` is what
		// deleted `app` from this surface's checked set entirely, banner
		// included. The read-first resolver PROVES the card instead: a card
		// header precedes the row it heads, so a row headline still resolves
		// there, and a banner above every card resolves nowhere.
		const headlineAxes = AXES.filter((a) => !spec.pageFixes.includes(a)).filter(competing);

		test(`${c.surface}${c.label ? ` (${c.label})` : ''} — ${axes.join(' + ')} named on every claim`, async () => {
			const { container } = await renderSurface(c.Comp, c);
			const all = subjectViolations(container, {
				row: axes,
				readFirst: headlineAxes,
				aggregates: spec.aggregates
			});
			const checked = all.checked;
			const { open, stale } = applyPending(all.violations, PENDING[c.surface] ?? []);
			if (stale.length > 0) {
				throw new Error(
					`${c.surface} lists ${stale.length} pending exemption(s) that no longer fire:\n` +
						stale.map((p) => `  [${p.claim}] ${p.axis}\n      ${p.why}`).join('\n') +
						`\n\n  Delete them from PENDING and un-skip the matching DECISION NEEDED test.\n`
				);
			}
			const violations = open.map(formatViolation);

			if (violations.length > 0) {
				throw new Error(
					`${c.surface} renders ${violations.length} claim(s) whose subject the page does not fix.\n\n` +
						violations.join('\n') +
						`\n\n  This surface fixes ${spec.pageFixes.concat(spec.cardFixes).join(', ') || 'nothing'}.\n` +
						`  ${spec.why}\n` +
						`  A sentence here has to supply ${axes.join(' and ')} itself, or sit inside a\n` +
						`  region that names it exactly once. Moving the sentence is not a fix; the\n` +
						`  same string is correct on rollout detail and wrong here.\n` +
						`  A claim marked (read first) is held to a stricter rule: it must supply\n` +
						`  ${headlineAxes.join(' and ')} from ITSELF or from a header ABOVE it. Its own body\n` +
						`  and its own button do not count -- on a 390px phone the body is five\n` +
						`  wrapped lines below the headline, and the headline is the whole glance.\n`
				);
			}
			expect(checked, `${c.surface} rendered none of the claims under test`).toBeGreaterThan(0);
		});
	}
});

describe('the cluster is legible where it is the only discriminator', () => {
	function twinFleet() {
		const base = fleet();
		const twinR = JSON.parse(JSON.stringify(base.rollouts.items[0]));
		const twinE = JSON.parse(JSON.stringify(base.environments.items[0]));
		for (const o of [twinR, twinE])
			o.metadata.annotations['rollout-dashboard.kuberik.com/source-cluster'] = CLUSTERS[1];
		base.rollouts.items.push(twinR);
		base.environments.items.push(twinE);
		return base;
	}

	test('/rollouts draws the twins as two groups, and names the cluster in each', async () => {
		vi.stubGlobal('fetch', vi.fn(respond(twinFleet())));
		const { container } = render(WithQueryClient, { props: { component: RolloutGrid as any } });
		await waitFor(() => expect(screen.getAllByText('alpha-dev').length).toBe(2), { timeout: 5000 });

		const headers = screen.getAllByText('alpha-dev').map((h) => h.parentElement!);
		const texts = headers.map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim());

		// A group header that says the word `cluster` and no name is a label
		// that names nothing -- and its own tooltip then reads
		// `Cluster  — the Kubernetes cluster these rollouts run on`.
		for (const t of texts) {
			expect(
				/cluster\s+\S/.test(t),
				`a /rollouts group header reads ${JSON.stringify(t)} — it says "cluster" and then nothing. ` +
					`Two namespaces with the same name on two clusters are then indistinguishable.`
			).toBe(true);
		}
		expect(texts[0], 'the two alpha-dev groups render identically').not.toBe(texts[1]);
	});
});

/**
 * ⭐ THE HEADLINE AGREES WITH ITS OWN SUBJECT. (2026-09-02, from the
 * coordinator: *"the grammatical subject is the singular app, so 'are' is
 * wrong."*) The first cut of the multi-environment fix wove the environment
 * SET into `subject` and let `pluralSubject` conjugate `is` -> `are`, which
 * read *"hello-frontend-app in all 3 environments ARE waiting on another
 * deploy"* -- agreement with the wrong noun. `/apps/[name]`'s OWN sentence,
 * *"All 3 environments are waiting on another deploy"*, is correctly plural
 * there because the environment SET genuinely is the subject once the page
 * has dropped the app. On `/apps` and `/environments` the app never drops
 * out, so it stays the subject and the environment set is a trailing
 * locative appended after the fact: *"<app> is waiting on another deploy in
 * all N environments"*. This locks the exact string so a future pass cannot
 * reopen the agreement error by a different route.
 *
 * ⭐ (2026-09-03) THE VERB PHRASE CHANGED, THE COMPOSITION DID NOT. The
 * fixture's one gate is a `RolloutDependency` contract, and a lone contract
 * gate now names its provider and required version the same way a two-gate
 * bucket of the same kind does (`upstreamHeadline`, called from BOTH
 * `blockingStory` branches) -- so the locked string below moved from "is
 * waiting on another deploy" to "is waiting for beta-app to ship a newer api
 * ^1.67.0". The thing this test exists to catch, subject/verb agreement and
 * the trailing locative, is unchanged: `pluralSubject` never enters it, and
 * the environment set still appends AFTER the finished sentence rather than
 * folding into `subject`.
 */
describe('the plural-cause headline still agrees with its singular subject', () => {
	for (const [surface, Comp] of [
		['/apps', Apps],
		['/environments', Environments]
	] as const) {
		test(`${surface} — "<app> is …" not "<app> in … environments ARE …" when one cause holds every environment`, async () => {
			const { container } = await renderSurface(Comp, { surface, Comp, hold: 'dependency' });
			const headline = container.querySelector('.t-headline')?.textContent?.trim() ?? '';
			expect(
				headline,
				`headline was ${JSON.stringify(headline)} -- expected the singular app to stay the ` +
					`sentence's subject ("<app> is waiting for beta-app to ship a newer api ^1.67.0 in ` +
					`all 3 environments"), not the environment set ("<app> in all 3 environments ARE ` +
					`waiting…").`
			).toMatch(
				/^alpha-app is waiting for beta-app to ship a newer api \^1\.67\.0 in all 3 environments$/
			);
		});
	}
});

/**
 * FAILING AND NAMED ON PURPOSE -- A PRODUCT DECISION, NOT A BUG TO PAPER
 * OVER.
 *
 * The `unhealthy` chip on `/` carries `checkFailureTitle` as its tooltip and
 * therefore as its accessible description. The sentence names the CHECK
 * (`payment-latency`) and then says *"Automatic deploys **here** are paused"*
 * -- and `here` is a word the sentence never defines. Everything that would
 * define it (the rollout name, the environment chip) sits AFTER the chip in
 * the card, so a person hovering, and a screen reader announcing the name on
 * its own, both get a failure with no place attached. Fifteen rows on that
 * page can be in this state at once.
 *
 * `/rollouts` renders the identical tooltip and is fine, because the
 * namespace group header is above it. So this is not a bug in the sentence,
 * it is a missing ARGUMENT: `checkFailureTitle(f, { subject })`, the same
 * shape `blockingStory` already takes and the same fix `/apps`'s banner just
 * had. It changes a string pinned by `truth.test.ts`, on the landing page,
 * and it is the owner's call whether the tooltip should carry
 * `alpha-app in DEV` or whether `/`'s cards should name the environment
 * before the chip instead. Named here rather than decided inside a test.
 */
describe('DECISION NEEDED — the health-check tooltip on / names no place', () => {
	test.skip('DECISION NEEDED: the unhealthy chip tooltip on / names its environment', async () => {
		const { container } = await renderSurface(ControlCenter, {
			surface: '/',
			Comp: ControlCenter,
			hold: 'approval',
			check: true
		});
		const { violations } = subjectViolations(container, {
			row: ['app', 'environment'],
			readFirst: ['app', 'environment']
		});
		expect(violations.filter((v) => v.claim === 'health failure title')).toEqual([]);
	});

	test('the status quo, encoded so the decision above is visible and not silent', async () => {
		const { container } = await renderSurface(ControlCenter, {
			surface: '/',
			Comp: ControlCenter,
			hold: 'approval',
			check: true
		});
		const { violations } = subjectViolations(container, {
			row: ['app', 'environment'],
			readFirst: ['app', 'environment']
		});
		expect(
			violations.some((v) => v.claim === 'health failure title' && v.axis === 'environment'),
			'the tooltip started naming its environment — delete the PENDING entry and un-skip the test above'
		).toBe(true);
	});
});
