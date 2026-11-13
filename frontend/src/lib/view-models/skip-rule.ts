/**
 * SKIP ONE RULE FOR ONE BUILD: the pure half. (bypass-only, 2026-11-12/13)
 *
 * The operator names a RULE (`Business hours`), the cluster holds one RolloutGate per rollout that rule applies to. The API now serves
 * `status.gates[].rule = {kind, name, namespace?}` (pkg/kubernetes/gatekind.go), which is what "the same rule" means across rollouts.
 *
 * Everything here is a function of the served rollouts: which build a rule is holding on a rollout (`targetBuild`), which other rollouts
 * the same rule holds (`skipRows`), whether a skip has been asked for and not yet used (`pendingSkip`, read off the ANNOTATIONS, because
 * the controller only marks `status.gates[].bypassGates` in the reconcile that deploys), and what History says about a deploy that used
 * one (`skippedRulesOf`). The confirm level lives beside `confirmLevel` in `deploy-risk.ts` (`skipConfirm`).
 *
 * VOCABULARY: "rule" and "skip" in every string this file returns. "gate" and "bypass" are cluster words and appear only in
 * annotation keys and in the controller's own message, which `skippedRulesOf` parses.
 */
import type { Rollout } from '$lib/../types';
import { SOURCE_CLUSTER_ANNOTATION } from '$lib/source-dashboard';
import { promotionCandidates, blockingGateNames } from './promotion';
import { displayVersionForTag } from '$lib/version-utils';

export const BYPASS_ANNOTATION = 'rollout.kuberik.com/bypass-gates';
export const BYPASS_ONLY_ANNOTATION = 'rollout.kuberik.com/bypass-gates-only';

export type RuleRef = { kind: string; name: string; namespace?: string };

/** What the Skip once trigger hands the dialog: one rule, the one build it holds here, and the cluster names behind it. */
export type SkipTarget = {
	rule: RuleRef;
	/** The rule as the operator reads it: the gate's pretty-name, else the rule's own name. */
	ruleLabel: string;
	/** The tag the API takes as `version`. */
	tag: string;
	/** The build as every other surface prints it. */
	build: string;
	gateNames: string[];
};

type GateLike = NonNullable<NonNullable<Rollout['status']>['gates']>[number];

/** Two rules are the same rule when kind and name match and both are namespaced the same way (cluster kinds carry no namespace). */
export function sameRule(a: RuleRef | null | undefined, b: RuleRef | null | undefined): boolean {
	if (!a || !b) return false;
	return a.kind === b.kind && a.name === b.name && (a.namespace ?? '') === (b.namespace ?? '');
}

/** Every gate summary of this rollout that the rule owns. */
export function ruleGates(rollout: Rollout | null | undefined, rule: RuleRef): GateLike[] {
	return (rollout?.status?.gates ?? []).filter((g) => g?.name && sameRule(g.rule, rule));
}

/** The rule as the operator reads it. The gate's pretty-name when it has one; a hand-written gate IS its own rule, so its name. */
export function ruleLabelOf(gate: Pick<GateLike, 'displayName' | 'rule' | 'name'> | null | undefined): string {
	return gate?.displayName?.trim() || gate?.rule?.name || gate?.name || '';
}

/** gate name -> the rule's label, for History and tooltips. */
export function gateRuleLabels(rollout: Rollout | null | undefined): Map<string, string> {
	const out = new Map<string, string>();
	for (const g of rollout?.status?.gates ?? []) if (g?.name) out.set(g.name, ruleLabelOf(g));
	return out;
}

type CandidateLike = { tag: string; blockedBy?: string[] };

/** The working set, newest first: `status.candidates` when the controller serves it, else the promotion candidates the page already reads. */
function candidatesOf(rollout: Rollout | null | undefined): CandidateLike[] {
	const served = rollout?.status?.candidates;
	if (served && served.length > 0) return served as CandidateLike[];
	return promotionCandidates(rollout)
		.filter((c) => c.tag)
		.map((c) => ({ tag: c.tag as string }));
}

/**
 * Which of `gateNames` hold `candidate`. `blockedBy` is the controller's own answer (it already omits a skipped gate); a rollout whose
 * candidates carry none (a payload from before it) is read the way every other surface reads a hold: the gates that refuse the tag.
 */
function heldBy(rollout: Rollout | null | undefined, candidate: CandidateLike, gateNames: readonly string[]): string[] {
	const refusing = candidate.blockedBy ?? blockingGateNames(rollout, candidate.tag);
	return gateNames.filter((g) => refusing.includes(g));
}

/**
 * The build a rule is holding on this rollout: the NEWEST candidate one of the rule's gates refuses, with the gates that do. Null when
 * the rule holds nothing here (it passes, or only older work is held by something else, or there is no newer build at all).
 */
export function targetBuild(
	rollout: Rollout | null | undefined,
	rule: RuleRef
): { tag: string; build: string; gateNames: string[] } | null {
	const gates = ruleGates(rollout, rule).map((g) => g.name as string);
	if (gates.length === 0) return null;
	for (const c of candidatesOf(rollout)) {
		const held = heldBy(rollout, c, gates);
		if (held.length > 0) return { tag: c.tag, build: displayVersionForTag(rollout, c.tag) || c.tag, gateNames: held };
	}
	return null;
}

/** The other rules (by label) that still refuse `tag` once `rule` is skipped: what "waits for X" says on a pending tile. */
export function otherHolders(rollout: Rollout | null | undefined, tag: string, skipped: readonly string[]): string[] {
	const c = candidatesOf(rollout).find((x) => x.tag === tag);
	if (!c) return [];
	const refusing = c.blockedBy ?? blockingGateNames(rollout, tag);
	const labels = gateRuleLabels(rollout);
	const out: string[] = [];
	for (const g of refusing) {
		if (skipped.includes(g)) continue;
		const l = labels.get(g);
		// a promotion/dependency gate has no pretty name worth printing here; it still holds, so say its rule's name
		if (l && !out.includes(l)) out.push(l);
	}
	return out;
}

export type PendingSkip = {
	tag: string;
	build: string;
	/** True when every rule is skipped (no only-list). */
	all: boolean;
	/** The skipped gate names (empty when `all`). */
	gates: string[];
};

/**
 * A skip that has been asked for and not yet used, read from `metadata.annotations` (the write lands there first; the controller marks
 * `status.gates[].bypassGates` only in the reconcile that deploys). Drawn only while the annotated build is still a candidate: the
 * controller ignores any other, so a stale annotation shows nothing.
 */
export function pendingSkip(rollout: Rollout | null | undefined): PendingSkip | null {
	const ann = rollout?.metadata?.annotations;
	const tag = ann?.[BYPASS_ANNOTATION]?.trim();
	if (!tag) return null;
	if (!candidatesOf(rollout).some((c) => c.tag === tag)) return null;
	const gates = (ann?.[BYPASS_ONLY_ANNOTATION] ?? '')
		.split(',')
		.map((g) => g.trim())
		.filter(Boolean);
	return { tag, build: displayVersionForTag(rollout, tag) || tag, all: gates.length === 0, gates };
}

/** Does a pending skip cover this gate (any of these gate names)? */
export function pendingCovers(p: PendingSkip | null, gateNames: readonly string[]): boolean {
	if (!p) return false;
	return p.all || gateNames.some((g) => p.gates.includes(g));
}

// ── Entry B: the other rollouts the same rule holds ─────────────────────

export type SkipRow = {
	/** `<cluster>/<namespace>/<name>` */
	key: string;
	cluster: string;
	namespace: string;
	name: string;
	env: string;
	/** The tag sent as `version`. */
	tag: string;
	build: string;
	gateNames: string[];
};

export const skipRowKey = (cluster: string, namespace: string, name: string) => `${cluster}/${namespace}/${name}`;

/**
 * Every rollout in the fleet that `rule` is holding a build on, ordered this rollout first, then by environment, then by name. A pending
 * skip removes a rollout from the list: nothing is left to skip there.
 */
export function skipRows(args: {
	fleet: readonly Rollout[];
	rule: RuleRef;
	/** The rollout the trigger was pressed on. */
	here: { cluster: string; namespace: string; name: string };
	envOf: (r: Rollout) => string;
	compareEnv: (a: string, b: string) => number;
}): SkipRow[] {
	const { fleet, rule, here, envOf, compareEnv } = args;
	const hereKey = skipRowKey(here.cluster, here.namespace, here.name);
	const rows: SkipRow[] = [];
	for (const r of fleet) {
		const ns = r.metadata?.namespace ?? '';
		const name = r.metadata?.name ?? '';
		const cluster = r.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? here.cluster;
		const target = targetBuild(r, rule);
		if (!target) continue;
		if (pendingCovers(pendingSkip(r), target.gateNames) && pendingSkip(r)?.tag === target.tag) continue;
		rows.push({
			key: skipRowKey(cluster, ns, name),
			cluster,
			namespace: ns,
			name,
			env: envOf(r),
			tag: target.tag,
			build: target.build,
			gateNames: target.gateNames
		});
	}
	return rows.sort((a, b) => {
		if (a.key === hereKey) return -1;
		if (b.key === hereKey) return 1;
		return compareEnv(a.env, b.env) || a.name.localeCompare(b.name) || a.cluster.localeCompare(b.cluster);
	});
}

// ── History ─────────────────────────────────────────────────────────────

export type SkippedRules = { all: boolean; gates: string[] };

/**
 * The controller writes `<Manual|Automatic> deployment[, with force deploy], with gate bypass of g1, g2[, with failed bake unblock]`
 * (partial) or `..., with gate bypass` (every rule). Who set it is not recorded, and nothing here invents it.
 */
export function skippedRulesOf(message: string | null | undefined): SkippedRules | null {
	if (!message) return null;
	const m = /with gate bypass(?: of ([^]*?))?(?=, with |$)/.exec(message);
	if (!m) return null;
	const gates = (m[1] ?? '')
		.split(',')
		.map((g) => g.trim())
		.filter(Boolean);
	return { all: gates.length === 0, gates };
}

/** The same clause out of the message, so what is left is only what a person could have written. */
export function withoutSkipClause(message: string | null | undefined): string {
	return (message ?? '').replace(/,? ?with gate bypass(?: of [^]*?)?(?=, with |$)/, '').trim();
}

export type SkippedFact = { text: string; parts: { text: string; code: boolean }[] };

/**
 * The History fact. Gate names map back to the rule's display name where the rollout still knows the gate (one fact per RULE, so two
 * gates of one rule read once); a gate it no longer knows is printed as its own name, in code.
 */
export function skippedFact(skipped: SkippedRules | null, labels: ReadonlyMap<string, string>): SkippedFact | null {
	if (!skipped) return null;
	if (skipped.all) return { text: 'Skipped every rule', parts: [{ text: 'Skipped every rule', code: false }] };
	const parts: { text: string; code: boolean }[] = [];
	for (const g of skipped.gates) {
		const label = labels.get(g);
		const p = { text: label ?? g, code: !label };
		if (!parts.some((x) => x.text === p.text)) parts.push(p);
	}
	return { text: `Skipped ${parts.map((p) => p.text).join(', ')}`, parts };
}
