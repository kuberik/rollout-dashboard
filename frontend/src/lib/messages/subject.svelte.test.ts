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
import { SURFACES } from './registry';
import { subjectViolations } from './axis';

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

type Case = { surface: string; Comp: unknown; hold: 'approval' | 'schedule' | 'none'; check?: boolean };

const LIST_SURFACES: Case[] = [
	{ surface: '/', Comp: ControlCenter, hold: 'approval', check: true },
	{ surface: '/rollouts', Comp: RolloutGrid, hold: 'approval', check: true },
	{ surface: '/apps', Comp: Apps, hold: 'approval' },
	{ surface: '/environments', Comp: Environments, hold: 'approval' },
	{ surface: '/activity', Comp: Activity, hold: 'approval', check: true }
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
		const axes = spec.mustName.filter((a) => a !== 'version' && a !== 'cluster');

		test(`${c.surface} — ${axes.join(' + ')} named on every claim`, async () => {
			const { container } = await renderSurface(c.Comp, c);
			const { violations, checked } = subjectViolations(container, axes);

			if (violations.length > 0) {
				throw new Error(
					`${c.surface} renders ${violations.length} claim(s) whose subject the page does not fix.\n\n` +
						violations.join('\n') +
						`\n\n  This surface fixes ${spec.pageFixes.concat(spec.cardFixes).join(', ') || 'nothing'}.\n` +
						`  ${spec.why}\n` +
						`  A sentence here has to supply ${axes.join(' and ')} itself, or sit inside a\n` +
						`  region that names it exactly once. Moving the sentence is not a fix; the\n` +
						`  same string is correct on rollout detail and wrong here.\n`
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
