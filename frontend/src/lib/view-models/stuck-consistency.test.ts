import { describe, it, expect } from 'vitest';
import { resetDemoState, getScenarioDepRollouts } from '$lib/demo/state';
import { mockDepEnvironments, CK_APP, CK_ENVS } from '$lib/demo/mock-data';
import { buildRolloutCards, detectRolloutStuck } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { rolloutMatchesEnvironment } from '$lib/source-dashboard';
import type { Rollout, Environment } from '../../types';

/**
 * ⛔ THE U-2 CLASS BUG, PINNED, THEN THE FIXTURE ITSELF FIXED. (2026-10-09)
 *
 * PART 1 — the predicate gap (commit d2df3fd). The coordinator's finding:
 * in the CALM mock scenario, `/apps/checkout-api` showed five environments
 * `STUCK` while Home's "Needs you now" showed none of them.
 * `buildRolloutCards` (what Home / `/rollouts` / the command palette read
 * `.stuck` from) used to run ONLY the own-rollout baking/deploying
 * detector, never the promotion-stuck one `/apps/[name]`, `/environments`
 * and `/envs/[name]` each separately composed. `detectRolloutStuck`
 * (`rollout-cards.ts`) is now the one join every surface calls through.
 *
 * PART 2 — the fixture was never supposed to be stuck here at all
 * (coordinator follow-up: "the calm scenario must read calm"). Tracing the
 * live repro past the predicate itself: `detectStuckPromotion` was
 * correctly reading its own documented "gateless but stagnant" branch —
 * NOT a gate refusing anything (`promotionBlock(r).blocked` was `false`
 * for every one of these five; only `prod-eu-central` has a gate that
 * genuinely refuses its next candidate, and stays excused for that real
 * reason). The branch fires on how long the newest candidate has been
 * waiting, read off `CK_RELEASES`' `created` field — which was a FIXED
 * calendar date (`2026-08-01`..`2026-08-28`) that does not track the
 * demo's own clock. As real wall-clock time passed it silently aged past
 * the 24h threshold, so every environment with a newer build available
 * read "no progress for 41d" that was never a real wedge. Fixed at the
 * source: `CK_RELEASES.created` is `hcAgo(...)` now, matching the
 * clock-relative convention `ckHistory`'s own deploy timestamps already
 * use, so this cannot rot the same way again (see that constant's own doc
 * comment for the full trace and `promotion-prod-eu-central`'s
 * genuinely-different reason it stays excused).
 *
 * ⚠️ SCENARIO-INDEPENDENT, DELIBERATELY — same call `freshenInFlight`
 * already made for this exact fixture ("NOTHING IN THE DEMO IS STUCK …
 * it is not scenario-dependent, deliberately … incident carries exactly
 * one thing needing a person [checkout-worker's failed deploy], and a
 * stuck card beside it would be a second"). `resetDemoState('incident')`
 * never touches `checkout-api`'s own data (only `CW_NAMESPACE`/`CW_NAME`
 * is scenario-conditional), so there is no existing plumbing to make this
 * app differ by scenario without inventing new machinery for a story no
 * fixture currently tells — flagged here rather than guessed at. Both
 * scenarios pin the SAME empty set below; if the coordinator wants a
 * genuine incident-only stuck beat for this app, that is a new, explicit
 * fixture decision for a follow-up, not a side effect of this fix.
 */

function ckFixture(): { rollouts: Rollout[]; environments: Environment[] } {
	const rollouts = (getScenarioDepRollouts() as Rollout[]).filter(
		(r) => r.metadata?.name === CK_APP
	);
	const environments = (mockDepEnvironments as unknown as Environment[]).filter(
		(e) => e.spec?.rolloutRef?.name === CK_APP
	);
	expect(rollouts.length).toBe(CK_ENVS.length);
	expect(environments.length).toBe(CK_ENVS.length);
	return { rollouts, environments };
}

function envNameFor(r: Rollout, environments: Environment[]): string {
	const env = environments.find((e) => rolloutMatchesEnvironment(r, e));
	return env?.spec?.environment ?? '';
}

describe.each(['calm', 'incident'] as const)(
	'checkout-api stuck sets agree across surfaces (%s scenario)',
	(scenario) => {
		it('buildRolloutCards (Home, /rollouts, command palette) and the per-environment detectRolloutStuck call (/apps/[name], /environments, /envs/[name]) name the same stuck environments', () => {
			resetDemoState(scenario);
			const { rollouts, environments } = ckFixture();
			const now = new Date();
			// `rolloutDependencies` deliberately omitted — see `ckGates`'s own
			// doc comment above: the contract gates are not on
			// `rollout.status.gates`, so a real `GateContext` for this
			// fixture has nothing to join from that source either. Every
			// surface builds its `GateContext` the same way for this app.
			const gateContext = buildGateContext({
				environments: { items: environments },
				rolloutDependencies: null
			});

			// ── SURFACE A: Home / `/rollouts` / command palette ──────────
			const cards = buildRolloutCards(rollouts, environments, now, gateContext);
			const cardStuckEnvs = new Set(
				cards.filter((c) => c.stuck != null).map((c) => c.envName)
			);

			// ── SURFACE B: `/apps/[name]`, `/environments`, `/envs/[name]` ─
			// Each of those pages calls `detectRolloutStuck` directly with
			// this app's OTHER environments as peers — reproduced here
			// without rendering any of the three pages.
			const perEnvStuckEnvs = new Set<string>();
			for (const r of rollouts) {
				const envName = envNameFor(r, environments);
				const peers = rollouts
					.filter((peer) => peer !== r)
					.map((peer) => ({ envName: envNameFor(peer, environments), rollout: peer }));
				const reason = detectRolloutStuck(r, peers, { now, gateContext });
				if (reason) perEnvStuckEnvs.add(envName);
			}

			expect(cardStuckEnvs).toEqual(perEnvStuckEnvs);

			// ⭐ CALM READS CALM (coordinator decision, 2026-10-09). With
			// `CK_RELEASES.created` clock-relative, nothing here is stuck in
			// EITHER scenario — `prod-eu-central` was never in the stuck set
			// (it is genuinely HELD, which `.stuck` correctly never counted)
			// and the other five no longer read "gateless but stagnant" now
			// that their newest candidate's `created` is always under 24h
			// old. See this file's own header comment for why this is NOT
			// scenario-differentiated.
			expect(cardStuckEnvs).toEqual(new Set());
		});
	}
);

/**
 * ⛔ THE SAME CLOCK-ROT, FOUR MORE ROLLOUTS. (2026-10-09, same coordinator
 * follow-up) Fixing `CK_RELEASES` alone left Home's "Needs you now" at 5 —
 * `fulfillment-svc`, `ledger-core`, `payments-svc` (platform-prod AND
 * platform-staging) and `standalone-api`. None of these publish
 * `status.gates` either (`mkPlainRollout`/`mkSaRollout`): they are
 * providers/consumers in the dependency story, held only by a
 * `RolloutDependency` never wired onto `rollout.status.gates`, same split
 * `ckGates` documents for checkout-api — so `detectStuckPromotion` took
 * its "gateless but stagnant" branch for every one of them too, off
 * `PAY_RELEASES`/`LEDGER_RELEASES`/`ORD_RELEASES`/`SA_RELEASES`' own fixed
 * calendar dates. None of the four is a deliberate needs-a-person beat —
 * `held-sentence.test.ts` and `deps-story.ts` only ever cast
 * `ledger-core`/`payments-svc` as the thing something ELSE is waiting ON —
 * so all four get the same `hcAgo` fix, not a gate-wiring one.
 */
describe.each(['calm', 'incident'] as const)(
	'the dependency-story rollouts read held, not stuck (%s scenario)',
	(scenario) => {
		it('fulfillment-svc, ledger-core, payments-svc (both namespaces) and standalone-api are never stuck on the card Home/`/rollouts`/the palette read', () => {
			resetDemoState(scenario);
			const rollouts = getScenarioDepRollouts() as Rollout[];
			const environments = mockDepEnvironments as unknown as Environment[];
			const targets = rollouts.filter((r) =>
				['fulfillment-svc', 'ledger-core', 'payments-svc', 'standalone-api'].includes(
					r.metadata?.name ?? ''
				)
			);
			// Two `payments-svc` (platform-prod, platform-staging) + one each
			// of the other three — five rollouts, matching Home's own "5
			// need you" count before this fix.
			expect(targets.length).toBe(5);

			const gateContext = buildGateContext({
				environments: { items: environments },
				rolloutDependencies: null
			});
			const cards = buildRolloutCards(rollouts, environments, new Date(), gateContext);
			const stuckNames = cards
				.filter((c) => targets.includes(c.rollout) && c.stuck != null)
				.map((c) => `${c.ns}/${c.name}`);

			expect(stuckNames).toEqual([]);
		});
	}
);
