import { describe, it, expect } from 'vitest';
import type { Rollout } from '../../types';
import { skipConfirm, skipConfirmLevel } from './deploy-risk';
import {
	otherHolders,
	pendingCovers,
	pendingSkip,
	ruleGates,
	sameRule,
	skippedFact,
	skippedRulesOf,
	skippedToast,
	skipRows,
	skipSentence,
	targetBuild,
	withoutSkipClause,
	BYPASS_ANNOTATION,
	BYPASS_ONLY_ANNOTATION,
	type RuleRef
} from './skip-rule';
import { deployReason } from './activity-note';

const BH: RuleRef = { kind: 'ClusterRolloutSchedule', name: 'business-hours' };

type G = { name: string; rule: RuleRef; displayName?: string; passing?: boolean; allowedVersions?: string[] };
const bh = (app: string): G => ({ name: `business-hours-${app}`, rule: BH, displayName: 'Business hours', passing: false });
const approval: G = { name: 'release-approval', rule: { kind: 'ApprovalPolicy', name: 'prod-needs-approval', namespace: 'x' }, displayName: 'Release approval', allowedVersions: ['m-61'], passing: true };

function rollout(o: {
	ns: string;
	name?: string;
	cluster?: string;
	gates: G[];
	/** candidates newest first, with the gates the controller says hold each */
	candidates: { tag: string; blockedBy?: string[] }[];
	annotations?: Record<string, string>;
	env?: string;
}): Rollout {
	return {
		metadata: {
			name: o.name ?? 'ledger-api',
			namespace: o.ns,
			labels: { environment: o.env ?? 'prod' },
			annotations: { 'rollout-dashboard.kuberik.com/source-cluster': o.cluster ?? 'prod', ...(o.annotations ?? {}) }
		},
		status: {
			currentVersion: 'm-61',
			gates: o.gates.map((g) => ({ ...g, kind: 'schedule' })),
			candidates: o.candidates.map((c) => ({ ...c, gated: false })),
			history: [{ version: { tag: 'm-61', version: '5.7.1-61' }, bakeStatus: 'Succeeded' }]
		}
	} as unknown as Rollout;
}

const heldByBh = (ns: string, app = 'ledger-api') =>
	rollout({ ns, name: app, gates: [bh(app)], candidates: [{ tag: 'm-62', blockedBy: [bh(app).name] }] });

describe('skipConfirm: what production asks for, and why', () => {
	it('no production in the selection is the dialog sentence, nothing typed', () => {
		expect(skipConfirmLevel(['staging', 'dev'])).toBe('notice');
		expect(skipConfirm([{ env: 'staging', build: '5.8.0-62', name: 'a' }], BH)).toEqual({ level: 'notice' });
	});

	it('production on ONE shared build: type the build', () => {
		const c = skipConfirm(
			[
				{ env: 'prod', build: '5.8.0-62', name: 'ledger-api' },
				{ env: 'prod', build: '5.8.0-62', name: 'billing-edge' },
				{ env: 'staging', build: '5.9.0-70', name: 'other' }
			],
			BH
		);
		expect(c.level).toBe('typed');
		if (c.level !== 'typed') return;
		// the staging rollout's different build does not matter: only the selected PRODUCTION builds decide
		expect(c.by).toBe('build');
		expect(c.expected).toBe('5.8.0-62');
		expect(c.production.map((p) => p.name)).toEqual(['ledger-api', 'billing-edge']);
	});

	it('production across several builds: list them and type the rule', () => {
		const c = skipConfirm(
			[
				{ env: 'prod', build: '5.8.0-62', name: 'ledger-api' },
				{ env: 'prod', build: '2.3.0-31', name: 'invoice-worker' }
			],
			BH
		);
		expect(c.level).toBe('typed');
		if (c.level !== 'typed') return;
		expect(c.by).toBe('rule');
		expect(c.expected).toBe('business-hours');
		expect(c.why).toBe("Several builds are selected, so type the rule's name.");
		expect(c.production).toHaveLength(2);
	});

	it('a prod site counts as production', () => {
		expect(skipConfirmLevel(['prod-eu-central'])).toBe('typed');
	});
});

describe('which build a rule holds on a rollout', () => {
	it('is the newest candidate one of the rule gates refuses (blockedBy)', () => {
		const r = rollout({
			ns: 'p',
			gates: [bh('ledger-api')],
			candidates: [
				{ tag: 'm-64', blockedBy: [] },
				{ tag: 'm-63', blockedBy: ['business-hours-ledger-api'] },
				{ tag: 'm-62', blockedBy: ['business-hours-ledger-api'] }
			]
		});
		expect(targetBuild(r, BH)).toMatchObject({ tag: 'm-63', gateNames: ['business-hours-ledger-api'] });
	});

	it('is null when the rule holds nothing, or the rollout has no gate of the rule', () => {
		const clear = rollout({ ns: 'p', gates: [bh('ledger-api')], candidates: [{ tag: 'm-62', blockedBy: [] }] });
		expect(targetBuild(clear, BH)).toBeNull();
		const other = rollout({ ns: 'p', gates: [approval], candidates: [{ tag: 'm-62', blockedBy: ['release-approval'] }] });
		expect(targetBuild(other, BH)).toBeNull();
	});

	it('falls back to the gates that refuse the tag when the payload carries no blockedBy', () => {
		const r = rollout({ ns: 'p', gates: [bh('ledger-api')], candidates: [{ tag: 'm-62' }] });
		expect(targetBuild(r, BH)?.tag).toBe('m-62');
	});

	it('names the same rule across rollouts by kind + name + namespace', () => {
		expect(sameRule(BH, { kind: 'ClusterRolloutSchedule', name: 'business-hours' })).toBe(true);
		expect(sameRule(BH, { kind: 'RolloutSchedule', name: 'business-hours', namespace: 'a' })).toBe(false);
		expect(sameRule({ kind: 'RolloutSchedule', name: 'b', namespace: 'a' }, { kind: 'RolloutSchedule', name: 'b', namespace: 'c' })).toBe(false);
		expect(ruleGates(heldByBh('p'), BH)).toHaveLength(1);
	});

	it('names the other rules still holding a build once the skipped ones are out', () => {
		const r = rollout({
			ns: 'p',
			gates: [bh('billing-edge'), approval],
			candidates: [{ tag: 'm-62', blockedBy: ['release-approval'] }]
		});
		expect(otherHolders(r, 'm-62', ['business-hours-billing-edge'])).toEqual(['Release approval']);
	});
});

describe('the other rollouts the same rule holds', () => {
	const here = { cluster: 'staging', namespace: 'ledger-api-staging', name: 'ledger-api' };
	const fleet = [
		heldByBh('billing-edge-prod', 'billing-edge'),
		rollout({ ns: 'ledger-api-staging', gates: [bh('ledger-api')], candidates: [{ tag: 'm-62', blockedBy: ['business-hours-ledger-api'] }], env: 'staging', cluster: 'staging' }),
		rollout({ ns: 'ledger-api-prod', gates: [approval], candidates: [{ tag: 'm-62', blockedBy: ['release-approval'] }] }),
		heldByBh('invoice-worker-staging', 'invoice-worker')
	];
	const envOf = (r: Rollout) => r.metadata?.labels?.environment ?? '';
	const rank = (a: string) => (a === 'staging' ? 0 : 1);

	it('lists this rollout first, then by environment, and leaves out rollouts the rule does not hold', () => {
		const rows = skipRows({ fleet, rule: BH, here, envOf, compareEnv: (a, b) => rank(a) - rank(b) });
		expect(rows.map((r) => r.key)).toEqual([
			'staging/ledger-api-staging/ledger-api',
			'prod/billing-edge-prod/billing-edge',
			'prod/invoice-worker-staging/invoice-worker'
		]);
		expect(rows[0]).toMatchObject({ tag: 'm-62', gateNames: ['business-hours-ledger-api'] });
	});

	it('drops a rollout whose skip is already asked for', () => {
		const pending = heldByBh('invoice-worker-staging', 'invoice-worker');
		pending.metadata!.annotations = { ...pending.metadata!.annotations, [BYPASS_ANNOTATION]: 'm-62' };
		const rows = skipRows({ fleet: [fleet[1], pending], rule: BH, here, envOf, compareEnv: () => 0 });
		expect(rows.map((r) => r.name)).toEqual(['ledger-api']);
	});
});

describe('a pending skip withdraws the offer whatever its tag', () => {
	const pend = (tag: string) =>
		rollout({
			ns: 'p',
			gates: [bh('invoice-worker')],
			candidates: [
				{ tag: 'm-63', blockedBy: ['business-hours-invoice-worker'] },
				{ tag: 'm-62', blockedBy: ['business-hours-invoice-worker'] }
			],
			annotations: { [BYPASS_ANNOTATION]: tag }
		});
	it('targetBuild is null for a pending skip on the NEWER build and on an OLDER one', () => {
		expect(targetBuild(pend('m-63'), BH)).toBeNull();
		// the held build is m-63, the pending one m-62: offering m-63 would replace the annotation and cancel m-62's skip
		expect(targetBuild(pend('m-62'), BH)).toBeNull();
	});
	it('a stale annotation (not a candidate) does not hide the offer', () => {
		expect(targetBuild(pend('m-99'), BH)?.tag).toBe('m-63');
	});
	it('skipRows drops the rollout even when the dialog would have offered an older build', () => {
		const here = { cluster: 'staging', namespace: 'p', name: 'x' };
		const rows = skipRows({ fleet: [pend('m-62')], rule: BH, here, envOf: () => '', compareEnv: () => 0 });
		expect(rows).toEqual([]);
	});
});

describe('a skip that is asked for and not used yet (annotations, not status)', () => {
	const mk = (ann: Record<string, string>, candidates = [{ tag: 'm-62', blockedBy: ['business-hours-ledger-api'] }]) =>
		rollout({ ns: 'p', gates: [bh('ledger-api'), approval], candidates, annotations: ann });

	it('is read from metadata.annotations the moment the write lands', () => {
		const p = pendingSkip(mk({ [BYPASS_ANNOTATION]: 'm-62', [BYPASS_ONLY_ANNOTATION]: 'business-hours-ledger-api' }));
		expect(p).toMatchObject({ tag: 'm-62', all: false, gates: ['business-hours-ledger-api'] });
		expect(pendingCovers(p, ['business-hours-ledger-api'])).toBe(true);
		expect(pendingCovers(p, ['release-approval'])).toBe(false);
	});

	it('with no only-list every rule is skipped', () => {
		const p = pendingSkip(mk({ [BYPASS_ANNOTATION]: 'm-62' }));
		expect(p?.all).toBe(true);
		expect(pendingCovers(p, ['release-approval'])).toBe(true);
	});

	it('is not drawn for a build that is no longer a candidate, or with no annotation', () => {
		expect(pendingSkip(mk({ [BYPASS_ANNOTATION]: 'm-99' }))).toBeNull();
		expect(pendingSkip(mk({}))).toBeNull();
		expect(pendingSkip(mk({ [BYPASS_ONLY_ANNOTATION]: 'x' }))).toBeNull();
	});
});

describe('History: the controller message names the skipped gates, never a person', () => {
	it('parses a partial skip', () => {
		expect(skippedRulesOf('Automatic deployment, with gate bypass of business-hours-ledger-api, release-approval')).toEqual({
			all: false,
			gates: ['business-hours-ledger-api', 'release-approval']
		});
	});
	it('stops at the next clause', () => {
		expect(skippedRulesOf('Manual deployment, with force deploy, with gate bypass of g1, with failed bake unblock')).toEqual({ all: false, gates: ['g1'] });
	});
	it('a bare "with gate bypass" is every rule', () => {
		expect(skippedRulesOf('Automatic deployment, with gate bypass')).toEqual({ all: true, gates: [] });
		expect(skippedRulesOf('Manual deployment, with gate bypass, with force deploy')).toEqual({ all: true, gates: [] });
	});
	it('says nothing for a message without the clause', () => {
		expect(skippedRulesOf('Automatic deployment')).toBeNull();
	});

	it("reads the controller's exact messages: unknown suffix ignored, `no gate` is no skip, bare is every rule", () => {
		expect(skippedRulesOf('Automatic deployment, with gate bypass of a, b (unknown: x, y)')).toEqual({ all: false, gates: ['a', 'b'] });
		expect(skippedRulesOf('Manual deployment, with gate bypass of a (unknown: x), with failed bake unblock')).toEqual({ all: false, gates: ['a'] });
		expect(skippedRulesOf('Manual deployment, with gate bypass of no gate (unknown: x)')).toBeNull();
		expect(skippedRulesOf('Manual deployment, with gate bypass of no gate')).toBeNull();
		expect(skippedRulesOf('Automatic deployment, with gate bypass')).toEqual({ all: true, gates: [] });
		expect(withoutSkipClause('Automatic deployment, with gate bypass of a, b (unknown: x, y)')).toBe('Automatic deployment');
		expect(withoutSkipClause('Manual deployment, with gate bypass of no gate (unknown: x)')).toBe('Manual deployment');
		expect(skippedRulesOf(undefined)).toBeNull();
	});
	it('maps gate names back to the rule label, one fact per rule, and prints an unknown gate as itself', () => {
		const labels = new Map([
			['business-hours-ledger-api', 'Business hours'],
			['business-hours-other', 'Business hours']
		]);
		expect(skippedFact({ all: false, gates: ['business-hours-ledger-api', 'business-hours-other'] }, labels)?.text).toBe('Skipped Business hours');
		const f = skippedFact({ all: false, gates: ['business-hours-ledger-api', 'old-gate-x'] }, labels);
		expect(f?.text).toBe('Skipped Business hours, old-gate-x');
		expect(f?.parts.map((p) => p.code)).toEqual([false, true]);
		expect(skippedFact({ all: true, gates: [] }, labels)?.text).toBe('Skipped every rule');
		expect(skippedFact(null, labels)).toBeNull();
	});
	it('strips the clause so it is never printed as a note', () => {
		expect(withoutSkipClause('Automatic deployment, with gate bypass of business-hours-x')).toBe('Automatic deployment');
		expect(withoutSkipClause('Manual deployment, with gate bypass, with force deploy')).toBe('Manual deployment, with force deploy');
		expect(deployReason('Automatic deployment, with gate bypass of business-hours-x')).toBeNull();
		expect(deployReason('Hotfix for ledger, with gate bypass')).toBe('Hotfix for ledger');
	});
});

describe('the dialog sentence follows the selection, and says things once', () => {
	const join = (p: { text: string }[]) => p.map((x) => x.text).join('');
	it('one rollout names rule, build, rollout and place', () => {
		expect(join(skipSentence('Business hours', [{ name: 'checkout-api', env: 'prod', build: '4.45.0-45' }]))).toBe(
			'Business hours lets 4.45.0-45 through to checkout-api in prod once.'
		);
	});
	it('several on one build / on different builds', () => {
		const a = { name: 'a', env: 'prod', build: '1' };
		expect(join(skipSentence('Business hours', [a, { ...a, name: 'b' }]))).toBe('Business hours lets 1 through once, in the 2 rollouts below.');
		expect(join(skipSentence('Business hours', [a, { ...a, name: 'b', build: '2' }]))).toBe("Business hours lets each rollout's held build through once.");
	});
	it('the toast counts rollouts', () => {
		expect(skippedToast('Business hours', [{ build: '4.45.0-45' }])).toBe('Business hours skipped once for 4.45.0-45');
		expect(skippedToast('Business hours', [{ build: 'a' }, { build: 'b' }, { build: 'c' }])).toBe('Business hours skipped once for 3 rollouts');
	});
});
