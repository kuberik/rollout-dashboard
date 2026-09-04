/**
 * PERF-2026-09-04 §C.6/C.7 — REFETCH ON CHANGE, NOT ON A TIMER.
 *
 * One `EventSource` per tab, connected to `GET /api/events/stream` (the Go
 * backend's SSE fan-out over its informer cache — see
 * `pkg/kubernetes/eventhub.go` and the route in `main.go`). Every `changes`
 * message is a coalesced batch of `{type, kind, namespace, name, cluster,
 * resourceVersion, ts, object?}` — this module's whole job is turning that
 * into the RIGHT TanStack Query invalidations, so a page updates within about
 * a second of the cluster changing instead of waiting out a 5-15s poll.
 *
 * ⭐ 33601e1 — WHEN `object` IS PRESENT, THIS MODULE PATCHES THE CACHE
 * DIRECTLY INSTEAD OF INVALIDATING IT. Invalidating an ACTIVE query fires a
 * real refetch; an event that already carries the changed object makes that
 * refetch redundant. See the "PATCH, NOT INVALIDATE" block right before
 * `applyChangeEvents` for the full per-kind story and its two deliberate
 * exceptions (`rollout-schedule-window`, `network-schedules`).
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
import type { RolloutsListResponse, RolloutResponse, DeploymentChildrenResponse } from './rollouts';
import { SOURCE_CLUSTER_ANNOTATION, sourceClusterName } from '../source-dashboard';

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
	/**
	 * ⭐ PATCH-FROM-EVENT, 33601e1 — the object as the API would serve it
	 * (managedFields and last-applied stripped server-side), for 8 kinds:
	 * Rollout, HealthCheck, Kustomization, Environment, KruiseRollout,
	 * RolloutDependency, RolloutSchedule, ClusterRolloutSchedule. Absent on
	 * every `delete` event (nothing to embed), for any OTHER kind, and when
	 * the marshaled object exceeds 64 KiB — see `pkg/kubernetes/eventhub.go`'s
	 * `AttachObjects` for the exact contract. `applyChangeEvents` below uses
	 * this to PATCH the affected caches directly instead of invalidating them
	 * (which forces a refetch) — see "PATCH, NOT INVALIDATE" below.
	 */
	object?: Record<string, unknown>;
};

/**
 * The minimal shape every embedded/listed object in this module cares about
 * — enough to find it by identity and to stamp the cluster it came from.
 * Deliberately NOT the generated `Rollout`/`Kustomization`/... types: an
 * event's `object` is untyped wire JSON, and every field this module reads
 * off it is present on every Kubernetes object regardless of kind.
 */
type K8sObject = {
	metadata?: {
		name?: string;
		namespace?: string;
		annotations?: Record<string, string> | null;
		// ⭐ DEPLOYMENT-CHILDREN, PERF-2026-09-04 — a ReplicaSet's `object` carries
		// this so its owning Deployment can be resolved without a second fetch.
		ownerReferences?: { kind?: string; name?: string }[] | null;
	};
	[key: string]: unknown;
};

/**
 * ⭐ THE FAN-OUT STAMPS `SOURCE_CLUSTER_ANNOTATION` AT LIST-BUILD TIME, NOT ON
 * THE EVENT'S OWN OBJECT. `main_fanout.go`'s `annotateItemsWithSource` only
 * runs when the hub assembles a `RolloutsListResponse` from each cluster's
 * raw list — `pkg/kubernetes/eventhub.go`'s `AttachObjects` (which produces
 * `ChangeEvent.Object`) re-Gets the object from the informer cache and never
 * touches this annotation. So an object lifted straight from an event and
 * pushed into a fleet-list cache would be MISSING the one annotation every
 * other item in that list carries — `sourceClusterName()` would read `''`
 * for it while its siblings read the real cluster name, which is exactly the
 * cross-cluster collision `rolloutMatchesEnvironment` and this module's own
 * cluster-scoped predicates exist to prevent. `ChangeEvent.cluster` is
 * authoritative (the backend stamps it from the connection the event came
 * in on — see this file's own top comment), so every object patched into a
 * fleet-list cache is re-stamped with it here before insertion.
 */
function stampSourceCluster(obj: K8sObject, cluster: string): K8sObject {
	const annotations = { ...(obj.metadata?.annotations ?? {}), [SOURCE_CLUSTER_ANNOTATION]: cluster };
	return { ...obj, metadata: { ...obj.metadata, annotations } };
}

function sameIdentity(obj: K8sObject | null | undefined, ev: ChangeEvent): boolean {
	return obj?.metadata?.name === ev.name && obj?.metadata?.namespace === ev.namespace;
}

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
 * ⭐ PERF-2026-09-04 — DEPLOYMENT CHILDREN. `ResourcesCard.svelte`'s
 * expanded-pods panel (`DeploymentChildren.svelte`) used to run its own
 * `setInterval` outside TanStack Query entirely; it is a real
 * `['deployment-children', cluster, namespace, name]` query now (see
 * `rollouts.ts`'s `deploymentChildrenQueryKey` — note `cluster` sits at
 * index 1, not last, unlike every other key tag in this file, which is what
 * the predicates below key off).
 *
 * ⭐ THE CONTRACT IS NEWER THAN THIS FILE'S TOP COMMENT. As of the backend
 * change this module is being built against, `Deployment` and `ReplicaSet`
 * `ChangeEvent`s also carry `object` (≤ 64 KiB, same as the other 8 kinds)
 * — the top-of-file "8 kinds" list predates it.
 *
 * ⭐ CHURN FOLLOW-UP (§C.7 second pass) — REPLICASET COUNTS ARE PATCHED NOW;
 * MANAGED-RESOURCES AND `deployment-children`'S OWN POD LIST STAY
 * INVALIDATE-ONLY, BOTH NOW THROTTLED. A rolling update writes several
 * ReplicaSet statuses a second; every one of those used to fire an immediate
 * `deployment-children`/`managed-resources` refetch. Two different fixes for
 * two different reasons:
 *
 * - **`deployment-children`'s summary counts ARE soundly patchable.**
 *   `patchReplicaSetChildrenCaches` below updates ONLY the fields `RSInfo`
 *   (main.go's children handler) puts on the wire unmodified from the raw
 *   ReplicaSet — `replicas`/`readyReplicas` (`status`) and `desiredReplicas`
 *   (`spec.replicas`) — none of them server-COMPUTED, so copying them from
 *   the event's own `object` is exactly what a refetch would return. It does
 *   NOT touch `isCurrentRS` (derived server-side by comparing THIS
 *   ReplicaSet's revision annotation against the owning DEPLOYMENT's current
 *   one — information this event doesn't carry) or the pods list (never on a
 *   ReplicaSet object at all, and no single Deployment/ReplicaSet object can
 *   be folded into the server-side aggregate `{replicaSets: [...]}` shape
 *   anyway) — those still need the throttled invalidate below to catch up.
 * - **`managed-resources` (a Deployment event) is NOT patched.**
 *   `ManagedResourceStatus.Status`/`.Message` are `status.Compute(obj)`
 *   output (`managedResourceStatusFromObject`, client.go) — kstatus
 *   evaluated server-side, not a field copy. There is no sound way to
 *   recompute that client-side from the raw object, and patching `.Object`
 *   alone while leaving `.Status`/`.Message` stale would show an updated
 *   replica count next to a status word that no longer agrees with it. So
 *   this stays invalidate-only, on purpose — see `managedResourcesNamespaces`
 *   below.
 *
 * Both are still capable of firing once per ReplicaSet status write during a
 * rollout, so both now go through `throttledInvalidate` (the trailing-edge
 * throttle defined further down) instead of invalidating immediately on
 * every batch — see that function's own doc comment.
 */
const DEPLOYMENT_KINDS = new Set(['Deployment']);
const REPLICASET_KINDS = new Set(['ReplicaSet']);

/**
 * A rolling update's ReplicaSet/Deployment status writes can arrive several
 * times a second; `deployment-children` and `managed-resources` invalidation
 * is throttled to at most one refetch per this many ms per query (leading +
 * one trailing) — see `throttledInvalidate`. Every OTHER kind in this file
 * keeps its immediate (0ms) invalidate — a Rollout/HealthCheck/etc. event is
 * comparatively rare, and the whole point of the push model is to react to
 * it at once.
 */
const CHURN_THROTTLE_MS = 2_000;

/**
 * A `ReplicaSet` event names only the ReplicaSet itself; its owning
 * Deployment comes from `metadata.ownerReferences` (the contract above).
 * `undefined` when `object` is absent (delete, or an update the 64 KiB cap
 * dropped) or carries no Deployment owner — the caller falls back to
 * invalidating every `deployment-children` entry in the event's namespace
 * rather than doing nothing, since a real ReplicaSet change happened and
 * this module just can't name which deployment it belongs to.
 */
function replicaSetOwnerDeployment(obj: K8sObject | undefined): string | undefined {
	return obj?.metadata?.ownerReferences?.find((o) => o.kind === 'Deployment')?.name ?? undefined;
}

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
	'OCIRepository',
	'Deployment',
	'ReplicaSet'
	// 'Event' deliberately excluded — see EVENT_TAG_KINDS' own comment. Add
	// it here the same day the backend starts streaming core Events.
]);

// ─────────────────────────────────────────────────────────────────────────
// PATCH, NOT INVALIDATE — PERF-2026-09-04 §C.7, event-object follow-up.
//
// `invalidateQueries` marks a cache entry stale and — for every ACTIVE query
// — fires a real network refetch. That was the whole cost this file existed
// to cut down on, and once an event carries the changed object, refetching
// is redundant: the object already tells the cache what the next fetch
// would return. Every function below therefore calls `setQueriesData`
// (patch the cache in place, bump `dataUpdatedAt`, no request) and the
// per-kind invalidate sets further down are now the FALLBACK path — used
// only when there is no `object` to patch with (delete-of-a->64KiB-object
// never happens, but an update can still omit it) or, for two cases
// documented at their own call sites, when patching still isn't SOUND with
// the data this module has.
//
// A delete event never carries `object` (see `ChangeEvent.object`'s own
// doc), but it always carries `namespace`/`name`/`kind` — enough to find and
// remove the matching entry by IDENTITY without needing the object body. So
// "patchable" means "delete, or update/add with an object", not "has an
// object" — every function below takes that as its precondition.
// ─────────────────────────────────────────────────────────────────────────

/** `RolloutsListResponse`'s embedded-array field for each `FLEET_LIST_KINDS` member. */
const FLEET_LIST_FIELD: Partial<Record<string, keyof RolloutsListResponse>> = {
	Rollout: 'rollouts',
	Kustomization: 'kustomizations',
	Environment: 'environments',
	KruiseRollout: 'kruiseRollouts',
	RolloutDependency: 'rolloutDependencies'
};

/**
 * Upsert/remove one object in one `RolloutsListResponse`'s matching array,
 * matched by (namespace, name, source cluster) so a same-named object on a
 * DIFFERENT cluster is never overwritten (see `stampSourceCluster`'s doc).
 * Returns the SAME reference when there is nothing to do, so `setQueriesData`
 * below leaves an unrelated cache entry untouched rather than bumping its
 * `dataUpdatedAt` for no reason.
 */
function patchFleetListResponse(resp: RolloutsListResponse, ev: ChangeEvent): RolloutsListResponse {
	const field = FLEET_LIST_FIELD[ev.kind];
	if (!field) return resp;
	const container = (resp as Record<string, unknown>)[field] as
		| { items?: K8sObject[] }
		| null
		| undefined;
	const items = container?.items ?? [];
	const idx = items.findIndex(
		(it) => sameIdentity(it, ev) && sourceClusterName(it) === ev.cluster
	);
	if (ev.type === 'delete') {
		if (idx === -1) return resp;
		const next = items.slice();
		next.splice(idx, 1);
		return { ...resp, [field]: { ...container, items: next } };
	}
	if (!ev.object) return resp;
	const stamped = stampSourceCluster(ev.object as K8sObject, ev.cluster);
	const next = items.slice();
	if (idx === -1) next.push(stamped);
	else next[idx] = stamped;
	return { ...resp, [field]: { ...container, items: next } };
}

/**
 * Patches `['rollouts','all']` and every `['rollouts','namespace',<ns>]`
 * cache entry whose namespace matches the event (a namespace-scoped fleet
 * list only ever contains that one namespace's items, so a DIFFERENT
 * namespace's cached list is correctly left alone — unlike `fleetNamespaces`
 * below, which invalidates by namespace for the same reason).
 */
function patchFleetListCaches(queryClient: QueryClient, ev: ChangeEvent): void {
	queryClient.setQueriesData<RolloutsListResponse>(
		{
			predicate: (query) => {
				const key = query.queryKey;
				if (key[0] !== 'rollouts') return false;
				if (key[1] === 'all') return true;
				return key[1] === 'namespace' && key[2] === ev.namespace;
			}
		},
		(old) => (old ? patchFleetListResponse(old, ev) : old)
	);
}

/**
 * The exact `['rollout', ns, name, cluster]` entry for a Rollout event that
 * carries its object — replaces `.rollout` in place. Never called for a
 * delete (there is no sensible "patched" state for a rollout that no longer
 * exists; that case stays on the `rolloutExact` invalidate set below so the
 * page refetches into its own 404/error state).
 */
function patchRolloutExactCache(queryClient: QueryClient, ev: ChangeEvent): void {
	queryClient.setQueriesData<RolloutResponse>(
		{
			predicate: (query) => {
				const key = query.queryKey;
				if (key.length < 4 || key[0] !== 'rollout') return false;
				return (
					key[1] === ev.namespace &&
					key[2] === ev.name &&
					((key[3] as string | undefined) ?? '') === ev.cluster
				);
			}
		},
		(old) => (old ? { ...old, rollout: ev.object as unknown as RolloutResponse['rollout'] } : old)
	);
}

/**
 * `RolloutResponse` fields `patchRolloutComposite` knows how to update in
 * place, driven off `ROLLOUT_NAMESPACE_KINDS` — i.e. only the kinds that
 * ALSO fall back to the namespace-wide invalidate when they can't be
 * patched. `Kustomization` is deliberately absent: it has never been a
 * member of `ROLLOUT_NAMESPACE_KINDS` (see that constant's own doc —
 * `RolloutResponse.kustomizations` was left to its own polling ceiling
 * rather than paying for a namespace-wide invalidate on every Kustomization
 * reconcile). It gets its own dedicated branch below instead, so an object
 * that CAN be patched now is a pure improvement on top of that trade —
 * and the object-absent case still falls to NOTHING for `Kustomization`,
 * exactly as it always has, rather than newly acquiring the invalidate this
 * set drives for its members.
 */
const EMBEDDABLE_IN_ROLLOUT_DETAIL = new Set(['Environment', 'KruiseRollout']);

/**
 * One `RolloutResponse`'s embedded Kustomization/Environment/KruiseRollout,
 * IF this particular composite actually references the changed object.
 * Returns `null` — "leave this entry alone" — both when the composite
 * doesn't carry that field yet (nothing to check membership against) and
 * when it does but names something else: a Kustomization event whose name
 * isn't in this rollout's `kustomizations.items` is simply not this
 * rollout's Kustomization, and unlike the namespace-wide invalidate this
 * replaces, patching can tell the difference and do nothing instead of
 * refetching a page the change can't possibly affect.
 *
 * `RolloutDependency` is deliberately absent — `RolloutResponse` (see
 * `rollouts.ts`) has no field for it, so there is nothing here to patch and
 * it stays on the `rolloutNamespaces` invalidate path unconditionally (see
 * the main loop below).
 */
function patchRolloutComposite(resp: RolloutResponse, ev: ChangeEvent): RolloutResponse | null {
	if (ev.kind === 'Kustomization') {
		const items = resp.kustomizations?.items as K8sObject[] | undefined;
		if (!items) return null;
		const idx = items.findIndex((k) => sameIdentity(k, ev));
		if (idx === -1) return null;
		const next = items.slice();
		if (ev.type === 'delete') next.splice(idx, 1);
		else if (ev.object) next[idx] = ev.object as K8sObject;
		else return null;
		return {
			...resp,
			kustomizations: { items: next } as unknown as RolloutResponse['kustomizations']
		};
	}
	if (ev.kind === 'Environment') {
		const cur = resp.environment as K8sObject | undefined;
		if (!sameIdentity(cur, ev)) return null;
		if (ev.type === 'delete') return { ...resp, environment: undefined };
		if (!ev.object) return null;
		return { ...resp, environment: ev.object as unknown as RolloutResponse['environment'] };
	}
	if (ev.kind === 'KruiseRollout') {
		const cur = resp.kruiseRollout as K8sObject | null | undefined;
		if (!sameIdentity(cur, ev)) return null;
		if (ev.type === 'delete') return { ...resp, kruiseRollout: null };
		if (!ev.object) return null;
		return { ...resp, kruiseRollout: ev.object as unknown as RolloutResponse['kruiseRollout'] };
	}
	return null;
}

/**
 * Tries `patchRolloutComposite` against every `rollout` cache entry in the
 * event's namespace+cluster (the event names the changed object, not which
 * rollout embeds it — same information gap `ROLLOUT_NAMESPACE_KINDS`
 * documents above). Entries `patchRolloutComposite` returns `null` for are
 * left byte-identical, so `setQueriesData` here never touches a rollout
 * detail page the change is unrelated to.
 */
function patchRolloutCompositeCaches(queryClient: QueryClient, ev: ChangeEvent): void {
	queryClient.setQueriesData<RolloutResponse>(
		{
			predicate: (query) => {
				const key = query.queryKey;
				if (key.length < 4 || key[0] !== 'rollout') return false;
				return (
					key[1] === ev.namespace && ((key[3] as string | undefined) ?? '') === ev.cluster
				);
			}
		},
		(old) => (old ? (patchRolloutComposite(old, ev) ?? old) : old)
	);
}

/**
 * Upserts/removes a `HealthCheck` inside `['health-checks', ns, rolloutName,
 * cluster]`'s `{ healthChecks: [...] }` array. The backend filters that list
 * server-side by the ROLLOUT's `healthCheckSelector` — information this
 * module doesn't have — so an incoming HealthCheck this rollout's cache does
 * NOT already contain could be either "not selected" or "newly relevant",
 * and there's no way to tell which from the object alone. The predicate that
 * IS sound either way is presence: a HealthCheck already in the list is
 * unambiguously this rollout's, so updating or removing it in place is
 * always correct; one that ISN'T there is left alone (this page's own
 * `pollWhenHealthy(5000, 60000, cluster)` override — unchanged by this pass
 * — is the safety net for that one case, not the 300s fleet-wide default).
 *
 * Returns `false` when at least one matching cache entry is KNOWN to have
 * changed (the item is present) but has no `object` to apply — the one case
 * that still needs a real invalidate, since presence confirms relevance but
 * there is no new content to patch in with.
 */
function patchHealthCheckCaches(queryClient: QueryClient, ev: ChangeEvent): boolean {
	let needsInvalidate = false;
	queryClient.setQueriesData<{ healthChecks?: K8sObject[] }>(
		{
			predicate: (query) => {
				const key = query.queryKey;
				if (key.length < 4 || key[0] !== 'health-checks') return false;
				return key[1] === ev.namespace && ((key[3] as string | undefined) ?? '') === ev.cluster;
			}
		},
		(old) => {
			if (!old?.healthChecks) return old;
			const items = old.healthChecks;
			const idx = items.findIndex((h) => sameIdentity(h, ev));
			if (ev.type === 'delete') {
				if (idx === -1) return old;
				const next = items.slice();
				next.splice(idx, 1);
				return { ...old, healthChecks: next };
			}
			if (idx === -1) return old; // not (yet) known to be this rollout's — see doc comment
			if (!ev.object) {
				needsInvalidate = true;
				return old;
			}
			const next = items.slice();
			next[idx] = ev.object as K8sObject;
			return { ...old, healthChecks: next };
		}
	);
	return !needsInvalidate;
}

/** The subset of a raw ReplicaSet object this module copies into a cached
 * `DeploymentReplicaSet` row — see `patchReplicaSetChildrenCaches`'s own doc
 * comment for exactly which fields, and why not more. */
type ReplicaSetObject = K8sObject & {
	status?: { replicas?: number; readyReplicas?: number };
	spec?: { replicas?: number };
};

/**
 * Patches ONE ReplicaSet's summary counts into every cached
 * `deployment-children` entry owned by `ownerDeploymentName`, matched by the
 * ReplicaSet's own NAME inside that entry's `replicaSets` array. Only
 * `replicas`/`readyReplicas`/`desiredReplicas` move — see the
 * `DEPLOYMENT_KINDS`/`REPLICASET_KINDS` doc comment above for why
 * `isCurrentRS` and the pods list are deliberately left alone.
 *
 * A ReplicaSet this cache doesn't already contain (idx === -1 — a brand-new
 * revision the reader hasn't expanded yet, or simply never fetched) is left
 * untouched here: there's no existing row to patch, and the throttled
 * invalidate the caller also schedules (`deploymentChildrenTargets`) is what
 * discovers it on the next refetch.
 */
function patchReplicaSetChildrenCaches(
	queryClient: QueryClient,
	ev: ChangeEvent,
	ownerDeploymentName: string
): void {
	const obj = ev.object as ReplicaSetObject | undefined;
	queryClient.setQueriesData<DeploymentChildrenResponse>(
		{
			predicate: (query) => {
				const key = query.queryKey;
				// ['deployment-children', cluster, namespace, name] — see this
				// key tag's own doc comment in rollouts.ts for the index order.
				if (key.length < 4 || key[0] !== 'deployment-children') return false;
				const cluster = (key[1] as string | undefined) ?? '';
				const ns = key[2] as string;
				const depName = key[3] as string;
				return cluster === ev.cluster && ns === ev.namespace && depName === ownerDeploymentName;
			}
		},
		(old) => {
			if (!old?.replicaSets) return old;
			const idx = old.replicaSets.findIndex((rs) => rs.name === ev.name);
			if (idx === -1) return old; // unknown RS — the throttled invalidate discovers it
			if (ev.type === 'delete') {
				const next = old.replicaSets.slice();
				next.splice(idx, 1);
				return { ...old, replicaSets: next };
			}
			if (!obj) return old;
			const current = old.replicaSets[idx];
			const next = old.replicaSets.slice();
			next[idx] = {
				...current,
				replicas: obj.status?.replicas ?? current.replicas,
				readyReplicas: obj.status?.readyReplicas ?? current.readyReplicas,
				desiredReplicas: obj.spec?.replicas ?? current.desiredReplicas
			};
			return { ...old, replicaSets: next };
		}
	);
}

// ─────────────────────────────────────────────────────────────────────────
// THROTTLED INVALIDATE — PERF-2026-09-04 §C.7 churn follow-up.
//
// A leading + trailing throttle, keyed by an arbitrary caller-chosen string
// (NOT necessarily a literal TanStack query key — see the call sites below,
// which key by "cluster|namespace[|name]" target rather than a full key
// tuple). The first call for a given key runs immediately; any further call
// for the SAME key before `ms` has elapsed collapses into exactly one
// trailing run at the end of the window, so a burst of N events produces at
// most 2 runs (leading + trailing), never N. A key that goes quiet for a
// full window resumes firing on its own next call's leading edge — spacing
// is not accumulated across idle periods.
// ─────────────────────────────────────────────────────────────────────────

type ThrottleState = { timer: ReturnType<typeof setTimeout> | null; lastRun: number };
const throttleStates = new Map<string, ThrottleState>();

export function throttledInvalidate(
	queryClient: QueryClient,
	key: string,
	ms: number,
	invalidate: () => void
): void {
	if (ms <= 0) {
		invalidate();
		return;
	}
	let state = throttleStates.get(key);
	if (!state) {
		state = { timer: null, lastRun: 0 };
		throttleStates.set(key, state);
	}
	const now = Date.now();
	if (state.timer === null && now - state.lastRun >= ms) {
		// Leading edge — nothing pending, and the last run (if any) was a full
		// window ago or more.
		state.lastRun = now;
		invalidate();
		return;
	}
	if (state.timer === null) {
		// Trailing edge — inside the window with nothing scheduled yet.
		// Exactly one trailing run fires at the window's own end, however many
		// more calls for this key arrive before then.
		const remaining = ms - (now - state.lastRun);
		state.timer = setTimeout(
			() => {
				state!.timer = null;
				state!.lastRun = Date.now();
				invalidate();
			},
			Math.max(remaining, 0)
		);
	}
	// else: a trailing run is already scheduled for this key — nothing to do.
}

/** Test-only: clears every pending throttle timer and its state, so one
 * test's churn on a given key can't bleed into the next test's use of the
 * SAME key (`deployment-children|hub|team-a|dep-1` etc. are reused across
 * many fixtures in events.test.ts). */
export function _resetThrottleForTests(): void {
	for (const state of throttleStates.values()) {
		if (state.timer !== null) clearTimeout(state.timer);
	}
	throttleStates.clear();
}

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
	// "cluster|namespace|deploymentName" — a `deployment-children` entry this
	// module can name exactly.
	const deploymentChildrenTargets = new Set<string>();
	// "cluster|namespace" — every `deployment-children` entry in the
	// namespace, for a ReplicaSet event that can't be traced to one owner.
	const deploymentChildrenNamespaces = new Set<string>();
	// "cluster|namespace" — a Deployment event also affects the rollout's
	// `managed-resources` entry (it is one of the resources that list
	// inventories), matched by namespace+cluster only since the event names
	// the Deployment, not the rollout that owns the Kustomization.
	const managedResourcesNamespaces = new Set<string>();
	let scheduleChanged = false;

	for (const ev of events) {
		if (!KNOWN_KINDS.has(ev.kind) && !EVENT_TAG_KINDS.has(ev.kind)) continue;

		// "Patchable" = a delete (identity alone is enough to remove an
		// entry) or an add/update that actually carries the changed object.
		// Everything else falls through to the exact invalidate behavior
		// this module had before objects existed — see the "PATCH, NOT
		// INVALIDATE" block above.
		const patchable = ev.type === 'delete' || !!ev.object;

		// ⭐ FLEET LIST — deliberately NOT cluster-scoped. `['rollouts','all']`
		// and the per-namespace fleet lists aggregate every cluster in one
		// response, so ANY cluster's Rollout/Kustomization/Environment/
		// KruiseRollout/RolloutDependency event must reach them.
		if (FLEET_LIST_KINDS.has(ev.kind) && ev.namespace) {
			if (patchable) patchFleetListCaches(queryClient, ev);
			else fleetNamespaces.add(ev.namespace);
		}

		if (ROLLOUT_EXACT_KINDS.has(ev.kind) && ev.namespace && ev.name) {
			// A Rollout delete has nothing to patch WITH (see
			// `patchRolloutExactCache`'s own doc) — it stays on the
			// invalidate set even though `patchable` is true for deletes
			// everywhere else in this function.
			if (ev.type !== 'delete' && ev.object) patchRolloutExactCache(queryClient, ev);
			else rolloutExact.add(`${ev.cluster}|${ev.namespace}|${ev.name}`);
		}
		if (ROLLOUT_NAMESPACE_KINDS.has(ev.kind) && ev.namespace) {
			// Only Kustomization/Environment/KruiseRollout are embedded in
			// `RolloutResponse` (`EMBEDDABLE_IN_ROLLOUT_DETAIL`) —
			// RolloutDependency isn't, so it always falls to the namespace
			// invalidate below, patchable or not (see
			// `patchRolloutComposite`'s own doc).
			if (patchable && EMBEDDABLE_IN_ROLLOUT_DETAIL.has(ev.kind)) {
				patchRolloutCompositeCaches(queryClient, ev);
			} else {
				rolloutNamespaces.add(`${ev.cluster}|${ev.namespace}`);
			}
		}

		if (HEALTH_CHECK_KINDS.has(ev.kind) && ev.namespace) {
			if (patchable) {
				if (!patchHealthCheckCaches(queryClient, ev)) {
					healthCheckTargets.add(`${ev.cluster}|${ev.namespace}`);
				}
			} else {
				healthCheckTargets.add(`${ev.cluster}|${ev.namespace}`);
			}
		}
		if (ROLLOUT_TEST_KINDS.has(ev.kind) && ev.namespace) {
			rolloutTestTargets.add(`${ev.cluster}|${ev.namespace}`);
		}
		if (EVENT_TAG_KINDS.has(ev.kind) && ev.namespace) {
			eventsTargets.add(`${ev.cluster}|${ev.namespace}`);
		}
		if (KUSTOMIZATION_KINDS.has(ev.kind) && ev.namespace && ev.name) {
			kustomizationTargets.push({ cluster: ev.cluster, namespace: ev.namespace, name: ev.name });
			// ⭐ NEW — `RolloutResponse.kustomizations` was never on the
			// namespace-invalidate fallback (see `EMBEDDABLE_IN_ROLLOUT_DETAIL`'s
			// doc), so there is no existing behavior to preserve here: only
			// ADD the patch when it's free (object present or a delete), and
			// change nothing when it isn't.
			if (patchable) patchRolloutCompositeCaches(queryClient, ev);
		}

		// ⭐ DEPLOYMENT-CHILDREN / MANAGED-RESOURCES — see the
		// `DEPLOYMENT_KINDS`/`REPLICASET_KINDS` doc comment above for why a
		// Deployment event stays invalidate-only for BOTH (kstatus can't be
		// recomputed client-side) while a ReplicaSet event's counts are
		// patched directly, below.
		if (DEPLOYMENT_KINDS.has(ev.kind) && ev.namespace && ev.name) {
			deploymentChildrenTargets.add(`${ev.cluster}|${ev.namespace}|${ev.name}`);
			// A Deployment is one of the resources `managed-resources` lists —
			// the event names the Deployment, not the rollout/Kustomization
			// that owns it, so this falls back to every `managed-resources`
			// entry in the same namespace+cluster (same shape as
			// `ROLLOUT_NAMESPACE_KINDS`'s own namespace fallback above).
			managedResourcesNamespaces.add(`${ev.cluster}|${ev.namespace}`);
		}
		if (REPLICASET_KINDS.has(ev.kind) && ev.namespace) {
			const ownerName = replicaSetOwnerDeployment(ev.object as K8sObject | undefined);
			if (ownerName) {
				// Counts patched in place right away — see
				// `patchReplicaSetChildrenCaches`'s own doc comment for exactly
				// which fields and why. The throttled invalidate below is what
				// still catches the pods list and any brand-new ReplicaSet this
				// cache doesn't know about yet.
				patchReplicaSetChildrenCaches(queryClient, ev, ownerName);
				deploymentChildrenTargets.add(`${ev.cluster}|${ev.namespace}|${ownerName}`);
			} else {
				// No object (delete, or dropped for size) — can't name the
				// owner, so invalidate every deployment's children in this
				// namespace+cluster rather than silently doing nothing.
				deploymentChildrenNamespaces.add(`${ev.cluster}|${ev.namespace}`);
			}
		}

		// ⚠️ SCHEDULES STAY INVALIDATE-ONLY — NOT AN OVERSIGHT.
		// `rollout-schedule-window` caches a REDUCTION (`{blocked,
		// nextTransition, names}`), not the raw schedule list a single
		// event's object could be folded into — a schedule flipping from
		// blocking to non-blocking can't be applied without knowing
		// whether some OTHER schedule for the same rollout is still
		// blocking, which this module was never told. `network-schedules`
		// DOES cache the raw per-cluster lists `fetchNetworkSchedules`
		// returns, but its Map is keyed by the string each CALLER passed
		// in (`''` for the hub-local cluster — see `schedules.ts`'s own
		// doc comment), while `ChangeEvent.cluster` is always the hub's
		// REAL display name for a hub-local event, never `''` (this
		// file's own top comment). There is no oracle here for "is this
		// event's cluster the same one as the Map's `''` entry" without
		// guessing — and guessing wrong would patch one cluster's list
		// with another cluster's schedule, the exact cross-cluster
		// corruption this module's cluster-scoped predicates exist to
		// prevent everywhere else. Schedules change far less often than
		// Rollout/HealthCheck status (a business-hours toggle, not a
		// 30s probe write), so the safety net this leaves in place costs
		// little.
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

	// ⭐ THROTTLED, PER TARGET — not one batched `invalidateQueries` call for
	// the whole Set. `throttledInvalidate` collapses a burst of events for
	// the SAME target into one trailing refetch, but two DIFFERENT targets
	// (two unrelated deployments, say) must not throttle each other — each
	// gets its own key and its own independent leading/trailing timer.
	for (const target of deploymentChildrenTargets) {
		throttledInvalidate(queryClient, `deployment-children|${target}`, CHURN_THROTTLE_MS, () => {
			queryClient.invalidateQueries({
				predicate: (query) => {
					const key = query.queryKey;
					// ['deployment-children', cluster, namespace, name] — cluster at
					// index 1, not last (see `deploymentChildrenQueryKey`'s own doc
					// in rollouts.ts for why the position differs from every other
					// key tag in this file).
					if (key.length < 4 || key[0] !== 'deployment-children') return false;
					const cluster = (key[1] as string | undefined) ?? '';
					const ns = key[2] as string;
					const depName = key[3] as string;
					return `${cluster}|${ns}|${depName}` === target;
				}
			});
		});
	}
	for (const target of deploymentChildrenNamespaces) {
		throttledInvalidate(queryClient, `deployment-children-ns|${target}`, CHURN_THROTTLE_MS, () => {
			queryClient.invalidateQueries({
				predicate: (query) => {
					const key = query.queryKey;
					if (key.length < 4 || key[0] !== 'deployment-children') return false;
					const cluster = (key[1] as string | undefined) ?? '';
					const ns = key[2] as string;
					return `${cluster}|${ns}` === target;
				}
			});
		});
	}

	for (const target of managedResourcesNamespaces) {
		throttledInvalidate(queryClient, `managed-resources|${target}`, CHURN_THROTTLE_MS, () => {
			queryClient.invalidateQueries({
				predicate: (query) => {
					const key = query.queryKey;
					// ['managed-resources', rolloutNamespace, rolloutName, cluster, kustomizationNames[]]
					if (key.length < 4 || key[0] !== 'managed-resources') return false;
					const ns = key[1] as string;
					const cluster = (key[3] as string | undefined) ?? '';
					return `${cluster}|${ns}` === target;
				}
			});
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
	// `deployment-children`/`managed-resources` throttle state is module-level
	// too (see `throttledInvalidate`) — reset it here so one test's churn on
	// a target string doesn't bleed into the next test that reuses it.
	_resetThrottleForTests();
}
