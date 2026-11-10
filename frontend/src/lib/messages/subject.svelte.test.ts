/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Apps from '../../routes/apps/+page.svelte';
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

// ⭐ THE CLOCK IS PINNED NEAR THE FIXTURE'S OWN DATES (design rollout,
// 2026-10-09). `fleet-fixture` stamps its holds in late August 2026; read
// against the real clock they are weeks old, and since every surface now
// shares `detectRolloutStuck`, a person-owned hold that old is STUCK — a
// different claim from the hold sentence these cases exist to check. Only
// `Date` is faked, so `waitFor`'s timers still run.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-08-31T02:00:00Z'));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

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
// The `/` exemption (the health-failure tooltip naming no place) is RESOLVED:
// Home's redesign states a failing check in a banner whose title names the
// rollout and its environment (design language, 2026-10-08).
//
// `/activity`'s grouped-row question (round 4 review, 2026-10-09) is RESOLVED
// too, by design-rollout: `registry.ts`'s `/activity` surface now declares
// `aggregates: { 'deploy state word': ['environment'] }` — scoped to that one
// claim, not a page-wide or guard-wide exemption. See that file's own note.
const PENDING: Record<string, Pending[]> = {};

const LIST_SURFACES: Case[] = [
	{ surface: '/apps', Comp: Apps, hold: 'approval' },
	/* 2026-11-09: /environments and the /apps dependency hold removed -- the r34/r39 pages draw tiles and place cells ("2 waiting", "Waiting on beta-app"), not the retired banner/Needs-you claim sentences this extractor scans, so they render no claim to check; their wording is held by truth.mjs and the home/apps/env model tests. */
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
	await waitFor(() => expect(screen.getAllByText(/alpha-app|r1aaaaa|invoice-api|checkout-edge/i).length).toBeGreaterThan(0), {
		timeout: 5000
	});
	// `$lib/stores/time`'s `now` starts with the date it was IMPORTED at (the
	// real clock, before the pinned one applies) and re-reads `Date` every
	// 100ms; let one tick land so every derivation sees the pinned clock.
	await new Promise((res) => setTimeout(res, 250));
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
	/* 2026-11-09: the /environments plural-cause banner case is retired with the banner -- the r34 Environments page prints tiles ("2 waiting"), no `<app> is waiting for … in all N environments` headline, so there is no singular-subject sentence to lock. */

	/**
	 * ⭐ /apps HAS NO PAGE-LEVEL GATE BANNER AT ALL NOW (TL whole-product
	 * consistency review, dr7). A self-clearing `RolloutDependency` hold
	 * still draws nothing — nobody on /apps can act on it, and the lane's
	 * own held node already states it, same as before (TL review round 2,
	 * item 8). What changed is the APPROVAL case: it no longer gets a
	 * one-banner-per-fleet collapse either — it is a `NeedsYouCard` row,
	 * one per held rollout, the same object a failed or stuck rollout gets.
	 * `/environments` above is unchanged and keeps the plural-cause banner.
	 */
	test('/apps — a self-clearing dependency hold renders no banner at all', async () => {
		const { container } = await renderSurface(Apps, { surface: '/apps', Comp: Apps, hold: 'dependency' });
		expect(
			container.querySelector('.ap-headline-row .t-heading'),
			'a dependency hold is self-clearing — nobody on /apps can act on it, so it must not draw a ' +
				"banner (the lane's own held node still carries the fact)."
		).toBeNull();
	});

	/* 2026-11-09: the /apps Needs-you-row case is retired with the row -- the r34 Apps page (Nothing needs attention / In flight / At rest, place cells) draws no "Waiting on an approval in <env>" <li>; the approval word is held by approvalWord's own tests. */
});

/* 2026-11-09: the old `/` (ControlCenter) and `/rollouts` (RolloutGrid) render targets are deleted with those pages; the new Home and Rollouts are drawn from the home model, not this fleet fixture, and render no claim here. Retired cases: the two list surfaces, the twin-cluster group headers, the health-check claim on `/`. */
