import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState, type Scenario } from '$lib/demo/state';
import { promotionCandidates } from './promotion';
import { pickerRankLabel, releaseIndex } from './deploy-risk';
import type { Rollout } from '../../types';
import { availableReleases } from '../releases/registry.svelte';
import { legacyStatus } from '../releases/legacy-fixture';

/**
 * ⛔ ITEM (a), coordinator follow-up, 2026-10-09. The measured defect: on
 * `checkout-api`/`prod-us-east-1` (calm scenario) Overview's "Newer builds"
 * row read `rollout.status.releaseCandidates.length` DIRECTLY — a field
 * `checkout-api`'s fixture never publishes (`ckGates`/`mkCkRollout` in
 * `mock-data.ts` set `availableReleases` and `gates` only) — so it fell
 * through to the `!releaseCandidates || length === 0` branch and printed
 * "No newer build to deploy right now." `/apps/checkout-api` read the same
 * rollout through `promotionCandidates` (`promotion.ts`), which falls back
 * to counting `availableReleases` past the current tag when `releaseCandidates`
 * is absent, and correctly printed "3 behind". Same rollout, two answers.
 *
 * The fix (rollout detail `+page.svelte`): every "newer builds" read on that
 * page — the header rollup, the count chip, the release-candidate list, the
 * metadata-line clause, and the no-deploys-yet preview — now derives from one
 * `const newerBuilds = $derived(promotionCandidates(rollout) as ...)`, the
 * same function `/apps/[name]/+page.svelte`'s `waitingBuildsFor` already
 * calls. `ChangeVersionModal`'s picker answers a DIFFERENT but
 * model-consistent question — "where does this tag rank in the FULL
 * (forward and backward) release list" — via `releaseIndex`
 * (`deploy-risk.ts`) over `availableReleases` directly, counting however many
 * entries rank after the current one. That is deliberately not routed
 * through `promotionCandidates` (the dialog needs ranks for rollbacks too,
 * not just candidates), but it MUST produce the same COUNT either way —
 * whenever `releaseCandidates` is unpublished (true of every `checkout-api`
 * environment but `prod-us-east-2`, whose fixture happens to carry one),
 * because `promotionCandidates`'s own fallback is defined as exactly that
 * `availableReleases` slice (see its doc comment in `promotion.ts`), and
 * whenever it IS published, because this fixture's published list and its
 * `availableReleases` slice agree on membership. This test is the agreement
 * check: for every
 * `checkout-api` environment, in both the calm and incident scenarios, the
 * rollout-detail/`/apps` count (`promotionCandidates(rollout).length`) and
 * the dialog's implied "N newer" count (`releaseIndex`-ranked entries past
 * current) must be identical — and, for the exact reported case
 * (`prod-us-east-1`, calm), both must read `3`, never `0`.
 */

const CK_APP = 'checkout-api';
const CK_ENVS = [
	'dev',
	'staging',
	'prod-eu-central',
	'prod-us-east-1',
	'prod-us-east-2',
	'prod-ap-southeast-2',
	'prod-af-south-1'
] as const;

type List = { rollouts: { items: Rollout[] } };

function fixtureList(): List {
	return JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as List;
}

function findRollout(list: List, env: string): Rollout {
	const r = list.rollouts.items.find(
		(x) => x.metadata?.name === CK_APP && x.metadata?.namespace === `${CK_APP}-${env}`
	);
	if (!r) throw new Error(`${CK_APP}/${env} not found in the fixture`);
	return r;
}

/**
 * ⭐ ITEM 3 (coordinator, 2026-10-09). CALLS THE REAL `pickerRankLabel`
 * (`deploy-risk.ts`), NOT A REIMPLEMENTATION OF ITS ARITHMETIC. This used to
 * recompute "is this entry newer" by hand via `releaseIndex(rollout, r.tag)
 * > curIdx` — a copy of what `pickerRankLabel` already does internally, so a
 * regression in the dialog's OWN rank logic (the thing this test exists to
 * catch) could silently pass: the test's hand-rolled copy and the dialog's
 * real function would just disagree with each other with nobody noticing.
 * `pickerRankLabel` moved out of `ChangeVersionModal.svelte` and into this
 * module for exactly this reason — see its own doc comment — and
 * `ChangeVersionModal.svelte`'s two call sites (the picker row's `rank` and
 * the Deploy button's `selectedVersionIsNewerCandidate`) now call this
 * SAME export, so there is only one "is this build newer" function in the
 * product, not two descriptions of it.
 *
 * `releaseIndex` (also a real export, not reimplemented) is used ONLY for
 * the up-front "can the current tag even be placed" guard —
 * `pickerRankLabel` itself returns `null` for the current tag by design
 * (it's already the green `Current` badge, not a rank), so that guard
 * cannot be expressed by calling `pickerRankLabel` on the current tag alone.
 */
function dialogNewerCount(rollout: Rollout): number | null {
	const currentTag = rollout.status?.history?.[0]?.version?.tag ?? null;
	if (releaseIndex(rollout, currentTag) === -1) return null;
	const available = availableReleases(rollout) ?? [];
	return available.filter((r) => pickerRankLabel(rollout, r.tag)?.endsWith('newer') ?? false).length;
}

describe.each<Scenario>(['calm', 'incident'])(
	'Overview/%s newer-build count agrees with the dialog (checkout-api, every environment)',
	(scenario) => {
		resetDemoState(scenario);
		const list = fixtureList();

		it.each(CK_ENVS)('%s: promotionCandidates count === dialog rank count', (env) => {
			const rollout = findRollout(list, env);
			const overviewAndAppsCount = promotionCandidates(rollout).length;
			const dialogCount = dialogNewerCount(rollout);
			expect(dialogCount, `${env}: current tag must be placeable in its own release list`).not.toBeNull();
			expect(
				overviewAndAppsCount,
				`${env}: Overview/\`/apps\` (promotionCandidates) must agree with the dialog's own rank count`
			).toBe(dialogCount);
		});
	}
);

describe('the exact reported defect: checkout-api/prod-us-east-1, calm', () => {
	resetDemoState('calm');
	const list = fixtureList();
	const rollout = findRollout(list, 'prod-us-east-1');

	it('reads 3 newer builds everywhere, never 0', () => {
		expect(legacyStatus(rollout).releaseCandidates ?? []).toEqual([]); // the field a naive read would use
		expect(promotionCandidates(rollout).length, 'Overview / /apps').toBe(3);
		expect(dialogNewerCount(rollout), 'the Change Version dialog').toBe(3);
	});
});
