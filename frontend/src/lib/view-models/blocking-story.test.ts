/**
 * Fixtures are the LIVE payload, read off `curl -sk .../api/rollouts` and
 * `.../api/rollouts/<ns>/<name>/schedules` on 2026-08-31. The three
 * `hello-world-app` rollouts are the exact case the critic filed: the same app
 * in three environments, held by a different mix of gates in each, with two
 * pages giving opposite answers about it.
 */
import { describe, it, expect } from 'vitest';
import {
	buildGateContext,
	withSchedules,
	classifyGate,
	blockingStory,
	shortStory,
	ruleHandle,
	joinClauses,
	EMPTY_GATE_CONTEXT
} from './blocking-story';

// ── LIVE FIXTURE ────────────────────────────────────────────────────────────
// `/api/rollouts` → environments[].status.rolloutGateRef + spec.relationship
const ENVIRONMENTS = {
	items: [
		{
			metadata: { namespace: 'hello-world-prod', name: 'hello-world-app' },
			spec: {
				environment: 'prod',
				relationship: { environment: 'staging', type: 'After' as const },
				rolloutRef: { name: 'hello-world-app' }
			},
			status: { rolloutGateRef: { name: 'ghd-xm669' } }
		},
		{
			metadata: { namespace: 'hello-world-staging', name: 'hello-world-app' },
			spec: {
				environment: 'staging',
				relationship: { environment: 'dev', type: 'After' as const },
				rolloutRef: { name: 'hello-world-app' }
			},
			status: { rolloutGateRef: { name: 'ghd-p2fld' } }
		},
		{
			metadata: { namespace: 'hello-world-dev', name: 'hello-world-app' },
			spec: { environment: 'dev', rolloutRef: { name: 'hello-world-app' } },
			status: { rolloutGateRef: { name: 'ghd-pnb8h' } }
		}
	]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const DEPENDENCIES = {
	items: [
		{
			metadata: { namespace: 'hello-dep-prod', name: 'hello-frontend-needs-api' },
			spec: {
				contract: 'api',
				providerRef: { name: 'hello-api-app', namespace: 'hello-dep-prod' },
				rolloutRef: { name: 'hello-frontend-app' }
			},
			status: {
				gateName: 'dependency-hello-frontend-needs-api',
				providedVersion: '1.66.0',
				admittedVersions: ['rel-66'],
				// THE LIVE SHAPE, VERBATIM. `blockedReleases[].requiredVersion` is
				// the constraint the held candidate places on the contract, and it
				// is the half of the relation the row draws on the right of the
				// arrow. It has been in the payload all along.
				blockedReleases: [
					{ tag: 'rel-67', requiredVersion: '^1.67.0', reason: 'ConstraintNotSatisfied' }
				]
			}
		}
	]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const SCHEDULES_STAGING = [
	{
		metadata: {
			name: 'business-hours-allow',
			annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
		},
		spec: { action: 'Allow' as const },
		status: { nextTransition: '2026-08-31T13:00:00Z', managedGates: ['schedule-gate-nwm62'] }
	}
];

const ctx = buildGateContext({
	environments: ENVIRONMENTS,
	rolloutDependencies: DEPENDENCIES
});

/** A rollout whose current build is mid-list, so there are real candidates. */
function rolloutWith(
	namespace: string,
	gates: Array<{ name: string; passing?: boolean; allowedVersions?: string[] | null }>,
	extra: { wantedVersion?: string } = {}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
	const available = [
		{ tag: 'tag-a', version: 'aaaaaaa' },
		{ tag: 'tag-b', version: 'bbbbbbb' },
		{ tag: 'tag-c', version: 'ccccccc' }
	];
	return {
		metadata: { namespace, name: 'hello-world-app' },
		spec: extra.wantedVersion ? { wantedVersion: extra.wantedVersion } : {},
		status: {
			availableReleases: available,
			// NEWEST-FIRST, two builds ahead of `tag-a`.
			releaseCandidates: [available[2], available[1]],
			history: [{ version: available[0], timestamp: '2026-08-01T00:00:00Z' }],
			gates
		}
	};
}

// ── THE JOINS ───────────────────────────────────────────────────────────────

describe('buildGateContext — the classification is a JOIN, never a name match', () => {
	it('joins an environment-controller gate to its relationship', () => {
		expect(ctx.promotion.get('hello-world-prod/ghd-xm669')).toEqual({
			after: 'staging',
			relType: 'After'
		});
	});

	it('joins a dependency gate to its provider, contract and BOTH versions', () => {
		expect(ctx.dependency.get('hello-dep-prod/dependency-hello-frontend-needs-api')).toEqual({
			provider: 'hello-api-app',
			contract: 'api',
			providedVersion: '1.66.0',
			requiredVersion: '^1.67.0'
		});
	});

	it('the required range is null when the held candidates disagree', () => {
		// ⛔ Masterminds semver constraints are not orderable across spellings, so
		// two candidates asking for two different ranges have no single "the"
		// requirement. Printing one of them would be a claim the payload does not
		// support, and the row falls back to the sentence.
		const mixed = buildGateContext({
			rolloutDependencies: {
				items: [
					{
						metadata: { namespace: 'ns', name: 'd' },
						spec: { contract: 'api', providerRef: { name: 'p' } },
						status: {
							gateName: 'g',
							providedVersion: '1.0.0',
							blockedReleases: [
								{ tag: 'a', requiredVersion: '^1.1.0' },
								{ tag: 'b', requiredVersion: '^2.0.0' }
							]
						}
					}
				]
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		});
		expect(mixed.dependency.get('ns/g')?.requiredVersion).toBeNull();
		// Two candidates asking for the SAME range is one requirement, not two.
		const agreed = buildGateContext({
			rolloutDependencies: {
				items: [
					{
						metadata: { namespace: 'ns', name: 'd' },
						spec: { contract: 'api', providerRef: { name: 'p' } },
						status: {
							gateName: 'g',
							blockedReleases: [
								{ tag: 'a', requiredVersion: '^1.1.0' },
								{ tag: 'b', requiredVersion: '^1.1.0' }
							]
						}
					}
				]
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		});
		expect(agreed.dependency.get('ns/g')?.requiredVersion).toBe('^1.1.0');
	});

	it('the drawing fields are the clause split at its own joint, never a second wording', () => {
		// ⭐ THE ROW AND THE BANNER CANNOT DRIFT, and this is the mechanism: the
		// sentence is BUILT from `subject` + `predicate`, so a surface that draws
		// the two halves separately is drawing the sentence's own words.
		const promo = classifyGate({ name: 'ghd-xm669', allowedVersions: [] }, 'hello-world-prod', ctx);
		expect(promo.subject).toBe('staging');
		expect(promo.subjectKind).toBe('environment');
		expect(`${promo.subject} ${promo.predicate}`).toBe(promo.clause);

		const dep = classifyGate(
			{ name: 'dependency-hello-frontend-needs-api', allowedVersions: [] },
			'hello-dep-prod',
			ctx
		);
		expect(dep.subject).toBe('hello-api-app');
		expect(dep.subjectKind).toBe('service');
		expect([dep.contract, dep.have, dep.need]).toEqual(['api', '1.66.0', '^1.67.0']);
	});

	it('a gate with no second party draws NOTHING, and that is the argued half', () => {
		// ⛔ `check`, `approval` and `unknown` name no object a reader can go and
		// look at; their only concrete handle is the gate's generated id, which
		// this product deliberately took OUT of the printed tier. `subject: null`
		// is how a surface knows to print `short` instead of inventing a picture.
		const check = classifyGate({ name: 'anything', passing: false }, 'ns', EMPTY_GATE_CONTEXT);
		expect(check.clears).toBe('check');
		expect(check.subject).toBeNull();
		expect(check.subjectKind).toBeNull();
		expect(check.need).toBeNull();
	});

	it('keys on NAMESPACE + name — one dependency gate name exists in three namespaces', () => {
		// The live cluster has `dependency-hello-frontend-needs-api` in
		// hello-dep-{dev,staging,prod}. A name-only key would attribute all three
		// to whichever landed last.
		expect(ctx.dependency.has('hello-dep-staging/dependency-hello-frontend-needs-api')).toBe(false);
		expect(ctx.dependency.has('hello-dep-prod/dependency-hello-frontend-needs-api')).toBe(true);
	});

	it('survives a cluster with no RolloutDependency CRD installed', () => {
		const c = buildGateContext({ environments: ENVIRONMENTS, rolloutDependencies: null });
		expect(c.dependency.size).toBe(0);
		expect(c.promotion.size).toBe(3);
	});
});

// ── THE CLASSIFICATION, WHICH IS THE WHOLE BUG ──────────────────────────────

describe('classifyGate', () => {
	it('⭐ an environment gate is NOT an approval — nobody can approve ghd-xm669', () => {
		// This is finding 7 verbatim. `ghd-xm669` publishes `allowedVersions: []`
		// and the old split therefore captioned it "Needs a person to approve".
		const g = classifyGate(
			{ name: 'ghd-xm669', passing: true, allowedVersions: [] },
			'hello-world-prod',
			ctx
		);
		expect(g.kind).toBe('promotion');
		expect(g.clears).toBe('upstream');
		expect(g.clause).toBe('staging deploys it first');
		expect(g.short).toBe('Waiting for staging to deploy it first');
		expect(g.label).not.toContain('ghd-');
	});

	it('a Parallel relationship says alongside, not first', () => {
		const c = buildGateContext({
			environments: {
				items: [
					{
						metadata: { namespace: 'ns', name: 'e' },
						spec: { environment: 'b', relationship: { environment: 'a', type: 'Parallel' } },
						status: { rolloutGateRef: { name: 'g' } }
					}
				]
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		});
		expect(classifyGate({ name: 'g', allowedVersions: [] }, 'ns', c).clause).toBe(
			'a deploys it alongside'
		);
	});

	it('an environment gate with no relationship yet says so rather than guessing', () => {
		const g = classifyGate({ name: 'ghd-pnb8h', allowedVersions: [] }, 'hello-world-dev', ctx);
		expect(g.kind).toBe('promotion');
		expect(g.clause).toBe('its upstream environment deploys this build');
	});

	it('a dependency gate names the service that has to ship, and its version', () => {
		const g = classifyGate(
			{ name: 'dependency-hello-frontend-needs-api', passing: true, allowedVersions: ['rel-66'] },
			'hello-dep-prod',
			ctx
		);
		expect(g.kind).toBe('dependency');
		expect(g.clears).toBe('upstream');
		expect(g.clause).toBe('hello-api-app ships a newer api than 1.66.0');
	});

	it('a not-passing gate with a schedule join is a CLOCK, with its real name and time', () => {
		const withSched = withSchedules(ctx, 'hello-world-staging', SCHEDULES_STAGING);
		const g = classifyGate(
			{ name: 'schedule-gate-nwm62', passing: false, allowedVersions: null },
			'hello-world-staging',
			withSched
		);
		expect(g.kind).toBe('schedule');
		expect(g.clears).toBe('clock');
		// "Business Hours Only" was the ONLY human-readable gate name in the
		// product and it was buried in the Change Version modal.
		expect(g.label).toBe('Business Hours Only');
		expect(g.clearsAt).toBe('2026-08-31T13:00:00Z');
	});

	it('a not-passing gate with no schedule join is a CHECK — never a fabricated clock', () => {
		const g = classifyGate(
			{ name: 'schedule-gate-nwm62', passing: false, allowedVersions: null },
			'hello-world-staging',
			ctx
		);
		expect(g.kind).toBe('check');
		expect(g.clears).toBe('check');
		expect(g.clearsAt).toBeNull();
	});

	it('an OPEN schedule contributes no join — only a refusing one explains a gate', () => {
		const open = withSchedules(ctx, 'ns', [
			{
				metadata: { name: 'business-hours-allow' },
				spec: { action: 'Allow' },
				status: { active: true, nextTransition: 'x', managedGates: ['g'] }
			}
		]);
		expect(open.schedule.size).toBe(0);
	});

	it('a Deny schedule blocks while ACTIVE — the mirror of Allow', () => {
		const deny = withSchedules(ctx, 'ns', [
			{
				metadata: { name: 'peak-hours-deny' },
				spec: { action: 'Deny' },
				status: { active: true, nextTransition: '2026-08-31T13:00:00Z', managedGates: ['g'] }
			}
		]);
		expect(deny.schedule.get('ns/g')?.label).toBe('peak-hours-deny');
	});

	it('a hand-authored allow-list gate — and ONLY that — needs a person', () => {
		const g = classifyGate(
			{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] },
			'hello-world-prod',
			ctx
		);
		expect(g.kind).toBe('approval');
		expect(g.clears).toBe('person');
	});

	it('with no context at all it never claims a mechanism it cannot evidence', () => {
		const g = classifyGate({ name: 'x', passing: false }, 'ns', EMPTY_GATE_CONTEXT);
		expect(g.clears).toBe('check');
		expect(g.clause).toBe('a check starts passing');
	});
});

// ── THE STORY: ONE ANSWER, EVERY GATE ───────────────────────────────────────

describe('blockingStory — the defect the critic filed', () => {
	const NOW = new Date('2026-08-30T23:26:00Z');

	it('⭐ STAGING says BOTH things: the window AND the upstream deploy', () => {
		// The exact live state. `/apps/<name>` said only the approval half and
		// rollout detail said only the clock half.
		const c = withSchedules(ctx, 'hello-world-staging', SCHEDULES_STAGING);
		const s = blockingStory(
			rolloutWith('hello-world-staging', [
				{ name: 'schedule-gate-nwm62', passing: false, allowedVersions: null },
				{ name: 'ghd-p2fld', passing: true, allowedVersions: [] }
			]),
			c,
			{ place: 'staging', now: NOW }
		);
		expect(s.blocked).toBe(true);
		expect(s.gates).toHaveLength(2);
		expect(s.headline).toBe('Two things are holding STAGING');
		expect(s.consequence).toContain('Nothing promotes itself until dev deploys it first');
		expect(s.consequence).toContain('the deploy window reopens in');
		// NOT "this will not clear on its own" — nobody can approve either gate.
		expect(s.person).toHaveLength(0);
		expect(s.resolution).toContain('Nobody has to approve anything');
		// The promise the product already keeps, and must keep.
		expect(s.resolution).toContain('A deploy you start by hand still applies immediately.');
	});

	it('⭐ PROD names all THREE gates and the failing one is among them', () => {
		// `/apps` blamed `hello-world-manual-approval`, rollout detail said "1
		// schedule", `/apps/<name>` named two — and the FAILING gate appeared on
		// none of them.
		const c = withSchedules(ctx, 'hello-world-prod', [
			{
				metadata: {
					name: 'business-hours-allow',
					annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
				},
				spec: { action: 'Allow' },
				status: { nextTransition: '2026-08-31T13:00:00Z', managedGates: ['schedule-gate-zvsqr'] }
			}
		]);
		const s = blockingStory(
			rolloutWith('hello-world-prod', [
				{ name: 'ghd-xm669', passing: true, allowedVersions: [] },
				{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] },
				{ name: 'schedule-gate-zvsqr', passing: false, allowedVersions: null }
			]),
			c,
			{ place: 'prod', now: NOW }
		);
		expect(s.gates.map((g) => g.id).sort()).toEqual([
			'ghd-xm669',
			'hello-world-manual-approval',
			'schedule-gate-zvsqr'
		]);
		expect(s.headline).toBe('Three things are holding PROD');
		expect(s.person.map((g) => g.id)).toEqual(['hello-world-manual-approval']);
		expect(s.upstream.map((g) => g.id)).toEqual(['ghd-xm669']);
		expect(s.clock.map((g) => g.id)).toEqual(['schedule-gate-zvsqr']);
		expect(s.severity).toBe('warning');
		expect(s.resolution).toContain('will not clear on its own');
	});

	it('the person-gate leads the consequence — the 3am answer goes first', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [
				{ name: 'schedule-gate-zvsqr', passing: false, allowedVersions: null },
				{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] },
				{ name: 'ghd-xm669', passing: true, allowedVersions: [] }
			]),
			ctx,
			{ place: 'prod', now: NOW }
		);
		expect(s.gates[0].clears).toBe('person');
	});

	it('a clock-only block is INFO, not a warning — nobody has to get up', () => {
		const c = withSchedules(ctx, 'hello-world-dev', [
			{
				metadata: {
					name: 'business-hours-allow',
					annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
				},
				spec: { action: 'Allow' },
				status: { nextTransition: '2026-08-31T13:00:00Z', managedGates: ['schedule-gate-fk44d'] }
			}
		]);
		const s = blockingStory(
			rolloutWith('hello-world-dev', [
				{ name: 'schedule-gate-fk44d', passing: false, allowedVersions: null }
			]),
			c,
			{ place: 'dev', now: NOW }
		);
		expect(s.severity).toBe('info');
		expect(s.selfClearing).toBe(true);
		expect(s.headline).toBe('Automatic deploys are paused');
		expect(s.clearsAt).toBe('2026-08-31T13:00:00Z');
		expect(s.resolution).toContain('clears on its own');
	});

	it('an upstream-only block is a WARNING but does not send anyone looking for a human', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [{ name: 'ghd-xm669', passing: true, allowedVersions: [] }]),
			ctx,
			{ place: 'prod', now: NOW }
		);
		expect(s.severity).toBe('warning');
		expect(s.headline).toBe('PROD is waiting on another deploy');
		expect(s.resolution).not.toContain('will not clear on its own');
	});

	it('a pin outranks every gate and is named as the cause', () => {
		const s = blockingStory(
			rolloutWith(
				'hello-world-prod',
				[{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] }],
				{ wantedVersion: '991829b' }
			),
			ctx,
			{ place: 'prod', now: NOW }
		);
		expect(s.pinnedTo).toBe('991829b');
		expect(s.gates).toHaveLength(0);
		expect(s.headline).toBe('PROD is pinned to 991829b');
		expect(s.consequence).not.toContain('manual-approval');
	});

	it('nothing newer to take is not a block', () => {
		const r = rolloutWith('hello-world-dev', [
			{ name: 'schedule-gate-fk44d', passing: false, allowedVersions: null }
		]);
		r.status.releaseCandidates = [];
		r.status.history = [{ version: { tag: 'tag-c', version: 'ccccccc' } }];
		const s = blockingStory(r, ctx, { place: 'dev', now: NOW });
		expect(s.blocked).toBe(false);
		expect(s.headline).toBe('');
	});

	it('a gate that is passing is not in the story', () => {
		const s = blockingStory(
			rolloutWith('hello-world-dev', [
				{ name: 'ghd-pnb8h', passing: true, allowedVersions: null },
				{ name: 'schedule-gate-fk44d', passing: false, allowedVersions: null }
			]),
			ctx,
			{ place: 'dev', now: NOW }
		);
		expect(s.gates.map((g) => g.id)).toEqual(['schedule-gate-fk44d']);
	});

	it('never fabricates a place it was not given', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [
				{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] }
			]),
			ctx,
			{ now: NOW }
		);
		expect(s.headline).toBe('this service is waiting on an approval');
	});
});

describe('shortStory / ruleHandle — a row cannot disagree with the banner above it', () => {
	const NOW = new Date('2026-08-30T23:26:00Z');

	it('one gate gives its own clause', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [{ name: 'ghd-xm669', passing: true, allowedVersions: [] }]),
			ctx,
			{ now: NOW }
		);
		expect(shortStory(s)).toBe('Waiting for staging to deploy it first');
	});

	it('several gates count them and name every KIND — never one of three', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [
				{ name: 'ghd-xm669', passing: true, allowedVersions: [] },
				{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] },
				{ name: 'schedule-gate-zvsqr', passing: false, allowedVersions: null }
			]),
			ctx,
			{ now: NOW }
		);
		expect(shortStory(s)).toBe(
			'Held by 3 rules — waiting on an approval, another deploy and a check'
		);
		expect(ruleHandle(s)).toBe('hello-world-manual-approval, ghd-xm669, schedule-gate-zvsqr');
	});

	it('is null when nothing is holding it', () => {
		expect(shortStory(blockingStory(null, ctx))).toBeNull();
		expect(ruleHandle(blockingStory(null, ctx))).toBeNull();
	});
});

describe('joinClauses', () => {
	it('reads as English, not as a table cell', () => {
		expect(joinClauses([])).toBe('');
		expect(joinClauses(['a'])).toBe('a');
		expect(joinClauses(['a', 'b'])).toBe('a and b');
		expect(joinClauses(['a', 'b', 'c'])).toBe('a, b and c');
	});
});

// ── ⚠️ THE FALL-THROUGH ─────────────────────────────────────────────────────
// The exact live state that falsified `ac8e045`, reproduced from the payload:
// `dependency-hello-frontend-needs-api` publishes `allowedVersions: ["rel-66"]`
// and is owned by a `RolloutDependency` controller. Rollout detail built its
// join table with `rolloutDependencies: null` and rendered it, behind a PERSON
// icon, as *"DEV is waiting on an approval … this will not clear on its own"*.

/** The gate OBJECT as `/api/rollouts/<ns>/<name>` serves it, owner refs and all. */
const DEP_GATE_OBJECT = {
	items: [
		{
			metadata: {
				namespace: 'hello-dep-dev',
				name: 'dependency-hello-frontend-needs-api',
				ownerReferences: [
					{ kind: 'RolloutDependency', name: 'hello-frontend-needs-api', controller: true }
				]
			}
		},
		{
			metadata: {
				namespace: 'hello-dep-dev',
				name: 'ghd-dptmm',
				ownerReferences: [{ kind: 'Environment', name: 'hello-frontend-app', controller: true }]
			}
		}
	]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const DEP_GATE = {
	name: 'dependency-hello-frontend-needs-api',
	passing: true,
	allowedVersions: ['rel-66']
};

describe('⚠️ an unrecognised gate must never silently become `person`', () => {
	const NOW = new Date('2026-08-30T23:26:00Z');

	it('the live defect: a dependency gate with no dependency join is NOT an approval', () => {
		// Exactly what rollout detail used to build: environments present,
		// `rolloutDependencies: null`, no gate objects.
		const broken = buildGateContext({ environments: ENVIRONMENTS, rolloutDependencies: null });
		const g = classifyGate(DEP_GATE, 'hello-dep-dev', broken);
		expect(g.clears).not.toBe('person');
		expect(g.clears).toBe('unknown');
		expect(g.short).toContain('cannot tell what clears it');
	});

	it('`sources` records that a source was CONSULTED, not that it was non-empty', () => {
		expect(buildGateContext({ environments: null, rolloutDependencies: null }).sources).toEqual({
			environments: false,
			dependencies: false
		});
		// An installed CRD with no objects IS a consulted source.
		expect(
			buildGateContext({ environments: { items: [] }, rolloutDependencies: { items: [] } }).sources
		).toEqual({ environments: true, dependencies: true });
	});

	it('the owner-reference veto holds even when EVERY join is missing', () => {
		// Belt to the joins' braces: nothing joined, and it is still not a person.
		const onlyOwners = buildGateContext({
			environments: null,
			rolloutDependencies: null,
			rolloutGates: DEP_GATE_OBJECT
		});
		const g = classifyGate(DEP_GATE, 'hello-dep-dev', onlyOwners);
		expect(g.clears).toBe('upstream');
		expect(g.kind).toBe('dependency');
		expect(g.clause).toBe('the service it depends on ships a newer version');

		const promo = classifyGate(
			{ name: 'ghd-dptmm', passing: true, allowedVersions: ['rel-66'] },
			'hello-dep-dev',
			onlyOwners
		);
		expect(promo.clears).toBe('upstream');
	});

	it('a gate owned by a controller we have no story for is `unknown`, never `person`', () => {
		const ctxOwned = buildGateContext({
			environments: ENVIRONMENTS,
			rolloutDependencies: DEPENDENCIES,
			rolloutGates: {
				items: [
					{
						metadata: {
							namespace: 'ns',
							name: 'future-gate',
							ownerReferences: [{ kind: 'CanaryAnalysis', name: 'weekly', controller: true }]
						}
					}
				]
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		});
		const g = classifyGate(
			{ name: 'future-gate', passing: true, allowedVersions: [] },
			'ns',
			ctxOwned
		);
		expect(g.clears).toBe('unknown');
		expect(g.clause).toBe('CanaryAnalysis weekly allows this build');
	});

	it('a gate we READ and found unowned is still an approval — evidence, not absence', () => {
		const ctxOwned = buildGateContext({
			environments: null,
			rolloutDependencies: null,
			rolloutGates: {
				items: [{ metadata: { namespace: 'ns', name: 'hello-world-manual-approval' } }]
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		});
		const g = classifyGate(
			{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] },
			'ns',
			ctxOwned
		);
		expect(g.clears).toBe('person');
	});

	it('an unknown gate says something TRUE and NON-COMMITTAL, and escalates nothing', () => {
		const broken = buildGateContext({ environments: ENVIRONMENTS, rolloutDependencies: null });
		const s = blockingStory(rolloutWith('hello-dep-dev', [DEP_GATE]), broken, {
			place: 'dev',
			now: NOW
		});
		expect(s.blocked).toBe(true);
		expect(s.person).toHaveLength(0);
		expect(s.unknown).toHaveLength(1);
		expect(s.headline).toBe('Something is holding DEV');
		expect(s.verdict).toBe(
			'This dashboard cannot tell what clears this — it may or may not need a person.'
		);
		// The two wrong instructions, both refused.
		expect(s.resolution).not.toContain('someone approves');
		expect(s.resolution).not.toContain('will not clear on its own');
		expect(s.resolution).not.toContain('clears on its own.');
		// Not knowing is not benign: it cannot be filed under "sorts itself out".
		expect(s.selfClearing).toBe(false);
		expect(s.severity).toBe('warning');
	});

	it('⭐ with the dependency join restored, all four surfaces say the same thing', () => {
		// The join, when the payload carries it, is still what NAMES the provider
		// and the version. The owner veto is a floor, never a substitute for it.
		const whole = buildGateContext({
			environments: ENVIRONMENTS,
			rolloutDependencies: DEPENDENCIES,
			rolloutGates: DEP_GATE_OBJECT
		});
		const s = blockingStory(rolloutWith('hello-dep-prod', [DEP_GATE]), whole, {
			place: 'prod',
			now: NOW
		});
		expect(s.headline).toBe('PROD is waiting on another deploy');
		expect(s.consequence).toContain('hello-api-app ships a newer api than 1.66.0');
		expect(s.verdict).toBe(
			'Nobody has to approve anything — this clears when the deploy in front of it lands.'
		);
		expect(s.person).toHaveLength(0);
		expect(s.unknown).toHaveLength(0);
	});

	it('the owner veto alone is upstream but GENERIC — it degrades, it does not lie', () => {
		// Same gate, a namespace the dependency fixture does not cover. We can
		// still prove a machine owns it, so we say the true generic thing rather
		// than naming a provider we have not read.
		const whole = buildGateContext({
			environments: ENVIRONMENTS,
			rolloutDependencies: DEPENDENCIES,
			rolloutGates: DEP_GATE_OBJECT
		});
		const s = blockingStory(rolloutWith('hello-dep-dev', [DEP_GATE]), whole, {
			place: 'dev',
			now: NOW
		});
		expect(s.headline).toBe('DEV is waiting on another deploy');
		expect(s.consequence).toContain('the service it depends on ships a newer version');
		expect(s.person).toHaveLength(0);
	});

	it('an unknown gate ranks second, behind a person and ahead of an upstream', () => {
		// Complete provenance, so `hello-world-manual-approval` is still an
		// approval — and one gate owned by a controller nothing here has a story
		// for, which is the shape a FUTURE writer will arrive in.
		const ctxMixed = buildGateContext({
			environments: ENVIRONMENTS,
			rolloutDependencies: DEPENDENCIES,
			rolloutGates: {
				items: [
					{
						metadata: {
							namespace: 'hello-world-prod',
							name: 'mystery-gate',
							ownerReferences: [{ kind: 'CanaryAnalysis', name: 'weekly', controller: true }]
						}
					}
				]
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		});
		const s = blockingStory(
			rolloutWith('hello-world-prod', [
				{ name: 'ghd-xm669', passing: true, allowedVersions: [] },
				{ name: 'mystery-gate', passing: true, allowedVersions: [] },
				{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] }
			]),
			ctxMixed,
			{ now: NOW }
		);
		expect(s.gates.map((g) => g.clears)).toEqual(['person', 'unknown', 'upstream']);
		expect(shortStory(s)).toContain('a rule this dashboard cannot attribute');
	});
});
