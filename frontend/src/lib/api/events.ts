/**
 * PERF-2026-09-04 §C.6/C.7 — REFETCH ON CHANGE, NOT ON A TIMER.
 *
 * One `EventSource` per tab, connected to `GET /api/events/stream` (the Go
 * backend's SSE fan-out over its informer cache — see
 * `pkg/kubernetes/eventhub.go` and the route in `main.go`). Every `changes`
 * message is a coalesced batch of `{type, kind, namespace, name, cluster,
 * resourceVersion, ts}` — this module's whole job is turning that into the
 * RIGHT TanStack Query invalidations, so a page updates within about a
 * second of the cluster changing instead of waiting out a 5-15s poll.
 *
 * ⭐ MULTI-CLUSTER — the hub's stream now fans in every spoke, not just its
 * own informer cache. `cluster` on each `ChangeEvent` is what makes an event
 * for one cluster's Rollout not clobber another cluster's same-named one
 * (see `applyChangeEvents`' per-kind predicates), and the separate
 * `event: clusters` message (`{"<name>": true|false, ...}` for every known
 * cluster, hub included) is what feeds `isClusterStreamHealthy`/
 * `areAllClustersHealthy` below — a spoke going dark falls that ONE
 * cluster's rollouts back to polling without slowing down every other
 * cluster's.
 *
 * ⛔ THIS IS ADDITIVE, NOT A REPLACEMENT FOR POLLING. The stream can drop
 * (proxy restart, a laptop sleeping, the backend rolling) and must fail
 * OPEN, not silent: `isEventStreamHealthy()` goes false the moment the
 * connection is lost, and `pollWhenHealthy`/`staleTimeWhenHealthy` in
 * `./errors` read it (and the per-cluster/fleet-wide variants above) on
 * every check, so the existing 5s/10-15s polling cadence resumes
 * automatically — no separate "is push broken" UI state to get wrong.
 *
 * Reconnect logic (backoff, `retry:` header support) is `eventsource-client`
 * itself — the same package `logs.ts` already uses for the pod-logs stream —
 * so this module only has to react to onConnect/onDisconnect, not reimplement
 * exponential backoff.
 */

import { createEventSource, type EventSourceClient } from 'eventsource-client';
import type { QueryClient } from '@tanstack/svelte-query';

/**
 * One coalesced change, verbatim from the backend's ChangeEvent.
 *
 * ⭐ MULTI-CLUSTER FAN-IN — `cluster` is the display name exactly as it
 * appears in `/api/clusters` and in the `[cluster]` route segment;
 * hub-local events carry the HUB's own name (never `''`), matching every
 * other `?cluster=`/route-param call site in this product. See the
 * `event: clusters` handling below for the companion per-cluster
 * connection-state event.
 */
export type ChangeEvent = {
	type: string; // "add" | "update" | "delete"
	kind: string; // "Rollout" | "Environment" | "RolloutGate" | ...
	namespace: string;
	name: string;
	cluster: string;
	resourceVersion: string;
	ts: number; // unix millis
};

/**
 * ⭐ PERF-2026-09-04 §C.7 SECOND FOLLOW-UP — INVALIDATE BY KIND, NOT BY A
 * NAMESPACE BLANKET.
 *
 * The first cut of this module invalidated every `ROLLOUT_SCOPED_KEY_TAGS`
 * key in an event's namespace for ANY known kind — correct in that nothing
 * went stale, wrong in how much it cost. Measured live on the hub (90s,
 * stream healthy): 9 batches / 14 events — Rollout update x4, HealthCheck
 * (probe status writes) x6, Kustomization x2 — drove `rollout`,
 * `permissions/all`, `health-checks`, `events` and `managed-resources` to
 * ALL refetch on EVERY batch regardless of kind, because a HealthCheck probe
 * write (routine, frequent) invalidated the per-user SSAR `permissions/all`
 * just as hard as an actual Rollout change. `permissions/all` in particular
 * has NO business being invalidated by a HealthCheck at all — it is a
 * SelfSubjectAccessReview keyed on the viewer's own token, not on anything
 * that changed in the cluster.
 *
 * The fix is to know, PER KIND, exactly which response shapes embed that
 * kind's data — grepped from the actual types, not guessed:
 *
 * - `RolloutResponse` (the `rollout` key: `rolloutQueryKey`) embeds
 *   `rollout`, `kustomizations`, `ociRepositories`, `rolloutGates`,
 *   `environment`, `kruiseRollout`, `rolloutTests`. So Rollout, RolloutGate,
 *   OCIRepository, Environment, KruiseRollout can all affect it — but of
 *   those, only a Rollout EVENT carries enough (namespace AND name) to
 *   match ONE cached entry; the rest only carry the CHANGED OBJECT's own
 *   namespace/name (a gate's own name, not the rollout it gates), so they
 *   fall back to "every `rollout` entry in that namespace".
 * - `RolloutsListResponse` (`rollouts/all`, `rollouts/namespace/<ns>`)
 *   embeds `rollouts`, `environments`, `kustomizations`, `kruiseRollouts`,
 *   `rolloutDependencies` — NOT `rolloutGates`, NOT `ociRepositories`. So
 *   RolloutGate and OCIRepository changes do NOT touch the fleet list; only
 *   Rollout, Kustomization, Environment, KruiseRollout, RolloutDependency do.
 * - `health-checks`, `rollout-tests`, `managed-resources` are each their
 *   OWN endpoint with their own dedicated kind (HealthCheck, RolloutTest,
 *   Kustomization respectively) — nothing else should touch them.
 * - `rollout-permissions` is a SelfSubjectAccessReview: per-USER, per-TOKEN,
 *   not per-object. NOTHING in the informer cache can make it stale, so it
 *   is invalidated by NOTHING here — it lives entirely on its own poll.
 * - the bare `events` key (`/api/rollouts/<ns>/<name>/events`, Kubernetes
 *   CORE `v1.Event` objects) is NOT one of `cachedByObject`'s cached types
 *   (`pkg/kubernetes/cache.go`) — the backend never streams a `"Event"`
 *   `ChangeEvent.Kind` today, so this key is not reachable via the stream
 *   at all yet and falls back to its own `pollWhenHealthy` ceiling. The
 *   mapping below is written as if it could arrive (`EVENT_TAG_KINDS`) so
 *   wiring the backend up later needs no frontend change — but it is
 *   currently dead code, and the tests say so.
 */

/** `RolloutResponse`'s embedded kinds whose OWN event carries the ROLLOUT's
 * exact namespace+name — currently only the Rollout object itself. */
const ROLLOUT_EXACT_KINDS = new Set(['Rollout']);

/** `RolloutResponse`'s embedded kinds whose event carries only the CHANGED
 * OBJECT's own namespace/name, not the rollout's — every `rollout` entry in
 * that namespace is invalidated rather than one exact entry. */
const ROLLOUT_NAMESPACE_KINDS = new Set([
	'RolloutGate',
	'OCIRepository',
	'Environment',
	'KruiseRollout',
	'RolloutDependency'
]);

/** `RolloutsListResponse`'s embedded kinds — these (and ONLY these) touch
 * the fleet list (`rollouts/all` + `rollouts/namespace/<ns>`). Confirmed
 * against the type: `rollouts, environments, kustomizations, kruiseRollouts,
 * rolloutDependencies` — RolloutGate and OCIRepository are NOT in it. */
const FLEET_LIST_KINDS = new Set([
	'Rollout',
	'Kustomization',
	'Environment',
	'KruiseRollout',
	'RolloutDependency'
]);

/** Each has its OWN endpoint/key and nothing else should invalidate it. */
const HEALTH_CHECK_KINDS = new Set(['HealthCheck']);
const ROLLOUT_TEST_KINDS = new Set(['RolloutTest']);
const KUSTOMIZATION_KINDS = new Set(['Kustomization']);
/** Not a real backend kind yet — see the big comment above. Kept as its own
 * set (rather than reusing `KNOWN_KINDS`) so adding it is a one-line change
 * whenever the backend starts streaming core `Event`s. */
const EVENT_TAG_KINDS = new Set(['Event']);

/**
 * ⭐ PERF-2026-09-04 §C.7 FOLLOW-UP — SCHEDULES ARE CLUSTER-WIDE, NOT
 * NAMESPACE-SCOPED, AND ONE OF THEM CARRIES NO NAMESPACE AT ALL.
 *
 * `ControlCenter`/`/dependencies`/the rollout Dependencies tab all share one
 * `['network-schedules', clusterNames]` query (`fetchNetworkSchedules`) — a
 * SINGLE request per page covering every cluster, keyed by the cluster list,
 * not by namespace. `revisions`/`revisions/[...slug]` separately read
 * `scheduleWindowQueryKey` (`['rollout-schedule-window', ns, name, cluster]`)
 * for one rollout's own deploy-window state. Both are schedule-shaped, not
 * rollout-shaped, so both key tags are driven by schedule KIND alone.
 *
 * `ClusterRolloutSchedule` is cluster-scoped BY DEFINITION
 * (`pkg/kubernetes/client.go`'s own doc comment) — its `metadata.namespace`
 * is always `""`, so `publishChange` (`pkg/kubernetes/cache.go`) publishes
 * `ChangeEvent{Namespace: ""}` for it, which is why both schedule tags are
 * matched on KIND ALONE rather than namespace: a cluster-wide schedule has
 * no namespace to narrow by, and could affect any rollout's window.
 */
const SCHEDULE_KINDS = new Set(['RolloutSchedule', 'ClusterRolloutSchedule']);

/** Every kind this module recognizes at all — the union of every set above,
 * checked FIRST so a cached type nobody has mapped yet fails LOUD (silently
 * doing nothing) instead of silently over- or under-invalidating. */
const KNOWN_KINDS = new Set([
	'Rollout',
	'RolloutDependency',
	'RolloutGate',
	'RolloutSchedule',
	'ClusterRolloutSchedule',
	'HealthCheck',
	'RolloutTest',
	'Environment',
	'KruiseRollout',
	'Kustomization',
	'OCIRepository'
	// 'Event' deliberately excluded — see EVENT_TAG_KINDS' own comment. Add
	// it here the same day the backend starts streaming core Events.
]);

/**
 * Maps one batch of change events to TanStack invalidations and applies
 * them, PER KIND. Exported (rather than folded into the EventSource wiring
 * below) so the mapping can be unit-tested with a fake `QueryClient` and no
 * network at all.
 *
 * An event for a kind this module has never heard of is ignored, not
 * treated as "invalidate everything" — see `KNOWN_KINDS`.
 */
export function applyChangeEvents(queryClient: QueryClient, events: ChangeEvent[]): void {
	const fleetNamespaces = new Set<string>();
	const rolloutExact = new Set<string>(); // "cluster|namespace|name"
	const rolloutNamespaces = new Set<string>(); // "cluster|namespace"
	const healthCheckTargets = new Set<string>(); // "cluster|namespace"
	const rolloutTestTargets = new Set<string>(); // "cluster|namespace"
	const eventsTargets = new Set<string>(); // "cluster|namespace"
	const kustomizationTargets: { cluster: string; namespace: string; name: string }[] = [];
	let scheduleChanged = false;

	for (const ev of events) {
		if (!KNOWN_KINDS.has(ev.kind) && !EVENT_TAG_KINDS.has(ev.kind)) continue;

		// ⭐ FLEET LIST — deliberately NOT cluster-scoped. `['rollouts','all']`
		// and the per-namespace fleet lists aggregate every cluster in one
		// response, so ANY cluster's Rollout/Kustomization/Environment/
		// KruiseRollout/RolloutDependency event must invalidate them.
		if (FLEET_LIST_KINDS.has(ev.kind) && ev.namespace) fleetNamespaces.add(ev.namespace);

		if (ROLLOUT_EXACT_KINDS.has(ev.kind) && ev.namespace && ev.name) {
			rolloutExact.add(`${ev.cluster}|${ev.namespace}|${ev.name}`);
		}
		if (ROLLOUT_NAMESPACE_KINDS.has(ev.kind) && ev.namespace) {
			rolloutNamespaces.add(`${ev.cluster}|${ev.namespace}`);
		}

		if (HEALTH_CHECK_KINDS.has(ev.kind) && ev.namespace) {
			healthCheckTargets.add(`${ev.cluster}|${ev.namespace}`);
		}
		if (ROLLOUT_TEST_KINDS.has(ev.kind) && ev.namespace) {
			rolloutTestTargets.add(`${ev.cluster}|${ev.namespace}`);
		}
		if (EVENT_TAG_KINDS.has(ev.kind) && ev.namespace) {
			eventsTargets.add(`${ev.cluster}|${ev.namespace}`);
		}
		if (KUSTOMIZATION_KINDS.has(ev.kind) && ev.namespace && ev.name) {
			kustomizationTargets.push({ cluster: ev.cluster, namespace: ev.namespace, name: ev.name });
		}
		if (SCHEDULE_KINDS.has(ev.kind)) scheduleChanged = true;
	}

	if (fleetNamespaces.size > 0) {
		queryClient.invalidateQueries({ queryKey: ['rollouts', 'all'] });
		for (const ns of fleetNamespaces) {
			queryClient.invalidateQueries({ queryKey: ['rollouts', 'namespace', ns] });
		}
	}

	// ⭐ CLUSTER-SCOPED MATCHING — every predicate below reads the key's OWN
	// cluster element (never the event's alone) so an event for cluster A can
	// never invalidate cluster B's cache entry for the same namespace/name.
	// `key[N] ?? ''` normalises a key built without a cluster (shouldn't
	// happen for any current call site, but fails toward "doesn't match"
	// rather than a crash) against `ev.cluster`, which the backend contract
	// guarantees is always a real, non-empty name (hub-local events carry the
	// hub's own name).

	if (rolloutExact.size > 0 || rolloutNamespaces.size > 0) {
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				if (key.length < 4 || key[0] !== 'rollout') return false;
				const ns = key[1] as string;
				const name = key[2] as string;
				const cluster = (key[3] as string | undefined) ?? '';
				return (
					rolloutExact.has(`${cluster}|${ns}|${name}`) || rolloutNamespaces.has(`${cluster}|${ns}`)
				);
			}
		});
	}

	if (healthCheckTargets.size > 0) {
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				// ['health-checks', rolloutNamespace, rolloutName, cluster]
				if (key.length < 4 || key[0] !== 'health-checks') return false;
				const ns = key[1] as string;
				const cluster = (key[3] as string | undefined) ?? '';
				return healthCheckTargets.has(`${cluster}|${ns}`);
			}
		});
	}

	if (rolloutTestTargets.size > 0) {
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				// ['rollout-tests', rolloutNamespace, rolloutName, cluster]
				if (key.length < 4 || key[0] !== 'rollout-tests') return false;
				const ns = key[1] as string;
				const cluster = (key[3] as string | undefined) ?? '';
				return rolloutTestTargets.has(`${cluster}|${ns}`);
			}
		});
	}

	if (eventsTargets.size > 0) {
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				// ['events', rolloutNamespace, rolloutName, cluster]
				if (key.length < 4 || key[0] !== 'events') return false;
				const ns = key[1] as string;
				const cluster = (key[3] as string | undefined) ?? '';
				return eventsTargets.has(`${cluster}|${ns}`);
			}
		});
	}

	if (kustomizationTargets.length > 0) {
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				// ['managed-resources', rolloutNamespace, rolloutName, cluster, kustomizationNames[]]
				if (key.length < 5 || key[0] !== 'managed-resources') return false;
				const ns = key[1] as string;
				const cluster = (key[3] as string | undefined) ?? '';
				const names = key[4];
				if (!Array.isArray(names)) return false;
				return kustomizationTargets.some(
					(t) => t.namespace === ns && t.cluster === cluster && names.includes(t.name)
				);
			}
		});
	}

	if (scheduleChanged) {
		queryClient.invalidateQueries({
			predicate: (query) =>
				query.queryKey[0] === 'network-schedules' || query.queryKey[0] === 'rollout-schedule-window'
		});
	}
}

// --- Stream health, read by `./errors`' pollWhenHealthy/staleTimeWhenHealthy ---

let healthy = false;

/**
 * Whether the change stream is currently connected. `./errors`'
 * `pollWhenHealthy`/`staleTimeWhenHealthy` consult this on every cadence
 * check (not just once at startup) so a stream that drops mid-session falls
 * back to polling immediately, and one that recovers speeds back up on its
 * own next check — no reload, no separate banner state.
 */
export function isEventStreamHealthy(): boolean {
	return healthy;
}

// --- Per-cluster health, fed by `event: clusters` ---

/**
 * `{"<clusterName>": true|false, ...}` for every known cluster (including
 * the hub), sent at connect and on every change of any cluster's connection
 * state. `null` until the FIRST such event arrives this session — the state
 * `isClusterStreamHealthy`/`areAllClustersHealthy` both fall back out of,
 * onto the whole-stream signal above, per the contract: "before the first
 * `clusters` event, treat the stream as before (connection open = healthy)".
 */
let clusterHealth: Map<string, boolean> | null = null;

function applyClusterHealth(update: Record<string, boolean>): void {
	clusterHealth = new Map(Object.entries(update));
}

/**
 * Whether ONE specific cluster's stream is currently connected. Rollout-
 * scoped queries (the rollout itself, health-checks, events,
 * managed-resources, rollout-tests, schedules) pass their own `[cluster]`
 * route segment here so a spoke going down only slows THAT spoke's rollouts
 * back to polling — a healthy hub or a healthy sibling spoke keeps its own
 * 60s ceiling.
 *
 * Unknown cluster name (not present in the last `clusters` event) falls back
 * to the whole-stream signal rather than assuming either state — the same
 * "fail toward polling, not toward silence" posture `isEventStreamHealthy`
 * already has.
 */
export function isClusterStreamHealthy(cluster: string): boolean {
	if (clusterHealth === null) return isEventStreamHealthy();
	const known = clusterHealth.get(cluster);
	return known ?? isEventStreamHealthy();
}

/**
 * Whether EVERY known cluster (including the hub) is connected. Fleet-wide
 * queries — anything that reads across the whole cluster set rather than one
 * rollout's own cluster (`['rollouts','all']` and its namespace variants,
 * `/environments`, `/activity`, `/apps`, `/versions`, the dependency graph,
 * and every OTHER call site that does not pass a specific cluster) use this:
 * one spoke going down must not speed up a query that reads every cluster,
 * but it also must not slow down a rollout ON A DIFFERENT, healthy cluster —
 * that per-rollout case is `isClusterStreamHealthy`'s job, not this one's.
 */
export function areAllClustersHealthy(): boolean {
	if (clusterHealth === null) return isEventStreamHealthy();
	for (const up of clusterHealth.values()) {
		if (!up) return false;
	}
	return true;
}

// --- Wiring: one EventSource per tab, hidden-tab suspend, reconnect-invalidates-once ---

const STREAM_URL = '/api/events/stream';
/** Suspend the connection after the tab has been hidden this long. */
const HIDE_AFTER_MS = 60_000;
/** No message at all (heartbeats included) for this long while nominally connected → force a reconnect; the backend heartbeats every 30s, so 3 misses is a good, cheap "actually dead" signal for a connection a proxy silently dropped. */
const WATCHDOG_MS = 100_000;

let client: EventSourceClient | null = null;
let started = false;
let connectedOnce = false;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let lastMessageAt = 0;

function noteMessage() {
	lastMessageAt = Date.now();
}

async function pump(queryClient: QueryClient, source: EventSourceClient) {
	try {
		for await (const msg of source) {
			noteMessage();
			if (msg.event === 'changes' && msg.data) {
				try {
					const events = JSON.parse(msg.data) as ChangeEvent[];
					applyChangeEvents(queryClient, events);
				} catch (e) {
					console.error('[event-stream] failed to parse changes payload:', e);
				}
			} else if (msg.event === 'clusters' && msg.data) {
				try {
					applyClusterHealth(JSON.parse(msg.data) as Record<string, boolean>);
				} catch (e) {
					console.error('[event-stream] failed to parse clusters payload:', e);
				}
			}
			// "heartbeat" and anything else just refresh lastMessageAt above —
			// nothing to invalidate.
		}
	} catch (e) {
		// eventsource-client's own reconnect loop handles this; onDisconnect
		// already flips `healthy` false. Logged for visibility only.
		console.error('[event-stream] iteration ended:', e);
	}
}

/**
 * Starts the one change-stream client for this tab and wires it to
 * `queryClient`. Idempotent — safe to call more than once (e.g. HMR) since
 * only the first call does anything. No-ops under SSR (`+layout.svelte`'s
 * script runs on the server too; `EventSource`/`document` don't exist
 * there).
 */
export function startEventStream(queryClient: QueryClient): void {
	if (started) return;
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	started = true;

	client = createEventSource({
		url: STREAM_URL,
		onConnect: () => {
			healthy = true;
			noteMessage();
			// A RECONNECT (not the very first connect) means some window of
			// changes may have been missed while disconnected — reconcile once
			// rather than trying to diff what was missed.
			if (connectedOnce) {
				queryClient.invalidateQueries();
			}
			connectedOnce = true;
		},
		onDisconnect: () => {
			healthy = false;
			// The last `clusters` snapshot can no longer be trusted once the
			// stream itself is down — a spoke's true state may have changed
			// with no way for us to hear about it. Discarding it (rather than
			// leaving stale `true`s behind) makes both `isClusterStreamHealthy`
			// and `areAllClustersHealthy` fall back to the (now false) whole-
			// stream signal until a fresh `clusters` event repopulates it,
			// which the backend sends again "at connect".
			clusterHealth = null;
		}
	});
	pump(queryClient, client);

	watchdog = setInterval(() => {
		if (healthy && lastMessageAt && Date.now() - lastMessageAt > WATCHDOG_MS) {
			healthy = false;
			clusterHealth = null;
			client?.close();
			client?.connect();
		}
	}, 10_000);

	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			if (hiddenTimer) return;
			hiddenTimer = setTimeout(() => {
				hiddenTimer = null;
				healthy = false;
				client?.close();
			}, HIDE_AFTER_MS);
		} else {
			if (hiddenTimer) {
				clearTimeout(hiddenTimer);
				hiddenTimer = null;
				// Never actually closed (hidden < 60s) — connection, if any,
				// is untouched.
				return;
			}
			// Was closed for being hidden >60s — reopen. onConnect's
			// `connectedOnce` branch invalidates everything once, covering
			// whatever changed while suspended.
			client?.connect();
		}
	});
}

/**
 * Test-only reset so each test file gets a fresh module state instead of
 * inheriting `started`/`healthy`/timers from a previous test's call to
 * `startEventStream`.
 */
export function _resetEventStreamForTests(): void {
	client?.close();
	client = null;
	started = false;
	connectedOnce = false;
	healthy = false;
	lastMessageAt = 0;
	clusterHealth = null;
	if (hiddenTimer) clearTimeout(hiddenTimer);
	hiddenTimer = null;
	if (watchdog) clearInterval(watchdog);
	watchdog = null;
}
