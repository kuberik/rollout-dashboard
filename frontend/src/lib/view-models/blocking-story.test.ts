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
	isPluralSubject,
	pluralSubject,
	upstreamVerdict,
	EMPTY_GATE_CONTEXT,
	type ClassifiedGate
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

	/**
	 * ⛔ THE RAW OCI TAG NEVER PRINTS. (2026-09-02) `spec.wantedVersion` is the
	 * ~60-char OCI reference (`main-1788002370-0afab6f…`), not the short form
	 * every surface names a build by. `pinnedTo` matches an `availableReleases`
	 * entry here (`tag-a` → `aaaaaaa`), so `displayVersionForTag` resolves it —
	 * exactly the lookup `/apps`, rollout detail's own "Version pinned" banner
	 * and `dependency-graph.ts`'s node hold already use.
	 */
	it('the pin headline and shortStory print the SHORT form, never the raw tag', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [], { wantedVersion: 'tag-a' }),
			ctx,
			{ place: 'dev', now: NOW }
		);
		expect(s.pinnedTo).toBe('tag-a');
		expect(s.pinnedToDisplay).toBe('aaaaaaa');
		expect(s.headline).toBe('DEV is pinned to aaaaaaa');
		expect(s.headline).not.toContain('tag-a');
		expect(shortStory(s)).toBe('Pinned to aaaaaaa');
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

describe('isPluralSubject', () => {
	it('one app, however many environments it is held in, is singular — "needs"', () => {
		// `heldSubjects()` folds this to ONE phrase, "hello-frontend-app in
		// dev, staging and prod" — one distinct name behind it, so the verb
		// that follows must be "needs", not "need".
		expect(isPluralSubject(['hello-frontend-app'])).toBe(false);
		expect(
			isPluralSubject(['hello-frontend-app', 'hello-frontend-app', 'hello-frontend-app'])
		).toBe(false);
	});

	it('two distinct apps held on the same provider is plural — "need"', () => {
		expect(isPluralSubject(['hello-frontend-app', 'checkout-app'])).toBe(true);
	});

	it('no names at all is not plural — nothing to disagree about', () => {
		expect(isPluralSubject([])).toBe(false);
	});
});

/** A minimal `ClassifiedGate`, filling in only what `upstreamVerdict` reads. */
function upstreamGate(overrides: Partial<ClassifiedGate>): ClassifiedGate {
	return {
		id: 'g',
		kind: 'promotion',
		clears: 'upstream',
		label: '',
		clause: '',
		short: '',
		clearsAt: null,
		subject: null,
		subjectKind: null,
		predicate: null,
		contract: null,
		have: null,
		need: null,
		...overrides
	};
}

describe('upstreamVerdict', () => {
	// ⭐ (2026-09-03, operator-walk finding 6, from the human: "the leading
	// clause is the one a 3am reader takes.") A CONTRACT gate no longer
	// leads with "nobody has to approve anything" — that reads as an
	// all-clear on a gate that will not move without a person shipping
	// something. It leads with the negative, names who has to act, and
	// names the one thing that DOES move it right now: a hand-started
	// deploy bypasses the check. A `promotion`-only gate is unaffected — see
	// below — because it really is inert, and "nobody has to approve
	// anything" is the whole, honest answer there.
	it('contract-only names the provider and the required version', () => {
		const gates = [
			upstreamGate({
				kind: 'dependency',
				subject: 'hello-api-app',
				contract: 'api',
				need: '^1.67.0'
			})
		];
		expect(upstreamVerdict(gates)).toBe(
			'No approval will unblock this. Someone has to ship api ^1.67.0 from hello-api-app; until then the only way forward is a hand-started deploy, which bypasses the check.'
		);
	});

	it('promotion-only says nobody has to approve anything', () => {
		const gates = [upstreamGate({ kind: 'promotion' })];
		expect(upstreamVerdict(gates)).toBe(
			'Nobody has to approve anything — this clears when the deploy in front of it lands.'
		);
	});

	it('mixed gates lead with the contract, THEN the promotion order', () => {
		const gates = [
			upstreamGate({ kind: 'promotion' }),
			upstreamGate({
				kind: 'dependency',
				subject: 'hello-api-app',
				contract: 'api',
				need: '^1.67.0'
			})
		];
		// ⛔ NOT "…the deploy in front of it lands and ship api ^1.67.0 from
		// hello-api-app" — that was the order the two `kind`s happened to be
		// checked in, not a choice. The contract is the binding cause and
		// leads; the promotion gate is the consequence and trails.
		expect(upstreamVerdict(gates)).toBe(
			'No approval will unblock this. Someone has to ship api ^1.67.0 from hello-api-app, then the deploy in front of it has to land; until then the only way forward is a hand-started deploy, which bypasses the check.'
		);
	});

	it('mixed gates lead with the contract regardless of INPUT order', () => {
		// The ordering is a property of the SENTENCE, not of the array the
		// caller happened to build — `blockingStory`'s own gate list is
		// worst-first (person, unknown, upstream, check, clock), which does
		// not itself distinguish promotion from dependency within `upstream`.
		const gates = [
			upstreamGate({
				kind: 'dependency',
				subject: 'hello-api-app',
				contract: 'api',
				need: '^1.67.0'
			}),
			upstreamGate({ kind: 'promotion' })
		];
		expect(upstreamVerdict(gates)).toBe(
			'No approval will unblock this. Someone has to ship api ^1.67.0 from hello-api-app, then the deploy in front of it has to land; until then the only way forward is a hand-started deploy, which bypasses the check.'
		);
	});

	it('a contract with no agreed requirement falls back to "a newer <contract>"', () => {
		const gates = [
			upstreamGate({ kind: 'promotion' }),
			upstreamGate({ kind: 'dependency', subject: 'hello-api-app', contract: 'api', need: null })
		];
		expect(upstreamVerdict(gates)).toBe(
			'No approval will unblock this. Someone has to ship a newer api from hello-api-app, then the deploy in front of it has to land; until then the only way forward is a hand-started deploy, which bypasses the check.'
		);
	});

	it('no upstream gate at all falls back to the general sentence', () => {
		expect(upstreamVerdict([])).toBe(
			'Nobody has to approve anything — this clears when the deploy in front of it lands.'
		);
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
		//
		// ⭐ THE HEADLINE NAMES THE CONTRACT NOW TOO. (2026-09-03) A lone contract
		// gate used to print the same generic sentence a lone promotion gate
		// does — this is `hello-dep-dev/hello-frontend-app`'s exact live shape,
		// one gate only, and it read "DEV is waiting on another deploy" while
		// PROD's two-gate banner (contract + downstream order gate, fixed above)
		// named `hello-api-app` and `^1.67.0` for the SAME contract. One gate is
		// not a reason to know less than two gates of the identical kind.
		const whole = buildGateContext({
			environments: ENVIRONMENTS,
			rolloutDependencies: DEPENDENCIES,
			rolloutGates: DEP_GATE_OBJECT
		});
		const s = blockingStory(rolloutWith('hello-dep-prod', [DEP_GATE]), whole, {
			place: 'prod',
			now: NOW
		});
		expect(s.headline).toBe('PROD is waiting for hello-api-app to ship api ^1.67.0');
		expect(s.consequence).toContain('hello-api-app ships a newer api than 1.66.0');
		// ⛔ NOT "the deploy in front of it lands" — this gate is a CONTRACT
		// (RolloutDependency), not a promotion order, and nothing is "in front
		// of it". The verdict names who has to ship what. See `upstreamVerdict`.
		// ⛔ NOR "Nobody has to approve anything" LEADING — superseded
		// 2026-09-03 (operator-walk finding 6): that clause is the one a 3am
		// reader takes as "not mine" and stops reading. A contract gate leads
		// with the negative and the escape hatch instead.
		expect(s.verdict).toBe(
			'No approval will unblock this. Someone has to ship api ^1.67.0 from hello-api-app; until then the only way forward is a hand-started deploy, which bypasses the check.'
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

// ── `pluralSubject`: A SET AS THE HEADLINE'S SUBJECT ───────────────────────
//
// `/apps/<name>`'s banner used to be forced to name the app AGAIN
// (`hello-frontend-app in all 3 environments is waiting on another deploy`)
// because every headline template needed a grammatically singular head. These
// pin the conjugated forms and, separately, that a bare string subject is
// completely unaffected — the byte-identical guarantee every other caller of
// `blockingStory` (`/apps`, `/environments`, `/envs/<name>`, rollout detail,
// `/versions`) relies on.
describe('pluralSubject — a headline whose subject is a set', () => {
	const NOW = new Date('2026-08-30T23:26:00Z');

	it('conjugates "is" to "are" — the upstream-only headline', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [{ name: 'ghd-xm669', passing: true, allowedVersions: [] }]),
			ctx,
			{ subject: pluralSubject('All 3 environments', 'all 3 environments'), now: NOW }
		);
		expect(s.headline).toBe('All 3 environments are waiting on another deploy');
	});

	it('conjugates "is" to "are" — a lone CONTRACT gate, `/apps/<name>`\'s own shape', () => {
		// ⭐ (2026-09-03) `/apps/<name>` drops the app from the sentence and
		// lets the environment SET stand as `subject`, which is what
		// `pluralSubject` is for — see its own doc. `upstreamHeadline` reads
		// `subjectLead`/`isVerb` exactly like every other branch, so naming
		// the contract on a lone gate conjugates the same way naming nothing
		// did: "All 3 environments ARE waiting for hello-api-app to ship api
		// ^1.67.0", never "is".
		const whole = buildGateContext({
			environments: ENVIRONMENTS,
			rolloutDependencies: DEPENDENCIES,
			rolloutGates: DEP_GATE_OBJECT
		});
		const s = blockingStory(rolloutWith('hello-dep-prod', [DEP_GATE]), whole, {
			subject: pluralSubject('All 3 environments', 'all 3 environments'),
			now: NOW
		});
		expect(s.headline).toBe(
			'All 3 environments are waiting for hello-api-app to ship api ^1.67.0'
		);
	});

	it('conjugates "is" to "are" — the person-gate headline', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [
				{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] }
			]),
			ctx,
			{ subject: pluralSubject('All 3 environments', 'all 3 environments'), now: NOW }
		);
		expect(s.headline).toBe('All 3 environments are waiting on an approval');
	});

	it('conjugates "is" to "are" — the pinned headline', () => {
		const s = blockingStory(
			rolloutWith(
				'hello-world-prod',
				[{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] }],
				{ wantedVersion: '991829b' }
			),
			ctx,
			{ subject: pluralSubject('All 3 environments', 'all 3 environments'), now: NOW }
		);
		expect(s.headline).toBe('All 3 environments are pinned to 991829b');
	});

	it('the multi-gate and unknown headlines put the subject in OBJECT position, uncapitalised', () => {
		// "Something is holding All 3 environments" breaks case mid-sentence —
		// the whole reason `lead`/`object` are separate strings. The sentence's
		// own verb ("is"/"are" on "things"/"Something") does not come from
		// `isVerb`, which is why these two headlines are untouched by
		// conjugation and only the embedded phrase changes.
		const c = withSchedules(ctx, 'hello-world-staging', SCHEDULES_STAGING);
		const s = blockingStory(
			rolloutWith('hello-world-staging', [
				{ name: 'schedule-gate-nwm62', passing: false, allowedVersions: null },
				{ name: 'ghd-p2fld', passing: true, allowedVersions: [] }
			]),
			c,
			{ subject: pluralSubject('All 3 environments', 'all 3 environments'), now: NOW }
		);
		expect(s.headline).toBe('Two things are holding all 3 environments');
	});

	it('a `lead`-only subject (no distinct `object`) reuses `lead` verbatim in object position', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [{ name: 'ghd-xm669', passing: true, allowedVersions: [] }]),
			ctx,
			{ subject: pluralSubject('DEV, STAGING and PROD'), now: NOW }
		);
		expect(s.headline).toBe('DEV, STAGING and PROD are waiting on another deploy');
	});

	it('a bare string subject is byte-identical to before `pluralSubject` existed', () => {
		const s = blockingStory(
			rolloutWith('hello-world-prod', [{ name: 'ghd-xm669', passing: true, allowedVersions: [] }]),
			ctx,
			{ place: 'prod', now: NOW }
		);
		expect(s.headline).toBe('PROD is waiting on another deploy');
	});
});

// ── ⭐ ONE CAUSE UNDER TWO NAMES IS STILL ONE CAUSE ─────────────────────────
//
// The defect: `/rollouts/prod/hello-dep-prod/hello-frontend-app`'s Overview
// banner read "Two things are holding PROD" — `blockingStory` fell back to a
// bare count the moment `gates.length > 1`, before either gate's `clears` was
// read. Both of PROD's gates are `hello-frontend-needs-api`'s contract: the
// `RolloutDependency` gate directly, and the promotion-order gate ("after
// staging") only because staging is held on the identical contract. Every
// other surface for this same rollout named the cause —
// `/envs/prod` → "… waiting for hello-api-app to ship api ^1.67.0 — it is on
// 1.66.0", `/apps` → "hello-frontend-app is waiting on another deploy in all
// 3 environments", `/dependencies` → "… until hello-api-app ships api
// ^1.67.0" — and the Overview banner was the one page still counting.
describe('⭐ same-bucket multi-gate headlines name the cause, not the count', () => {
	const NOW = new Date('2026-09-03T00:00:00Z');

	it('the live fixture: a contract gate and its downstream order gate both read `upstream` — the headline names hello-api-app and ^1.67.0, never "things"', () => {
		const frontendCtx = buildGateContext({
			environments: {
				items: [
					{
						metadata: { namespace: 'hello-dep-prod', name: 'hello-frontend-app' },
						spec: {
							environment: 'prod',
							relationship: { environment: 'staging', type: 'After' as const },
							rolloutRef: { name: 'hello-frontend-app' }
						},
						status: { rolloutGateRef: { name: 'ghd-frontend-prod' } }
					}
				]
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any,
			rolloutDependencies: DEPENDENCIES
		});
		const s = blockingStory(
			rolloutWith('hello-dep-prod', [
				{ name: 'dependency-hello-frontend-needs-api', passing: true, allowedVersions: ['rel-66'] },
				{ name: 'ghd-frontend-prod', passing: true, allowedVersions: [] }
			]),
			frontendCtx,
			{ place: 'prod', now: NOW }
		);
		expect(s.gates).toHaveLength(2);
		// Both gates read the SAME bucket — the order gate is downstream of the
		// same contract, not a second cause.
		expect(s.gates.every((g) => g.clears === 'upstream')).toBe(true);
		expect(s.headline).toBe('PROD is waiting for hello-api-app to ship api ^1.67.0');
		expect(s.headline).not.toContain('things');
		expect(s.headline).not.toMatch(/^(One|Two|Three|Four|Five|Six|no) /);
		// The contract leads the consequence too, regardless of the gates'
		// generated-name alphabetical order.
		expect(s.consequence.indexOf('hello-api-app ships')).toBeLessThan(
			s.consequence.indexOf('staging deploys it first')
		);
	});

	it('a person gate plus a contract: the buckets differ, so the count headline stays — and the consequence still names the approval first', () => {
		const frontendCtx = buildGateContext({
			// `{ items: [] }` — CONSULTED and empty, not `null` — so the
			// provenance test can clear a hand-authored gate as `person`.
			environments: { items: [] },
			rolloutDependencies: DEPENDENCIES
		});
		const s = blockingStory(
			rolloutWith('hello-dep-prod', [
				{ name: 'dependency-hello-frontend-needs-api', passing: true, allowedVersions: ['rel-66'] },
				{ name: 'hello-frontend-manual-approval', passing: true, allowedVersions: [] }
			]),
			frontendCtx,
			{ place: 'prod', now: NOW }
		);
		expect(s.gates).toHaveLength(2);
		expect(s.person).toHaveLength(1);
		expect(s.upstream).toHaveLength(1);
		// Mixed buckets: a person and a contract are two DIFFERENT kinds of
		// story, so the count headline is still the honest one.
		expect(s.headline).toBe('Two things are holding PROD');
		// But the human-actionable clause still leads the consequence — the
		// worst-first build order already puts `person` before `upstream`.
		expect(s.consequence.indexOf('someone approves it')).toBeLessThan(
			s.consequence.indexOf('hello-api-app ships')
		);
		expect(s.resolution).toContain('will not clear on its own');
	});

	it('⭐ the live DEV fixture: a lone contract gate names the provider too, the same rule as two gates of the same kind', () => {
		// `/rollouts/dev/hello-dep-dev/hello-frontend-app` carries ONLY the
		// contract gate — no downstream order gate, since dev has no upstream
		// environment. It used to print the same generic sentence a lone
		// promotion gate does, while the two-gate PROD banner (fixed above)
		// named `hello-api-app` and `^1.67.0` for the identical contract. One
		// gate is not a reason to say less than two gates of the same kind.
		//
		// ⛔ THE MODULE-LEVEL `DEPENDENCIES` FIXTURE ONLY JOINS `hello-dep-prod`
		// — a dev-namespace item is built here so the join actually resolves a
		// provider, rather than falling through to the owner-veto's GENERIC
		// dependency clause (already covered by "the owner veto alone is
		// upstream but GENERIC", above).
		const devCtx = buildGateContext({
			environments: { items: [] },
			rolloutDependencies: {
				items: [
					{
						metadata: { namespace: 'hello-dep-dev', name: 'hello-frontend-needs-api' },
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
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		});
		const s = blockingStory(rolloutWith('hello-dep-dev', [DEP_GATE]), devCtx, {
			place: 'dev',
			now: NOW
		});
		expect(s.gates).toHaveLength(1);
		expect(s.headline).toBe('DEV is waiting for hello-api-app to ship api ^1.67.0');
	});

	it('a lone PROMOTION-order gate is untouched — the generic sentence stays, because there is no contract to name', () => {
		// ⛔ LOCKED, and this is the case `upstreamHeadline` falls back for:
		// the sole upstream gate is `kind: 'promotion'`, so there is no
		// `dependency` gate's provider/contract/need to name. Already pinned
		// above at "'an upstream-only block is a WARNING…'" with the same
		// `ghd-xm669` fixture; repeated here beside its contract counterpart
		// so the asymmetry (one names the cause, one stays generic) reads as
		// a deliberate pair rather than an accident of which test ran first.
		const s = blockingStory(
			rolloutWith('hello-world-prod', [{ name: 'ghd-xm669', passing: true, allowedVersions: [] }]),
			ctx,
			{ place: 'prod', now: NOW }
		);
		expect(s.upstream).toHaveLength(1);
		expect(s.upstream[0].kind).toBe('promotion');
		expect(s.headline).toBe('PROD is waiting on another deploy');
	});
});
