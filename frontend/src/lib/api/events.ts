/**
 * PERF-2026-09-04 §C.6/C.7 — REFETCH ON CHANGE, NOT ON A TIMER.
 *
 * One `EventSource` per tab, connected to `GET /api/events/stream` (the Go
 * backend's SSE fan-out over its informer cache — see
 * `pkg/kubernetes/eventhub.go` and the route in `main.go`). Every message is
 * a coalesced batch of `{type, kind, namespace, name, resourceVersion, ts}`
 * — this module's whole job is turning that into the RIGHT TanStack Query
 * invalidations, so a page updates within about a second of the cluster
 * changing instead of waiting out a 5-15s poll.
 *
 * ⛔ THIS IS ADDITIVE, NOT A REPLACEMENT FOR POLLING. The stream can drop
 * (proxy restart, a laptop sleeping, the backend rolling) and must fail
 * OPEN, not silent: `isEventStreamHealthy()` goes false the moment the
 * connection is lost, and `pollWhenHealthy`/`staleTimeWhenHealthy` in
 * `./errors` read it on every check, so the existing 5s/10-15s polling
 * cadence resumes automatically — no separate "is push broken" UI state to
 * get wrong.
 *
 * Reconnect logic (backoff, `retry:` header support) is `eventsource-client`
 * itself — the same package `logs.ts` already uses for the pod-logs stream —
 * so this module only has to react to onConnect/onDisconnect, not reimplement
 * exponential backoff.
 */

import { createEventSource, type EventSourceClient } from 'eventsource-client';
import type { QueryClient } from '@tanstack/svelte-query';

/** One coalesced change, verbatim from the backend's ChangeEvent. */
export type ChangeEvent = {
	type: string; // "add" | "update" | "delete"
	kind: string; // "Rollout" | "Environment" | "RolloutGate" | ...
	namespace: string;
	name: string;
	resourceVersion: string;
	ts: number; // unix millis
};

/**
 * Every per-rollout query key in this app follows the same shape:
 * `[kindTag, namespace, name, ...rest]` — see `rolloutQueryKey`,
 * `rolloutPermissionsQueryKey`, `rolloutTestsQueryKey`,
 * `scheduleWindowQueryKey`, plus the inline keys on rollout detail
 * (`health-checks`, `events`, `managed-resources`). That consistency is what
 * makes a namespace-scoped invalidation possible without this module having
 * to know which specific rollout a gate, schedule or health check object
 * belongs to — the change stream's event only carries the CHANGED OBJECT's
 * own namespace/name, not the rollout's, for every kind except Rollout
 * itself.
 */
const ROLLOUT_SCOPED_KEY_TAGS = new Set([
	'rollout',
	'rollout-permissions',
	'rollout-tests',
	'rollout-schedule-window',
	'health-checks',
	'events',
	'managed-resources'
]);

/**
 * True for every kind the backend's informer cache streams
 * (`pkg/kubernetes/cache.go`'s `cachedByObject`) — a change to any of them
 * can change what a rollout page or the fleet list shows. Kept as an
 * allowlist (rather than "invalidate on anything") so a future cached type
 * this module hasn't been told about yet fails LOUD in a test instead of
 * silently over-invalidating or, worse, silently doing nothing.
 */
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
]);

/**
 * ⭐ PERF-2026-09-04 §C.7 FOLLOW-UP — SCHEDULES ARE CLUSTER-WIDE, NOT
 * NAMESPACE-SCOPED, AND ONE OF THEM CARRIES NO NAMESPACE AT ALL.
 *
 * `ControlCenter`/`/dependencies`/the rollout Dependencies tab all share one
 * `['network-schedules', clusterNames]` query (`fetchNetworkSchedules`) — a
 * SINGLE request per page covering every cluster, keyed by the cluster list,
 * not by namespace. `ROLLOUT_SCOPED_KEY_TAGS`'s predicate matches
 * `key[1] === namespace`, so this key can never match it (`key[1]` here is
 * an array of cluster names, not a namespace string) even when its tag were
 * added to that set.
 *
 * Worse: `ClusterRolloutSchedule` is cluster-scoped BY DEFINITION
 * (`pkg/kubernetes/client.go`'s own doc comment) — its `metadata.namespace`
 * is always `""`, so `publishChange` (`pkg/kubernetes/cache.go`) publishes
 * `ChangeEvent{Namespace: ""}` for it. Before this fix that emptied
 * `ev.namespace`, which is falsy, so the ORIGINAL loop below dropped
 * ClusterRolloutSchedule events on the floor entirely — a schedule window
 * opening or closing never invalidated anything, cluster-wide fleet list
 * included, because the very first `if (... && ev.namespace)` filtered it
 * out before it could contribute to `namespaces`.
 *
 * `RolloutSchedule` (namespaced) still feeds `namespaces` normally — this
 * set additionally, unconditionally, invalidates `network-schedules` for
 * either schedule kind, keyed only on KIND, since there is no namespace or
 * cluster-name join available to narrow it further.
 */
const SCHEDULE_KINDS = new Set(['RolloutSchedule', 'ClusterRolloutSchedule']);

/**
 * Maps one batch of change events to TanStack invalidations and applies
 * them. Exported (rather than folded into the EventSource wiring below) so
 * the mapping can be unit-tested with a fake `QueryClient` and no network at
 * all.
 *
 * For every event whose kind this module recognizes: invalidate the
 * cluster-wide fleet list (`['rollouts', 'all']`), the per-namespace list
 * (`['rollouts', 'namespace', ns]`), and every currently-cached per-rollout
 * query in that namespace (`ROLLOUT_SCOPED_KEY_TAGS`, matched by namespace
 * since the event doesn't name which rollout a gate/schedule/health-check
 * object belongs to — see the doc comment above). An event for a kind this
 * module has never heard of is ignored, not treated as "invalidate
 * everything" — see KNOWN_KINDS. A `RolloutSchedule`/`ClusterRolloutSchedule`
 * event ALSO invalidates `network-schedules` (see `SCHEDULE_KINDS`'s own
 * comment) — independently of whether it carried a namespace.
 */
export function applyChangeEvents(queryClient: QueryClient, events: ChangeEvent[]): void {
	const namespaces = new Set<string>();
	let scheduleChanged = false;
	for (const ev of events) {
		if (!KNOWN_KINDS.has(ev.kind)) continue;
		if (ev.namespace) namespaces.add(ev.namespace);
		if (SCHEDULE_KINDS.has(ev.kind)) scheduleChanged = true;
	}
	if (namespaces.size === 0 && !scheduleChanged) return;

	if (namespaces.size > 0) {
		queryClient.invalidateQueries({ queryKey: ['rollouts', 'all'] });
		for (const ns of namespaces) {
			queryClient.invalidateQueries({ queryKey: ['rollouts', 'namespace', ns] });
		}
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				return (
					key.length >= 2 &&
					typeof key[0] === 'string' &&
					ROLLOUT_SCOPED_KEY_TAGS.has(key[0]) &&
					namespaces.has(key[1] as string)
				);
			}
		});
	}

	if (scheduleChanged) {
		queryClient.invalidateQueries({
			predicate: (query) => query.queryKey[0] === 'network-schedules'
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
		}
	});
	pump(queryClient, client);

	watchdog = setInterval(() => {
		if (healthy && lastMessageAt && Date.now() - lastMessageAt > WATCHDOG_MS) {
			healthy = false;
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
	if (hiddenTimer) clearTimeout(hiddenTimer);
	hiddenTimer = null;
	if (watchdog) clearInterval(watchdog);
	watchdog = null;
}
