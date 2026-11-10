import { describe, expect, it } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import type { Environment, Rollout } from '../../types';
import { getDisplayVersion } from '$lib/utils';
import { buildRolloutCards, type RolloutCard } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { buildTopology, deployNameOf, placeKeyOf, upstreamOf } from '$lib/view-models/sites-waves';

/**
 * ⭐ CHAIN ORDER (2026-10-11, demo/chain-order). Every app's builds must
 * flow dev → test → staging → prod[-region] IN THAT ORDER, per its own
 * `Environment` chain:
 *
 *   1. A later stage's running (or currently-checking) build must already
 *      have passed through every earlier stage — i.e. appear somewhere in
 *      that earlier stage's own `status.history` — unless the later
 *      stage's own history explicitly marks the deploy as a rollback
 *      (`history[0].rollback === true`, the one record the UI reads for
 *      that). Checked directly off `respond()`'s payload, for every stage.
 *
 *   2. A stage the product calls HELD (`RolloutCard.held`, `held.ts`'s
 *      `heldVerdict` — "refused HERE, not merely not-reached-yet") must be
 *      held on a build that already exists at the stage before it. A
 *      stage that is merely BEHIND (not held — plain chain sequencing,
 *      `waitsForEnv` naming the stage ahead) may legitimately show a
 *      candidate the earlier stage has not shipped yet: that is what
 *      "behind" means, and `held.ts`'s own reference cases
 *      (`held-predicate.test.ts`, "hello-world (calm): not reached dev,
 *      never held") pin exactly this shape. Checked only for cards
 *      `held.ts` actually marks `held`.
 *
 * This was violated three ways before this fix:
 *   - `checkout-worker`: dev ran `3f1ed09` while staging already ran (and
 *     failed) the NEWER `a02f1c4` — a build dev had never run (rule 1).
 *   - `checkout-edge`: prod was checking `d09e6f4`, which neither dev nor
 *     staging's history had ever contained (rule 1).
 *   - `hello-world`: staging read "held · 1 newer waiting" (`e2c9b47`) when
 *     dev itself had only queued it, never deployed it — fixed not by
 *     hiding the candidate but by `held.ts` correctly calling this plain
 *     chain sequencing, never `held` (rule 2; staging's card is `held ===
 *     false` here, so rule 2 has nothing to check on it — rule 1 still
 *     covers its actual running build).
 *
 * Rule 1 reads straight off `respond('GET', '/api/rollouts')` — the same
 * payload the dashboard renders. Rule 2 reads `RolloutCard.held`, built the
 * same way `rollout-cards.ts` builds it for every real surface, so this
 * test cannot draw a different held/behind line than the product does.
 */

/** Apps whose fixtures model one build promoted verbatim through a real
 *  multi-tier chain — see the scope note in `buildAppChains` below. */
const CHAIN_APPS = new Set(['checkout-worker', 'checkout-edge', 'hello-world']);

type RespondRollouts = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
};

/** Canonical rank for a stage name when sites-waves names no predecessor. Anything starting with `prod` ranks alongside every other
 *  `prod*` region — parallel branches off the same `staging`, never chained
 *  against one another. */
function canonicalRank(env: string): number {
	if (env === 'dev') return 0;
	if (env === 'test') return 1;
	if (env === 'staging') return 2;
	if (env.startsWith('prod')) return 3;
	return 4;
}

type StageInfo = {
	env: string;
	rollout: Rollout;
	/** The stage `upstreamOf` names as its predecessor (sites-waves), when there is one. */
	after: string | null;
};

function historyVersions(r: Rollout): Set<string> {
	const out = new Set<string>();
	for (const h of r.status?.history ?? []) {
		const v = h?.version ? getDisplayVersion(h.version) : null;
		if (v) out.add(v);
	}
	return out;
}

function isRollback(r: Rollout): boolean {
	const head = r.status?.history?.[0] as { rollback?: boolean } | undefined;
	return head?.rollback === true;
}

/** Group rollouts by app name, and resolve each stage's predecessor —
 *  preferring the predecessor sites-waves derives (`upstreamOf`) and falling back to "the closest
 *  lower-ranked stage of the same app" when no such edge is published. */
function buildAppChains(body: RespondRollouts): Map<string, StageInfo[]> {
	// The predecessor of a stage is what sites-waves' `upstreamOf` says (tier order, then waves):
	// the Environment no longer publishes an explicit `After` edge. The key is the PLACE key, the
	// name every rollout of the fixture is labelled with.
	const envs = body.environments.items;
	const topos = buildTopology(envs);
	const envByKey = new Map<string, string | null>();
	for (const e of envs) {
		const name = e.spec?.rolloutRef?.name ?? e.metadata?.name;
		if (!name || !e.spec?.environment) continue;
		const topo = topos.get(deployNameOf(e));
		const node = topo?.tiers.flatMap((t) => t.sites).find((x) => x.env === e);
		const up = topo && node ? upstreamOf(topo, node).find((x) => x.env)?.env : undefined;
		envByKey.set(`${name}/${placeKeyOf(e, envs)}`, up ? placeKeyOf(up, envs) : null);
	}

	const byApp = new Map<string, StageInfo[]>();
	for (const r of body.rollouts.items) {
		const name = r.metadata?.name;
		const env = r.metadata?.labels?.environment;
		if (!name || !env) continue;
		// ⛔ SCOPE: apps whose own environments genuinely model ONE build
		// promoted verbatim through a chain — `HF_APP`/`HW_APP_NAME`
		// (`checkout-edge`, `hello-world`) and `checkout-worker`'s own
		// `FLEET` rows, each with an explicit `previousVersion` chaining
		// its two tiers. The rest of `FLEET` (`orders-api`,
		// `recommender-svc`, …) is decorative background texture —
		// several unrelated single-tier/independent builds chosen for
		// visual variety, never a modeled promotion chain (`orders-api`'s
		// dev/staging even run DIFFERENT build tags for the same commit by
		// design, see the "live everywhere" comment above `FLEET` in
		// `mock-data.ts`) — so the chain-order rule has nothing to check
		// there and does not apply.
		if (!CHAIN_APPS.has(name)) continue;
		const after = envByKey.get(`${name}/${env}`) ?? null;
		const list = byApp.get(name) ?? [];
		list.push({ env, rollout: r, after });
		byApp.set(name, list);
	}
	return byApp;
}

/** The stage immediately before `stage` in its app's chain, or null when
 *  `stage` is the root. Explicit `after` wins; otherwise the closest
 *  strictly-lower-ranked stage (same-ranked stages, e.g. two prod regions,
 *  are parallel — neither is the other's predecessor). */
function predecessorOf(stage: StageInfo, stages: StageInfo[]): StageInfo | null {
	if (stage.after) {
		const named = stages.find((s) => s.env === stage.after);
		if (named) return named;
	}
	const myRank = canonicalRank(stage.env);
	let best: StageInfo | null = null;
	for (const s of stages) {
		if (s === stage) continue;
		const rank = canonicalRank(s.env);
		if (rank < myRank && (!best || rank > canonicalRank(best.env))) best = s;
	}
	return best;
}

/** `RolloutCard.held`, built the same way every real page builds it. */
function buildHeldByKey(body: RespondRollouts): Map<string, boolean> {
	const rollouts = body.rollouts.items;
	const environments = body.environments.items;
	const dependencies: unknown[] = [];
	const gateContext = buildGateContext({
		environments: { items: environments },
		rolloutDependencies: { items: dependencies as never[] }
	});
	const network = buildRolloutGraph({
		rollouts,
		environments,
		dependencies: dependencies as never[],
		envOrder: [],
		gates: gateContext
	});
	const cards: RolloutCard[] = buildRolloutCards(rollouts, environments, new Date(), gateContext, (r) =>
		contractHoldsForRollout(network, r)
	);
	const byKey = new Map<string, boolean>();
	for (const c of cards) byKey.set(`${c.name}/${c.envName}`, c.held);
	return byKey;
}

function checkScenario(scenario: 'calm' | 'incident' | 'wide') {
	resetDemoState(scenario);
	const body = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as RespondRollouts;
	const byApp = buildAppChains(body);
	const heldByKey = buildHeldByKey(body);

	for (const [app, stages] of byApp) {
		for (const stage of stages) {
			const predecessor = predecessorOf(stage, stages);
			if (!predecessor) continue; // root stage — nothing to check it against

			const reachable = historyVersions(predecessor.rollout);
			const current = stage.rollout.status?.history?.[0]?.version
				? getDisplayVersion(stage.rollout.status.history[0].version)
				: ((stage.rollout.status as { currentVersion?: string } | undefined)?.currentVersion ??
					null);

			// ── RUNNING/CHECKING BUILD (rule 1 — every stage) ─────────────
			if (current && !reachable.has(current) && !isRollback(stage.rollout)) {
				throw new Error(
					`[${scenario}] ${app}/${stage.env} is running/checking "${current}", which never ` +
						`appeared in ${app}/${predecessor.env}'s history (and is not marked a rollback). ` +
						`${app}/${predecessor.env} history: [${[...reachable].join(', ')}]`
				);
			}

			// ── "N NEWER WAITING" (rule 2 — HELD stages only; a stage that ──
			// is merely BEHIND may legitimately show a candidate the stage
			// before it has not shipped yet, see this file's module doc.
			if (heldByKey.get(`${app}/${stage.env}`) !== true) continue;
			const candidates = (stage.rollout.status?.releaseCandidates ?? [])
				.map((c) => getDisplayVersion(c))
				.filter((v): v is string => !!v);
			for (const candidate of candidates) {
				if (!reachable.has(candidate)) {
					throw new Error(
						`[${scenario}] ${app}/${stage.env} is HELD and counts "${candidate}" as a ` +
							`newer build waiting, but it does not exist anywhere in ` +
							`${app}/${predecessor.env}'s history — a stage cannot be held on a build the ` +
							`stage before it never ran. ${app}/${predecessor.env} history: ` +
							`[${[...reachable].join(', ')}]`
					);
				}
			}
		}
	}
}

describe('chain order — every app flows dev → test → staging → prod[-region]', () => {
	it('calm: every running/checking build and every "N newer waiting" build passed through every earlier stage', () => {
		checkScenario('calm');
	});

	it('incident: every running/checking build and every "N newer waiting" build passed through every earlier stage', () => {
		checkScenario('incident');
	});

	it('wide: every running/checking build and every "N newer waiting" build passed through every earlier stage', () => {
		checkScenario('wide');
	});
});
