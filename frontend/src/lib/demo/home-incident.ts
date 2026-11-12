/**
 * ⭐ THE `home-incident` SCENARIO — THE PINNED HOME FIXTURE, SERVED AS THE HUB.
 *
 * Role: lets product Home (and every rollout page it links to) be compared
 * against the lab's `/lab/lumen`, which renders the SAME raw inputs. The
 * inputs are `src/lib/view-models/home/fixtures/incident-input.json`,
 * captured once from the lab's demo `incident` state (lab commit 3d168544:
 * billing apps, the per-env pipeline, a KruiseRollout pair on invoice-api).
 *
 * Why this is not a fourth `Scenario` in `./state.ts`: `calm`/`incident`/
 * `wide` are TRANSFORMS of `mock-data.ts`'s live fleet (heal, fail, clamp,
 * mutate on retry/promote). This one is a FROZEN SNAPSHOT of a different
 * fleet — nothing in it is generated, so routing it through `state.ts`'s
 * transforms would rewrite the very data it exists to pin. It therefore sits
 * IN FRONT of `respond()`: the routes it owns are answered from the fixture,
 * everything else (`null`) falls through to `respond()` unchanged — GitHub
 * commit/PR lookups (the fixture's repos ARE the demo GitHub universe),
 * permissions, manifests, mutations.
 *
 * Opt-in only (`MOCK_API=1 MOCK_SCENARIO=home-incident`, see
 * `dev-mock-api.ts`). Pure and browser-safe like `respond.ts`: the fixture
 * object is passed in, never imported here, so the demo build's bundle does
 * not carry 360 KB it never serves.
 *
 * THE CLOCK-ROT RULE: every ISO instant in the fixture is moved by
 * `now - capturedAt` at request time, so an age that read "6h" at capture
 * reads "6h" today and forever. Never serve the fixture's raw timestamps.
 *
 * THE DETAIL-PAGE RULE (round-1 UX finding): a rollout whose head history
 * entry failed, or carries `failedHealthChecks`, must never read healthy on
 * its own page. Health checks and events are DERIVED from that same head
 * entry, so the page agrees with the Home row that linked to it.
 */
import { staleClusterErrors, type StaleMockMode } from './cluster-errors-mock';
import type { MockResult } from './respond';
import { applySlicesMode, sliceDetailRollout } from './mock-slices';
import { withEdgeCases } from './home-edge';
import { respondGithub as respondGithubRange, avatarFor as avatarForLogin } from './github-data';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type K8sObject = { metadata: { name: string; namespace: string; labels?: Record<string, string>; annotations?: Record<string, string> }; [k: string]: any };

export type HomeFixtureChange = {
	owner: string;
	repo: string;
	mergedAt: string;
	[k: string]: unknown;
};

export type HomeFixture = {
	capturedAt: string;
	me: string;
	rollouts: K8sObject[];
	environments: K8sObject[];
	rolloutDependencies: K8sObject[];
	kustomizations: K8sObject[];
	kruiseRollouts: K8sObject[];
	changes: HomeFixtureChange[];
	/**
	 * HealthChecks the fixture carries as objects, in the shape
	 * prometheus-controller writes (`spec.class`, the alert-labels annotation,
	 * `status.status` / `message` / `lastChangeTime` / `lastErrorTime`). Served
	 * beside the checks `homeIncidentHealthChecks` derives from history, to the
	 * rollouts whose selector picks them.
	 */
	healthChecks?: K8sObject[];
	/** RolloutSchedules (the home-edge scenario's closed named windows); served on /api/schedules */
	schedules?: K8sObject[];
};

export const HOME_INCIDENT_SCENARIO = 'home-incident';
/** the review scenarios one dev server can serve over the same fixture (`?scenario=<name>` sets a cookie the mock reads; MOCK_SCENARIO is the default) */
export const HOME_SCENARIOS = ['home-incident', 'home-calm', 'home-quiet', 'home-edge'] as const;
export type HomeScenario = (typeof HOME_SCENARIOS)[number];
/** `incident` / `calm` / `quiet` (and the lens spellings) -> the scenario name; null for anything else */
export function homeScenarioOf(v: string | null | undefined): HomeScenario | null {
	const k = (v ?? '').replace(/^home-/, '');
	return k === 'incident' || k === 'calm' || k === 'quiet' || k === 'edge' ? (`home-${k}` as HomeScenario) : null;
}

/** The clusters the fixture's `source-cluster` annotations name. */
export const HOME_INCIDENT_CLUSTERS = [
	{ name: 'dev', url: 'https://kuberik-dev.example.com' },
	{ name: 'staging', url: 'https://kuberik-staging.example.com' },
	{ name: 'prod', url: 'https://kuberik-prod.example.com' }
];

const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

/** Deep copy of `value` with every ISO instant string moved by `shiftMs`. */
export function rebaseInstants<T>(value: T, shiftMs: number): T {
	if (typeof value === 'string') {
		return (ISO_INSTANT.test(value) ? new Date(Date.parse(value) + shiftMs).toISOString() : value) as T;
	}
	if (Array.isArray(value)) return value.map((v) => rebaseInstants(v, shiftMs)) as T;
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = rebaseInstants(v, shiftMs);
		return out as T;
	}
	return value;
}

/**
 * ONE MOCK-DATA CORRECTION (the same one `components/home/sketch/home-data.ts` applies to the pinned fixture for unit tests): the captured fixture has
 * hello-frontend-app's rel-66 arriving in dev, staging and prod in the SAME second and #13 merged 16h before its own build was cut. No real pipeline
 * does that. #13 merges at 18:33, rel-66 reaches dev 18:46, staging 18:58, prod 19:11 (unchanged). Applied BEFORE the rebase, in the fixture's own time.
 */
const ARRIVE: Record<string, string> = { 'hello-dep-dev': '2026-10-24T18:46:26.893Z', 'hello-dep-staging': '2026-10-24T18:58:26.893Z' };
const MERGED_13 = '2026-10-24T18:33:49.255Z';
export function correctedHomeFixture(f: HomeFixture): HomeFixture {
	const rollouts = f.rollouts.map((r) => {
		const t = ARRIVE[r.metadata.namespace];
		const hist = r.status?.history as { timestamp: string }[] | undefined;
		if (!t || r.metadata.name !== 'hello-frontend-app' || !hist?.length) return r;
		const [h0, ...rest] = hist;
		return { ...r, status: { ...r.status, history: [{ ...h0, timestamp: t }, ...rest] } };
	});
	const environments = f.environments.map((e) => {
		const t = ARRIVE[e.metadata.namespace];
		return t && e.metadata.name === 'hello-frontend-app' ? { ...e, status: { ...e.status, lastStatusChangeTime: t } } : e;
	});
	const changes = f.changes.map((c) => (c.repo === 'hello-frontend-app' && c.number === 13 ? { ...c, mergedAt: MERGED_13 } : c));
	return { ...f, rollouts, environments, changes };
}

/**
 * THE CALM AND QUIET SCENARIOS (r39; they were model-level lenses, `?calm=1` / `?quiet=1`, and are data now).
 * calm  = every place healthy: a failed head deploy reads as the successful deploy it would have been (no failed checks, no failure message).
 * quiet = calm, and nothing waits on a person: no approval gate has a candidate waiting.
 */
export function homeScenarioFixture(f: HomeFixture, scenario: HomeScenario): HomeFixture {
	if (scenario === 'home-incident') return f;
	/* home-edge: the incident fixture untouched plus the edge apps (home-edge.ts) */
	if (scenario === 'home-edge') return withEdgeCases(f);
	const rollouts = f.rollouts.map((r) => {
		const st = (r.status ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
		const hist = (st.history ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
		let next = st;
		if (hist[0]?.bakeStatus === 'Failed') {
			const { failedHealthChecks: _drop, bakeStatusMessage: _msg, ...ok } = hist[0];
			void _drop; void _msg;
			next = { ...next, history: [{ ...ok, bakeStatus: 'Succeeded' }, ...hist.slice(1)] };
		}
		if (scenario === 'home-quiet' && ((st.gates ?? []) as { name: string }[]).some((g) => /approval/.test(g.name)))
			next = { ...next, releaseCandidates: [] };
		return next === st ? r : { ...r, status: next };
	});
	return { ...f, rollouts, healthChecks: [] };
}

/**
 * What each failing check measures (rollout-controller `status.observations[]`): the figure the Attention cards lead with ("8.2 % error rate ·
 * over a 1 % budget"). The pinned fixture carries only the message string, so the mock adds the measurement the message already states.
 * Served on the HealthCheck (`/health-checks`, fleet and per rollout) and as the snapshot on the head history entry's `failedHealthChecks`.
 */
const OBSERVATIONS: Record<string, Record<string, unknown>[]> = {
	'invoice-api-error-rate': [{ name: 'error rate', kind: 'Threshold', value: '8.2', limit: '1', direction: 'Above', unit: '%', healthy: false }],
	'checkout-worker-prometheus-high-error-rate': [
		{ name: 'error rate', kind: 'Threshold', value: '8.9', limit: '1', direction: 'Above', unit: '%', healthy: false },
		{ name: 'queue depth', kind: 'Count', value: '412', healthy: false }
	],
	'hello-frontend-app-error-rate': [{ name: 'error rate', kind: 'Threshold', value: '2.4', limit: '1', direction: 'Above', unit: '%', healthy: false }]
};
export function withObservationSnapshots(f: HomeFixture): HomeFixture {
	const rollouts = f.rollouts.map((r) => {
		const hist = r.status?.history as { failedHealthChecks?: { name: string }[] }[] | undefined;
		const fc = hist?.[0]?.failedHealthChecks;
		if (!fc?.some((c) => OBSERVATIONS[c.name])) return r;
		const head = { ...hist![0], failedHealthChecks: fc.map((c) => (OBSERVATIONS[c.name] ? { ...c, observations: OBSERVATIONS[c.name] } : c)) };
		return { ...r, status: { ...r.status, history: [head, ...hist!.slice(1)] } };
	});
	return { ...f, rollouts };
}

/** The fixture as it reads at `now`: all instants shifted by `now - capturedAt`. */
export function rebasedHomeFixture(fixture: HomeFixture, now: Date): HomeFixture {
	return rebaseInstants(fixture, now.getTime() - Date.parse(fixture.capturedAt));
}

type HistoryEntry = {
	version?: { tag?: string };
	timestamp?: string;
	bakeStatus?: string;
	bakeStatusMessage?: string;
	bakeEndTime?: string;
	failedHealthChecks?: { name: string; message?: string }[];
};

function head(rollout: K8sObject): HistoryEntry | undefined {
	return (rollout.status?.history as HistoryEntry[] | undefined)?.[0];
}

const inNs = (ns: string) => (o: K8sObject) => o.metadata.namespace === ns;

/**
 * The detail page fetches `/health-checks` only for a rollout whose spec has
 * a `healthCheckSelector` (the real backend filters by it). The fixture's
 * rollouts mostly carry none — the lab read failing checks straight off
 * `history[].failedHealthChecks` — so without one, a rollout whose check is
 * failing would print "No health checks select this rollout" under a
 * failure Home just sent the reader to. The DETAIL payload therefore gets
 * the selector `homeIncidentHealthChecks` labels its checks with; the LIST
 * payload stays byte-for-byte the fixture so Home computes exactly what the
 * lab computed.
 */
export function withHealthCheckSelector(rollout: K8sObject): K8sObject {
	if (rollout.spec?.healthCheckSelector) return rollout;
	return {
		...rollout,
		spec: { ...rollout.spec, healthCheckSelector: { matchLabels: { app: rollout.metadata.name } } }
	};
}

/**
 * The metadata rollout-controller's RolloutDependency reconciler (`syncGate`)
 * writes on the gate it manages, when `gateName` is one: the dependency and
 * rollout labels, the pretty-name and description annotations, and the
 * controller owner reference that tells a page the gate is the dependency's,
 * not a hand-authored rule. `{}` for any other gate (nothing is invented).
 */
function dependencyGateMeta(f: HomeFixture, namespace: string, gateName: string): Record<string, unknown> {
	const dep = f.rolloutDependencies.find((d) => inNs(namespace)(d) && d.status?.gateName === gateName);
	if (!dep) return {};
	const provider = dep.spec?.providerRef?.name ?? '';
	const contract = dep.spec?.contract ?? '';
	return {
		labels: {
			'gate.kuberik.com/dependency-name': dep.metadata.name,
			'gate.kuberik.com/rollout-name': dep.spec?.rolloutRef?.name ?? ''
		},
		annotations: {
			'gate.kuberik.com/pretty-name': `Depends on ${provider}`,
			'gate.kuberik.com/description': `Holds back releases that require a newer version of contract "${contract}" than ${provider} has deployed.`
		},
		ownerReferences: [
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'RolloutDependency',
				name: dep.metadata.name,
				controller: true,
				blockOwnerDeletion: true
			}
		]
	};
}

/**
 * `/rollouts/:ns/:name` — the rollout itself plus its namespace's
 * Environment, Kustomizations and KruiseRollout from the fixture, and one
 * RolloutGate object per `status.gates` entry (the list only carries the
 * gate's name/passing/allowedVersions, which is exactly what the gate rows
 * read; no pretty-name or schedule is invented). A RolloutDependency's gate
 * also carries the metadata its controller writes (`dependencyGateMeta`).
 */
export function homeIncidentDetail(f: HomeFixture, rollout: K8sObject): Record<string, unknown> {
	const { namespace, name } = rollout.metadata;
	const gates = (rollout.status?.gates ?? []) as {
		name: string;
		passing?: boolean;
		allowedVersions?: string[] | null;
	}[];
	return {
		rollout: withHealthCheckSelector(rollout),
		environment:
			f.environments.find((e) => inNs(namespace)(e) && e.spec?.rolloutRef?.name === name) ?? null,
		kustomizations: { items: f.kustomizations.filter(inNs(namespace)) },
		ociRepositories: { items: [] },
		rolloutGates: {
			items: gates.map((g) => ({
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'RolloutGate',
				metadata: { name: g.name, namespace, ...dependencyGateMeta(f, namespace, g.name) },
				// the spec as its writer keeps it: an allow-list writer (environment-controller,
				// an approval) never sets `passing`, a check or schedule writer sets only `passing`
				spec: {
					rolloutRef: { name },
					...(g.passing !== undefined ? { passing: g.passing } : {}),
					...(Array.isArray(g.allowedVersions) ? { allowedVersions: g.allowedVersions } : {})
				}
			}))
		},
		kruiseRollout: f.kruiseRollouts.find(inNs(namespace)) ?? null,
		rolloutTests: { items: [] }
	};
}

/**
 * `/rollouts/:ns/:name/health-checks` — one Unhealthy check per
 * `failedHealthChecks` entry on the head deploy, plus the Flux deployment check, which is
 * Unhealthy only when the head failed with no named check, Pending while the
 * head is still deploying/baking, Healthy otherwise.
 *
 * A named failing check is dated at the moment the bake failed on it
 * (`bakeEndTime`): `lastChangeTime` is when it tripped and `lastErrorTime`
 * (the witness) is the failure condition's own transition time, which is
 * what rollout-controller compares against its cutoff. The fixture only
 * carries `failedHealthChecks` on a `Failed` head, as the controller writes
 * them, so that bake end is always after the deploy and any
 * `lastRetryTimestamp` (hello-dep-prod), and the detail page keeps the row.
 */
export function homeIncidentHealthChecks(
	rollout: K8sObject,
	fixtureChecks: readonly K8sObject[] = []
): { healthChecks: Record<string, unknown>[] } {
	const { namespace, name } = rollout.metadata;
	const h = head(rollout);
	const at = h?.bakeEndTime ?? h?.timestamp;
	const failedChecks = h?.failedHealthChecks ?? [];
	const headFailed = h?.bakeStatus === 'Failed';
	const pending = h?.bakeStatus === 'InProgress' || h?.bakeStatus === 'Deploying';
	const check = (checkName: string, cls: string, displayName: string, status: Record<string, unknown>) => ({
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'HealthCheck',
		metadata: {
			name: checkName,
			namespace,
			labels: { app: name },
			annotations: { 'kuberik.com/display-name': displayName }
		},
		spec: { class: cls },
		status
	});
	const flux = check(
		`${name}-kustomization-health-check`,
		'kustomization',
		'Flux Deployment',
		headFailed && failedChecks.length === 0
			? {
					status: 'Unhealthy',
					message: h?.bakeStatusMessage ?? 'deploy failed',
					lastChangeTime: at,
					lastErrorTime: at
				}
			: pending
				? { status: 'Pending', message: 'reconciling', lastChangeTime: h?.timestamp }
				: { status: 'Healthy', message: 'Kustomization is reconciled', lastChangeTime: h?.timestamp }
	);
	// the fixture's own checks this rollout's selector picks (same namespace, every matchLabel)
	const want = (withHealthCheckSelector(rollout).spec?.healthCheckSelector?.matchLabels ?? {}) as Record<string, string>;
	const selected = fixtureChecks.filter(
		(hc) =>
			hc.metadata.namespace === namespace &&
			Object.entries(want).every(([k, v]) => hc.metadata.labels?.[k] === v)
	);
	return {
		healthChecks: [
			...selected,
			flux,
			...failedChecks.map((c) =>
				check(c.name, 'prometheus-alert', c.name, {
					status: 'Unhealthy',
					message: c.message ?? 'failing',
					lastChangeTime: at,
					lastErrorTime: at,
					...(OBSERVATIONS[c.name] ? { observations: OBSERVATIONS[c.name].map((o) => ({ ...o, observedTime: at })) } : {})
				})
			)
		]
	};
}

/**
 * `GET /api/health-checks` — every rollout's checks, one item per rollout,
 * each EXACTLY `homeIncidentHealthChecks(rollout)` (the per-rollout endpoint's
 * answer), so Home and the rollout detail page read one truth. Shape as the
 * real endpoint (design: .work/home-build/hc-v2/QUESTIONS.md).
 */
export function homeIncidentFleetHealthChecks(f: HomeFixture, staleMode: StaleMockMode | null = null): Record<string, unknown> {
	return {
		rolloutHealthChecks: {
			items: f.rollouts.map((r) => ({
				metadata: {
					namespace: r.metadata.namespace,
					name: r.metadata.name,
					annotations: { ...(r.metadata.annotations ?? {}) }
				},
				healthChecks: homeIncidentHealthChecks(r, f.healthChecks).healthChecks
			}))
		},
		clusters: HOME_INCIDENT_CLUSTERS,
		clusterErrors: staleClusterErrors(staleMode)
	};
}

/** `/rollouts/:ns/:name/events` — the head deploy's own events, at its own times. */
export function homeIncidentEvents(rollout: K8sObject): Record<string, unknown> {
	const { name } = rollout.metadata;
	const h = head(rollout);
	if (!h) return { events: [] };
	const tag = h.version?.tag ?? 'unknown';
	const pod = `${name}-${tag}-0`;
	const events: Record<string, unknown>[] = [
		{
			type: 'Normal',
			reason: 'ScalingReplicaSet',
			involvedObject: { kind: 'Deployment', name },
			message: `Scaled up replica set ${name}-${tag} to 1`,
			lastTimestamp: h.timestamp
		}
	];
	if (h.bakeStatus === 'Failed') {
		events.push({
			type: 'Warning',
			reason: 'Unhealthy',
			involvedObject: { kind: 'Pod', name: pod },
			// the pod-level symptom is the failing check's own message; the
			// bake message is the controller's verdict, not a probe result
			message: h.failedHealthChecks?.[0]?.message ?? h.bakeStatusMessage ?? 'Readiness probe failed',
			lastTimestamp: h.bakeEndTime ?? h.timestamp
		});
	}
	return { events };
}

/**
 * GitHub resolves a tag name as a commit ref, so `commits/rel-66` answers
 * with the commit the tag points at. The fixture's tags live on the app's
 * own rollouts (`version.tag` → `version.revision`), and its changes carry
 * revisions, so a tag is resolved to its revision before matching.
 */
function resolveTag(f: HomeFixture, repo: string, ref: string): string {
	for (const r of f.rollouts) {
		if (r.metadata.name !== repo) continue;
		const status = r.status as
			| { history?: { version?: { tag?: string; revision?: string } }[]; availableReleases?: { tag?: string; revision?: string }[] }
			| undefined;
		const versions = [...(status?.history ?? []).map((h) => h.version), ...(status?.availableReleases ?? [])];
		const hit = versions.find((v) => v?.tag === ref && v.revision);
		if (hit?.revision) return hit.revision;
	}
	return ref;
}

/** A sha prefix in either direction (the UI links 7- and 12-char slices). */
function refMatches(full: unknown, ref: string): boolean {
	if (typeof full !== 'string' || !full || !ref) return false;
	const a = full.toLowerCase();
	const b = ref.toLowerCase();
	return a.startsWith(b) || b.startsWith(a);
}

/** `/api/github/pulls/:o/:r/:n` for a fixture PR — the fields the fixture
 * carries, plus a merged state and one passing check (the fixture records
 * no CI, and an unknown check state would read as a claim). */
function fixturePull(c: HomeFixtureChange): Record<string, unknown> {
	return {
		number: c.number,
		title: c.title,
		htmlUrl: c.htmlUrl,
		author: c.author,
		state: 'merged',
		mergedAt: c.mergedAt,
		mergeCommitSha: c.mergeCommitSha,
		base: c.base,
		containedIn: c.containedIn,
		containedInAll: c.containedInAll,
		containedInUnknown: false,
		openedAt: new Date(Date.parse(c.mergedAt) - 4 * 3_600_000).toISOString(),
		headSha: c.headSha,
		changedFiles: c.changedFiles,
		checks: { state: 'success', total: 1, failed: 0, url: `${c.htmlUrl}/checks` }
	};
}

const json = (value: unknown, status = 200): MockResult => ({
	status,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(value)
});

/**
 * apps-10 AR9 — invoice-api's 35 deploys all landed in one afternoon, so "How it's going" drew six empty days and one bar. Served (never
 * stored) the older entries of its six rollouts move back by whole days: the two newest entries of every rollout stay (the current deploy
 * and the last healthy one are what every page prints), the other 23 spread over the previous six days (5/4/2/4/3/5, newest day first),
 * so the week reads 5/3/4/2/4/5 + today. Only the API response changes; the pinned fixture file is untouched.
 */
/** #37's merge sha: the incident change merged 9h ago, so its own build's deploys are not spread into past days. */
const PINNED_SHA = 'a11c202';
const INVOICE_DAYS = [5, 4, 2, 4, 3, 5];
function spreadWeek(f: HomeFixture, name: RegExp, perDay: number[], pinned?: string): HomeFixture {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const entries: { h: any }[] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const r of f.rollouts as any[]) {
		if (!name.test(r.metadata?.name ?? '')) continue;
		(r.status?.history ?? []).forEach((h: unknown, i: number) => { if (i >= 2) { const tag = (h as { version?: { tag?: string } }).version?.tag ?? ''; if (tag !== PINNED_SHA && (pinned === undefined || tag < pinned)) entries.push({ h }); } });
	}
	entries.sort((a, b) => Date.parse(b.h.timestamp) - Date.parse(a.h.timestamp));
	/* truth-4: with `pinned`, only builds OLDER than the pinned change's build (tags below it) move back. A build above it was made after #37 merged
	   (its `containedIn` lists #37), so it cannot have been deployed on a past day; it keeps today's time, which also keeps every rollout's history in
	   build order (dev never "rolled back from a11c707"). Too few eligible entries for the quota: one per day, newest first, instead of empty days. */
	if (pinned !== undefined && entries.length < perDay.reduce((a, b) => a + b, 0)) perDay = perDay.map((_, d) => entries.filter((_e, k) => Math.floor((k * perDay.length) / entries.length) === d).length);
	let i = 0;
	perDay.forEach((n, d) => {
		for (let k = 0; k < n && i < entries.length; k++, i++) {
			const h = entries[i].h;
			for (const key of Object.keys(h)) if (typeof h[key] === 'string' && ISO_INSTANT.test(h[key])) h[key] = new Date(Date.parse(h[key]) - (d + 1) * 86_400_000).toISOString();
		}
	});
	// truth-3: a build is never deployed before the change that made it merged. The spread moved deploys back by whole days, so the
	// change whose merge sha is that build moves back with its OLDEST spread deploy (merged 40 minutes earlier), unless it is already
	// older. A change merged after that deploy's original time (#37, the incident change, 9h ago) is the pinned story: its own build's
	// entries are never spread (see `pinned` above), so it stays put.
	const first = new Map<string, number>();
	for (const r of f.rollouts as any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
		if (!name.test(r.metadata?.name ?? '')) continue;
		if (r.status?.history) r.status.history.sort((a: { timestamp: string }, b: { timestamp: string }) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
		for (const h of r.status?.history ?? []) { const t = Date.parse(h.timestamp); const k = h.version?.tag ?? ''; if (!(first.get(k)! <= t)) first.set(k, t); }
	}
	for (const c of f.changes as { mergeCommitSha?: string; mergedAt: string; openedAt?: string }[]) {
		const t = first.get(c.mergeCommitSha ?? '');
		if (t === undefined || Date.parse(c.mergedAt) <= t - 40 * 60_000) continue;
		c.mergedAt = new Date(t - 40 * 60_000).toISOString();
	}
	return f;
}
const spreadInvoiceWeek = (f: HomeFixture): HomeFixture => spreadWeek(f, /^invoice-api/, INVOICE_DAYS, PINNED_SHA);
/**
 * apps-11 AS8 — hello-frontend-app's 12 deploys all landed today too ("How it's going" = one bar + six empty days). Same served-only
 * treatment: the two newest entries of each of its three rollouts stay, the other six spread over the previous six days (1/1/0/2/1/1).
 */
const HELLO_DAYS = [1, 1, 0, 2, 1, 1];
const spreadHelloWeek = (f: HomeFixture): HomeFixture => spreadWeek(f, /^hello-frontend-app/, HELLO_DAYS);

/**
 * Answers one request from the fixture as it reads at `now`, or `null` to
 * let `respond()` handle it. Every route also answers under
 * `/api/clusters/<c>/…`.
 */
export function respondHomeIncident(
	method: string,
	rawUrl: string,
	fixture: HomeFixture,
	now: Date = new Date(),
	staleMode: StaleMockMode | null = null
): MockResult | null {
	if (method !== 'GET') return null;
	const [rawPath, query = ''] = rawUrl.split('?');
	const path = rawPath.replace(/^\/api\/clusters\/[^/]+(?=\/)/, '/api');
	const live = () => spreadHelloWeek(spreadInvoiceWeek(rebasedHomeFixture(withObservationSnapshots(correctedHomeFixture(fixture)), now)));

	if (path === '/api/rollouts') {
		const f = live();
		// Same serve-time slices conversion as respond.ts's generic path (./mock-slices.ts); the pinned JSON fixture stays untouched.
		const slicesMode = applySlicesMode(f.rollouts);
		return json({
			rollouts: { items: slicesMode.rollouts },
			releaseSources: { items: slicesMode.sources },
			releaseSlices: { items: slicesMode.slices },
			environments: { items: f.environments },
			rolloutDependencies: { items: f.rolloutDependencies },
			kustomizations: { items: f.kustomizations },
			kruiseRollouts: { items: f.kruiseRollouts },
			clusters: HOME_INCIDENT_CLUSTERS,
			clusterErrors: staleClusterErrors(staleMode, now)
		});
	}

	/* craft r5 (D1): a Kustomization whose inventory holds a KruiseRollout serves it as a managed resource, so the rollout tab's
	   Deployment pipeline (which reads KruiseRollouts from managed-resources, not from the detail payload) draws the same canary
	   stages the Home model derived from `kruiseRolloutsForRollout`. Without this the tab drew Started + Check for invoice-api while
	   the lists drew Started + 4 stages + Check. */
	const mr = path.match(/^\/api\/kustomizations\/([^/]+)\/([^/]+)\/managed-resources$/);
	if (mr) {
		const f = live();
		const k = f.kustomizations.find((x) => x.metadata.namespace === mr[1] && x.metadata.name === mr[2]);
		const ids: string[] = ((k?.status?.inventory?.entries ?? []) as { id: string }[]).map((e) => e.id).filter((id) => id.endsWith('_rollouts.kruise.io_Rollout'));
		const krs = f.kruiseRollouts.filter((kr) => ids.includes(`${kr.metadata.namespace}_${kr.metadata.name}_rollouts.kruise.io_Rollout`));
		if (krs.length)
			return json({
				managedResources: krs.map((kr) => ({
					groupVersionKind: 'rollouts.kruise.io/v1beta1/Rollout',
					name: kr.metadata.name,
					namespace: kr.metadata.namespace,
					status: 'InProgress',
					message: '',
					lastModified: now.toISOString(),
					object: kr
				}))
			});
	}

	/* the deploy windows a scenario carries (home-edge); every other scenario leaves /api/schedules to respond() */
	if (fixture.schedules) {
		const sm = path.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/schedules$/);
		const items = live().schedules ?? [];
		if (sm) return json({ rolloutSchedules: { items: items.filter((x) => x.metadata.namespace === sm[1]) }, clusterRolloutSchedules: { items: [] } });
		if (path === '/api/schedules') return json({ rolloutSchedules: { items }, clusterRolloutSchedules: { items: [] } });
	}

	if (path === '/api/health-checks') return json(homeIncidentFleetHealthChecks(live(), staleMode));

	const m = path.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)(\/health-checks|\/events)?$/);
	if (m) {
		const [, ns, name, sub] = m;
		const f = live();
		const rollout = f.rollouts.find((r) => r.metadata.namespace === ns && r.metadata.name === name);
		if (!rollout) return json({ error: 'not_found', message: `rollout ${ns}/${name} not found` }, 404);
		if (sub === '/health-checks') return json(homeIncidentHealthChecks(rollout, f.healthChecks));
		if (sub === '/events') return json(homeIncidentEvents(rollout));
		return json(sliceDetailRollout(homeIncidentDetail(f, rollout)));
	}

	if (path === '/api/auth/github/status') {
		return json({ configured: true, connected: true, login: fixture.me, avatarUrl: avatarForLogin(fixture.me) });
	}

	if (path === '/api/github/changes') {
		const days = Number(new URLSearchParams(query).get('days') ?? 30) || 30;
		const cutoff = now.getTime() - days * 86_400_000;
		const f = live();
		return json({
			user: f.me,
			repos: [...new Set(f.changes.map((c) => `${c.owner}/${c.repo}`))],
			since: new Date(cutoff).toISOString(),
			changes: f.changes.filter((c) => Date.parse(c.mergedAt) >= cutoff)
		});
	}

	/* r34 rollouts r6 T5 — ONE TITLE PER SHA. The apps github-data's own universe does not carry (invoice-api's a11c…, telemetry-collector's 4a8d2e6 / 7b3c9f1, billing-api's b17b…)
	   answer a rollout's commit RANGE with the generic "Release commit for build X" (and a made-up author) while the bare-commit route above names the same sha from the fixture's
	   change. The tabs' History CHANGE pane and Overview read the range: so a range that github-data could only answer with that boilerplate is re-headlined from the fixture change
	   (title AND author), the one record the PR pages and Home already print. Every range github-data really knows is returned untouched. */
	const range = path.match(/^\/api\/rollouts\/[^/]+\/[^/]+\/commits$/);
	if (range) {
		const res = respondGithubRange('GET', path, new URLSearchParams(query));
		if (!res) return null;
		try {
			const j = JSON.parse(res.body ?? '{}') as { commits?: { sha: string; message: string; author?: string; authorUrl?: string; avatarUrl?: string; url?: string }[] };
			let changed = false;
			for (const c of j.commits ?? []) {
				if (!/^Release commit for build /.test(c.message)) continue;
				const hit = live().changes.find((x) => refMatches(x.mergeCommitSha, c.sha) || refMatches(x.headSha, c.sha));
				if (!hit) continue;
				c.message = String(hit.title); c.author = String(hit.author); c.authorUrl = `https://github.com/${hit.author}`; c.avatarUrl = avatarForLogin(String(hit.author)); c.url = `https://github.com/${hit.owner}/${hit.repo}/commit/${c.sha}`; changed = true;
			}
			if (changed) return { status: res.status, headers: res.headers, body: JSON.stringify(j) } as MockResult;
		} catch { /* github-data's answer stands */ }
		return null;
	}

	// GitHub lookups for the fixture's own changes — the fixture's repos
	// (billing, invoice-api, …) are not all in `github-data.ts`'s universe,
	// so a commit/PR Home or a detail page links to would 404 there. A ref
	// the fixture does not know falls through to `respondGithub` unchanged.
	const pull = path.match(/^\/api\/github\/pulls\/([^/]+)\/([^/]+)\/(\d+)$/);
	if (pull) {
		const [, owner, repo, n] = pull;
		const c = live().changes.find(
			(x) => x.kind === 'pr' && x.owner === owner && x.repo === repo && x.number === Number(n)
		);
		return c ? json(fixturePull(c)) : null;
	}
	const commit = path.match(/^\/api\/github\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)(\/pulls)?$/);
	if (commit) {
		const [, owner, repo, ref, pulls] = commit;
		const f = live();
		const sha = resolveTag(f, repo, ref);
		const hits = f.changes.filter(
			(x) => x.owner === owner && x.repo === repo && (refMatches(x.mergeCommitSha, sha) || refMatches(x.headSha, sha))
		);
		if (pulls) {
			if (!f.changes.some((x) => x.owner === owner && x.repo === repo)) return null;
			return json(
				hits
					.filter((x) => x.kind === 'pr')
					.map((x) => ({
						number: x.number,
						title: x.title,
						htmlUrl: x.htmlUrl,
						state: 'merged',
						mergedAt: x.mergedAt,
						author: x.author
					}))
			);
		}
		const c = hits[0];
		if (!c) return null;
		return json({
			sha: c.mergeCommitSha,
			subject: c.title,
			author: c.author,
			committedAt: c.mergedAt,
			htmlUrl: `https://github.com/${owner}/${repo}/commit/${c.mergeCommitSha}`,
			containedIn: c.containedIn,
			containedInAll: c.containedInAll
		});
	}

	if (path === '/api/cluster') return json(HOME_INCIDENT_CLUSTERS[2]);
	if (path === '/api/clusters') return json(HOME_INCIDENT_CLUSTERS);

	return null;
}
