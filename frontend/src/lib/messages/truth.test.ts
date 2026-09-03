/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect } from 'vitest';
import { literalsIn, HOLE } from './scan';
import { SENTENCE_MODULES } from './registry';

import {
	buildGateContext,
	withSchedules,
	classifyGate,
	blockingStory,
	shortStory,
	ruleHandle,
	joinClauses,
	prettyNameOf,
	EMPTY_GATE_CONTEXT
} from '$lib/view-models/blocking-story';
import { verdictSentence, blockReason as verdictBlockReason } from '$lib/view-models/verdict';
import {
	confirmLevel,
	confirmNotice,
	typedPrompt,
	deployActionLabel,
	deployDirection,
	deployIntent,
	retryIntent,
	retryConsequences,
	rollbackTarget,
	targetPhrase,
	gatesAllow,
	isProductionTarget,
	rolloutEnvironmentName
} from '$lib/view-models/deploy-risk';
import {
	checkFailure,
	checkFailureTitle,
	parseCheckMessage,
	classifyCheck,
	recoveredChecks,
	recoveredLabel,
	recoveredTitle,
	deployWindowStart
} from '$lib/view-models/health-witness';
import { upToDateHeadline, upToDateCaption } from '$lib/view-models/up-to-date';
import {
	rankLabel,
	rankRole,
	rankTitle,
	rankBehindBy,
	rankIsAdverse,
	rankVerdictsByRollout
} from '$lib/view-models/env-rank';
import {
	autoDeployState,
	autoDeployWhy,
	manualDeployNote,
	clearPinOutcome,
	rollbackStory
} from '$lib/view-models/auto-deploy';
import {
	ApiError,
	errorHeadline,
	errorConsequence,
	errorFacts,
	isRetryable,
	queryRetry,
	MAX_RETRIES
} from '$lib/api/errors';
import { bakeWord, bakeTitle, BAKE_WORD, BAKE_TITLE } from '$lib/bake-status';
import { isNeedsYou, isSteady, isTrailing, isHealthy } from '$lib/view-models/fleet-groups';
import { buildRolloutCards } from '$lib/rollout-cards';

/**
 * PROPERTY 1 -- THE SENTENCE IS TRUE FOR THE STATE THAT PRODUCED IT.
 *
 * Every assertion below starts from a STATE, not from a string. That
 * direction is the whole design. A suite written the other way round -- "here
 * are the sentences, do they read well" -- is what three audits already did,
 * and the defect class came back each time in a state nobody had staged.
 *
 * -- GROUND TRUTH ---------------------------------------------------------
 *
 * The controller, read directly, never the component:
 *
 *   rollout_controller.go:240  `if !hasManualDeployment && len(history) > 0 {
 *                               if !gatesPassing { return } ... }`
 *   rollout_controller.go:258  `if !hasManualDeployment && len(history) > 0 &&
 *                               !healthChecksHealthy { return }`
 *   rollout_controller.go:295  the failed-bake short-circuit, same guard
 *
 * All three carry `!hasManualDeployment`, so EVERY sentence about a hold in
 * this product scopes to AUTOMATIC promotion. A sentence that says
 * "deployments are blocked" or "nothing new deploys here" is false, and both
 * of those shipped.
 *
 *   githubenvironment_controller.go:1643 `updateAllowedVersionsFromRelationships`
 *
 * writes the DOWNSTREAM environment's gate allow-list from the UPSTREAM
 * environment's successful history. So "Production is not touched." on an
 * override deploy into staging was false in exactly the case it printed.
 *
 * -- THE COMPLETENESS GUARD, AT THE BOTTOM OF THIS FILE -------------------
 *
 * Everything a matrix case produces is recorded. The last describe block
 * asserts that every prose literal in every `SENTENCE_MODULE` was produced by
 * at least one state, or is named in `UNREACHED` with a reason. A branch
 * nobody can reach fails loudly instead of quietly returning a default --
 * which is precisely how `person` survived as the gate fall-through through
 * two releases.
 */

// ─────────────────────────────────────────────────────────────────────────
// THE RECORDER
// ─────────────────────────────────────────────────────────────────────────

const produced = new Set<string>();

/** Assert a state's output AND record it against the coverage guard. */
function says(actual: string | null | undefined, expected: string | RegExp): void {
	if (typeof actual === 'string') produced.add(actual);
	if (expected instanceof RegExp) expect(actual).toMatch(expected);
	else expect(actual).toBe(expected);
}

/** Record without asserting an exact form -- for lists and aggregates. */
function saw(...values: Array<string | null | undefined>): void {
	for (const v of values) if (typeof v === 'string') produced.add(v);
}

// ─────────────────────────────────────────────────────────────────────────
// FIXTURES -- shaped like the live payload, minimal per state
// ─────────────────────────────────────────────────────────────────────────

const rel = (tag: string, created = '2026-08-01T00:00:00Z') => ({ tag, version: tag, created });

/** A rollout with N releases, running index `at`, plus whatever gates. */
function rollout(opts: {
	ns?: string;
	name?: string;
	releases?: string[];
	at?: number | null;
	gates?: Array<{ name: string; passing?: boolean; allowedVersions?: string[] | null }>;
	candidates?: string[] | null;
	pinned?: string | null;
	bakeStatus?: string;
	conditions?: Array<{
		type: string;
		status: string;
		message?: string;
		lastTransitionTime?: string;
	}>;
	history?: any[];
}): any {
	const releases = (opts.releases ?? ['a1', 'b2', 'c3']).map((t) => rel(t));
	const at = opts.at === undefined ? 0 : opts.at;
	const current = at === null ? null : releases[at];
	const cands =
		opts.candidates === undefined
			? at === null
				? []
				: releases
						.slice(at + 1)
						.reverse()
						.map((r) => r.tag)
			: opts.candidates;
	return {
		metadata: { name: opts.name ?? 'alpha-app', namespace: opts.ns ?? 'alpha-dev' },
		spec: opts.pinned ? { wantedVersion: opts.pinned } : {},
		status: {
			availableReleases: releases,
			releaseCandidates: cands === null ? undefined : cands.map((t) => rel(t)),
			gates: opts.gates ?? [],
			conditions: opts.conditions ?? [],
			history:
				opts.history ??
				(current
					? [
							{
								version: current,
								timestamp: '2026-08-31T00:00:00Z',
								bakeStatus: opts.bakeStatus ?? 'Succeeded'
							}
						]
					: [])
		}
	};
}

// ═════════════════════════════════════════════════════════════════════════
// blocking-story.ts
// ═════════════════════════════════════════════════════════════════════════

describe('blocking-story: every gate kind is classified from evidence', () => {
	const ENVS = {
		items: [
			{
				metadata: { namespace: 'ns', name: 'e-after' },
				spec: { environment: 'staging', relationship: { environment: 'dev', type: 'After' } },
				status: { rolloutGateRef: { name: 'gate-after' } }
			},
			{
				metadata: { namespace: 'ns', name: 'e-par' },
				spec: { environment: 'canary', relationship: { environment: 'prod', type: 'Parallel' } },
				status: { rolloutGateRef: { name: 'gate-par' } }
			},
			{
				metadata: { namespace: 'ns', name: 'e-norel' },
				spec: { environment: 'dev' },
				status: { rolloutGateRef: { name: 'gate-norel' } }
			}
		]
	} as any;
	const DEPS = {
		items: [
			{
				metadata: { namespace: 'ns', name: 'd1' },
				spec: { contract: 'api', providerRef: { name: 'alpha-api' } },
				status: { gateName: 'gate-dep', providedVersion: '1.66.0' }
			},
			{
				metadata: { namespace: 'ns', name: 'd2' },
				spec: { contract: 'api', providerRef: { name: 'beta-api' } },
				status: { gateName: 'gate-dep-unread' }
			}
		]
	} as any;

	const full = buildGateContext({ environments: ENVS, rolloutDependencies: DEPS });

	test('promotion gate, After -- names the upstream environment and nobody to approve', () => {
		const g = classifyGate({ name: 'gate-after', allowedVersions: [] }, 'ns', full);
		expect(g.kind).toBe('promotion');
		expect(g.clears).toBe('upstream');
		says(g.label, 'after dev');
		says(g.clause, 'dev deploys it first');
		says(g.short, 'Waiting for dev to deploy it first');
	});

	test('promotion gate, Parallel -- a different verb, because the order differs', () => {
		const g = classifyGate({ name: 'gate-par', allowedVersions: [] }, 'ns', full);
		says(g.clause, 'prod deploys it alongside');
		says(g.short, 'Waiting for prod to deploy it alongside');
	});

	test('promotion gate with no relationship published -- says so, invents no upstream', () => {
		const g = classifyGate({ name: 'gate-norel', allowedVersions: [] }, 'ns', full);
		says(g.label, 'after its upstream environment');
		says(g.clause, 'its upstream environment deploys this build');
		says(g.short, 'Waiting for its upstream environment to deploy this build');
	});

	test('dependency gate -- names the provider, the contract and its current version', () => {
		const g = classifyGate({ name: 'gate-dep', allowedVersions: [] }, 'ns', full);
		expect(g.clears).toBe('upstream');
		says(g.label, 'depends on alpha-api');
		says(g.clause, 'alpha-api ships a newer api than 1.66.0');
		says(g.short, 'Waiting for alpha-api to ship a newer api — it is on 1.66.0');
	});

	test('dependency gate that has read no provider version -- stops at the observable', () => {
		const g = classifyGate({ name: 'gate-dep-unread', allowedVersions: [] }, 'ns', full);
		says(g.clause, 'beta-api ships a newer api');
		says(g.short, 'Waiting for beta-api to ship a newer api');
	});

	test('schedule gate -- the window name and the clock, from managedGates', () => {
		const ctx = withSchedules(full, 'ns', [
			{
				metadata: {
					name: 'business-hours',
					annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
				},
				spec: { action: 'Allow' },
				status: {
					active: false,
					nextTransition: '2026-09-01T09:00:00Z',
					managedGates: ['gate-sched']
				}
			} as any
		]);
		const g = classifyGate({ name: 'gate-sched', passing: false }, 'ns', ctx);
		expect(g.clears).toBe('clock');
		says(g.label, 'Business Hours Only');
		says(g.clause, 'the deploy window reopens');
		says(g.short, 'Outside the Business Hours Only deploy window');
		expect(g.clearsAt).toBe('2026-09-01T09:00:00Z');
		// ⭐ THE DRAWN FORM: the window's own name, and a verb that needs the
		// clock after it. A card renders `Business Hours Only reopens in 12h 59m`
		// where it used to render the whole sentence plus the absolute instant,
		// three wrapped lines in a 300px card.
		says(g.predicate, 'reopens in');
		expect(g.subject).toBe('Business Hours Only');
		expect(g.subjectKind).toBe('schedule');
	});

	test('a window with NO published transition draws nothing -- `reopens in` needs a clock', () => {
		// ⛔ A NAME IS NOT A STATE, and `reopens in` with nothing after it is a
		// broken sentence. With no `nextTransition` the drawing is off and every
		// surface falls back to `short`, which is complete on its own.
		const ctx = withSchedules(full, 'ns', [
			{
				metadata: { name: 'freeze' },
				spec: { action: 'Deny' },
				status: { active: true, managedGates: ['gate-nt'] }
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		]);
		const g = classifyGate({ name: 'gate-nt', passing: false }, 'ns', ctx);
		expect(g.clears).toBe('clock');
		expect(g.subject).toBeNull();
		expect(g.predicate).toBeNull();
		says(g.short, 'Outside the freeze deploy window');
	});

	test('a Deny schedule blocks while ACTIVE -- the same predicate the API uses', () => {
		const ctx = withSchedules(full, 'ns', [
			{
				metadata: { name: 'freeze' },
				spec: { action: 'Deny' },
				status: { active: true, nextTransition: null, managedGates: ['gate-freeze'] }
			} as any
		]);
		says(
			classifyGate({ name: 'gate-freeze', passing: false }, 'ns', ctx).short,
			'Outside the freeze deploy window'
		);
	});

	test('an Allow schedule that IS active explains nothing and is not attributed to it', () => {
		const ctx = withSchedules(full, 'ns', [
			{
				metadata: { name: 'open' },
				spec: { action: 'Allow' },
				status: { active: true, managedGates: ['gate-open'] }
			} as any
		]);
		const g = classifyGate({ name: 'gate-open', passing: false }, 'ns', ctx);
		expect(g.kind).toBe('check');
		says(g.short, 'A check is not passing');
	});

	test('not passing, no window published -- true and unschedulable, no invented clock', () => {
		const g = classifyGate({ name: 'gate-x', passing: false }, 'ns', full);
		says(g.clause, 'a check starts passing');
		says(g.short, 'A check is not passing');
		expect(g.clearsAt).toBeNull();
	});

	/**
	 * THE FALL-THROUGH, AND THE REASON THIS MODULE EXISTS. `person` used to be
	 * reached by ABSENCE. It is now reached only from evidence, and the three
	 * ways of failing to get there each have their own sentence.
	 */
	test('owner-reference veto: an Environment-owned gate can never be an approval', () => {
		const ctx = buildGateContext({
			environments: null,
			rolloutDependencies: null,
			rolloutGates: {
				items: [
					{
						metadata: {
							name: 'ghd-xm669',
							namespace: 'ns',
							ownerReferences: [{ controller: true, kind: 'Environment', name: 'prod' }]
						}
					}
				]
			}
		} as any);
		const g = classifyGate({ name: 'ghd-xm669', allowedVersions: [] }, 'ns', ctx);
		expect(g.clears).toBe('upstream');
		says(g.short, 'Waiting for its upstream environment to deploy this build');
	});

	test('owner-reference veto: a RolloutDependency-owned gate is a machine, not a person', () => {
		const ctx = buildGateContext({
			rolloutGates: {
				items: [
					{
						metadata: {
							name: 'dep-1',
							namespace: 'ns',
							ownerReferences: [{ controller: true, kind: 'RolloutDependency', name: 'd' }]
						}
					}
				]
			}
		} as any);
		const g = classifyGate({ name: 'dep-1', allowedVersions: [] }, 'ns', ctx);
		says(g.label, 'depends on another service');
		says(g.clause, 'the service it depends on ships a newer version');
		says(g.short, 'Waiting for the service it depends on to ship a newer version');
	});

	test('a controller we have no story for -- names the owner and stops', () => {
		const ctx = buildGateContext({
			rolloutGates: {
				items: [
					{
						metadata: {
							name: 'x-1',
							namespace: 'ns',
							ownerReferences: [{ controller: true, kind: 'PolicyEngine', name: 'p' }]
						}
					}
				]
			}
		} as any);
		const g = classifyGate({ name: 'x-1', allowedVersions: [] }, 'ns', ctx);
		expect(g.clears).toBe('unknown');
		says(g.label, 'PolicyEngine p');
		says(g.clause, 'PolicyEngine p allows this build');
		says(g.short, 'Held by PolicyEngine p');
	});

	test('an owner reference we read with NO controller owner -- positive human evidence', () => {
		const ctx = buildGateContext({
			rolloutGates: {
				items: [{ metadata: { name: 'manual', namespace: 'ns', ownerReferences: [] } }]
			}
		} as any);
		const g = classifyGate({ name: 'manual', allowedVersions: [] }, 'ns', ctx);
		expect(g.clears).toBe('person');
		says(g.clause, 'someone approves it');
		says(g.short, 'Waiting for someone to approve it');
	});

	test('no owner info but every attributing source WAS consulted -- also an approval', () => {
		const g = classifyGate({ name: 'manual', allowedVersions: [] }, 'ns', full);
		expect(g.clears).toBe('person');
		says(g.short, 'Waiting for someone to approve it');
	});

	/**
	 * The regression the second critique filed: rollout detail hard-coded
	 * `rolloutDependencies: null`, so a machine gate was captioned as an
	 * approval on the rollout's own page. With a source missing the answer is
	 * `unknown`, and `unknown` refuses BOTH wrong instructions.
	 */
	test('a source that was never served -- unknown, and it names no remedy', () => {
		const partial = buildGateContext({
			environments: { items: [] },
			rolloutDependencies: null
		} as any);
		const g = classifyGate({ name: 'mystery-gate', allowedVersions: [] }, 'ns', partial);
		expect(g.clears).toBe('unknown');
		says(g.label, 'mystery-gate');
		says(g.clause, 'the rule mystery-gate allows this build');
		says(g.short, 'Held by mystery-gate — this dashboard cannot tell what clears it');
	});

	test('an empty source IS a consulted source; a null one is not', () => {
		expect(
			buildGateContext({ environments: { items: [] }, rolloutDependencies: { items: [] } } as any)
				.sources
		).toEqual({
			environments: true,
			dependencies: true
		});
		expect(buildGateContext({} as any).sources).toEqual({
			environments: false,
			dependencies: false
		});
	});

	test('a gate with no name at all still gets a handle, never an empty sentence', () => {
		says(classifyGate({}, 'ns', EMPTY_GATE_CONTEXT).label, 'a rule');
	});

	test('prettyNameOf reads the annotation, and nothing else', () => {
		expect(
			prettyNameOf({ annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' } })
		).toBe('Business Hours Only');
		expect(prettyNameOf({})).toBeNull();
		expect(prettyNameOf(undefined)).toBeNull();
	});
});

describe('blocking-story: the story a page prints, one state at a time', () => {
	const ctxFull = buildGateContext({
		environments: { items: [] },
		rolloutDependencies: { items: [] }
	} as any);

	test('nothing newer -- no story at all, and no sentence to misread', () => {
		const s = blockingStory(rollout({ at: 2 }), ctxFull);
		expect(s.blocked).toBe(false);
		expect(s.headline).toBe('');
		expect(s.resolution).toBe('');
	});

	test('never deployed -- also no story; a first deploy is never gate-held', () => {
		const s = blockingStory(rollout({ at: null }), ctxFull);
		expect(s.blocked).toBe(false);
	});

	test('pinned with newer builds -- the pin is the cause, no gate is', () => {
		const r = rollout({
			at: 0,
			pinned: 'a1',
			gates: [{ name: 'manual', allowedVersions: [] }]
		});
		const s = blockingStory(r, ctxFull, { place: 'staging' });
		says(s.headline, 'STAGING is pinned to a1');
		says(
			s.consequence,
			'2 newer builds are available and none of them will deploy while the pin is set.'
		);
		says(s.verdict, 'Clearing the pin is the only thing that restarts automatic deploys.');
		says(shortStory(s), 'Pinned to a1');
		expect(s.gates).toEqual([]);
	});

	test('pinned to the newest build -- singular grammar, and no invented count', () => {
		const s = blockingStory(rollout({ at: 2, pinned: 'c3' }), ctxFull);
		says(s.headline, 'this service is pinned to c3');
		says(s.consequence, 'Automatic updates are off here until the pin is cleared.');
	});

	test('pinned with exactly one newer build -- the singular branch', () => {
		const s = blockingStory(rollout({ at: 1, pinned: 'b2' }), ctxFull);
		says(
			s.consequence,
			'1 newer build is available and none of them will deploy while the pin is set.'
		);
	});

	test('one approval gate -- the only state whose verdict is escalate', () => {
		const r = rollout({ at: 0, gates: [{ name: 'manual', allowedVersions: [] }] });
		const s = blockingStory(r, ctxFull, { place: 'staging' });
		says(s.headline, 'STAGING is waiting on an approval');
		says(
			s.consequence,
			'2 newer builds are waiting. Nothing promotes itself until someone approves it.'
		);
		says(s.verdict, 'This will not clear on its own.');
		says(
			s.resolution,
			'This will not clear on its own. A deploy you start by hand still applies immediately.'
		);
		expect(s.selfClearing).toBe(false);
		expect(s.severity).toBe('warning');
	});

	/**
	 * THE MANUAL-DEPLOY CLAUSE IS NOT DECORATION. `rollout_controller.go:240`
	 * holds AUTOMATIC promotion only. A banner without this clause reads as an
	 * outage, and two shipped strings -- `Nothing new deploys here until it
	 * passes` and `Manual only` -- were wrong in exactly this way.
	 */
	test('every resolution keeps the manual-deploy escape, in every gate state', () => {
		const states = [
			rollout({ at: 0, gates: [{ name: 'manual', allowedVersions: [] }] }),
			rollout({ at: 0, gates: [{ name: 'sched', passing: false }] }),
			rollout({ at: 0, gates: [{ name: 'mystery', allowedVersions: [] }] })
		];
		for (const r of states) {
			const s = blockingStory(r, EMPTY_GATE_CONTEXT);
			expect(s.resolution).toContain('A deploy you start by hand still applies immediately.');
			expect(s.resolution).not.toMatch(/deployments are blocked|nothing new deploys/i);
			saw(s.resolution);
		}
	});

	test('one unknown gate -- states the fact, names no remedy, is not self-clearing', () => {
		const partial = buildGateContext({
			environments: { items: [] },
			rolloutDependencies: null
		} as any);
		const s = blockingStory(
			rollout({ at: 0, gates: [{ name: 'ghd-p2fld', allowedVersions: [] }] }),
			partial,
			{
				place: 'dev'
			}
		);
		says(s.headline, 'Something is holding DEV');
		says(
			s.verdict,
			'This dashboard cannot tell what clears this — it may or may not need a person.'
		);
		expect(s.selfClearing).toBe(false);
		says(shortStory(s), 'Held by ghd-p2fld — this dashboard cannot tell what clears it');
	});

	test('one upstream gate -- explicitly says nobody has to approve anything', () => {
		const ctx = buildGateContext({
			environments: {
				items: [
					{
						metadata: { namespace: 'alpha-dev', name: 'e' },
						spec: { environment: 'staging', relationship: { environment: 'dev', type: 'After' } },
						status: { rolloutGateRef: { name: 'ghd-1' } }
					}
				]
			},
			rolloutDependencies: { items: [] }
		} as any);
		const s = blockingStory(
			rollout({ at: 0, gates: [{ name: 'ghd-1', allowedVersions: [] }] }),
			ctx,
			{
				place: 'staging'
			}
		);
		says(s.headline, 'STAGING is waiting on another deploy');
		says(
			s.verdict,
			'Nobody has to approve anything — this clears when the deploy in front of it lands.'
		);
		expect(s.selfClearing).toBe(false);
	});

	/**
	 * ⛔ THE DEFECT: a `RolloutDependency` contract gate is `clears: 'upstream'`
	 * too, and the verdict used to be ONE HARD-CODED SENTENCE for the whole
	 * bucket — true of a promotion order, false of a contract, which has no
	 * "deploy in front of it" at all. A contract clears when the PROVIDER
	 * ships a version that satisfies it, and the verdict now says so by name.
	 * `hello-dep-prod`'s live shape: `hello-api-app`, contract `api`,
	 * `blockedReleases: [{ tag: 'rel-67', requiredVersion: '^1.67.0' }]`.
	 */
	test('one CONTRACT gate -- names the provider and the required version, never "deploy in front"', () => {
		const ctx = buildGateContext({
			environments: { items: [] },
			rolloutDependencies: {
				items: [
					{
						metadata: { namespace: 'hello-dep-prod', name: 'd' },
						spec: { contract: 'api', providerRef: { name: 'hello-api-app' } },
						status: {
							gateName: 'dependency-hello-frontend-needs-api',
							providedVersion: '1.66.0',
							blockedReleases: [
								{ tag: 'rel-67', requiredVersion: '^1.67.0', reason: 'ConstraintNotSatisfied' }
							]
						}
					}
				]
			}
		} as any);
		const s = blockingStory(
			rollout({
				ns: 'hello-dep-prod',
				at: 0,
				gates: [{ name: 'dependency-hello-frontend-needs-api', allowedVersions: [] }]
			}),
			ctx,
			{ place: 'prod' }
		);
		// ⭐ (2026-09-03) A lone contract gate now names the provider and the
		// required version in the HEADLINE too, not only the verdict — see
		// `upstreamHeadline`'s doc: the live `hello-dep-dev` shape carries only
		// this one gate, and it used to print the same generic sentence a lone
		// promotion gate does.
		says(s.headline, 'PROD is waiting for hello-api-app to ship api ^1.67.0');
		// ⛔ NOT "Nobody has to approve anything" LEADING — superseded
		// 2026-09-03 (operator-walk finding 6): that clause is the one a 3am
		// reader takes as "not mine" and stops reading. A contract gate leads
		// with the negative and names the escape hatch (a hand-started
		// deploy) instead. See `upstreamVerdict`.
		says(
			s.verdict,
			'No approval will unblock this. Someone has to ship api ^1.67.0 from hello-api-app; until then the only way forward is a hand-started deploy, which bypasses the check.'
		);
		expect(s.verdict).not.toContain('deploy in front');
		expect(s.selfClearing).toBe(false);
		// ⛔ THE MANUAL CLAUSE DOES NOT DOUBLE ITSELF. (2026-09-03, coordinator
		// follow-up) `upstreamVerdict` already states the hand-started-deploy
		// escape hatch for a contract gate, so `resolution` must not append
		// the generic `A deploy you start by hand still applies immediately.`
		// a second time — the banner read the identical fact twice back to
		// back before this fix. `resolution` here is BYTE-IDENTICAL to
		// `verdict`, not `verdict + manual`.
		expect(s.resolution).toBe(s.verdict);
		expect(s.resolution.match(/hand-started deploy|start.*by hand/gi)?.length).toBe(1);
	});

	test('a promotion gate AND a contract gate together -- the contract LEADS', () => {
		// ⭐ (2026-09-02, second pass, from the human: "The contract is the
		// binding cause; the order gate follows on its own once the provider
		// ships.") The contract names WHO has to act; the promotion gate is
		// the environment controller's own bookkeeping, which opens once the
		// provider ships. The contract clause leads.
		const ctx = buildGateContext({
			environments: {
				items: [
					{
						metadata: { namespace: 'ns', name: 'e' },
						spec: { environment: 'staging', relationship: { environment: 'dev', type: 'After' } },
						status: { rolloutGateRef: { name: 'ghd-1' } }
					}
				]
			},
			rolloutDependencies: {
				items: [
					{
						metadata: { namespace: 'ns', name: 'd' },
						spec: { contract: 'api', providerRef: { name: 'hello-api-app' } },
						status: {
							gateName: 'dep-1',
							providedVersion: '1.66.0',
							blockedReleases: [{ tag: 'x', requiredVersion: '^1.67.0' }]
						}
					}
				]
			}
		} as any);
		const s = blockingStory(
			rollout({
				ns: 'ns',
				at: 0,
				gates: [
					{ name: 'ghd-1', allowedVersions: [] },
					{ name: 'dep-1', allowedVersions: [] }
				]
			}),
			ctx,
			{ place: 'staging' }
		);
		says(
			s.verdict,
			'No approval will unblock this. Someone has to ship api ^1.67.0 from hello-api-app, then the deploy in front of it has to land; until then the only way forward is a hand-started deploy, which bypasses the check.'
		);
		// ⛔ THE DEFECT: `hello-frontend-app`'s Overview banner read "Two things
		// are holding PROD" for this exact shape — a contract gate and the
		// promotion-order gate downstream of the same contract, both
		// `clears: 'upstream'`. Two gates, one cause, so the headline names
		// the cause the same way a lone contract gate's verdict already does,
		// rather than counting to two.
		says(s.headline, 'STAGING is waiting for hello-api-app to ship api ^1.67.0');
		expect(s.headline).not.toMatch(/things are holding/);
		// Mixed gates too: the verdict already carries the escape hatch, so
		// `resolution` must not append it a second time.
		expect(s.resolution).toBe(s.verdict);
	});

	test('a promotion gate AND a contract with no agreed requirement -- the headline falls back to "a newer <contract>"', () => {
		// ⛔ Masterminds semver constraints are not orderable across spellings,
		// so two held candidates asking for different ranges have no single
		// "the" requirement (see `ClassifiedGate.need`). The headline falls
		// back the same way the dependency clause itself does.
		const ctx = buildGateContext({
			environments: {
				items: [
					{
						metadata: { namespace: 'ns2', name: 'e' },
						spec: { environment: 'staging', relationship: { environment: 'dev', type: 'After' } },
						status: { rolloutGateRef: { name: 'ghd-1' } }
					}
				]
			},
			rolloutDependencies: {
				items: [
					{
						metadata: { namespace: 'ns2', name: 'd' },
						spec: { contract: 'api', providerRef: { name: 'hello-api-app' } },
						status: {
							gateName: 'dep-1',
							providedVersion: '1.66.0',
							blockedReleases: [
								{ tag: 'x', requiredVersion: '^1.1.0' },
								{ tag: 'y', requiredVersion: '^2.0.0' }
							]
						}
					}
				]
			}
		} as any);
		const s = blockingStory(
			rollout({
				ns: 'ns2',
				at: 0,
				gates: [
					{ name: 'ghd-1', allowedVersions: [] },
					{ name: 'dep-1', allowedVersions: [] }
				]
			}),
			ctx,
			{ place: 'staging' }
		);
		says(s.headline, 'STAGING is waiting for hello-api-app to ship a newer api');
		// ⭐ (2026-09-03) Reaches `upstreamVerdict`'s "no agreed requirement"
		// fallback template too — the headline alone left `ship a newer
		// <contract> from <provider>` unproduced by any state in this file.
		says(
			s.verdict,
			'No approval will unblock this. Someone has to ship a newer api from hello-api-app, then the deploy in front of it has to land; until then the only way forward is a hand-started deploy, which bypasses the check.'
		);
	});

	test('one clock gate -- the time is printed, and the verdict is go back to bed', () => {
		const ctx = withSchedules(ctxFull, 'alpha-dev', [
			{
				metadata: {
					name: 'bh',
					annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
				},
				spec: { action: 'Allow' },
				status: { active: false, nextTransition: '2026-08-31T13:00:00Z', managedGates: ['sg-1'] }
			} as any
		]);
		const s = blockingStory(rollout({ at: 0, gates: [{ name: 'sg-1', passing: false }] }), ctx, {
			now: new Date('2026-08-31T09:00:00Z')
		});
		says(s.headline, 'this service is held');
		expect(s.consequence).toMatch(/Nothing promotes itself until the deploy window reopens in 4h/);
		says(s.verdict, 'This clears on its own.');
		expect(s.selfClearing).toBe(true);
		// ⛔ SUPERSEDED 2026-09-03 (F2): `warning`, not `info` -- a schedule is
		// a RULE holding the rollout, not a state a person chose, whatever
		// `selfClearing` says about whether a person has to act on it. See
		// `blocking-story.ts`'s own doc comment on the `severity` field.
		expect(s.severity).toBe('warning');
		saw(s.consequence);
	});

	test('a clock gate whose schedule published no next transition -- no invented time', () => {
		const ctx = withSchedules(ctxFull, 'alpha-dev', [
			{
				metadata: { name: 'bh' },
				spec: { action: 'Allow' },
				status: { active: false, managedGates: ['sg-1'] }
			} as any
		]);
		const s = blockingStory(rollout({ at: 0, gates: [{ name: 'sg-1', passing: false }] }), ctx);
		expect(s.consequence).toBe(
			'2 newer builds are waiting. Nothing promotes itself until the deploy window reopens.'
		);
		says(s.verdict, 'This clears on its own once the check passes.');
	});

	test('one check gate -- clears itself, but the wording does not promise a clock', () => {
		const s = blockingStory(rollout({ at: 0, gates: [{ name: 'hc', passing: false }] }), ctxFull);
		says(s.headline, 'this service is held');
		says(s.verdict, 'This clears on its own once the check passes.');
		expect(s.selfClearing).toBe(true);
	});

	test('several gates -- it COUNTS them; naming one as the whole story was the defect', () => {
		const s = blockingStory(
			rollout({
				at: 0,
				gates: [
					{ name: 'manual', allowedVersions: [] },
					{ name: 'sched', passing: false }
				]
			}),
			ctxFull,
			{ place: 'prod' }
		);
		says(s.headline, 'Two things are holding PROD');
		expect(s.consequence).toContain('someone approves it');
		expect(s.consequence).toContain('a check starts passing');
		says(s.verdict, 'This will not clear on its own.');
		says(shortStory(s), 'Held by 2 rules — waiting on an approval and a check');
		says(ruleHandle(s), 'manual, sched');
		saw(s.consequence);
	});

	test('more gates than the count words cover -- falls back to the numeral, never blank', () => {
		const gates = Array.from({ length: 7 }, (_, i) => ({ name: `g${i}`, passing: false }));
		const s = blockingStory(rollout({ at: 0, gates }), ctxFull, { place: 'dev' });
		says(s.headline, '7 things are holding DEV');
		saw(shortStory(s), s.consequence);
	});

	test('shortStory kinds cover every clears value, so a row cannot be silent', () => {
		const partial = buildGateContext({
			environments: { items: [] },
			rolloutDependencies: null
		} as any);
		const s = blockingStory(
			rollout({
				at: 0,
				gates: [
					{ name: 'manual', allowedVersions: [] },
					{ name: 'mystery', allowedVersions: [] },
					{ name: 'sched', passing: false }
				]
			}),
			partial
		);
		const short = shortStory(s)!;
		says(short, /^Held by 3 rules — waiting on /);
		expect(short).toContain('a rule this dashboard cannot attribute');
	});

	test('an upstream + clock mix names both kinds in the row form', () => {
		const ctx = withSchedules(
			buildGateContext({
				environments: {
					items: [
						{
							metadata: { namespace: 'alpha-dev', name: 'e' },
							spec: { environment: 'staging', relationship: { environment: 'dev', type: 'After' } },
							status: { rolloutGateRef: { name: 'ghd-1' } }
						}
					]
				},
				rolloutDependencies: { items: [] }
			} as any),
			'alpha-dev',
			[
				{
					metadata: { name: 'bh' },
					spec: { action: 'Allow' },
					status: { active: false, nextTransition: '2026-09-01T09:00:00Z', managedGates: ['sg-1'] }
				} as any
			]
		);
		const s = blockingStory(
			rollout({
				at: 0,
				gates: [
					{ name: 'ghd-1', allowedVersions: [] },
					{ name: 'sg-1', passing: false }
				]
			}),
			ctx
		);
		says(shortStory(s), 'Held by 2 rules — waiting on another deploy and a deploy window');
	});

	test('ruleHandle is null when there is nothing to look up', () => {
		expect(ruleHandle(blockingStory(rollout({ at: 2 }), ctxFull))).toBeNull();
		expect(shortStory(blockingStory(rollout({ at: 2 }), ctxFull))).toBeNull();
	});

	test('joinClauses is English, at every length', () => {
		expect(joinClauses([])).toBe('');
		expect(joinClauses(['a'])).toBe('a');
		says(joinClauses(['a', 'b']), 'a and b');
		says(joinClauses(['a', 'b', 'c']), 'a, b and c');
	});
});

// ═════════════════════════════════════════════════════════════════════════
// verdict.ts
// ═════════════════════════════════════════════════════════════════════════

const env = (o: Partial<Parameters<typeof verdictSentence>[0][number]>): any => ({
	label: 'dev',
	status: 'Succeeded',
	behind: 0,
	blocked: false,
	stuck: false,
	awaitingApprovalGates: [],
	notPassingGates: [],
	stuckKind: null,
	stuckForMs: null,
	version: 'a1',
	...o
});

describe('verdict: one sentence, in strict precedence, never a fabricated cause', () => {
	test('no environments -- no sentence', () => {
		expect(verdictSentence([])).toBeNull();
	});

	test('1 -- a failure outranks everything', () => {
		says(
			verdictSentence([
				env({ label: 'prod', status: 'Failed' }),
				env({ label: 'dev', behind: 99, stuck: true })
			]),
			"prod's last deploy failed."
		);
	});

	test('2 -- diverged outranks stuck, and prints NO lag for it', () => {
		says(
			verdictSentence([env({ label: 'prod', diverged: true, version: '9f10e49', behind: 19 })]),
			'prod is on 9f10e49, which is not on the release line.'
		);
	});

	test('2 -- diverged with no version still says the fact', () => {
		says(
			verdictSentence([env({ label: 'prod', diverged: true, version: null })]),
			'prod is running a build that is not on the release line.'
		);
	});

	test('2 -- several diverged environments are counted and named', () => {
		says(
			verdictSentence([
				env({ label: 'prod', diverged: true }),
				env({ label: 'staging', diverged: true })
			]),
			'2 environments (prod, staging) are off the release line.'
		);
	});

	test('3 -- wedged on an approval gate: a person', () => {
		says(
			verdictSentence([
				env({ label: 'prod', behind: 19, blocked: true, awaitingApprovalGates: ['m'] })
			]),
			'prod is 19 builds behind, waiting on a manual approval.'
		);
	});

	test('3 -- wedged on a not-passing gate: a window, not an approval', () => {
		says(
			verdictSentence([env({ label: 'prod', behind: 1, blocked: true, notPassingGates: ['s'] })]),
			'prod is 1 build behind, waiting on a deploy window.'
		);
	});

	/**
	 * NEVER A FABRICATED CAUSE. With no gate on either list, `blockReason`
	 * returns null and the sentence falls to what was OBSERVED. The shipped
	 * defect was `return 'a gate'` on an app that defines no gates -- the most
	 * prominent sentence on the page asserting a mechanism with no evidence.
	 */
	test('3 -- wedged with NO gate at all: says what was observed, invents no gate', () => {
		expect(verdictBlockReason({ awaitingApprovalGates: [], notPassingGates: [] })).toBeNull();
		says(
			verdictSentence([
				env({
					label: 'prod',
					behind: 19,
					stuck: true,
					stuckKind: 'baking',
					stuckForMs: 76 * 3600_000
				})
			]),
			/^prod is 19 builds behind, checking for /
		);
		says(
			verdictSentence([
				env({ label: 'prod', behind: 3, stuck: true, stuckKind: 'deploying', stuckForMs: 3600_000 })
			]),
			/^prod is 3 builds behind, deploying for /
		);
		says(
			verdictSentence([
				env({ label: 'prod', behind: 3, stuck: true, stuckKind: 'behind', stuckForMs: 7200_000 })
			]),
			/^prod is 3 builds behind, and has not moved in /
		);
		says(
			verdictSentence([
				env({ label: 'prod', behind: 3, stuck: true, stuckKind: null, stuckForMs: null })
			]),
			'prod is 3 builds behind, and is not moving.'
		);
	});

	test('3 -- wedged with an UNKNOWABLE lag prints no number', () => {
		says(
			verdictSentence([env({ label: 'prod', behind: null, stuck: true, stuckKind: null })]),
			'prod is behind, and is not moving.'
		);
	});

	test('3 -- wedged at zero lag uses the solo form, not a dangling participle', () => {
		says(
			verdictSentence([
				env({ label: 'prod', behind: 0, stuck: true, stuckKind: 'baking', stuckForMs: null })
			]),
			'prod has been checking.'
		);
		says(
			verdictSentence([
				env({ label: 'prod', behind: 0, stuck: true, stuckKind: 'deploying', stuckForMs: null })
			]),
			'prod has been deploying.'
		);
		says(
			verdictSentence([
				env({ label: 'prod', behind: 0, blocked: true, awaitingApprovalGates: ['m'] })
			]),
			'prod is waiting on a manual approval.'
		);
		says(
			verdictSentence([
				env({ label: 'prod', behind: 0, stuck: true, stuckKind: 'behind', stuckForMs: 60_000 })
			]),
			/^prod has not moved in /
		);
	});

	test('4 -- deploying outranks checking; both name the environment', () => {
		says(
			verdictSentence([env({ label: 'dev', status: 'Deploying', behind: 1 })]),
			'dev is deploying.'
		);
		says(
			verdictSentence([env({ label: 'dev', status: 'InProgress', behind: 1 })]),
			'dev is checking.'
		);
	});

	test('5 -- converged, one environment, with and without a shared sha', () => {
		says(verdictSentence([env({ label: 'dev', version: 'a1' })]), 'dev is on a1.');
		says(verdictSentence([env({ label: 'dev', version: null })]), 'dev is on the newest build.');
	});

	test('5 -- converged, several environments', () => {
		says(
			verdictSentence([
				env({ label: 'dev', version: 'a1' }),
				env({ label: 'prod', version: 'a1' })
			]),
			'All 2 environments are on a1.'
		);
		says(
			verdictSentence([
				env({ label: 'dev', version: 'a1' }),
				env({ label: 'prod', version: 'b2' })
			]),
			'All 2 environments are on the newest build.'
		);
	});

	test('6 -- merely behind, singular and plural and unknowable', () => {
		says(verdictSentence([env({ label: 'prod', behind: 4 })]), 'prod is 4 builds behind.');
		says(verdictSentence([env({ label: 'prod', behind: 1 })]), 'prod is 1 build behind.');
		says(verdictSentence([env({ label: 'prod', behind: null })]), 'prod is behind.');
	});
});

// ═════════════════════════════════════════════════════════════════════════
// deploy-risk.ts
// ═════════════════════════════════════════════════════════════════════════

describe('deploy-risk: the confirmation table, every row', () => {
	const base = (o: any = {}) => ({
		direction: 'forward' as const,
		production: false,
		vouched: true,
		custom: false,
		environment: 'dev',
		...o
	});

	// ⛔ SUPERSEDED 2026-09-03 (B3, operator walk). The table `deploy-risk.ts`
	// documents at its own top was rewritten the same day this test was:
	// PRODUCTION is `typed` in every direction now (forward, rollback, and a
	// vouched retry), not only the unvouched forward/retry rows. A live walk
	// found a rollback into production was two taps with no typed
	// confirmation, a non-alarm blue primary and a disabled toggle reading as
	// off while it silently pinned production — the exact ceremony gap this
	// table exists to close, just on the direction the old table exempted.
	// Every NON-production row is byte-identical to before.
	test('the documented table, PRODUCTION now a ceiling regardless of direction', () => {
		expect(confirmLevel(base({ direction: 'forward', production: true, vouched: false }))).toBe(
			'typed'
		);
		expect(confirmLevel(base({ direction: 'forward', production: true, vouched: true }))).toBe(
			'typed'
		);
		expect(confirmLevel(base({ direction: 'forward', production: false, vouched: false }))).toBe(
			'notice'
		);
		expect(confirmLevel(base({ direction: 'forward', production: false, vouched: true }))).toBe(
			'none'
		);
		expect(confirmLevel(base({ direction: 'rollback', production: true }))).toBe('typed');
		expect(confirmLevel(base({ direction: 'rollback', production: false }))).toBe('notice');
		expect(confirmLevel(base({ direction: 'retry', production: true, vouched: false }))).toBe(
			'typed'
		);
		expect(confirmLevel(base({ direction: 'retry', production: true, vouched: true }))).toBe(
			'typed'
		);
		expect(confirmLevel(base({ direction: 'retry', production: false, vouched: false }))).toBe(
			'notice'
		);
		expect(confirmLevel(base({ direction: 'retry', production: false, vouched: true }))).toBe(
			'none'
		);
		expect(confirmLevel(base({ custom: true }))).toBe('typed');
		expect(confirmLevel(base({ direction: 'same' }))).toBe('none');
	});

	test('a rollback OUT of production still never reaches typed — the fast 3am recovery survives', () => {
		expect(confirmLevel(base({ direction: 'rollback', production: false, vouched: false }))).toBe(
			'notice'
		);
	});

	test('a rollback INTO production reaches typed now, same ceiling as forward (B3)', () => {
		expect(confirmLevel(base({ direction: 'rollback', production: true, vouched: false }))).toBe(
			'typed'
		);
	});

	test('direction is measured against the rollout own release list', () => {
		const r = rollout({ releases: ['a1', 'b2', 'c3'], at: 1 });
		expect(deployDirection(r, 'b2')).toBe('same');
		expect(deployDirection(r, 'c3')).toBe('forward');
		expect(deployDirection(r, 'a1')).toBe('rollback');
		expect(deployDirection(r, 'zz')).toBe('forward');
		expect(deployDirection(r, null)).toBe('same');
	});

	test('gatesAllow: an empty allow-list refuses everything, and no gates allows everything', () => {
		expect(gatesAllow(rollout({ gates: [] }), 'a1')).toBe(true);
		expect(gatesAllow(rollout({ gates: [{ name: 'g', allowedVersions: [] }] }), 'a1')).toBe(false);
		expect(
			gatesAllow(rollout({ gates: [{ name: 'g', passing: false, allowedVersions: ['a1'] }] }), 'a1')
		).toBe(false);
		expect(gatesAllow(rollout({ gates: [{ name: 'g', allowedVersions: ['a1'] }] }), 'a1')).toBe(
			true
		);
		expect(gatesAllow(rollout({}), null)).toBe(false);
	});

	test('production is env-order own definition, and the namespace fallback is one-directional', () => {
		expect(isProductionTarget('prod')).toBe(true);
		expect(isProductionTarget('staging')).toBe(false);
		expect(isProductionTarget('')).toBe(false);
		expect(rolloutEnvironmentName(rollout({ ns: 'hello-world-prod' }))).toBe('hello-world-prod');
		expect(isProductionTarget('hello-world-prod')).toBe(true);
		expect(rolloutEnvironmentName(rollout({}), 'staging')).toBe('staging');
	});
});

describe('deploy-risk: every notice, in the state that produces it', () => {
	const intent = (o: any = {}) => ({
		direction: 'forward' as const,
		production: false,
		vouched: true,
		custom: false,
		environment: 'staging',
		...o
	});

	test('none -- no sentence at all, so a dialog is never taught to be ignored', () => {
		expect(confirmNotice(intent())).toBeNull();
		expect(
			retryConsequences(intent({ direction: 'retry' }), {
				failingChecks: [],
				clearsFailureDetail: true
			})
		).toEqual([]);
	});

	test('a custom tag -- says no rule vouched and the commit list may be incomplete', () => {
		says(
			confirmNotice(intent({ custom: true })),
			"This tag is not in staging's release list, so no rule here has vouched for it and the commit list above may be incomplete. It applies immediately."
		);
	});

	test('a rollback -- names the real consequence, older code against newer data', () => {
		says(
			confirmNotice(intent({ direction: 'rollback' })),
			'Goes back to a version staging has already run. It applies immediately; older code will run against data the newer version has already written.'
		);
	});

	test('the pin note rides on every level, and names where it pins', () => {
		says(
			confirmNotice(intent({ direction: 'rollback' }), true),
			/It also pins staging to this version, so nothing newer promotes until the pin is cleared\.$/
		);
	});

	test('production, vouched -- says the controller would have done this itself', () => {
		says(
			confirmNotice(intent({ production: true, environment: 'prod', vouched: true })),
			'This changes production. Every rule currently allows this build, so this is the move the controller would make on its own — it just has not made it yet.'
		);
	});

	test('production, unvouched -- says the word production, twice, and that nothing checks it', () => {
		const n = confirmNotice(intent({ production: true, environment: 'prod', vouched: false }))!;
		says(
			n,
			'This ships to production a build that no rule currently allows. It applies immediately and production starts serving it; nothing checks it first.'
		);
	});

	/**
	 * `Production is not touched.` WAS FALSE IN EXACTLY THIS CASE.
	 * `updateAllowedVersionsFromRelationships` puts a baked upstream build on
	 * the downstream gate's allow-list, so an override into staging can reach
	 * production with nobody pressing anything. The replacement is modal --
	 * `can become allowed` -- because `DeployIntent` cannot see whether any
	 * environment promotes after this one, and the opposite claim would be the
	 * same defect with the sign flipped.
	 */
	test('non-production, unvouched -- never reassures about production', () => {
		const n = confirmNotice(intent({ production: false, environment: 'staging', vouched: false }))!;
		says(
			n,
			'This overrides the rules holding staging, which do not currently allow this build. It applies immediately. It does not deploy to production — but a build that deploys and passes its checks here can become allowed in whatever environment promotes after staging.'
		);
		expect(n).not.toContain('Production is not touched');
	});

	test('targetPhrase gives the modal the word it owed its reader', () => {
		says(targetPhrase(intent({ production: true })), 'production');
		says(targetPhrase(intent({ environment: 'staging' })), 'staging');
		says(targetPhrase(intent({ environment: '' })), 'this environment');
	});

	test('the typed prompt names why it is asking', () => {
		says(typedPrompt(intent({ custom: true })), 'This version is not in the release list. Type');
		says(
			typedPrompt(intent({ production: true, environment: 'prod' })),
			'Nothing has vouched for this build in production. Type'
		);
	});

	// ⭐ 2026-09-03 (B3, operator walk): a rollback into production reaches
	// `typed` now too (see `confirmLevel`'s own doc comment), and "nothing has
	// vouched for this build" is false of it -- the build already ran here
	// successfully, which is why it is a safe place to go back to. This
	// state is what `typedPrompt`'s own rollback branch exists for.
	test('the typed prompt for a rollback names the tier, not a false vouching claim', () => {
		says(
			typedPrompt(intent({ direction: 'rollback', production: true, environment: 'prod' })),
			'This changes production. Type'
		);
	});

	test('the button says where it lands, in every direction', () => {
		says(
			deployActionLabel(intent({ direction: 'rollback', production: true })),
			'Roll back production'
		);
		says(deployActionLabel(intent({ direction: 'rollback', environment: 'dev' })), 'Roll back dev');
		says(deployActionLabel(intent({ direction: 'rollback', environment: '' })), 'Roll back');
		says(
			deployActionLabel(intent({ direction: 'retry', production: true })),
			'Redeploy to production'
		);
		says(deployActionLabel(intent({ direction: 'retry', environment: '' })), 'Redeploy');
		says(deployActionLabel(intent({ environment: 'staging' })), 'Deploy to staging');
		says(deployActionLabel(intent({ environment: '' })), 'Deploy Now');
	});
});

describe('deploy-risk: a retry states what it destroys', () => {
	const prod = (o: any = {}) => ({
		direction: 'retry' as const,
		production: true,
		vouched: false,
		custom: false,
		environment: 'prod',
		...o
	});

	test('unvouched retry into production -- four facts, in the order a reader needs them', () => {
		const lines = retryConsequences(
			prod(),
			{ failingChecks: ['latency'], clearsFailureDetail: true },
			'064b655'
		);
		says(
			lines[0],
			'Redeploys 064b655 to production — the same build whose last deploy here failed.'
		);
		says(
			lines[1],
			'No rule here currently allows this build. It applies immediately and production starts serving it.'
		);
		says(lines[2], 'latency is still failing right now. Nothing has re-checked this build since.');
		says(
			lines[3],
			'Retrying resets that check to “Pending — reset due to new deployment”, which clears the failure detail shown above.'
		);
	});

	test('with no tag in hand it still names the target, never a bare Retry', () => {
		says(
			retryConsequences(prod(), { failingChecks: [], clearsFailureDetail: false })[0],
			'Redeploys the current build to production — the same build whose last deploy here failed.'
		);
	});

	test('a vouched retry says the controller would have made this attempt', () => {
		says(
			retryConsequences(prod({ vouched: true }), {
				failingChecks: [],
				clearsFailureDetail: false
			})[1],
			'Every rule here allows this build, so this is the attempt the controller would make on its own.'
		);
	});

	test('several failing checks are counted, listed and capped', () => {
		const many = retryConsequences(prod(), {
			failingChecks: ['a', 'b', 'c', 'd'],
			clearsFailureDetail: true
		});
		says(
			many[2],
			'4 health checks are still failing right now — a, b, c, …. Nothing has re-checked this build since.'
		);
		says(
			many[3],
			'Retrying resets those checks to “Pending — reset due to new deployment”, which clears the failure detail shown above.'
		);
	});

	/**
	 * THE WORST CASE AND THE ONE WITH ITS OWN SENTENCE: a check that failed
	 * and has RECOVERED still carries `lastErrorTime`, and
	 * `ResetHealthCheckStatus` sets it to nil. Losing the only record that
	 * anything went wrong is not the same event as losing a message that is
	 * still on screen.
	 */
	test('a retry with nothing failing now still says it erases the record', () => {
		says(
			retryConsequences(prod(), { failingChecks: [], clearsFailureDetail: true })[2],
			'Retrying resets this rollout’s health checks to “Pending — reset due to new deployment”, which erases the record that anything failed here.'
		);
	});

	test('retryIntent reads the head of history, and a retry is never a custom tag', () => {
		const r = rollout({ ns: 'alpha-prod', at: 1, gates: [{ name: 'g', allowedVersions: [] }] });
		const i = retryIntent(r);
		expect(i.direction).toBe('retry');
		expect(i.custom).toBe(false);
		expect(i.vouched).toBe(false);
		expect(i.production).toBe(true);
	});

	test('deployIntent marks a tag outside the release list as custom', () => {
		expect(deployIntent(rollout({ at: 0 }), 'nope').custom).toBe(true);
		expect(deployIntent(rollout({ at: 0 }), 'c3').custom).toBe(false);
	});
});

describe('deploy-risk: a rollback target is proved older, or is not offered', () => {
	test('the most recent build this place has already run that is provably older', () => {
		const r = rollout({
			releases: ['a1', 'b2', 'c3'],
			history: [
				{ version: rel('c3'), timestamp: '3' },
				{ version: rel('a1'), timestamp: '2' }
			]
		});
		expect(rollbackTarget(r)).toMatchObject({ tag: 'a1', basis: 'ran-here' });
	});

	test('history that only goes FORWARD is refused -- the shipped Rollback bug', () => {
		const r = rollout({
			releases: ['a1', 'b2', 'c3'],
			history: [
				{ version: rel('b2'), timestamp: '2' },
				{ version: rel('c3'), timestamp: '1' }
			]
		});
		expect(rollbackTarget(r)).toMatchObject({ tag: 'a1', basis: 'older-release' });
	});

	test('nothing older anywhere -- null, and the caller must not offer the button', () => {
		const r = rollout({ releases: ['a1'], history: [{ version: rel('a1'), timestamp: '1' }] });
		expect(rollbackTarget(r)).toBeNull();
		expect(rollbackTarget(rollout({ history: [] }))).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════
// health-witness.ts
// ═════════════════════════════════════════════════════════════════════════

describe('health-witness: a failing check, and a check that recovered', () => {
	const CONDITION =
		"HealthCheck 'payment-latency' in namespace 'alpha-prod' is not healthy (status: Unhealthy): p99 latency 4.2s exceeds SLO of 500ms for 5m";

	test('the controller condition is parsed, and a message that does not match still shows', () => {
		expect(parseCheckMessage(CONDITION)).toEqual({
			check: 'payment-latency',
			detail: 'p99 latency 4.2s exceeds SLO of 500ms for 5m'
		});
		expect(parseCheckMessage('something else entirely')).toEqual({ check: null, detail: null });
		expect(parseCheckMessage('')).toEqual({ check: null, detail: null });
	});

	test('DeploymentBlocked True is the join; False and absent are not', () => {
		expect(
			checkFailure(
				rollout({ conditions: [{ type: 'DeploymentBlocked', status: 'True', message: CONDITION }] })
			)
		).toMatchObject({ check: 'payment-latency' });
		expect(
			checkFailure(
				rollout({
					conditions: [{ type: 'DeploymentBlocked', status: 'False', message: CONDITION }]
				})
			)
		).toBeNull();
		expect(checkFailure(rollout({}))).toBeNull();
		expect(checkFailure(null)).toBeNull();
	});

	/**
	 * `Nothing new deploys here until it passes.` WAS THE SAME DEFECT AS
	 * `Blocked`, one object over. `rollout_controller.go:258` carries the same
	 * `!hasManualDeployment` guard the gate loop has, so a deploy a person
	 * starts still applies and the old sentence said it would not.
	 */
	test('the title scopes the hold to AUTOMATIC deploys, in all four shapes', () => {
		says(
			checkFailureTitle({
				check: 'payment-latency',
				detail: 'p99 4.2s',
				raw: CONDITION,
				since: null
			}),
			'Health check payment-latency is failing — p99 4.2s. Automatic deploys here are held until it passes; a deploy you start by hand still applies.'
		);
		says(
			checkFailureTitle({ check: null, detail: null, raw: 'raw text', since: null }),
			'A health check is failing — raw text. Automatic deploys here are held until it passes; a deploy you start by hand still applies.'
		);
		says(
			checkFailureTitle({ check: 'c', detail: null, raw: '', since: null }),
			'Health check c is failing. Automatic deploys here are held until it passes; a deploy you start by hand still applies.'
		);
		expect(checkFailureTitle({ check: 'c', detail: 'd', raw: '', since: null })).not.toMatch(
			/nothing new deploys/i
		);
	});

	/**
	 * THE WINDOW IS `rollout_controller.go`'s own `errorCutoff`, so the UI and
	 * the controller cannot disagree about which errors belong to this deploy.
	 */
	test('the deploy window is max(deployed, lastRetry), and null before a first deploy', () => {
		expect(deployWindowStart(rollout({ history: [] }))).toBeNull();
		expect(deployWindowStart(rollout({ history: [{ version: rel('a1') }] }))).toBeNull();
		expect(
			deployWindowStart(
				rollout({ history: [{ version: rel('a1'), timestamp: '2026-08-31T01:00:00Z' }] })
			)?.toISOString()
		).toBe('2026-08-31T01:00:00.000Z');
		expect(
			deployWindowStart(
				rollout({
					history: [
						{
							version: rel('a1'),
							timestamp: '2026-08-31T01:00:00Z',
							lastRetryTimestamp: '2026-08-31T02:00:00Z'
						}
					]
				})
			)?.toISOString()
		).toBe('2026-08-31T02:00:00.000Z');
	});

	test('four check states, and `recovered` is the one that did not exist', () => {
		const w = new Date('2026-08-31T01:00:00Z');
		expect(classifyCheck({ status: { status: 'Unhealthy' } } as any, w)).toBe('failing');
		expect(classifyCheck({ status: { status: 'Failed' } } as any, w)).toBe('failing');
		expect(classifyCheck({ status: { status: 'Pending' } } as any, w)).toBe('pending');
		expect(classifyCheck({ status: { status: 'Healthy' } } as any, w)).toBe('passing');
		expect(
			classifyCheck(
				{ status: { status: 'Healthy', lastErrorTime: '2026-08-31T00:00:00Z' } } as any,
				w
			)
		).toBe('passing');
		expect(
			classifyCheck(
				{ status: { status: 'Healthy', lastErrorTime: '2026-08-31T01:30:00Z' } } as any,
				w
			)
		).toBe('recovered');
		expect(
			classifyCheck(
				{ status: { status: 'Healthy', lastErrorTime: '2026-08-31T01:30:00Z' } } as any,
				null
			)
		).toBe('passing');
		expect(
			classifyCheck({ status: { status: 'Healthy', lastErrorTime: 'not a date' } } as any, w)
		).toBe('passing');
	});

	test('recoveredChecks filters to exactly the witnesses inside the window', () => {
		const w = new Date('2026-08-31T01:00:00Z');
		const list = [
			{ metadata: { name: 'ok' }, status: { status: 'Healthy' } },
			{
				metadata: { name: 'witness' },
				status: { status: 'Healthy', lastErrorTime: '2026-08-31T01:30:00Z' }
			}
		] as any;
		expect(recoveredChecks(list, w).map((h: any) => h.metadata.name)).toEqual(['witness']);
		expect(recoveredChecks([], w)).toEqual([]);
	});

	test('the recovered row leads with the state and follows with the witness', () => {
		says(recoveredLabel('2m ago'), 'passing, last errored 2m ago');
		says(
			recoveredTitle({ metadata: { name: 'payment-latency' } } as any, '2m ago'),
			'payment-latency is passing now, but it errored 2m ago — inside the window of the deploy that is running. The controller keeps that error as evidence; this mark clears on the next deploy or retry.'
		);
		says(recoveredTitle({} as any, '2m ago'), /^This check is passing now, but it errored 2m ago/);
	});
});

// ═════════════════════════════════════════════════════════════════════════
// up-to-date.ts
// ═════════════════════════════════════════════════════════════════════════

describe('up-to-date: the caption never completes the wrong headline', () => {
	test('nothing deployed anywhere', () => {
		says(upToDateHeadline({ onHead: 0, deployed: 0, total: 3 }), 'Never deployed');
		says(upToDateCaption({ onHead: 0, deployed: 0, total: 3 }), '3 environments waiting');
		says(upToDateCaption({ onHead: 0, deployed: 0, total: 1 }), '1 environment waiting');
	});

	test('nothing configured at all', () => {
		says(upToDateCaption({ onHead: 0, deployed: 0, total: 0 }), 'no environments');
		says(upToDateCaption({ onHead: 0, deployed: 0, total: 0, noun: 'place' }), 'no places');
	});

	test('everything deployed is current', () => {
		says(upToDateHeadline({ onHead: 3, deployed: 3, total: 3 }), 'All on the newest');
		says(upToDateCaption({ onHead: 3, deployed: 3, total: 3 }), 'in all 3 environments');
	});

	/**
	 * THE REPORTED SPLICE. `0 of 3 on the newest` above `in all 3 environments` --
	 * the tail of `All on the newest` reached by fall-through. Converged AND
	 * behind is a real, common state and gets the fact that distinguishes it.
	 */
	test('converged and behind -- the state that produced the spliced caption', () => {
		says(upToDateHeadline({ onHead: 0, deployed: 3, total: 3, spread: 1 }), '0 of 3 on the newest');
		says(
			upToDateCaption({ onHead: 0, deployed: 3, total: 3, spread: 1 }),
			'all 3 on one older build'
		);
	});

	test('split across versions -- the caption counts them', () => {
		says(upToDateCaption({ onHead: 1, deployed: 3, total: 3, spread: 2 }), '2 builds live');
	});

	test('the places with no distance at all are named separately', () => {
		says(upToDateCaption({ onHead: 1, deployed: 1, total: 3, pending: 2 }), '2 never deployed');
		says(upToDateCaption({ onHead: 1, deployed: 2, total: 2, diverged: 1 }), '1 unreleased');
		says(upToDateCaption({ onHead: 1, deployed: 2, total: 2, unknown: 1 }), '1 unknown');
		says(
			upToDateCaption({
				onHead: 1,
				deployed: 4,
				total: 6,
				spread: 2,
				pending: 2,
				diverged: 1,
				unknown: 1
			}),
			'2 builds live · 2 never deployed · 1 unreleased · 1 unknown'
		);
	});
});

// ═════════════════════════════════════════════════════════════════════════
// env-rank.ts
// ═════════════════════════════════════════════════════════════════════════

describe('env-rank: one spelling, and unknown is a legible answer', () => {
	test('the chip label is total -- it never returns null for a caller to fill in', () => {
		says(rankLabel({ kind: 'newest' }), 'newest');
		says(rankLabel({ kind: 'behind', by: 20 }), '20 behind');
		says(rankLabel({ kind: 'diverged' }), 'unreleased');
		says(rankLabel({ kind: 'unknown' }), 'unknown');
		expect(rankLabel({ kind: 'behind', by: 20 })).not.toContain('−');
	});

	test('the chip role is total too, so no call site invents a fallback', () => {
		expect(rankRole({ kind: 'newest' })).toBe('newest');
		expect(rankRole({ kind: 'behind', by: 1 })).toBe('rank');
		expect(rankRole({ kind: 'diverged' })).toBe('diverged');
		expect(rankRole({ kind: 'unknown' })).toBe('unranked');
	});

	/**
	 * THE SUBJECT IS THE ENVIRONMENT'S UPGRADE PATH, NOT THE BUILD. Two
	 * environments on one sha can hold different candidate counts, so a
	 * sentence about the SHA would be false for at least one of them.
	 */
	test('the title names the subject and says what the number counts', () => {
		says(rankTitle({ kind: 'newest' }, 'prod'), 'prod is on the newest build available to it');
		says(rankTitle({ kind: 'behind', by: 20 }, 'prod'), 'prod can still take 20 newer builds');
		says(rankTitle({ kind: 'behind', by: 1 }, 'prod'), 'prod can still take 1 newer build');
		says(
			rankTitle({ kind: 'diverged' }, 'prod'),
			'prod is running a build that is on no environment’s release list'
		);
		says(
			rankTitle({ kind: 'unknown' }, 'prod'),
			"prod's distance from the newest build cannot be resolved — the build it is running is not in its own release list"
		);
	});

	test('behindBy is 0 for every non-behind verdict, and must not be rendered', () => {
		expect(rankBehindBy({ kind: 'unknown' })).toBe(0);
		expect(rankBehindBy({ kind: 'newest' })).toBe(0);
		expect(rankBehindBy({ kind: 'diverged' })).toBe(0);
		expect(rankBehindBy({ kind: 'behind', by: 7 })).toBe(7);
		expect(rankIsAdverse({ kind: 'unknown' })).toBe(false);
		expect(rankIsAdverse({ kind: 'newest' })).toBe(false);
		expect(rankIsAdverse({ kind: 'behind', by: 1 })).toBe(true);
		expect(rankIsAdverse({ kind: 'diverged' })).toBe(true);
	});

	test('the states that reach each verdict, from a rollout payload', () => {
		const newest = rollout({ name: 'a', ns: 'a-dev', at: 2, candidates: [] });
		const behind = rollout({ name: 'a', ns: 'a-dev', at: 0 });
		const never = rollout({ name: 'a', ns: 'a-dev', at: null });
		expect(rankVerdictsByRollout([newest], []).get(newest)).toEqual({ kind: 'newest' });
		expect(rankVerdictsByRollout([behind], []).get(behind)).toEqual({ kind: 'behind', by: 2 });
		expect(rankVerdictsByRollout([never], []).get(never)).toEqual({ kind: 'unknown' });
	});

	/**
	 * `unknown` IS THE HONEST ANSWER, NOT A HOLE. The build a place is running
	 * has aged out of THAT place's own `availableReleases` while another
	 * environment still publishes it, so the ladder can see the build and the
	 * rollout's own list cannot measure a distance to it. The fence in
	 * `rankVerdicts` is exact: fall back to the ladder only when NO list
	 * exists, never when a version merely fell out of one that does.
	 */
	test('a build that aged out of its own release list is unknown, not ranked', () => {
		const environments = [
			{
				metadata: { namespace: 'a-dev', name: 'e-dev' },
				spec: { environment: 'dev', rolloutRef: { name: 'a' } }
			},
			{
				metadata: { namespace: 'a-prod', name: 'e-prod' },
				spec: { environment: 'prod', rolloutRef: { name: 'a' } }
			}
		] as any;
		const dev = rollout({
			name: 'a',
			ns: 'a-dev',
			releases: ['a1', 'b2', 'zz'],
			at: 2,
			candidates: []
		});
		const prod = {
			metadata: { name: 'a', namespace: 'a-prod' },
			spec: {},
			status: {
				availableReleases: [rel('a1'), rel('b2')],
				history: [
					{ version: rel('zz'), timestamp: '2026-08-31T00:00:00Z', bakeStatus: 'Succeeded' }
				]
			}
		} as any;
		const ranks = rankVerdictsByRollout([dev, prod], environments);
		expect(ranks.get(prod)).toEqual({ kind: 'unknown' });
		expect(ranks.get(dev)).toEqual({ kind: 'newest' });
	});

	/** A build on NO environment's release line, deployed inside the window. */
	test('a build nobody released is `unreleased`, and carries no distance', () => {
		const orphan = {
			metadata: { name: 'a', namespace: 'a-dev' },
			spec: {},
			status: {
				availableReleases: [rel('a1', '2026-08-01T00:00:00Z'), rel('b2', '2026-08-02T00:00:00Z')],
				history: [
					{
						version: rel('zz', '2026-08-03T00:00:00Z'),
						timestamp: '2026-08-31T00:00:00Z',
						bakeStatus: 'Succeeded'
					}
				]
			}
		} as any;
		expect(rankVerdictsByRollout([orphan], []).get(orphan)).toEqual({ kind: 'diverged' });
	});
});

// ═════════════════════════════════════════════════════════════════════════
// auto-deploy.ts
// ═════════════════════════════════════════════════════════════════════════

describe('auto-deploy: why promotion is paused, and what clearing a pin does', () => {
	test('no reason at all -- nothing is said', () => {
		expect(autoDeployState(null).paused).toBe(false);
		expect(manualDeployNote({ paused: false, reasons: [], gateNames: [] })).toBeNull();
		expect(autoDeployWhy({ paused: false, reasons: [], gateNames: [] })).toBe('');
	});

	test('each reason has its own clause', () => {
		says(
			autoDeployWhy({ paused: true, reasons: ['gates'], gateNames: [] }),
			'a rule is holding it'
		);
		says(
			autoDeployWhy({ paused: true, reasons: ['gates'], gateNames: ['Business Hours Only'] }),
			'a rule is holding it (Business Hours Only)'
		);
		says(
			autoDeployWhy({ paused: true, reasons: ['health'], gateNames: [] }),
			'health checks are failing'
		);
		says(
			autoDeployWhy({ paused: true, reasons: ['pin'], gateNames: [] }),
			'it is pinned to one version'
		);
		says(
			autoDeployWhy({ paused: true, reasons: ['failed'], gateNames: [] }),
			'the last deploy failed its checks'
		);
		says(
			autoDeployWhy({ paused: true, reasons: ['gates', 'pin'], gateNames: [] }),
			'a rule is holding it, and it is pinned to one version'
		);
	});

	/** The manual-deploy clause again: a gate holds AUTOMATIC promotion only. */
	test('the note always says the deploy in front of the reader still applies', () => {
		says(
			manualDeployNote({ paused: true, reasons: ['gates'], gateNames: [] }),
			'Automatic promotion is held right now — a rule is holding it. That does not hold this deploy: it applies immediately.'
		);
	});

	test('clearing the pin when the pin is the only hold', () => {
		says(
			clearPinOutcome({ paused: true, reasons: ['pin'], gateNames: [] }),
			'Automatic promotion resumes, and the rollout moves to the newest allowed version.'
		);
	});

	test('clearing the pin when something else still holds it -- says nothing will move', () => {
		says(
			clearPinOutcome({ paused: true, reasons: ['pin', 'gates'], gateNames: [] }),
			'Automatic promotion resumes, but nothing will move yet — a rule is holding it. The rollout stays on the version it is running until that clears.'
		);
	});

	/**
	 * ⛔ THE ROLLBACK'S CONSEQUENCE, WHICH IS A DIFFERENT SENTENCE DEPENDING
	 * ON WHETHER ANYTHING IS HOLDING IT. Ground truth is
	 * `rollout_controller.go`: with `spec.wantedVersion == nil`,
	 * `hasManualDeployment` is false, `selectWantedRelease` falls through to
	 * `gatedReleaseCandidates[0]`, and `getNextReleaseCandidates` returns
	 * everything strictly NEWER than what is running -- a set a rollback can
	 * never leave empty. So an unpinned rollback IS undone, and the only
	 * question is when.
	 */
	test('a rollback that is pinned says the pin is what holds it', () => {
		says(
			rollbackStory(
				{ from: 'c3', to: 'a1', by: 2 },
				{ paused: true, reasons: ['pin'], gateNames: [] }
			),
			'Went back 2 releases, c3 → a1, and pinned there. Nothing moves off a1 until the pin is cleared.'
		);
	});

	test('a rollback with nothing holding it says it will be undone', () => {
		says(
			rollbackStory({ from: 'c3', to: 'a1', by: 2 }, { paused: false, reasons: [], gateNames: [] }),
			'Went back 2 releases, c3 → a1, and it is not pinned there. Automatic promotion is running, so the newest allowed build deploys here again.'
		);
	});

	/**
	 * ⚠️ AND IT MAY NOT SAY `will re-promote` WHILE A GATE HOLDS IT. This is
	 * the live state of `hello-dep-dev/hello-frontend-app` on the hub right
	 * now -- `GatesPassing=False / NoAllowedVersions`, a dependency gate on
	 * `rel-67` -- where "it will move forward again" is FALSE today. The
	 * sentence names the condition instead. Singular `release`, too: that
	 * rollout went back exactly one.
	 */
	test('a rollback a gate is holding names the condition rather than predicting', () => {
		says(
			rollbackStory(
				{ from: '2.67.0-67', to: '2.66.0-66', by: 1 },
				{ paused: true, reasons: ['gates'], gateNames: ['dependency-hello-frontend-needs-api'] }
			),
			'Went back 1 release, 2.67.0-67 → 2.66.0-66, and it is not pinned there. It will not move today — a rule is holding it (dependency-hello-frontend-needs-api) — but the newest allowed build deploys here again as soon as that clears.'
		);
	});

	test('the states that reach each reason, from a rollout payload', () => {
		expect(autoDeployState(rollout({ gates: [{ name: 'g', passing: false }] })).reasons).toContain(
			'gates'
		);
		expect(
			autoDeployState(rollout({ conditions: [{ type: 'GatesPassing', status: 'False' }] })).reasons
		).toContain('gates');
		expect(
			autoDeployState(rollout({ conditions: [{ type: 'DeploymentBlocked', status: 'True' }] }))
				.reasons
		).toContain('health');
		expect(autoDeployState(rollout({ pinned: 'a1' })).reasons).toContain('pin');
		expect(autoDeployState(rollout({ bakeStatus: 'Failed' })).reasons).toContain('failed');
		const unblocked = rollout({ bakeStatus: 'Failed' });
		unblocked.metadata.annotations = { 'rollout.kuberik.com/unblock-failed': 'true' };
		expect(autoDeployState(unblocked).reasons).not.toContain('failed');
	});
});

// ═════════════════════════════════════════════════════════════════════════
// api/errors.ts
// ═════════════════════════════════════════════════════════════════════════

const apiError = (status: number, detail = '', url = 'http://h/api/rollouts') =>
	new ApiError(status, `Request failed (${status})`, detail, url);

describe('api/errors: one headline per failure class, and never an invented cause', () => {
	test('a non-ApiError names the page, not HTTP', () => {
		says(errorHeadline(new Error('boom')), 'Could not load this page');
		says(errorHeadline(new Error('boom'), 'this rollout'), 'Could not load this rollout');
	});

	test('401 and 403 are different answers and are said differently', () => {
		says(errorHeadline(apiError(401)), 'Your session has expired');
		says(errorHeadline(apiError(403)), "You don't have access to this");
	});

	test('404, and the backend 500 that is really a 404', () => {
		says(errorHeadline(apiError(404)), 'This page does not exist');
		says(
			errorHeadline(
				apiError(500, 'failed to get rollout: rollouts.kuberik.com "x" not found'),
				'this rollout'
			),
			'This rollout does not exist'
		);
	});

	/**
	 * FOUND BY THIS SUITE. `subject[0].toUpperCase()` threw on an empty
	 * subject, inside the one function whose job is to render after something
	 * else has already failed. A blank screen with a console trace is the
	 * eternal-skeleton finding arriving by a different route.
	 */
	test('an empty subject does not crash the failure page', () => {
		says(errorHeadline(apiError(404), ''), 'This page does not exist');
		expect(() => errorHeadline(apiError(404), '')).not.toThrow();
	});

	test('unreachable -- names the thing that is wrong, not the page that noticed', () => {
		for (const s of [0, 502, 503, 504])
			says(errorHeadline(apiError(s)), 'Cannot reach the dashboard server');
		says(errorHeadline(apiError(500)), 'The dashboard server could not answer');
		says(errorHeadline(apiError(400)), 'Could not load this page');
	});

	/**
	 * A 403 SAYS NOTHING ABOUT A NAMESPACE. The refusal may be about the
	 * resource kind, an admission policy or the proxy. The shipped sentence
	 * named a namespace grant nobody had observed and sent the reader to argue
	 * about the wrong thing.
	 */
	test('the 403 consequence names no cause it did not observe', () => {
		const c = errorConsequence(apiError(403))!;
		says(c, 'The server refused this request for your account. Ask whoever granted your access.');
		expect(c).not.toMatch(/namespace/i);
	});

	test('401 says nothing was lost; a missing object says what may have happened', () => {
		says(
			errorConsequence(apiError(401)),
			'Sign in again to carry on. Nothing you were looking at was lost.'
		);
		says(errorConsequence(apiError(404)), 'It may have been deleted, or the address may be wrong.');
	});

	/**
	 * THE ETERNAL-SKELETON FINDING. A failed request and an empty result are
	 * different facts, and only one of them is a reading of the fleet.
	 */
	test('every other failure states that the blank is not a reading of the cluster', () => {
		const retryable = errorConsequence(apiError(503))!;
		says(
			retryable,
			`This is a failed request, not an empty result — nothing on this page is a reading of your cluster. The dashboard tried ${MAX_RETRIES + 1} times, and keeps checking every 30s, so the page fills itself in when the server answers again.`
		);
		const terminal = errorConsequence(apiError(400))!;
		says(
			terminal,
			'This is a failed request, not an empty result — nothing on this page is a reading of your cluster. Trying again will not change the answer until something on the server side changes.'
		);
		says(errorConsequence(new Error('x')), /keeps checking every 30s/);
	});

	/**
	 * ⭐ THE DETAIL IS A RECORD NOW, NOT A SENTENCE. (2026-09-02) `errorDetail`
	 * returned `/api/rollouts — the server sent no explanation with its HTTP
	 * 503.` — an ADDRESS, a STATUS and WHAT THE SERVER SAID, three machine
	 * facts joined with an em dash. `errorFacts` returns them as fields;
	 * `FactList` aligns them inside the same `<details>`. The CLAIM under test
	 * is unchanged and is the one that matters: the server's own sentence is
	 * verbatim, and a failure with no explanation SAYS it had none rather than
	 * being handed an invented cause.
	 */
	test('the detail is the server own sentence, or an explicit statement that there was none', () => {
		/** Records every label and value into `produced`, then flattens for the eye. */
		const shape = (e: unknown) => {
			const facts = errorFacts(e);
			for (const f of facts) saw(f.label, f.value);
			return facts.map((f) => `${f.label}=${f.value}`);
		};
		expect(shape(apiError(500, 'boom'))).toEqual([
			'Address=/api/rollouts',
			'Status=HTTP 500',
			'Server said=boom'
		]);
		expect(shape(apiError(503))).toEqual([
			'Address=/api/rollouts',
			'Status=HTTP 503',
			'Server said=nothing'
		]);
		// NOBODY ANSWERED. No status, no path, and the record says so in words
		// rather than leaving the row empty.
		expect(shape(apiError(0, '', ''))).toEqual([
			'Server said=nothing — the browser could not open a connection'
		]);
		expect(shape(new Error('plain'))).toEqual(['Error=plain']);
		expect(errorFacts(undefined)).toEqual([]);
	});

	test('the retry policy: a 4xx is an answer, a 5xx and a timing code are not', () => {
		expect(isRetryable(apiError(404))).toBe(false);
		expect(isRetryable(apiError(401))).toBe(false);
		expect(isRetryable(apiError(400))).toBe(false);
		expect(isRetryable(apiError(408))).toBe(true);
		expect(isRetryable(apiError(429))).toBe(true);
		expect(isRetryable(apiError(0))).toBe(true);
		expect(isRetryable(apiError(503))).toBe(true);
		expect(isRetryable(apiError(500, 'x not found'))).toBe(false);
		expect(isRetryable('not an error')).toBe(true);
		expect(queryRetry(MAX_RETRIES, apiError(503))).toBe(false);
		expect(queryRetry(0, apiError(503))).toBe(true);
	});

	test('the ApiError getters that the headlines branch on', () => {
		expect(apiError(0).isUnreachable).toBe(true);
		expect(apiError(403).isAuth).toBe(true);
		expect(apiError(404).isMissing).toBe(true);
		expect(apiError(500).isMissing).toBe(false);
		expect(apiError(500, '', 'http://h/api/x/y').path).toBe('/api/x/y');
		expect(apiError(500, '', '').path).toBe('');
		says(
			new ApiError(0, 'No response from the server', '', 'u').message,
			'No response from the server'
		);
		says(apiError(503).message, 'Request failed (503)');
	});
});

// ═════════════════════════════════════════════════════════════════════════
// bake-status.ts
// ═════════════════════════════════════════════════════════════════════════

describe('bake-status: one word per state, and one sentence per word', () => {
	test('every bakeStatus has a word, and the word is never the CRD field name', () => {
		says(bakeWord('Succeeded'), 'deploy succeeded');
		says(bakeWord('Failed'), 'deploy failed');
		says(bakeWord('InProgress'), 'checking');
		says(bakeWord('Deploying'), 'deploying');
		says(bakeWord('Cancelled'), 'stopped');
		says(bakeWord('None'), 'no deploy yet');
		says(bakeWord(undefined), 'no deploy yet');
		says(bakeWord('SomethingNew'), 'no deploy yet');
		for (const w of Object.values(BAKE_WORD)) expect(w.toLowerCase()).not.toMatch(/\bbak(e|ing)\b/);
	});

	test('every word has a consequence sentence for its title', () => {
		says(bakeTitle('Succeeded'), 'The deploy finished and passed its checks');
		says(bakeTitle('Failed'), 'The deploy failed');
		says(
			bakeTitle('InProgress'),
			'The new version is live and is being watched before the deploy counts as done'
		);
		says(bakeTitle('Deploying'), 'The new version is still going out');
		says(bakeTitle('Cancelled'), 'The deploy was stopped before it finished');
		says(bakeTitle('None'), 'Nothing has been deployed here yet');
		says(bakeTitle(undefined), 'Nothing has been deployed here yet');
		expect(Object.keys(BAKE_TITLE).sort()).toEqual(Object.keys(BAKE_WORD).sort());
		for (const t of Object.values(BAKE_TITLE))
			expect(t.toLowerCase()).not.toMatch(/\bbak(e|ing)\b/);
	});
});

// ═════════════════════════════════════════════════════════════════════════
// fleet-groups.ts -- not prose, but the predicates the prose is derived from
// ═════════════════════════════════════════════════════════════════════════

describe('fleet-groups: what "healthy" is allowed to cover', () => {
	const card = (o: any = {}) =>
		({
			statusKey: 'succeeded',
			stuck: null,
			checkFailure: null,
			isRunning: false,
			rank: { kind: 'newest' },
			...o
		}) as any;

	test('a failing health check promotes into attention -- the 3am finding', () => {
		expect(
			isNeedsYou(card({ checkFailure: { check: 'c', detail: null, raw: '', since: null } }))
		).toBe(true);
		expect(
			isHealthy(card({ checkFailure: { check: 'c', detail: null, raw: '', since: null } }))
		).toBe(false);
	});

	test('failed and stuck are attention; a clean success is not', () => {
		expect(isNeedsYou(card({ statusKey: 'failed' }))).toBe(true);
		expect(isNeedsYou(card({ stuck: { kind: 'baking' } }))).toBe(true);
		expect(isNeedsYou(card())).toBe(false);
	});

	test('trailing and steady partition healthy exactly', () => {
		expect(isTrailing(card({ rank: { kind: 'behind', by: 3 } }))).toBe(true);
		expect(isTrailing(card({ rank: { kind: 'diverged' } }))).toBe(true);
		expect(isSteady(card({ rank: { kind: 'newest' } }))).toBe(true);
	});

	/**
	 * FAILING AND SKIPPED ON PURPOSE -- A PRODUCT DECISION, NOT A BUG TO PAPER
	 * OVER.
	 *
	 * `isSteady` files an `unknown` rank under Steady, and `/` captions that
	 * group *"at the head of its own release list"*. An `unknown` rank means
	 * the running build is not in the rollout's own release list at all, so
	 * the dashboard does not know whether it is at the head or twenty behind
	 * -- `rankTitle` says exactly that, in the same product, one chip away.
	 * Steady is a CLAIM FROM ABSENCE, which is the defect class the branch
	 * spent three passes removing everywhere else.
	 *
	 * The fix is a SIXTH BUCKET (`unresolved`) with its own caption and its own
	 * counter on `/` and `/rollouts`, not a reworded caption: moving `unknown`
	 * into Trailing would invent a lag, and leaving it in Steady asserts one it
	 * cannot see. That is a design decision with a visual cost on two landing
	 * surfaces, so it is named here and left to the owner rather than decided
	 * inside a test.
	 */
	test.skip('DECISION NEEDED: an unresolvable rank is not Steady -- it needs a sixth bucket', () => {
		expect(isSteady(card({ rank: { kind: 'unknown' } }))).toBe(false);
	});

	test('the status quo, encoded so the decision above is visible and not silent', () => {
		expect(isSteady(card({ rank: { kind: 'unknown' } }))).toBe(true);
	});
});

// ═════════════════════════════════════════════════════════════════════════
// rollout-cards.ts -- the row sentences on the two landing surfaces
// ═════════════════════════════════════════════════════════════════════════

describe('rollout-cards: a card carries the facts its row sentence needs', () => {
	test('a rollback is detected from release position, and is silent when unorderable', () => {
		const cards = buildRolloutCards(
			[
				rollout({
					name: 'alpha-app',
					ns: 'alpha-prod',
					releases: ['a1', 'b2', 'c3'],
					history: [
						{ version: rel('a1'), timestamp: '2026-08-31T02:00:00Z', bakeStatus: 'Succeeded' },
						{ version: rel('c3'), timestamp: '2026-08-31T01:00:00Z', bakeStatus: 'Succeeded' }
					]
				})
			],
			[],
			new Date('2026-08-31T03:00:00Z')
		);
		expect(cards[0].rolledBack).toMatchObject({ from: 'c3', to: 'a1', by: 2 });
		// A rolled-back rollout still carries its lag. The state moved into the
		// status disc; it did not evict the number.
		expect(cards[0].rank).toEqual({ kind: 'behind', by: 2 });
	});

	test('a failing check reaches the card, so the list surfaces can read it', () => {
		const cards = buildRolloutCards(
			[
				rollout({
					name: 'alpha-app',
					ns: 'alpha-prod',
					conditions: [
						{
							type: 'DeploymentBlocked',
							status: 'True',
							message:
								"HealthCheck 'latency' in namespace 'alpha-prod' is not healthy (status: Unhealthy): p99 4.2s"
						}
					]
				})
			],
			[],
			new Date('2026-08-31T03:00:00Z')
		);
		expect(cards[0].checkFailure).toMatchObject({ check: 'latency', detail: 'p99 4.2s' });
		expect(isNeedsYou(cards[0])).toBe(true);
	});
});

// ═════════════════════════════════════════════════════════════════════════
// THE COMPLETENESS GUARD
// ═════════════════════════════════════════════════════════════════════════

/**
 * A literal that no state in this file produced, with the reason it is not a
 * defect. EVERY ENTRY IS A CLAIM and is meant to be argued with.
 */
const UNREACHED: Record<string, string> = {
	'lib/api/errors.ts|Could not load …':
		'The template; both of its filled forms are asserted (this page, this rollout).',
	'lib/api/errors.ts|…… does not exist':
		'The template; both filled forms are asserted (this page / this rollout).',
	'lib/api/errors.ts|…the browser could not open a connection.':
		'Asserted in its filled form, where `path` is empty and the prefix collapses.',
	'lib/api/errors.ts|…the server sent no explanation with its HTTP ….':
		'Asserted in its filled form with a real path and status.',
	'lib/api/errors.ts|… The dashboard tried … times, and keeps checking every …s, so the page fills itself in when the server answers again.':
		'Asserted assembled onto the shared lead sentence.',
	'lib/api/errors.ts|… Trying again will not change the answer until something on the server side changes.':
		'Asserted assembled onto the shared lead sentence.',
	'lib/api/errors.ts|Request failed (…)': 'Asserted as the filled message of a 503 ApiError.',
	'lib/api/errors.ts|this page':
		'The default `subject` argument; asserted through the headline it produces.',
	'lib/view-models/blocking-story.ts|… in … (…)':
		'The clock arithmetic; asserted by regex against a real 4h window.',
	'lib/view-models/blocking-story.ts|…Nothing promotes itself until ….':
		'The consequence template; asserted filled, in six different gate states.',
	'lib/view-models/blocking-story.ts|… newer build… … waiting.':
		'The lead clause; asserted inside the assembled consequence, singular and plural.',
	'lib/view-models/blocking-story.ts|… newer build… … available and none of them will deploy while the pin is set.':
		'Asserted filled, singular and plural.',
	'lib/view-models/blocking-story.ts|… and …': '`joinClauses` two-item form; asserted directly.',
	'lib/view-models/blocking-story.ts|a rule': 'The nameless-gate handle; asserted directly.',
	'lib/view-models/deploy-risk.ts|… version… ahead':
		'Not a deploy-risk string — the scanner attributes a shared template; covered by dependencies.ts.',
	'lib/bake-status.ts|no deploy yet':
		'Asserted as the output of bakeWord for None, undefined and an unknown enum.'
};

describe('every sentence module is reached by a state, not merely mentioned', () => {
	/** A catalogue template matches a produced string when the holes fill in. */
	function matches(template: string, output: string): boolean {
		if (!template.includes(HOLE)) return output.includes(template);
		const parts = template.split(HOLE).filter((p) => p.length > 0);
		if (parts.length === 0) return true;
		let at = 0;
		for (const p of parts) {
			const i = output.indexOf(p, at);
			if (i === -1) return false;
			at = i + p.length;
		}
		return true;
	}

	for (const module of SENTENCE_MODULES) {
		test(`${module}: no unreached prose`, () => {
			const outputs = [...produced];
			const orphans = literalsIn(module)
				.map((l) => l.text)
				.filter((t, i, a) => a.indexOf(t) === i)
				.filter((t) => !UNREACHED[`${module}|${t}`])
				.filter((t) => !outputs.some((o) => matches(t, o)));

			if (orphans.length === 0) return;
			throw new Error(
				`${module} contains ${orphans.length} operator-visible string(s) that NO state in ` +
					`truth.test.ts produced:\n` +
					orphans.map((o) => `    ${JSON.stringify(o)}`).join('\n') +
					`\n\n  A string nobody can reach from a state is one of three things, and all ` +
					`\n  three are worth knowing:\n` +
					`\n    - a branch that is genuinely unreachable. Delete it. A default nobody` +
					`\n      reaches is how "Needs a person to approve" survived two releases as` +
					`\n      the gate fall-through.` +
					`\n    - a real state this matrix does not stage yet. Add the state, and assert` +
					`\n      the sentence against the CONTROLLER, not against the component.` +
					`\n    - a template asserted only in its filled form. Add it to UNREACHED in` +
					`\n      this file WITH THE REASON, which is a claim a reviewer can check.\n`
			);
		});
	}
});
