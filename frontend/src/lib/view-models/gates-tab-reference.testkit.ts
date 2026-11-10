import fixtureJson from './home/fixtures/incident-input.json';
import { respondHomeIncident, type HomeFixture } from '../demo/home-incident';
import { cardContext } from './card-context';
import { blockingStory, buildGateContext, promotionHoldBreakdown } from './blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from './dependency-graph';
import { composeHeldLeadSentence, heldVerdictForBuild } from './held';
import { compareEnvironmentNames } from '$lib/env-order';
import type { Environment, Rollout, RolloutDependency, RolloutGate } from '../../types';

/**
 * THE GATES TAB'S OWN CAUSE FOR ONE ROLLOUT, REBUILT FROM ITS CONSTRUCTION, for
 * the page-agreement tests (/environments, /envs/<name>, /dependencies,
 * /changes/<slug>). Not the shared helpers: `RolloutGate` objects, a focused
 * graph, `contractHoldsForRollout`, `promotionHoldBreakdown` → `reallyHeldHere`
 * → `blockingStory`'s consequence when every candidate is really held here,
 * else `composeHeldLeadSentence`'s headline — the lead row the tab prints.
 * Fixture: `home-incident`.
 */
export const fixture = fixtureJson as unknown as HomeFixture;
export const now = new Date(fixture.capturedAt);

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};
export const list = JSON.parse(
	respondHomeIncident('GET', '/api/rollouts', fixture, now)!.body!
) as List;
export const rollouts = list.rollouts.items;
export const environments = list.environments.items;
export const envOrder = [
	...new Set(environments.map((e) => e.spec?.environment).filter(Boolean) as string[])
].sort(compareEnvironmentNames);

export const fleet = cardContext({
	rollouts,
	environments: list.environments,
	rolloutDependencies: list.rolloutDependencies,
	envOrder
});

export function rolloutIn(ns: string, name = 'checkout-api'): Rollout {
	const r = rollouts.find((x) => x.metadata?.namespace === ns && x.metadata?.name === name);
	if (!r) throw new Error([ns, name].join('/'));
	return r;
}
export function envOf(ns: string): string {
	return environments.find((e) => e.metadata?.namespace === ns)?.spec?.environment ?? '';
}

/** The cause text the Gates tab's lead row prints for `ns`, or '' when nothing is held here. */
export function gatesTabCause(ns: string, name = 'checkout-api'): string {
	const r = rolloutIn(ns, name);
	const env = envOf(ns);
	const detail = JSON.parse(
		respondHomeIncident('GET', `/api/rollouts/${ns}/${name}`, fixture, now)!.body!
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
		focus: { cluster: '', namespace: ns, name }
	});
	const contractHolds = contractHoldsForRollout(network, r, ns, undefined);
	const breakdown = promotionHoldBreakdown(r, gateContext, { now, contractHolds });
	const really = breakdown.held.filter((h) => heldVerdictForBuild(h, env).held);
	if (really.length === 0) return '';
	if (breakdown.allHeld && really.length === breakdown.held.length) {
		return blockingStory(r, gateContext, { place: env, now, contractHolds }).consequence;
	}
	return composeHeldLeadSentence(really, breakdown.deployable).headline;
}
