import { describe, it, expect } from 'vitest';
import { dedupedClauses, dedupedCauses, orderClause, heldConsequence, heldExplanation } from './HeldBanner.svelte';
import type { BlockingStory, ClassifiedGate } from '$lib/view-models/blocking-story';

const NOTHING_TO_DRAW = {
	subject: null,
	subjectKind: null,
	predicate: null,
	contract: null,
	have: null,
	need: null
} as const;

function dependencyGate(clause: string, id: string = 'dependency-hello-frontend-needs-api'): ClassifiedGate {
	return {
		id,
		kind: 'dependency',
		clears: 'upstream',
		label: 'depends on hello-api-app',
		clause,
		short: clause,
		clearsAt: null,
		timezone: null,
		...NOTHING_TO_DRAW,
		subject: 'hello-api-app',
		subjectKind: 'service',
		predicate: 'ships a newer api',
		contract: 'api',
		have: '1.66.0',
		need: '^1.67.0'
	};
}

function promotionGate(after: string): ClassifiedGate {
	return {
		id: `ghd-${after}`,
		kind: 'promotion',
		clears: 'upstream',
		label: `after ${after}`,
		clause: `${after} deploys it first`,
		short: `Waiting for ${after} to deploy it first`,
		clearsAt: null,
		timezone: null,
		...NOTHING_TO_DRAW,
		subject: after,
		subjectKind: 'environment',
		predicate: 'deploys it first'
	};
}

/**
 * `dev`, `staging` and `prod` — the exact live-cluster shape item 1 names:
 * one contract gate shared by all three, plus a promotion gate on staging
 * and prod naming the environment in front of them. Differ ONLY by which
 * gates are present, the same way the three real per-env `BlockingStory`
 * results do.
 */
function story(gates: ClassifiedGate[]): BlockingStory {
	const upstream = gates;
	return {
		blocked: true,
		candidateCount: 1,
		pinnedTo: null,
		pinnedToDisplay: null,
		gates,
		person: [],
		clock: [],
		upstream,
		checks: [],
		unknown: [],
		clearsAt: null,
		selfClearing: false,
		headline: '',
		consequence: '',
		verdict: '',
		resolution: '',
		severity: 'warning',
		iconKind: 'dependency',
		kindPending: false
	};
}

const DEP_CLAUSE = 'hello-api-app ships a newer api than 1.66.0';

function threeEnvStories(): BlockingStory[] {
	return [
		story([dependencyGate(DEP_CLAUSE)]),
		story([dependencyGate(DEP_CLAUSE), promotionGate('dev')]),
		story([dependencyGate(DEP_CLAUSE), promotionGate('staging')])
	];
}

describe('dedupedClauses — round 11 revisions-pass-6, item 1', () => {
	it('names the dependency clause once across three stories that differ only by promotion gate', () => {
		expect(dedupedClauses(threeEnvStories())).toEqual([DEP_CLAUSE]);
	});

	it('excludes promotion clauses entirely — orderClause names the chain instead', () => {
		const clauses = dedupedClauses(threeEnvStories());
		expect(clauses.some((c) => c.includes('deploys it first'))).toBe(false);
	});

	it('still names a second, unrelated cause once', () => {
		const other = dependencyGate('hello-cache-app ships a newer cache than 2.0.0');
		const out = dedupedClauses([story([dependencyGate(DEP_CLAUSE)]), story([other])]);
		expect(out).toEqual([DEP_CLAUSE, 'hello-cache-app ships a newer cache than 2.0.0']);
	});

	it('is empty for nothing held', () => {
		expect(dedupedClauses([])).toEqual([]);
	});
});

/**
 * ⭐ SECOND OPERATOR WALK, ITEM 3 (PAINFUL) — `heldConsequence` names the
 * GATE, not just its sentence: an operator reading "hello-api-app ships api
 * ^1.67.0" in a banner has no way to `kubectl get rolloutgate` for the rule
 * that says so without this.
 */
describe('dedupedCauses — the clause AND the gate id it came from', () => {
	it('pairs each deduped clause with the gate id that produced it', () => {
		expect(dedupedCauses([story([dependencyGate(DEP_CLAUSE)])])).toEqual([
			{ clause: DEP_CLAUSE, id: 'dependency-hello-frontend-needs-api' }
		]);
	});

	it('two distinct causes keep two distinct ids, same order as the clauses', () => {
		const other = dependencyGate('hello-cache-app ships a newer cache than 2.0.0', 'ghd-5b2wn');
		const out = dedupedCauses([story([dependencyGate(DEP_CLAUSE)]), story([other])]);
		expect(out).toEqual([
			{ clause: DEP_CLAUSE, id: 'dependency-hello-frontend-needs-api' },
			{ clause: 'hello-cache-app ships a newer cache than 2.0.0', id: 'ghd-5b2wn' }
		]);
	});
});

describe('orderClause — the sequence, named once', () => {
	it('chains the held places in pipeline order when a promotion gate is present', () => {
		expect(orderClause(threeEnvStories(), ['DEV', 'STAGING', 'PROD'])).toBe('then dev → staging → prod');
	});

	it('is empty with no promotion gate — independent holds have no order to state', () => {
		expect(orderClause([story([dependencyGate(DEP_CLAUSE)])], ['DEV'])).toBe('');
	});

	it('is empty for a single held place even if a promotion gate somehow exists — nothing to chain', () => {
		expect(orderClause([story([promotionGate('dev')])], ['STAGING'])).toBe('');
		expect(orderClause([story([promotionGate('dev')])], [])).toBe('');
	});
});

describe('heldConsequence — one paragraph, the cause once and the order once', () => {
	it('joins the deduped cause and the order into one sentence', () => {
		expect(heldConsequence(threeEnvStories(), ['DEV', 'STAGING', 'PROD'])).toBe(
			'Nothing promotes itself until hello-api-app ships a newer api than 1.66.0 · then dev → staging → prod (dependency-hello-frontend-needs-api).'
		);
	});

	it('drops the order clause when there is nothing to sequence', () => {
		expect(heldConsequence([story([dependencyGate(DEP_CLAUSE)])], ['DEV'])).toBe(
			'Nothing promotes itself until hello-api-app ships a newer api than 1.66.0 (dependency-hello-frontend-needs-api).'
		);
	});

	it('names two distinct gates, comma-joined, when two distinct causes hold', () => {
		const other = dependencyGate('hello-cache-app ships a newer cache than 2.0.0', 'ghd-5b2wn');
		expect(heldConsequence([story([dependencyGate(DEP_CLAUSE)]), story([other])], [])).toBe(
			'Nothing promotes itself until hello-api-app ships a newer api than 1.66.0 and hello-cache-app ships a newer cache than 2.0.0 (dependency-hello-frontend-needs-api, ghd-5b2wn).'
		);
	});

	it('is empty for nothing held', () => {
		expect(heldConsequence([], [])).toBe('');
	});
});

describe('heldExplanation — the lead clause, and indefinite vs waiting', () => {
	it('leads with the candidate count once, not per environment', () => {
		const out = heldExplanation(threeEnvStories(), ['DEV', 'STAGING', 'PROD'], false);
		expect(out).toBe(
			'1 newer build is waiting. Nothing promotes itself until hello-api-app ships a newer api than 1.66.0 · then dev → staging → prod (dependency-hello-frontend-needs-api).'
		);
		// The old defect: the same consequence, once per environment.
		expect(out.match(/hello-api-app ships a newer api/g)?.length).toBe(1);
		expect(out.match(/1 newer build is waiting/g)?.length).toBe(1);
	});

	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 — "1 newer build is waiting" and
	 * "held indefinitely … not a matter of waiting" contradict each other in
	 * the same paragraph. The lead clause must not survive into the
	 * indefinite branch.
	 */
	it('drops "N newer build(s) is/are waiting" entirely when the hold is indefinite', () => {
		const out = heldExplanation(threeEnvStories(), ['DEV', 'STAGING', 'PROD'], true);
		expect(out).not.toMatch(/newer builds? (is|are) waiting/);
		expect(out).toContain('held indefinitely');
		expect(out).toContain(DEP_CLAUSE);
	});

	it('is the empty string, not a dangling "held indefinitely" fragment, when nothing is held', () => {
		expect(heldExplanation([], [], true)).toBe('');
	});
});
