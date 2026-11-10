import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { respondHomeIncident, type HomeFixture } from '../demo/home-incident';
import { cardContext } from './card-context';
import {
	blockingStory,
	buildGateContext,
	promotionHoldBreakdown,
	type ClassifiedGate
} from './blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from './dependency-graph';
import { heldHereGates, heldVerdictForBuild } from './held';
import { compareEnvironmentNames } from '$lib/env-order';
import type { Environment, Rollout, RolloutDependency, RolloutGate } from '../../types';

/**
 * ⭐ /apps/<app> AND THE GATES TAB NAME THE SAME CAUSES. (2026-10-25)
 *
 * On the controller-faithful `home-incident` fixture a `RolloutDependency`'s
 * gate sits on every consumer's `status.gates`. The app page built its stories
 * without the contract holds and keyed its wait cards on the whole story's
 * blended `gates`, so all of checkout-api's prod regions (frontier `4.43.0-43`,
 * needs payments-svc `~2.9.0`) folded into staging's different hold
 * (`4.44`/`4.45`, a newer payments) and vanished from "Waiting, nothing to
 * do". The Gates tab names the build actually refused HERE.
 *
 * App path: `cardContext` off the list payload (what the page builds) →
 * `storyFor` → `heldHereGates`. Gates-tab path: the tab's own construction —
 * `buildGateContext` WITH the rollout's `RolloutGate` objects, a focused
 * graph, `contractHoldsForRollout(network, rollout, ns, cluster)`,
 * `promotionHoldBreakdown` → `reallyHeldHere`, or `blockingStory`'s own
 * gates when every candidate is really held here.
 */

const fixture = JSON.parse(
	readFileSync(new URL('./home/fixtures/incident-input.json', import.meta.url), 'utf8')
) as HomeFixture;
const now = new Date(fixture.capturedAt);

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};
const list = JSON.parse(respondHomeIncident('GET', '/api/rollouts', fixture, now)!.body!) as List;
const rollouts = list.rollouts.items;
const environments = list.environments.items;
const envOrder = [
	...new Set(environments.map((e) => e.spec?.environment).filter(Boolean) as string[])
].sort(compareEnvironmentNames);

const app = cardContext({
	rollouts,
	environments: list.environments,
	rolloutDependencies: list.rolloutDependencies,
	envOrder
});

function rolloutIn(ns: string): Rollout {
	const r = rollouts.find((x) => x.metadata?.namespace === ns && x.metadata?.name === 'checkout-api');
	if (!r) throw new Error(`no checkout-api in ${ns}`);
	return r;
}
function envOf(ns: string): string {
	return environments.find((e) => e.metadata?.namespace === ns)?.spec?.environment ?? '';
}
const clauses = (gates: ClassifiedGate[]) =>
	gates
		.filter((g) => g.kind !== 'promotion')
		.map((g) => `${g.kind}|${g.subject ?? ''}|${g.clause}`)
		.sort();

function appCauses(ns: string): string[] {
	const r = rolloutIn(ns);
	return clauses(heldHereGates(app.storyFor(r, { now }), envOf(ns)));
}

function gatesTabCauses(ns: string): string[] {
	const r = rolloutIn(ns);
	const env = envOf(ns);
	const detail = JSON.parse(
		respondHomeIncident('GET', `/api/rollouts/${ns}/checkout-api`, fixture, now)!.body!
	) as { rolloutGates: { items: RolloutGate[] } };
	const gateContext = buildGateContext({
		environments: list.environments,
		rolloutDependencies: list.rolloutDependencies,
		rolloutGates: detail.rolloutGates
	});
	const network = buildRolloutGraph({
		rollouts,
		environments,
		dependencies: list.rolloutDependencies.items,
		envOrder,
		gates: gateContext,
		focus: { cluster: '', namespace: ns, name: 'checkout-api' }
	});
	const contractHolds = contractHoldsForRollout(network, r, ns, undefined);
	const breakdown = promotionHoldBreakdown(r, gateContext, { now, contractHolds });
	const reallyHeldHere = breakdown.held.filter((h) => heldVerdictForBuild(h, env).held);
	if (reallyHeldHere.length === 0) return [];
	if (breakdown.allHeld && reallyHeldHere.length === breakdown.held.length) {
		return clauses(blockingStory(r, gateContext, { now, contractHolds }).gates);
	}
	return [...new Set(clauses(reallyHeldHere.flatMap((h) => h.classifiedGates)))];
}

describe('/apps/checkout-api and the Gates tab name the same causes (home-incident)', () => {
	it('staging: held by payments-svc for a newer payments, on both pages', () => {
		expect(gatesTabCauses('checkout-api-staging')).toEqual([
			'dependency|payments-svc|payments-svc ships a newer payments than 2.4.1'
		]);
		expect(appCauses('checkout-api-staging')).toEqual(gatesTabCauses('checkout-api-staging'));
	});

	it('prod-ap-southeast-2: held by payments-svc until it ships ~2.9.0, on both pages', () => {
		expect(gatesTabCauses('checkout-api-prod-ap-southeast-2')).toEqual([
			'dependency|payments-svc|payments-svc ships ~2.9.0'
		]);
		expect(appCauses('checkout-api-prod-ap-southeast-2')).toEqual(
			gatesTabCauses('checkout-api-prod-ap-southeast-2')
		);
	});

	it('every checkout-api environment agrees', () => {
		const namespaces = rollouts
			.filter((r) => r.metadata?.name === 'checkout-api')
			.map((r) => r.metadata!.namespace!);
		expect(namespaces.length).toBeGreaterThan(5);
		for (const ns of namespaces) expect([ns, appCauses(ns)]).toEqual([ns, gatesTabCauses(ns)]);
	});

	it('regression: the whole story read alone folds prod into staging’s hold', () => {
		// What the page keyed on before: the gate-only story's blended gates.
		const old = (ns: string) =>
			clauses(blockingStory(rolloutIn(ns), app.gateContext, { now }).gates);
		expect(old('checkout-api-prod-ap-southeast-2')).toEqual(old('checkout-api-staging'));
		expect(appCauses('checkout-api-prod-ap-southeast-2')).not.toEqual(
			appCauses('checkout-api-staging')
		);
	});
});
