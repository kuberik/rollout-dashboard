/**
 * ⭐ THE "SKIP ONE RULE ONCE" DEMO FIXTURE. (bypass-only, 2026-11-13; spec §8)
 *
 * One `ClusterRolloutSchedule`, `business-hours`, CLOSED at the demo anchor, holds a newer build on six rollouts of three apps across two
 * clusters (`staging`, `prod`), each through its own generated RolloutGate (`business-hours-<app>`). The six are chosen so every state of the
 * feature is reachable without a cluster:
 *
 *   payout-api     staging  business-hours AND a hand-written `payout-signoff` gate hold m-62. The sign-off is the only rule holding THIS
 *                           rollout alone, so its dialog is the single-rollout one (non-production, notice). Skipping business-hours here
 *                           leaves the build held: the tile reads `Skipped once for 5.8.0-62 · waits for Payout sign-off`.
 *   payout-api     prod     business-hours is the ONLY blocker: skip, and the mock deploys it on its next tick (history entry written).
 *   billing-edge   staging  business-hours only, and the viewer may not patch it: its row is disabled in the list.
 *   billing-edge   prod     business-hours AND `Release approval` hold the SAME build as payout-api prod (typed confirm by BUILD).
 *   invoice-worker staging  a skip is ALREADY pending (annotations set), so the pending state is there on first load.
 *   invoice-worker prod     a different build (typed confirm by RULE) and the one rollout whose POST answers 409, so partial failure shows.
 *
 * `POST /api/rollouts/:ns/:name/bypass-gates` follows the BRIEF's accumulate semantics on this in-memory state. Everything lives here and
 * is reset by `resetBypassDemo()`; no other fixture is touched. Rollouts and environments are appended to the fleet list in `respond.ts`.
 */
import { hcAgo, hcNow, expandSha, sitedByApp } from './mock-data';
import { approvalPolicyMeta } from './gate-kind';
import { broadcastRolloutChange } from './state';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BH_RULE = { kind: 'ClusterRolloutSchedule', name: 'business-hours' };
const BH_LABEL = 'Business hours';
export const BYPASS = 'rollout.kuberik.com/bypass-gates';
export const BYPASS_ONLY = 'rollout.kuberik.com/bypass-gates-only';

type Build = { tag: string; version: string };
type Spec = {
	app: string;
	env: 'staging' | 'prod';
	live: Build;
	next: Build;
	/** gates beyond business-hours, as served on `status.gates` */
	extra?: Obj[];
	pending?: boolean;
	/** older history entries that used a skip: [daysAgo, message] */
	history?: [number, string][];
};

const M60 = { tag: 'm-60', version: '5.7.0-60' };
const M61 = { tag: 'm-61', version: '5.7.1-61' };
const M62 = { tag: 'm-62', version: '5.8.0-62' };
const W29 = { tag: 'w-29', version: '2.1.0-29' };
const W30 = { tag: 'w-30', version: '2.2.0-30' };
const W31 = { tag: 'w-31', version: '2.3.0-31' };

const ns = (s: Spec) => `${s.app}-${s.env}`;
export const bhGateName = (app: string) => `business-hours-${app}`;

const SPECS: Spec[] = [
	{
		app: 'payout-api',
		env: 'staging',
		live: M61,
		next: M62,
		extra: [
			{ name: 'payout-signoff', kind: 'unknown', displayName: 'Payout sign-off', passing: false, message: 'Waiting for the payout owners', rule: { kind: 'RolloutGate', name: 'payout-signoff' } }
		]
	},
	{ app: 'payout-api', env: 'prod', live: M61, next: M62, history: [[3, 'Automatic deployment, with gate bypass of business-hours-payout-api']] },
	{ app: 'billing-edge', env: 'staging', live: M61, next: M62 },
	{
		app: 'billing-edge',
		env: 'prod',
		live: M61,
		next: M62,
		extra: [
			{
				name: 'release-approval',
				kind: 'approval',
				displayName: 'Release approval',
				allowedVersions: [M61.tag],
				passing: true,
				rule: { kind: 'ApprovalPolicy', name: 'prod-needs-approval', namespace: 'billing-edge-prod' }
			}
		]
	},
	{ app: 'invoice-worker', env: 'staging', live: W30, next: W31, pending: true },
	{ app: 'invoice-worker', env: 'prod', live: W30, next: W31, history: [[6, 'Automatic deployment, with gate bypass']] }
];

const release = (b: Build, minAgo: number) => ({ tag: b.tag, version: b.version, revision: expandSha(b.tag), created: hcAgo(minAgo) });
const histEntry = (b: Build, minAgo: number, message?: string) => ({
	version: { tag: b.tag, version: b.version, revision: expandSha(b.tag) },
	timestamp: hcAgo(minAgo),
	triggeredBy: { kind: 'System', name: 'System' },
	...(message ? { message } : {}),
	bakeStatus: 'Succeeded',
	bakeStartTime: hcAgo(minAgo),
	bakeEndTime: hcAgo(minAgo - 1)
});

const refuses = (g: Obj, tag: string) => (Array.isArray(g.allowedVersions) ? !g.allowedVersions.includes(tag) : g.passing === false);

/** The controller's `blockedBy`: the gates that refuse the candidate, minus those skipped for exactly that build. */
function recompute(r: Obj): void {
	const ann = r.metadata.annotations ?? {};
	const skipTag: string | undefined = ann[BYPASS];
	const only: string[] = (ann[BYPASS_ONLY] ?? '').split(',').filter(Boolean);
	for (const g of r.status.gates) g.bypassGates = !!skipTag && refuses(g, skipTag) && (only.length === 0 || only.includes(g.name)) ? true : undefined;
	r.status.releaseCandidates = (r.status.releaseCandidates as Obj[]).map((c) => {
		const blockedBy = (r.status.gates as Obj[])
			.filter((g) => refuses(g, c.tag) && !(skipTag === c.tag && (only.length === 0 || only.includes(g.name))))
			.map((g) => g.name);
		return { ...c, blockedBy };
	});
}

function build(s: Spec): Obj {
	const gates: Obj[] = [
		{
			name: bhGateName(s.app),
			kind: 'schedule',
			displayName: BH_LABEL,
			passing: false,
			message: 'Outside the window',
			rule: BH_RULE
		},
		...(s.extra ?? []).map((g) => ({ ...g }))
	];
	const history = [
		histEntry(s.live, 5 * 60),
		...(s.history ?? []).map(([days, message], i) => histEntry(s.live.tag === 'm-61' ? M60 : W29, days * 24 * 60 + i, message))
	];
	const r: Obj = {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: {
			name: s.app,
			namespace: ns(s),
			labels: { environment: s.env },
			annotations: s.pending ? { [BYPASS]: s.next.tag, [BYPASS_ONLY]: bhGateName(s.app) } : {}
		},
		spec: { releasesImagePolicy: `${ns(s)}/${s.app}`, versionHistoryLimit: 10, minBakeTime: '5m' },
		status: {
			source: `github.com/exampleco/${s.app}`,
			wantedVersion: s.live.tag,
			currentVersion: s.live.tag,
			availableReleases: [release(s.live.tag === 'm-61' ? M60 : W29, 4 * 24 * 60), release(s.live, 5 * 60), release(s.next, 60)],
			releaseCandidates: [{ tag: s.next.tag, created: hcAgo(60) }],
			gatedReleaseCandidates: [],
			history,
			gates
		}
	};
	recompute(r);
	return r;
}

let state = new Map<string, Obj>();
const key = (namespace: string, name: string) => `${namespace}/${name}`;
const ensure = () => {
	if (state.size === 0) for (const s of SPECS) state.set(key(ns(s), s.app), build(s));
	return state;
};
const timers = new Set<ReturnType<typeof setTimeout>>();

/** Back to the authored state; cancels the deploy ticks. */
export function resetBypassDemo(): void {
	for (const t of timers) clearTimeout(t);
	timers.clear();
	state = new Map();
}

export const getBypassRollouts = (): Obj[] => [...ensure().values()];
export const isBypassRollout = (namespace: string, name: string) => ensure().has(key(namespace, name));
export const findBypassRollout = (namespace: string, name: string): Obj | undefined => ensure().get(key(namespace, name));

export function getBypassEnvironments(): Obj[] {
	const rollouts = getBypassRollouts();
	const envs = SPECS.map((s) => ({
		apiVersion: 'environments.kuberik.com/v1alpha1',
		kind: 'Environment',
		metadata: { name: s.app, namespace: ns(s) },
		spec: { environment: s.env, name: s.app, rolloutRef: { name: s.app } },
		status: { currentVersion: s.live.tag, lastStatusChangeTime: hcAgo(5 * 60) }
	}));
	return sitedByApp(envs as never, rollouts as never) as Obj[];
}

/** The gate objects behind one rollout's summaries, as the detail route serves `rolloutGates`. */
export function bypassGateObjects(namespace: string, name: string): Obj[] {
	const r = findBypassRollout(namespace, name);
	if (!r) return [];
	return (r.status.gates as Obj[]).map((g) => {
		const bh = g.rule?.kind === 'ClusterRolloutSchedule';
		const meta = bh
			? {
					labels: { 'gate.kuberik.com/schedule-name': BH_RULE.name, 'gate.kuberik.com/schedule-kind': BH_RULE.kind, 'gate.kuberik.com/rollout-name': name },
					annotations: { 'gate.kuberik.com/pretty-name': g.displayName },
					ownerReferences: [{ apiVersion: 'kuberik.com/v1alpha1', kind: BH_RULE.kind, name: BH_RULE.name, uid: 'bh-uid' }]
				}
			: g.kind === 'approval'
				? approvalPolicyMeta(namespace, name, 'prod-needs-approval', g.displayName)
				: { labels: { 'gate.kuberik.com/rollout-name': name }, annotations: { 'gate.kuberik.com/pretty-name': g.displayName }, ownerReferences: [] };
		return {
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'RolloutGate',
			metadata: { name: g.name, namespace, ...meta },
			spec: { rolloutRef: { name }, passing: g.passing, ...(g.allowedVersions ? { allowedVersions: g.allowedVersions } : {}) }
		};
	});
}

/** The cluster-scoped schedule, closed now (the rules are shifted off the current Zagreb hour when it would be open). */
export function bypassSchedule(namespace?: string): Obj {
	const zagreb = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', hour: '2-digit', hourCycle: 'h23' }).format(d);
	const hour = Number(zagreb(hcNow));
	const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zagreb', weekday: 'long' }).format(hcNow);
	const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
	const openNow = weekdays.includes(day) && hour >= 9 && hour < 18;
	const pad = (n: number) => `${String(n % 24).padStart(2, '0')}:00`;
	const rules = openNow
		? [{ name: 'weekdays', timeRange: { start: pad(hour + 4), end: pad(hour + 10) }, daysOfWeek: weekdays }]
		: [{ name: 'weekdays', timeRange: { start: '09:00', end: '18:00' }, daysOfWeek: weekdays }];
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'ClusterRolloutSchedule',
		metadata: { name: BH_RULE.name, annotations: { 'gate.kuberik.com/pretty-name': BH_LABEL } },
		spec: { action: 'Allow', timezone: 'Europe/Zagreb', rules },
		status: {
			active: false,
			nextTransition: new Date(hcNow.getTime() + 5 * 3600_000).toISOString(),
			// bare gate names, as the controller publishes them and every other fixture does: `withSchedules` joins them to the REQUESTING
			// namespace (a `<ns>/<gate>` here joined to nothing, so Business hours read as `a check starts passing`)
			managedGates: SPECS.filter((s) => !namespace || ns(s) === namespace).map((s) => bhGateName(s.app)),
			matchingRollouts: SPECS.length
		}
	};
}

/** `patch: false` for the one rollout the viewer may not change. */
export function bypassPermissions(namespace: string, name: string) {
	if (!isBypassRollout(namespace, name)) return undefined;
	const may = namespace !== 'billing-edge-staging';
	return {
		permissions: { update: may, patch: may, approve: may },
		resource: { apiGroup: 'kuberik.com', kind: 'Rollout', name, namespace }
	};
}

type Result = { status: number; body: Obj };

/** POST /api/rollouts/:ns/:name/bypass-gates, the BRIEF's contract on the in-memory state. */
export function skipBypass(namespace: string, name: string, body: Obj): Result {
	const r = findBypassRollout(namespace, name);
	if (!r) return { status: 404, body: { error: 'rollout not found' } };
	const version: string | undefined = body.version;
	if (!version) return { status: 400, body: { error: 'Invalid request body' } };
	const candidate = (r.status.releaseCandidates as Obj[]).find((c) => c.tag === version);
	// the designated 409: this rollout "changed under us" so a multi-rollout skip shows a partial failure
	if (!candidate || namespace === 'invoice-worker-prod') {
		return { status: 409, body: { error: `version ${version} is not a release candidate of this rollout` } };
	}
	const rule = body.rule as { kind: string; name: string; namespace?: string } | undefined;
	const explicit: string[] = body.gates ?? [];
	let names: string[] = [];
	if (rule) {
		names = (r.status.gates as Obj[])
			.filter((g) => g.rule?.kind === rule.kind && g.rule?.name === rule.name && (g.rule?.namespace ?? '') === (rule.namespace ?? ''))
			.map((g) => g.name);
		if (names.length === 0) return { status: 422, body: { error: 'no gate matches the rule' } };
	}
	for (const g of explicit) {
		if (!(r.status.gates as Obj[]).some((x) => x.name === g)) return { status: 422, body: { error: `gate ${g} is not a gate of this rollout` } };
	}
	names = [...new Set([...names, ...explicit])].sort();
	const ann = (r.metadata.annotations ??= {});
	let scope: 'only' | 'all' = 'only';
	if (!rule && explicit.length === 0) {
		ann[BYPASS] = version;
		delete ann[BYPASS_ONLY];
		scope = 'all';
	} else if (ann[BYPASS] === version && !ann[BYPASS_ONLY]) {
		scope = 'all'; // a full skip of the same build stays full
	} else {
		const prior = ann[BYPASS] === version ? (ann[BYPASS_ONLY] ?? '').split(',').filter(Boolean) : [];
		ann[BYPASS] = version;
		ann[BYPASS_ONLY] = [...new Set([...prior, ...names])].sort().join(',');
	}
	recompute(r);
	scheduleDeploy(namespace, name);
	broadcastRolloutChange(namespace, name, namespace.includes('prod') ? 'prod' : 'staging');
	// like the backend: the MERGED gate list the pending skip now names (the whole annotation for an only-skip), not just this request's
	const merged = scope === 'all' ? names : (ann[BYPASS_ONLY] ?? '').split(',').filter(Boolean);
	return { status: 200, body: { rollout: r, version, gates: merged, scope } };
}

/** The controller's next reconcile: a skipped build nothing else holds is deployed once, and the annotations are cleared. */
function scheduleDeploy(namespace: string, name: string): void {
	const t = setTimeout(() => {
		timers.delete(t);
		const r = findBypassRollout(namespace, name);
		const tag: string | undefined = r?.metadata.annotations?.[BYPASS];
		if (!r || !tag) return;
		const c = (r.status.releaseCandidates as Obj[]).find((x) => x.tag === tag);
		if (!c || c.blockedBy.length > 0) return; // still held by another rule: stays
		const only: string[] = (r.metadata.annotations[BYPASS_ONLY] ?? '').split(',').filter(Boolean);
		const rel = (r.status.availableReleases as Obj[]).find((x) => x.tag === tag)!;
		r.status.history.unshift({
			version: { tag, version: rel.version, revision: rel.revision },
			timestamp: new Date().toISOString(),
			triggeredBy: { kind: 'System', name: 'System' },
			message: `Automatic deployment, with gate bypass${only.length ? ` of ${only.join(', ')}` : ''}`,
			bakeStatus: 'Succeeded',
			bakeStartTime: new Date().toISOString(),
			bakeEndTime: new Date().toISOString()
		});
		r.status.currentVersion = tag;
		r.status.wantedVersion = tag;
		r.status.releaseCandidates = [];
		r.metadata.annotations = {};
		for (const g of r.status.gates as Obj[]) delete g.bypassGates;
		broadcastRolloutChange(namespace, name, namespace.includes('prod') ? 'prod' : 'staging');
	}, 12_000);
	timers.add(t);
}
