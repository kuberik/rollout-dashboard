/**
 * THE MOCK'S MUTABLE STATE — "the mock does something when you press it."
 * (2026-09-12, demo-mode, LANE 1.)
 *
 * Every other file under `./demo` treats the mock as read-only: `respond()`
 * answers the same JSON forever, so a promo take could press "Retry deploy"
 * a hundred times and the page would never move. This module is the one
 * place that ACTUALLY MUTATES three rollouts' state in memory (hello-world,
 * checkout-api, checkout-worker — see `FIXTURES` below), schedules the
 * follow-up transitions a real deploy would produce, and pushes real
 * `changes` events on the already-open `/api/events/stream` so the client's
 * OWN cache-invalidation logic (`src/lib/api/events.ts`) does the refetch —
 * one source of truth, never a second "optimistic" copy of the same fact.
 *
 * ⛔ NOTHING NODE-SPECIFIC MAY ENTER THIS FILE — same rule as `mock-data.ts`
 * and `respond.ts`: it is bundled into the browser by the demo build.
 *
 * ⭐ WHY ONLY THREE ROLLOUTS ARE "LIVE". The film visits exactly three:
 * `default/hello-world` (promote / change version), `checkout-api-prod-us-
 * east-2/checkout-api` (promote / change version, and the rollout Home
 * offers "Promote now" on with no buttons today), and `checkout-worker-
 * staging/checkout-worker` (the failed card whose "Retry deploy" link needs
 * somewhere real to land). Every other fixture (dependencies, multi-region,
 * high-frequency) stays exactly what `mock-data.ts` already exports —
 * frozen, and correctly so: the film never presses a button on them.
 *
 * ⭐ RESET IS BYTE-FOR-BYTE, NOT "GOOD ENOUGH". The film re-runs takes
 * against one long-lived dev server (the capture instance's clock is pinned
 * to a fixed `MOCK_NOW`, so every `hcAgo(n)` call below is deterministic
 * across the whole session) — a mutation left over between takes would make
 * take 2 open on take 1's already-deployed state. `resetDemoState()`
 * rebuilds every live fixture from its `mk*()` factory (never a cached
 * clone), which is what makes "byte-for-byte" free: the factories are pure
 * functions of the pinned clock, so calling one twice is not "restore a
 * snapshot", it is "get the same answer again".
 */

import { approvalWrite, approvalUnwrite } from '../view-models/approval-write';
import {
	NAMESPACE,
	ROLLOUT_NAME,
	KUSTOMIZATION_NAMESPACE,
	KUSTOMIZATION_NAME,
	mockRolloutResponse,
	mockHealthChecks,
	mockManagedResources,
	mockFleetRollouts,
	mockDepRollouts,
	mkHwvRollouts,
	mkHwvEnvironments,
	hcAgo,
	hcNow,
	reanchorClock
} from './mock-data';
import {
	CK_NAMESPACE,
	CK_NAME,
	CK_CLUSTER,
	CK_KUSTOMIZATION_NAME,
	mkCkDetail,
	mkCkHealthChecks,
	mkCkEvents,
	mkCkManagedResources,
	CW_NAMESPACE,
	CW_NAME,
	CW_CLUSTER,
	mkCwDetail,
	mkCwHealthChecks,
	mkCwEvents,
	mkCwManagedResources,
	mkHelloWorldEvents
} from './mock-details';
import {
	HW_APP_NAME,
	HW_NAMESPACE,
	HW_CLUSTER,
	HW_GATE_NAME,
	mkHwDetail,
	mkHwHealthChecksFor,
	mkHwEventsFor,
	mkHwManagedResourcesFor,
	mkHwEnvironment
} from './mock-promote';
import { resetDepsStory, runDepsStep, replaceHwvEnvironments, type DepsStep } from './deps-story';
import { resetWavesStory, setWavesStep, wavesPlaces, type WavesStep } from './waves-story';
import type { MockSend } from './respond';

// ─────────────────────────────────────────────────────────────────────────
// SUBSCRIBER REGISTRY — every open `/api/events/stream` connection, across
// both adapters (the dev middleware, one per browser tab, and the demo
// build's in-browser shim). `respond.ts`'s stream `start()` registers here
// and its teardown MUST call the returned unregister function — see that
// file's own SSE block. Forgetting it is exactly the shape of leak
// `vite.config.ts`'s dev-proxy note warns about (1038 subscribers, 4.6 GB).
// ─────────────────────────────────────────────────────────────────────────

const subscribers = new Set<MockSend>();

export function registerStreamSubscriber(send: MockSend): () => void {
	subscribers.add(send);
	return () => {
		subscribers.delete(send);
	};
}

type DemoChangeEvent = {
	type: 'add' | 'update' | 'delete';
	kind: string;
	namespace: string;
	name: string;
	cluster: string;
	resourceVersion: string;
	ts: number;
	// Deliberately no `object` field — see this file's own top comment and
	// `respond.ts`'s SSE block: the client's `applyChangeEvents` treats an
	// object-less event as "go refetch this", which is exactly what a
	// mutation here wants (one source of truth: the JSON this module holds).
};

function broadcastChanges(events: DemoChangeEvent[]): void {
	if (events.length === 0) return;
	const frame = `event: changes\ndata: ${JSON.stringify(events)}\n\n`;
	for (const send of subscribers) {
		try {
			send(frame);
		} catch {
			// A dead subscriber is cleaned up by its own stream's `cancel`/
			// `close` teardown (see `respond.ts`), not from here.
		}
	}
}

let rv = 0;
function nextRv(): string {
	rv += 1;
	return String(rv);
}

function broadcastRollout(namespace: string, name: string, cluster: string, at: Date): void {
	broadcastChanges([
		{
			type: 'update',
			kind: 'Rollout',
			namespace,
			name,
			cluster,
			resourceVersion: nextRv(),
			ts: at.getTime()
		}
	]);
}

/**
 * `applyChangeEvents`' `HEALTH_CHECK_KINDS` branch invalidates
 * `['health-checks', ROLLOUT_namespace, rolloutName, cluster]` by matching
 * `ev.namespace` against the cache key's ROLLOUT namespace (see
 * `+page.svelte`'s `healthChecksQuery`) — not the HealthCheck object's own
 * `metadata.namespace`, which in these fixtures is the APP namespace and can
 * differ from the Rollout's. `rolloutNamespace` here is deliberately the
 * ROLLOUT's namespace for exactly that reason.
 */
function broadcastHealthChecks(
	items: { metadata?: { name?: string } }[],
	rolloutNamespace: string,
	cluster: string,
	at: Date
): void {
	if (items.length === 0) return;
	broadcastChanges(
		items.map((hc) => ({
			type: 'update',
			kind: 'HealthCheck',
			namespace: rolloutNamespace,
			name: hc.metadata?.name ?? 'health-check',
			cluster,
			resourceVersion: nextRv(),
			ts: at.getTime()
		}))
	);
}

// ─────────────────────────────────────────────────────────────────────────
// TIMERS — every scheduled transition below goes through `schedule()` so
// `resetDemoState()` can cancel every pending one. A timer that outlives a
// reset is a determinism bug: the NEXT take would see a transition fire
// mid-scene that the previous take triggered.
// ─────────────────────────────────────────────────────────────────────────

const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

/** Started-at (wall clock) per rollout whose gate sequence is running — the
 *  idempotence flag AND what `/api/demo/now`'s `gate` field reports. Declared
 *  up here with the timers it schedules because `resetDemoState()` runs at
 *  module load and clears it; a `const` declared further down would still be
 *  in its temporal dead zone at that point. See `runGateSequence`. */
const gateStartedAt = new Map<string, number>();

/** Same temporal-dead-zone reason as `gateStartedAt` above — `resetDemoState`
 *  clears this at module load, so it has to be declared before that call
 *  runs, not down beside `stepPromoteGate` where it's used. See that
 *  function's own doc comment. */
const promoteStepsDone = new Set<string>();

function schedule(fn: () => void, ms: number): void {
	const t = setTimeout(() => {
		pendingTimers.delete(t);
		fn();
	}, ms);
	pendingTimers.add(t);
}

function cancelAllTimers(): void {
	for (const t of pendingTimers) clearTimeout(t);
	pendingTimers.clear();
}

// ─────────────────────────────────────────────────────────────────────────
// THE DEMO CLOCK — anchored to `hcNow`, never to wall-clock `Date.now()`.
//
// ⭐ CORRECTION (tl-dashboard-demo-2, 2026-09-12): `hcNow`/`hcAgo` in
// `mock-data.ts` are evaluated ONCE, at module load — i.e. at the pinned
// `MOCK_NOW` instant the capture server started. A mutation that stamped
// `new Date()`/`Date.now()` at REQUEST time was measured drifting **12.5
// hours** ahead of every other timestamp on the page, because the capture
// server had simply been up that long — wall-clock time keeps moving even
// though the fixtures' own clock is pinned. Every timestamp this module
// writes is `hcNow` plus a small, monotonically increasing offset instead —
// enough for a settle step to sort after the deploy step that scheduled it,
// never enough to drift toward the real wall clock.
// ─────────────────────────────────────────────────────────────────────────

let demoClockOffsetMs = 0;

/**
 * ⭐ SELF-HEALING FOR A SERVER NOBODY RESET (U-3, 2026-10-08). A capture
 * resets right before it runs, so `hcNow` is always fresh there and this
 * never fires. A dev server left running across a long session is not so
 * disciplined — see `reanchorClock`'s own note in `mock-data.ts`. Once the
 * anchor has drifted more than a gate/retry/rollback's own settle window
 * could ever legitimately need, treat it as stale and snap it back to the
 * real wall clock before stamping anything new, so "this just started" and
 * "an hour ago" cannot both be true of the same timestamp.
 */
const CLOCK_STALE_MS = 10 * 60_000;

/**
 * ⭐ SHARED BY EVERY READER, NOT JUST MUTATIONS (U-4 class, 2026-10-09).
 * This used to live only inside `demoNow()`, so a GET-only session (nobody
 * ever promotes/retries/gates anything — exactly the calm story) never
 * self-healed: `hcNow` stayed pinned at whatever `resetDemoState()` last
 * saw, forever, while every `*-restamp-on-read helper below
 * (`freshenInFlight`, `freshenCandidateAge`) measures age OFF `hcNow`. A
 * passive reader calling `peekDemoClock()` now gets the same self-heal a
 * mutation already got, which is what keeps those two helpers' "N minutes/
 * hours ago" ceilings meaningful on a long-lived, idle dev server.
 */
function ensureClockFresh(): void {
	if (Date.now() - hcNow.getTime() > CLOCK_STALE_MS) {
		reanchorClock();
		demoClockOffsetMs = 0;
	}
}

function demoNow(): Date {
	ensureClockFresh();
	demoClockOffsetMs += 1_000;
	return new Date(hcNow.getTime() + demoClockOffsetMs);
}

/** The demo clock's current instant WITHOUT advancing it — for a `ts` field
 * riding alongside a stamp `demoNow()` just produced in the same step.
 * ⭐ NOT EXPORTED (logs round 7: briefly exported for the logs SSE handlers
 * in respond.ts to stamp with instead of `Date.now()`, on the theory that
 * the capture harness pins the page clock to this one — reverted,
 * squad-rollout lead's ruling: the owner reviews in a plain browser, where
 * a demo-clock line can trail the real clock by minutes and read as dead;
 * the capture case is handled on the histogram's own side instead, not by
 * changing what the mock stamps). Back to module-private; nothing outside
 * this file calls it. */
function peekDemoClock(): Date {
	ensureClockFresh();
	return new Date(hcNow.getTime() + demoClockOffsetMs);
}

/** `GET /api/demo/now` (respond.ts) — the capture harness pins the page's
 * clock from this instead of a hardcoded literal, so it always agrees with
 * whatever this module has actually stamped so far. `scenario` rides along
 * so the harness (and a curl probe) can see which fleet is currently being
 * served without a separate round trip. */
export function demoClockSnapshot(): {
	now: string;
	anchor: string;
	scenario: Scenario;
	gate?: number;
} {
	const gate = gateElapsedMs();
	return {
		now: peekDemoClock().toISOString(),
		anchor: hcNow.toISOString(),
		scenario,
		// Wall-clock milliseconds since `runGateSequence` started, so a capture
		// script can wait on the beat it wants instead of counting its own
		// sleeps. Absent until the sequence is called, and cleared by a reset.
		...(gate === undefined ? {} : { gate })
	};
}

// ─────────────────────────────────────────────────────────────────────────
// THE PENDING COUNTDOWN — on the DEMO clock (`peekDemoClock()`), the same
// clock domain every other timestamp in this file uses, and deliberately NOT
// `Date.now()`. (2026-09-21, film critic finding: a `Pending` check's
// sub-line read `evaluating alert state · next probe in 12s` as a STRING
// baked in at fixture-build time — the same number forever, however long the
// row sat on screen.)
//
// This looks backwards next to "THE DEMO CLOCK" section above, which warns
// that `hcNow` drifts from real wall time on a long-lived dev server — and
// it would be backwards, IF `$now` (`lib/stores/time.ts`) read the demo
// clock. It does not: `$now` is plain `new Date()`, real wall time, with no
// knowledge of `hcNow` at all. That is exactly why every OTHER timestamp
// this module stamps (`lastChangeTime`, `bakeStartTime`, …) already has the
// identical drift problem for a reader with an unpinned browser, and the
// product's own fix for it has never been "stop using the demo clock" — it
// is "the capture harness pins the browser's clock to `/api/demo/now` before
// recording", exactly what this feature's own verification does too
// (measured live: port 5181's demo clock was 16h+ behind real wall time from
// staying up — a `nextProbeAt` stamped from `Date.now()` would show a
// countdown of tens of thousands of seconds the instant that pinned browser
// loaded the page, while one stamped from `peekDemoClock()` agrees with the
// pinned clock by construction). A long-uptime, UNPINNED session is a
// pre-existing, accepted limitation of this whole mock, not a new one this
// feature introduces.
//
// ⚠️ THIS BLOCK MUST STAY ABOVE `resetDemoState`'S DEFINITION-TIME CALL SITE
// (the bare `resetDemoState();` a little further down). `armFreshPendingProbes`
// is a hoisted function declaration so calling it early is fine, but the
// `const PENDING_PROBE_INTERVAL_MS` it closes over is NOT initialized until
// its own line runs — declaring it AFTER `resetDemoState();`'s call produced
// `RangeError: Invalid time value` (`undefined + ms` → `NaN` → an invalid
// `Date`) the first time this shipped, caught by the test suite itself
// refusing to even load.
// ─────────────────────────────────────────────────────────────────────────

const PENDING_PROBE_INTERVAL_MS = 12_000;

/**
 * Seeds `nextProbeAt` on any `Pending` check that doesn't already carry one —
 * called once per fixture on every `resetDemoState()`, so a fresh reset (or
 * server start) always opens on a countdown that has just begun, never one
 * already stale from a previous run. Never overwrites a value already set.
 */
function armFreshPendingProbes(bundle: HealthChecksBundle): void {
	const at = peekDemoClock();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const hc of bundle.healthChecks as any[]) {
		if (hc.status?.status === 'Pending' && !hc.status.nextProbeAt) {
			hc.status.nextProbeAt = new Date(at.getTime() + PENDING_PROBE_INTERVAL_MS).toISOString();
		}
	}
}

/**
 * ⭐ ARMED AT THE START OF A TRANSITION, NEVER FROM INSIDE ITS OWN
 * `schedule()` CALLBACK. The countdown has to be visible for its whole
 * duration — `runGateSequence`, `changeVersion` and `retryRollout` each know,
 * the instant they are called, exactly how long their own health-check flip
 * will take (`GATE_CHECK_MS`/`PROMOTE_HEALTH_MS`/`RETRY_SETTLE_MS`), so each
 * arms the fixture's one `Pending` check to that same delay before
 * scheduling anything — the row's own countdown reaches zero in the same
 * frame the flip actually happens instead of disagreeing with it.
 */
function armPendingProbe(f: LiveFixture, delayMs: number, namespace: string, cluster: string): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const pending = (f.healthChecks.healthChecks as any[]).find((hc) => hc.status?.status === 'Pending');
	if (!pending) return;
	const at = peekDemoClock();
	pending.status.nextProbeAt = new Date(at.getTime() + delayMs).toISOString();
	broadcastHealthChecks([pending], namespace, cluster, at);
}

// ─────────────────────────────────────────────────────────────────────────
// FIXTURES — the three rollouts this module actually mutates.
// ─────────────────────────────────────────────────────────────────────────

type DetailBundle = Record<string, unknown>;
type HealthChecksBundle = { healthChecks: Record<string, unknown>[] };
type EventsBundle = { events: Record<string, unknown>[] };

interface FixtureDef {
	namespace: string;
	name: string;
	/** Used when the request has no `/api/clusters/<cluster>/` prefix (e.g. a
	 * curl against a single-cluster dev server) — see `extractClusterHint` in
	 * `respond.ts`, which supplies the real thing whenever the URL carries it. */
	cluster: string;
	kustomizationKey: string;
	buildDetail: () => DetailBundle;
	buildHealthChecks: () => HealthChecksBundle;
	buildEvents: () => EventsBundle;
	buildManagedResources: () => Record<string, unknown>[];
}

/**
 * ⭐ THE ROLLOUT PAGE READS `status.releaseCandidates` DIRECTLY, NEVER
 * `availableReleases`. Discovered live: adding only `availableReleases` to
 * hello-world/checkout-api left "Newer builds" printing "No newer build to
 * deploy right now" exactly as before, and no per-candidate `Deploy` button
 * — `+page.svelte` (`releaseCandidates.length === 0` branches, ~line 3290)
 * never falls back to deriving one from `availableReleases` the way
 * `promotion.ts` does for OTHER surfaces (env-rank, the fleet cards).
 * `releaseCandidates` is the backend's own field, NEWEST-FIRST (see
 * `promotion.ts`'s own doc comment) — this recomputes it from
 * `availableReleases` (this module's oldest-first convention, matching the
 * real API) every time `currentVersion` changes, so a promote's next paint
 * shows one fewer candidate rather than a stale list still naming the build
 * that was just deployed.
 */
function recomputeReleaseCandidates(rollout: {
	status: { currentVersion?: string; availableReleases?: unknown[]; releaseCandidates?: unknown[] };
}): void {
	const releases = rollout.status.availableReleases as { tag: string }[] | undefined;
	if (!releases) return;
	const idx = releases.findIndex((r) => r.tag === rollout.status.currentVersion);
	const newer = idx === -1 ? releases.slice() : releases.slice(idx + 1);
	rollout.status.releaseCandidates = [...newer].reverse();
}

/** `mockRolloutResponse` predates this module and has no `availableReleases`
 * at all — "Newer builds" read "No newer build to deploy right now" and
 * Change Version read "No versions available" (task B). Adds the current
 * `f68d0ac` plus one older and one NEWER build, on a fresh `structuredClone`
 * so the shared export in `mock-data.ts` is never touched. */
function buildHwDetail(): DetailBundle {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const detail = structuredClone(mockRolloutResponse) as any;
	// ⭐ `revision` IS NOT DECORATION — IT IS WHAT MAKES THE DEPLOY DIALOG
	// ABLE TO ASK GITHUB ANYTHING. (2026-09-13, tl-dashboard-demo-2.)
	// `revisionFor()` (version-utils) resolves a build's git sha off exactly
	// this field; with it absent, `ChangeVersionModal` prints "No commit
	// revision known for this build — the commit list is unavailable" where
	// the commits to deploy belong — measured live, in the dialog a film
	// records. These fixtures' tags ARE the shas, so the two agree by
	// construction and the range handed to `/commits` is one the GitHub
	// fixtures have a real answer for.
	detail.rollout.status.availableReleases = [
		{ tag: 'a1b2c3d', version: 'a1b2c3d', revision: 'a1b2c3d', created: hcAgo(120) },
		{ tag: 'f68d0ac', version: 'f68d0ac', revision: 'f68d0ac', created: hcAgo(16) },
		{ tag: 'e2c9b47', version: 'e2c9b47', revision: 'e2c9b47', created: hcAgo(5) }
	];
	recomputeReleaseCandidates(detail.rollout);
	/**
	 * ⭐ THE `promote` SCENARIO'S CHAIN (2026-09-21, mock-promote.ts). dev's own
	 * `environment` field used to be a standalone literal with no
	 * `spec.rolloutRef` — fine for THIS page (only the place key (`placeKey`, sites-waves) and `label`
	 * were ever read here) but invisible to `groupRolloutsByApp`, which keys
	 * on `rolloutRef.name`. Swapped for the shared factory so dev joins the
	 * SAME app group as `hello-world-staging`/`hello-world-prod` on
	 * `/environments` — one Environment object, not two competing shapes for
	 * the same rollout.
	 */
	detail.environment = mkHwEnvironment('dev');
	return detail as DetailBundle;
}

const FIXTURES: FixtureDef[] = [
	{
		namespace: NAMESPACE,
		name: ROLLOUT_NAME,
		cluster: 'dev',
		kustomizationKey: `${KUSTOMIZATION_NAMESPACE}/${KUSTOMIZATION_NAME}`,
		buildDetail: buildHwDetail,
		buildHealthChecks: () => structuredClone(mockHealthChecks),
		buildEvents: () => mkHelloWorldEvents(ROLLOUT_NAME),
		buildManagedResources: () => structuredClone(mockManagedResources.managedResources)
	},
	{
		namespace: CK_NAMESPACE,
		name: CK_NAME,
		cluster: CK_CLUSTER,
		kustomizationKey: `${CK_NAMESPACE}/${CK_KUSTOMIZATION_NAME}`,
		buildDetail: () => {
			const detail = mkCkDetail();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			recomputeReleaseCandidates((detail as any).rollout);
			return detail;
		},
		buildHealthChecks: mkCkHealthChecks,
		buildEvents: mkCkEvents,
		buildManagedResources: mkCkManagedResources
	},
	{
		namespace: CW_NAMESPACE,
		name: CW_NAME,
		cluster: CW_CLUSTER,
		kustomizationKey: `${CW_NAMESPACE}/${CW_NAME}`,
		buildDetail: () => {
			const detail = mkCwDetail();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			recomputeReleaseCandidates((detail as any).rollout);
			return detail;
		},
		buildHealthChecks: mkCwHealthChecks,
		buildEvents: mkCwEvents,
		buildManagedResources: mkCwManagedResources
	},
	/**
	 * ⭐ THE `promote` SCENARIO'S TWO NEW LIVE FIXTURES (2026-09-21,
	 * mock-promote.ts). `hello-world-staging/hello-world` is what
	 * `stepPromoteGate` (below) promotes automatically once dev's own gate
	 * fixture clears; `hello-world-prod/hello-world` completes the chain on
	 * `/environments` (held `after staging`) but is not itself part of the
	 * stepped beat.
	 */
	{
		namespace: HW_NAMESPACE.staging,
		name: HW_APP_NAME,
		cluster: HW_CLUSTER.staging,
		kustomizationKey: `${HW_NAMESPACE.staging}/${HW_APP_NAME}`,
		buildDetail: () => {
			const detail = mkHwDetail('staging');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			recomputeReleaseCandidates((detail as any).rollout);
			return detail;
		},
		buildHealthChecks: () => mkHwHealthChecksFor('staging'),
		buildEvents: () => mkHwEventsFor('staging'),
		buildManagedResources: () => mkHwManagedResourcesFor('staging')
	},
	{
		namespace: HW_NAMESPACE.prod,
		name: HW_APP_NAME,
		cluster: HW_CLUSTER.prod,
		kustomizationKey: `${HW_NAMESPACE.prod}/${HW_APP_NAME}`,
		buildDetail: () => {
			const detail = mkHwDetail('prod');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			recomputeReleaseCandidates((detail as any).rollout);
			return detail;
		},
		buildHealthChecks: () => mkHwHealthChecksFor('prod'),
		buildEvents: () => mkHwEventsFor('prod'),
		buildManagedResources: () => mkHwManagedResourcesFor('prod')
	}
];

interface LiveFixture {
	def: FixtureDef;
	detail: DetailBundle;
	healthChecks: HealthChecksBundle;
	events: EventsBundle;
}

const fixtureKey = (namespace: string, name: string): string => `${namespace}/${name}`;

export type MockApproval = { name: string; version: string; by?: string; createdAt: string };
/** declared before `resetDemoState()` runs at module load (see the mock of the approvals API below) */

/** the viewer, as the API server names them (`oidc:` + login) */
export const MOCK_APPROVER = 'oidc:danielreed';
/** the fixtures' second and third approvers: western names, as every demo person has */
export const MOCK_APPROVERS = { dashboard: 'oidc:wyatt', git: 'github-actions' } as const;
const approvalsByRollout = new Map<string, MockApproval[]>();
const live = new Map<string, LiveFixture>();
const managedResourcesByKey = new Map<string, Record<string, unknown>[]>();

// ─────────────────────────────────────────────────────────────────────────
// THREE SCENARIOS, SWITCHABLE AT RUNTIME (2026-09-13, tl-dashboard-demo-2;
// `wide` added 2026-10-09, round 5 QA-5 item 2, changes-slug lane).
//
// "A failure may be shown once, near the end, otherwise whoever is looking
// at this will think it's all broken." The film and every embedded landing
// demo must be able to open on a fleet with NOTHING on fire, and switch to
// exactly one incident on cue.
//
//   CALM (the default on module load — every take starts here unless asked
//   otherwise): zero `Failed` rollouts anywhere in `/api/rollouts` — Home's
//   "Needs you now", `/environments`' banner, `/activity`'s red banner and
//   its `N failed` counts, `/rollouts`' chips, every history row and every
//   mark on the 1D/7D/30D charts all read clean, because every one of them
//   is DERIVED client-side from the same rollout objects this transforms.
//   The stuck "Promote now" card (checkout-api prod-us-east-2, `InProgress`
//   past `detectStuck`'s threshold) and the one held dependency are left
//   alone — those are WAITING states, not errors, and the transform below
//   only ever touches `bakeStatus === 'Failed'`.
//
//   INCIDENT: exactly one failing rollout, checkout-worker in staging (the
//   one `retryRollout` fixes) — everything else exactly as calm.
//
// ⭐ A TRANSFORM OVER THE FIXTURES AT RESET TIME, NEVER A REWRITE OF THEM.
// `mock-data.ts` below `export const FLEET` is another lane's region, being
// actively rewritten — this never edits `FLEET`/`HF_LANES`/`MR_LANES`/
// `CK_BAKE`/etc., it walks the ALREADY-BUILT `mockFleetRollouts`/
// `mockDepRollouts` arrays (plus this module's own three live fixtures) on
// every reset and produces a scenario-adjusted CLONE, so a future rewrite of
// those fixtures upstream is picked up automatically on the next reset.
//
// ⭐ EXACTLY WHICH ROWS DIFFER, so the film knows what changes when it
// switches (verified live — see this lane's report):
//   - `checkout-worker-staging/checkout-worker`'s head history entry:
//     `bakeStatus` `Failed` (incident) vs `Succeeded` (calm), plus
//     `bakeStatusMessage`/`failedHealthChecks` present vs absent.
//   - its `checkout-worker-prometheus-high-error-rate` health check:
//     `Unhealthy` (incident) vs `Healthy` (calm).
//   - ANY OTHER `Failed` HEAD entry the underlying fixtures happen to carry
//     (today: `checkout-api-prod-af-south-1`'s head entry, from `CK_BAKE`'s
//     own `'prod-af-south-1': 'Failed'`) becomes `Succeeded` in EVERY
//     scenario — only checkout-worker/staging (incident, wide) and
//     telemetry-forwarder/prod (wide only) are exceptions.
//   - ⭐ ROUND 3 (2026-10-09, coordinator ruling): A FAILED ENTRY BELOW THE
//     HEAD IS NEVER HEALED, in any scenario — "history must never rewrite a
//     past failure." `healRolloutFailures` only ever reads/writes
//     `history[0]`. `checkout-edge-prod`'s own inserted Failed+rollback
//     pair (lane H, `mock-data.ts`) and `orders-api/dev`'s documented
//     03:00 historical incident both survive a reset in every scenario.
//   - nothing else changes: `InProgress`/`Deploying`/`Cancelled` entries,
//     every `Pending` health check (hello-world's and checkout-api's, which
//     the promote demo flips), and the held dependency are untouched by
//     any scenario.
//
//   WIDE (added round 5 QA-5 item 2, changes-slug lane; review-only, never
//   the film's own default) — incident's own state PLUS
//   `telemetry-forwarder/prod` FAILED. Exists for exactly one reason:
//   `LandingGrid`'s one-fill-per-row rule needs a genuine FAILING cell to
//   review on the platform-telemetry PR (`danger-tint` fill, principle 14's
//   adverse case) — forcing it into `incident` broke that scenario's own
//   rule ("exactly one failure, checkout-worker"), so it gets its own named
//   scenario instead of stretching `incident`'s contract to cover a second,
//   unrelated failure. `?scenario=wide` on the reset route; never fired by
//   the film or any landing capture script.
// ─────────────────────────────────────────────────────────────────────────

export type Scenario = 'calm' | 'incident' | 'wide';

/** Default on module load is `calm` — tl-dashboard-demo-2's call: most of the
 * film and every embedded demo should open on a fleet with nothing on fire.
 *
 * `MOCK_SCENARIO` (dev server only) picks the boot scenario instead. Vite
 * restarts the mock server on every edit under `lib/demo/`, and a restart
 * used to drop a reviewer's `incident` server back to `calm` mid-session — it
 * read as the incident "healing itself" (squad-rollout, 2026-10-10). A reset
 * still switches it at runtime. The browser demo build has no `process`, so
 * it always boots `calm`. */
export function bootScenario(env: Record<string, string | undefined> | undefined): Scenario {
	const v = env?.MOCK_SCENARIO;
	return v === 'incident' || v === 'wide' || v === 'calm' ? v : 'calm';
}
let scenario: Scenario = bootScenario(
	typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : undefined
);

type HistoryLike = { bakeStatus?: string; bakeStatusMessage?: string; failedHealthChecks?: unknown };
type RolloutLike = { status?: { history?: HistoryLike[] } };
type HealthCheckLike = { status?: { status?: string; message?: string } };

/**
 * ⭐ ROUND 5 QA-5, ITEM 2 (2026-10-09, TL, changes-slug lane) — THE
 * EXEMPTION MOVED TO `wide`-ONLY. Round 4's own correction (kept below for
 * the record) put this in `incident` beside `checkout-worker`'s own
 * failure — but `incident`'s whole contract, stated at this file's own
 * module-level note and the landing film's "one failure, late" rule, is
 * EXACTLY ONE failing rollout. A second one here broke that contract for
 * every OTHER reviewer of `incident` (Home, `/activity`, the film's own
 * incident chapter), not just this lane's own PR page. `wide` is a new,
 * narrower-purpose scenario (`?scenario=wide` on the reset route) that
 * exists ONLY to review `LandingGrid`'s one-fill-per-row danger case on the
 * platform-telemetry PR — `incident` itself is clean again, exactly
 * checkout-worker, in both `calm` and `incident` this cell heals to
 * `Succeeded` like every other fleet-array `Failed` entry.
 *
 * (2026-10-09, TL "GO" decision, then TL correction, changes-slug lane —
 * the superseded `incident`-only cut this replaces: the owner reviews Home
 * in calm, mid-redesign, and a permanent failure there printed "1 needs
 * you" and a failure banner on the one scenario that is supposed to have
 * neither — fixed by scoping the exemption to a scenario at all, which
 * this round narrows further, to `wide` alone.)
 */
const TM_ALWAYS_FAILED_KEY = 'telemetry-forwarder-prod/telemetry-forwarder';

/**
 * ⭐ HEALS ONLY `history[0]` — THE CURRENT/IN-FLIGHT ENTRY (2026-10-09,
 * squad-rollout round 3, coordinator ruling: "history must never rewrite a
 * past failure"). The prior cut looped over the WHOLE history array, which
 * was a deliberate, reviewed choice at the time (round 5 QA-5) — it existed
 * so a calm fleet shows no CURRENT failure, and nothing before this round
 * had a Failed entry anywhere but the head, so looping over everything and
 * looping over only the head were indistinguishable in practice. squad-
 * rollout's own History redesign changed that: `checkout-edge-prod` now
 * carries a Failed entry followed by a rollback (lane H's own fixture,
 * `mock-data.ts`), and the old loop silently healed it to `Succeeded`,
 * which is a past deploy's RECORD, not its current state — exactly what
 * the coordinator's ruling forbids. It also happened to heal
 * `orders-api/dev`'s own "one deliberate 03:00 incident" historical entry
 * (`mock-data.ts`'s `FLEET_INCIDENT_KEY`), which that fixture's own comment
 * documents as meant to survive as Failed; restoring that is a welcome side
 * effect of this fix, not a new risk.
 *
 * The calm-has-no-CURRENT-failure invariant is unchanged: `history[0]` is
 * still the only entry this function ever touches, so a rollout's HEAD
 * still reads `Succeeded` in calm exactly as before (`state.test.ts`'s
 * existing assertions on it are untouched). What changes is entries BELOW
 * the head, which until this round no fixture ever populated with
 * `Failed` — see the new test asserting both historical entries above
 * survive a heal.
 */
const CK_FAILED_LEADER_KEY = 'checkout-api-prod-af-south-1/checkout-api';
function healRolloutFailures(rollout: RolloutLike | null | undefined): void {
	const meta = (rollout as { metadata?: { namespace?: string; name?: string } } | null | undefined)
		?.metadata;
	if (scenario === 'wide' && meta && `${meta.namespace}/${meta.name}` === TM_ALWAYS_FAILED_KEY)
		return;
	const head = rollout?.status?.history?.[0];
	if (head?.bakeStatus === 'Failed') {
		head.bakeStatus = 'Succeeded';
		delete head.bakeStatusMessage;
		delete head.failedHealthChecks;
	}
}

/**
 * ⭐ THE ONE PERSON-HELD GATE IN THE FLEET IS GRANTED IN `calm`. (2026-10-09,
 * squad-rollout coordinator, final ruling on the hold-one-rule: "The
 * telemetry-indexer approval is granted in calm... Needs-you = needs a
 * person.") `telemetry-indexer-prod/telemetry-indexer` carries a
 * hand-authored `telemetry-indexer-manual-approval` gate
 * (`mock-data.ts`'s `TM_CELLS`, `heldAt: TM_NEW`) that refuses `TM_NEW` —
 * the one `person`-kind hold left in the fleet once the hold-one-rule made
 * contract/promotion-order holds visible under their OWN gate kinds
 * (`upstream`, never `person`). `calm`'s whole promise is "nothing needs a
 * person" (the owner reviews Home in calm, mid-redesign) — this grants the
 * approval there, the same way `healRolloutFailures` grants a clean deploy:
 * the gate's `allowedVersions` gains `TM_NEW`, so `gateAllows` (and every
 * reader built on it — `blockingStory`, `isHeld`, the Gates tab) calls it
 * clear. `incident`/`wide` keep the gate exactly as authored — the
 * approval-wait story (and the Gates tab's one `person`-kind example) stays
 * there.
 */
const TM_APPROVAL_GATE_KEY = 'telemetry-indexer-prod/telemetry-indexer';
function healApprovalGates(rollout: RolloutLike | null | undefined): void {
	if (scenario !== 'calm') return;
	const meta = (rollout as { metadata?: { namespace?: string; name?: string } } | null | undefined)
		?.metadata;
	if (!meta || `${meta.namespace}/${meta.name}` !== TM_APPROVAL_GATE_KEY) return;
	const status = (rollout as { status?: { gates?: Array<{ name?: string }> } })?.status;
	if (!status || !Array.isArray(status.gates)) return;
	// The gate is removed rather than widened — this demo module has no
	// exported handle on `mock-data.ts`'s own `TM_OLD`/`TM_NEW` constants to
	// widen `allowedVersions` with, and "the approval is granted" is exactly
	// "nothing refuses the candidate any more", same observable effect.
	status.gates = status.gates.filter((g) => !g.name?.endsWith('-manual-approval'));
}

/** `Unhealthy` → `Healthy`, in place. `Pending` is deliberately untouched —
 * both hello-world's and checkout-api's promote demo depends on shipping
 * with exactly one `Pending` check for `changeVersion` to flip at +3s. */
function healHealthChecks(bundle: HealthChecksBundle | null | undefined): void {
	for (const hc of (bundle?.healthChecks ?? []) as HealthCheckLike[]) {
		if (hc?.status?.status === 'Unhealthy') {
			hc.status.status = 'Healthy';
			hc.status.message = 'alert is not firing';
		}
	}
}

/**
 * ⛔ A `Warning` EVENT IS A FAILURE IN THE RAIL, AND CALM MAY NOT HAVE ONE.
 * (2026-09-13, third capture sweep.)
 *
 * `Recent events` is a card on every rollout page, and a `Warning` row draws
 * the adverse glyph and the adverse ink — so hello-world, the demo's
 * flagship, was carrying `Unhealthy · Readiness probe failed … 503` in its
 * rail on a scenario whose whole promise is that nothing is failing. The
 * fixtures keep their Warning rows (a deploy that failed really does emit
 * them, and `EventsCard`'s info glyph needs a reachable Warning state — it
 * has one, on checkout-worker, in `incident`); the SCENARIO decides who is
 * allowed to show them, exactly as it already does for bake statuses and
 * health checks.
 */
function healEvents(bundle: { events?: unknown[] } | null | undefined): void {
	if (!bundle?.events) return;
	bundle.events = bundle.events.filter((e) => (e as { type?: string })?.type !== 'Warning');
}

/**
 * ⛔ NOTHING IN THE DEMO IS STUCK. (2026-09-13, from the clean capture of
 * Home — the film's FIRST screen.)
 *
 * `detectStuck` (utils.ts) calls an in-flight deploy STUCK once its head
 * entry is more than an hour old, which is what put two amber
 * `STUCK · checking >1h · Promote now` cards under `Needs you now` on a
 * fleet with nothing wrong: the fixtures had simply stamped those deploys
 * 90 minutes back. The CHECKING phase itself is the product working, and it
 * stays — what goes is the age that makes it read as a wedge.
 *
 * ⭐ IT IS NOT SCENARIO-DEPENDENT, DELIBERATELY. `incident` carries exactly
 * one thing needing a person (checkout-worker's failed deploy), and a stuck
 * card beside it would be a second. One rule for both scenarios is also one
 * fewer difference for the film to keep track of.
 *
 * ⚠️ APPLIED TO WHAT THE MOCK SERVES, NOT TO THE FIXTURES THEMSELVES.
 * `mock-data.ts`'s Gantt/dependency cases are built on those head ages and
 * are asserted elsewhere; re-stamping here changes the demo's answer without
 * editing the shared fixture every other consumer reads.
 *
 * ⭐ RE-STAMPED ON EVERY READ, NOT JUST ON RESET (U-4 class, 2026-10-09,
 * coordinator finding: "the demo still ages … so does a dev server left
 * running"). This used to run once, inside `scenarioRollout`, which itself
 * only ran at `resetDemoState()` — so a server that sat idle (nobody reset
 * it, nobody pressed a button) watched the SAME freshened timestamp age
 * past `detectStuck`'s 1h threshold all over again as real wall-clock time
 * kept moving, exactly the clock-relative-fixture rot `f3fb44c`/`f984340`
 * fixed for the release calendars — just one layer further in, because
 * THIS clamp was only re-applied at reset, never at read. `getScenario-
 * FleetRollouts`/`getScenarioDepRollouts`/`getDetail` below now call this
 * (via `peekDemoClock()`, which self-heals `hcNow` on every call — see
 * `ensureClockFresh`) on every single read, so "in flight" reads as fresh
 * forever, with no second reset required.
 *
 * ⛔ A THIRD PREDICATE READS THIS SAME FIELD (U-4 class, 2026-10-09,
 * caught by the 3-day clock-advance test): `detectStuckBehind` (`utils.ts`)
 * never looks at MY OWN head timestamp — it looks at my PEER's, measuring
 * `now - peerRollout.status.history[0].timestamp` and calling ME `behind`
 * (amber) once that exceeds 24h, REGARDLESS of my peer's own `bakeStatus`.
 * A `Succeeded` deploy three real days old is a perfectly ordinary fixture
 * (most of the fleet is exactly that) until some OTHER environment is a
 * version behind it — at which point its age, not its status, is what the
 * predicate reads. So the `InProgress`/`Deploying`-only guard below used to
 * have, confirmed live: 27 "N behind" cards lit up on a 3-day clock advance
 * with zero resets, none of them actually wedged. Fixed by dropping the
 * bake-status guard entirely and giving EVERY head timestamp a ceiling —
 * a short one (`IN_FLIGHT_MAX_MIN`) for the two statuses `detectStuck`'s own
 * 1h threshold cares about, a longer one (`HEAD_MAX_AGE_MIN`, same 20h
 * margin `freshenCandidateAge` uses under the 24h `detectStuckBehind`/
 * `detectStuckPromotion` threshold) for everything else. `compareRollouts`
 * (which decides "is this rollout actually behind") reads release order,
 * never a timestamp, so clamping this field changes no fixture's relative
 * position — only how long its most recent deploy LOOKS like it took.
 */
const IN_FLIGHT_MAX_MIN = 25;
const HEAD_MAX_AGE_MIN = 20 * 60; // 20h — under the 24h detectStuckBehind/detectStuckPromotion thresholds
/**
 * Returns the number of milliseconds the head entry's `timestamp` (and
 * `bakeStartTime`) got shifted FORWARD by, or `0` when it was already
 * fresh. Callers that also hold this rollout's `healthChecks`/`events`
 * bundles pass this delta into `freshenAssociatedTimestamps` so every
 * field reads the SAME start — see that function's own doc comment for
 * why the head timestamp alone was not the whole story.
 */
function freshenInFlight(rollout: RolloutLike | null | undefined): number {
	const head = rollout?.status?.history?.[0] as
		| (HistoryLike & { timestamp?: string; bakeStartTime?: string })
		| undefined;
	if (!head) return 0;
	const ceilingMin =
		head.bakeStatus === 'InProgress' || head.bakeStatus === 'Deploying'
			? IN_FLIGHT_MAX_MIN
			: HEAD_MAX_AGE_MIN;
	const freshest = peekDemoClock().getTime() - ceilingMin * 60_000;
	const at = head.timestamp ? new Date(head.timestamp).getTime() : NaN;
	if (Number.isFinite(at) && at >= freshest) return 0;
	const deltaMs = Number.isFinite(at) ? freshest - at : 0;
	const iso = new Date(freshest).toISOString();
	head.timestamp = iso;
	if (head.bakeStartTime) head.bakeStartTime = iso;
	return deltaMs;
}

/**
 * ⛔ THE SAME ROT, A THIRD LAYER (U-4 class, 2026-10-09, measured with
 * `vi.setSystemTime` the same way `clock-rot.test.ts` measured the first
 * two: reset once, advance 6h and 3 days, no further reset). `freshenIn-
 * Flight` clamps the rollout's OWN head `timestamp`/`bakeStartTime` — but
 * a deploying/checking build's page also prints "started"/"since" off
 * THREE other sources that were never re-stamped on read at all, only
 * built once (from `hcAgo(n)`, relative to whatever `hcNow` was at the
 * last reset) inside each fixture's `mk*HealthChecks`/`mk*Events`
 * factories: `HealthChecksCard`'s `status.lastChangeTime` (the "checking
 * — since …" line on the Pending row) and `status.lastErrorTime`, and
 * `EventsCard`'s `lastTimestamp`/`firstTimestamp`/`eventTime`. Measured on
 * checkout-api's own "checking >1h" fixture: 6h idle put its Pending
 * health check's `lastChangeTime` 369 MINUTES old and its events 365-390
 * minutes old, while the clamped head timestamp correctly read 25 minutes
 * — three readings of "when did this build start" disagreeing with each
 * other and with reality on the same page.
 *
 * Fixed by shifting every one of these fields FORWARD by the exact same
 * `deltaMs` `freshenInFlight` just applied to the head — never
 * re-deriving an independent ceiling for each one, which would let them
 * drift apart again. Shifting (not re-anchoring to "now") preserves each
 * timestamp's original offset from the head (the Flux health check that
 * went healthy 9 minutes into the deploy stays 9 minutes into the deploy,
 * not snapped to some unrelated fixed age), so the deploy's internal story
 * — which check settled first, which event came before which — never
 * reorders. Capped at `peekDemoClock()` so a shift can never place a
 * stamp in the future.
 */
function shiftIsoForward(
	ts: string | undefined,
	deltaMs: number,
	ceilingMs: number
): string | undefined {
	if (!ts || deltaMs <= 0) return ts;
	const at = new Date(ts).getTime();
	if (!Number.isFinite(at)) return ts;
	return new Date(Math.min(at + deltaMs, ceilingMs)).toISOString();
}

function freshenAssociatedTimestamps(
	healthChecks: HealthChecksBundle | undefined,
	events: EventsBundle | undefined,
	deltaMs: number
): void {
	if (deltaMs <= 0) return;
	const ceilingMs = peekDemoClock().getTime();
	for (const hc of healthChecks?.healthChecks ?? []) {
		const status = (hc as { status?: { lastChangeTime?: string; lastErrorTime?: string } })
			?.status;
		if (!status) continue;
		if (status.lastChangeTime) {
			status.lastChangeTime = shiftIsoForward(status.lastChangeTime, deltaMs, ceilingMs);
		}
		if (status.lastErrorTime) {
			status.lastErrorTime = shiftIsoForward(status.lastErrorTime, deltaMs, ceilingMs);
		}
	}
	for (const ev of events?.events ?? []) {
		const e = ev as { lastTimestamp?: string; firstTimestamp?: string; eventTime?: string };
		if (e.lastTimestamp) e.lastTimestamp = shiftIsoForward(e.lastTimestamp, deltaMs, ceilingMs);
		if (e.firstTimestamp) e.firstTimestamp = shiftIsoForward(e.firstTimestamp, deltaMs, ceilingMs);
		if (e.eventTime) e.eventTime = shiftIsoForward(e.eventTime, deltaMs, ceilingMs);
	}
}

/**
 * ⛔ THE SAME ROT, ONE LAYER UP (U-4 class, 2026-10-09). `freshenInFlight`
 * only clamps the HEAD history entry's own bake/deploy age — but
 * `detectStuckPromotion`'s "gateless but stagnant" branch (`promotion.ts`)
 * never reads that field at all once a rollout HAS a newer build available
 * (`block.candidateCount > 0`): it reads `newestCandidate(rollout).created`,
 * the newest release this rollout hasn't taken yet, and calls it `stuck`
 * once that's more than 24h old. `f3fb44c`/`f984340` moved those `created`
 * dates onto `hcAgo()` so they'd be computed relative to the demo clock
 * instead of a hardcoded calendar date — but `hcAgo()` is still evaluated
 * exactly ONCE, when `mock-data.ts`'s top-level release-list consts
 * (`CK_RELEASES` etc.) are first built, which is PROCESS START, not "this
 * request" or even "the last reset" (`resetDemoState()` never rebuilds
 * `mockFleetRollouts`/`mockDepRollouts` — see their own doc comment, "every
 * other fixture … stays exactly what `mock-data.ts` already exports —
 * frozen, and correctly so"). So the exact same rot the in-flight fix
 * above targets was still live here, just on a 24h clock instead of a 1h
 * one — confirmed with a 3-day clock advance and no reset: 30 of these
 * flipped `stuck` in one sweep before this function existed. Same cure:
 * clamp the newest-candidate's `created` to within `CANDIDATE_MAX_AGE_MIN`
 * of `peekDemoClock()` on every read, never older — comfortably under the
 * 24h threshold (`DEFAULT_STUCK_THRESHOLD_MS`, `promotion.ts`) so normal
 * clock self-heal drift (`CLOCK_STALE_MS`, 10min) can never close the gap.
 *
 * ⚠️ NOT A CALL INTO `promotion.ts`'s OWN `promotionBlock`/`newestCandidate`
 * — tried first, reverted. `promotion.ts` imports `$lib/utils` and
 * `$lib/../types` (aliased, not relative), and `$lib/...` only resolves
 * inside SvelteKit's own app bundle. This file has to stay loadable from
 * plain Node too (`dev-mock-api.ts`'s `vite.config.ts`-time plugin import,
 * same constraint `mock-data.ts`/`respond.ts` already document at their own
 * top) — pulling `promotion.ts` in transitively broke `vitest run` and the
 * dev server itself with `ERR_MODULE_NOT_FOUND: $lib`. So this mirrors
 * `newerReleaseCount`/`newestCandidate`'s selection rule by hand instead:
 * `releaseCandidates` is newest-first (candidate = index 0) when present;
 * otherwise `availableReleases` is oldest-first (candidate = last) and
 * only counts when the current version is findable in it at an index
 * before the tail. Deliberately permissive where the real predicate is
 * stricter (it also returns "unknowable" when the current version aged
 * out of `availableReleases` entirely) — the cost of that gap is clamping
 * a `created` field the real predicate wouldn't have read, which is a
 * harmless no-op, never a timestamp it needed clamped and didn't get.
 */
const CANDIDATE_MAX_AGE_MIN = HEAD_MAX_AGE_MIN; // same 20h margin, same 24h threshold
type ReleaseRefLike = { created?: string; version?: string; revision?: string; tag?: string };
type RolloutWithReleasesLike = {
	status?: {
		history?: { version?: ReleaseRefLike | string }[];
		releaseCandidates?: ReleaseRefLike[];
		availableReleases?: ReleaseRefLike[];
	};
};
function displayVersionOf(v: ReleaseRefLike | string | undefined): string | null {
	if (!v) return null;
	if (typeof v === 'string') return v;
	return v.version || v.revision || v.tag || null;
}
function newestUnclaimedCandidate(rollout: RolloutWithReleasesLike | null | undefined): ReleaseRefLike | null {
	const status = rollout?.status;
	if (!status) return null;
	if (Array.isArray(status.releaseCandidates)) {
		return status.releaseCandidates[0] ?? null;
	}
	const available = status.availableReleases;
	if (!Array.isArray(available) || available.length === 0) return null;
	const cur = displayVersionOf(status.history?.[0]?.version);
	if (cur === null) return null;
	const idx = available.findIndex((r) => displayVersionOf(r) === cur);
	if (idx === -1 || idx === available.length - 1) return null; // unknowable, or already newest
	return available[available.length - 1] ?? null;
}
function freshenCandidateAge(rollout: RolloutLike | null | undefined): void {
	const candidate = newestUnclaimedCandidate(rollout as unknown as RolloutWithReleasesLike);
	if (!candidate?.created) return;
	const freshest = peekDemoClock().getTime() - CANDIDATE_MAX_AGE_MIN * 60_000;
	const at = new Date(candidate.created).getTime();
	if (Number.isFinite(at) && at >= freshest) return;
	candidate.created = new Date(freshest).toISOString();
}

/** Scenario-adjusted CLONE of one already-built rollout object — never
 * mutates its input, since fleet/dep arrays below are shared across every
 * reset and every request until the next reset rebuilds them. */
function scenarioRollout<T>(rollout: T): T {
	const clone = structuredClone(rollout);
	healRolloutFailures(clone as RolloutLike);
	healApprovalGates(clone as RolloutLike);
	freshenInFlight(clone as RolloutLike);
	freshenCandidateAge(clone as RolloutLike);
	return clone;
}

/** The fleet/dependency rollout lists, AFTER the active scenario's
 * transform — what `/api/rollouts` actually serves for every rollout this
 * module does not itself keep "live". Rebuilt on every reset, and each
 * read below re-freshens in place — see `freshenInFlight`/
 * `freshenCandidateAge`'s own doc comments for why rebuilding at reset
 * alone was not enough. */
let scenarioFleetRollouts: unknown[] = [];
let scenarioDepRollouts: unknown[] = [];

export function getScenarioFleetRollouts(): unknown[] {
	for (const r of scenarioFleetRollouts) {
		freshenInFlight(r as RolloutLike);
		freshenCandidateAge(r as RolloutLike);
	}
	return scenarioFleetRollouts;
}
export function getScenarioDepRollouts(): unknown[] {
	for (const r of scenarioDepRollouts) {
		freshenInFlight(r as RolloutLike);
		freshenCandidateAge(r as RolloutLike);
	}
	return scenarioDepRollouts;
}

/**
 * Both read-time restamps, for a caller holding a rollout object that
 * is NOT one of `getScenarioFleetRollouts`/`getScenarioDepRollouts`/
 * `getDetail`'s own return values — specifically `respond.ts`'s
 * `mockDepDetails` branch, whose `detail.rollout` is the SAME object
 * reference `mockDepRollouts` was built from (never cloned, never
 * scenario-mapped), so neither of the getters above ever touches it.
 * Exported rather than duplicated so this stays the one place "which
 * fields rot" is answered.
 */
export function freshenStaticRollout(rollout: RolloutLike | null | undefined): void {
	// The static detail is built Failed (CK_BAKE, the wave-3 leader's authored story); every scenario heals it, as the fleet list does ("incident has exactly one failure").
	const m = (rollout as { metadata?: { namespace?: string; name?: string } } | null | undefined)?.metadata;
	if (m && `${m.namespace}/${m.name}` === CK_FAILED_LEADER_KEY) healRolloutFailures(rollout);
	freshenInFlight(rollout);
	freshenCandidateAge(rollout);
}

export function getScenario(): Scenario {
	return scenario;
}

/**
 * Rebuilds every live fixture from its pristine factory, recomputes the
 * fleet-wide scenario view, and cancels every pending transition timer.
 * Called once at module load (there is no "before first reset" state — the
 * very first read is already the pristine one) and again on every
 * `POST/GET /api/demo/reset`.
 *
 * `requestedScenario`, when given, SWITCHES the active scenario (`?scenario=
 * calm|incident|wide` on the reset route — `wide`, round 5 QA-5 item 2, is
 * review-only, see `Scenario`'s own doc comment); a plain reset with no
 * query keeps whatever scenario is already active — task requirement, not
 * an oversight.
 */
export function resetDemoState(requestedScenario?: Scenario): void {
	if (requestedScenario === 'calm' || requestedScenario === 'incident' || requestedScenario === 'wide') {
		scenario = requestedScenario;
	}
	cancelAllTimers();
	// …and the gate sequence's own idempotence flag, or a second take on the
	// same server would find the sequence "already run" — see `runGateSequence`.
	gateStartedAt.clear();
	promoteStepsDone.clear();
	live.clear();
	managedResourcesByKey.clear();
	rv = 0;
	demoClockOffsetMs = 0;
	// Every explicit reset re-anchors the demo clock to the real "now" —
	// see `reanchorClock`'s own note. Every fixture rebuilt below reads
	// `hcAgo`/`hcNow` at THIS call, so a reset is also how a long-running
	// dev server's "ago" numbers come back into agreement with the real
	// wall clock the browser is comparing them against.
	reanchorClock();
	for (const def of FIXTURES) {
		const detail = def.buildDetail();
		const healthChecks = def.buildHealthChecks();
		// Every `Pending` check opens on a real, ticking countdown — see "THE
		// PENDING COUNTDOWN" note further down this file.
		armFreshPendingProbes(healthChecks);
		const isIncidentFixture =
			(scenario === 'incident' || scenario === 'wide') &&
			def.namespace === CW_NAMESPACE &&
			def.name === CW_NAME;
		// The designated incident rollout keeps its natural (Failed/Unhealthy)
		// built state; every other fixture, in EITHER scenario, is healed —
		// calm heals everyone, incident heals everyone EXCEPT this one.
		const events = def.buildEvents();
		if (!isIncidentFixture) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			healRolloutFailures((detail as any).rollout);
			healHealthChecks(healthChecks);
			healEvents(events as { events?: unknown[] });
		}
		// Every live fixture gets the same "nothing is stuck" rule the fleet
		// list gets through `scenarioRollout` — see `freshenInFlight`.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		freshenInFlight((detail as any).rollout);
		managedResourcesByKey.set(def.kustomizationKey, def.buildManagedResources());
		if (!isIncidentFixture) {
			// ⛔ AND ITS PODS. A healed rollout whose Deployment is still
			// `InProgress · 1 of 2 ready` is the same leak in the Resources
			// card that the events leak was in the rail — measured on
			// checkout-worker in `calm`, whose deploy had been healed to
			// `Succeeded` while its workload was still half rolled out.
			allReplicasReady(def.kustomizationKey);
		}
		live.set(fixtureKey(def.namespace, def.name), {
			def,
			detail,
			healthChecks,
			events
		});
	}
	seedApprovals();
	scenarioFleetRollouts = mockFleetRollouts.map(scenarioRollout);
	resetWavesStory(); // before mkHwvRollouts: the stepped waves story overrides hwvLive only once a beat is fired
	// hello-waves is the one app whose state follows the scenario (mock-data.ts FIXTURE E).
	scenarioDepRollouts = [...mockDepRollouts, ...mkHwvRollouts(scenario)].map(scenarioRollout);
	// The stepped dependencies story (`deps-story.ts`) mutates these clones
	// and its own copies of the dependencies/environments — back to `arm`.
	resetDepsStory(scenario);
	// Tell every tab that already has one of these three pages open to
	// snap back to the pristine fixture too — the whole point of a reset
	// between takes is that the BROWSER, not just the next curl, sees it.
	const at = peekDemoClock();
	broadcastChanges(
		FIXTURES.map((def) => ({
			type: 'update',
			kind: 'Rollout',
			namespace: def.namespace,
			name: def.name,
			cluster: def.cluster,
			resourceVersion: nextRv(),
			ts: at.getTime()
		}))
	);
}

resetDemoState();

export function hasFixture(namespace: string, name: string): boolean {
	return live.has(fixtureKey(namespace, name));
}

/**
 * ⭐ FRESHENED ON EVERY READ TOO (U-4 class, 2026-10-09). The three LIVE
 * fixtures (`hello-world`, `checkout-api`, `checkout-worker`) get their
 * in-flight head/candidate ages set once per `resetDemoState()` call (see
 * the fixture-rebuild loop above) — fine for a capture that resets right
 * before recording, not for a dev server left open: a GET-only session
 * never mutates these in place, so nothing else re-clamps them between
 * resets. Same two restamps `getScenarioFleetRollouts`/
 * `getScenarioDepRollouts` apply, applied here so `/rollouts/:ns/:name`
 * (detail), its embedded history (the "history" tab reads the same
 * object), and every page that reads through `withLiveOverrides`/
 * `getHwEnvRollouts` (list, Home, `/apps`) see the same fresh answer.
 */
/**
 * Re-freshens one live fixture's rollout head AND its `healthChecks`/
 * `events` bundles together — see `freshenAssociatedTimestamps`'s own doc
 * comment for why the head clamp alone left two other sources rotting.
 * Called from every one of `getDetail`/`getHealthChecks`/`getEvents` (any
 * of the three can be the first endpoint a page hits) and idempotent
 * either way: `freshenInFlight` only returns a non-zero delta the FIRST
 * time a given staleness is observed, so a page that hits all three in
 * one load shifts the bundles exactly once, not three times.
 */
function freshenLiveEntry(entry: LiveFixture | undefined): void {
	if (!entry) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const rollout = (entry.detail as any)?.rollout as RolloutLike | undefined;
	const deltaMs = freshenInFlight(rollout);
	freshenCandidateAge(rollout);
	freshenAssociatedTimestamps(entry.healthChecks, entry.events, deltaMs);
}

export function getDetail(namespace: string, name: string): DetailBundle | undefined {
	const entry = live.get(fixtureKey(namespace, name));
	freshenLiveEntry(entry);
	return entry?.detail;
}

export function getHealthChecks(namespace: string, name: string): HealthChecksBundle | undefined {
	const entry = live.get(fixtureKey(namespace, name));
	freshenLiveEntry(entry);
	return entry?.healthChecks;
}

export function getEvents(namespace: string, name: string): EventsBundle | undefined {
	const entry = live.get(fixtureKey(namespace, name));
	freshenLiveEntry(entry);
	return entry?.events;
}

export function getManagedResources(
	kustNamespace: string,
	kustName: string
): Record<string, unknown>[] | undefined {
	return managedResourcesByKey.get(`${kustNamespace}/${kustName}`);
}

/**
 * `hello-world-staging`/`hello-world-prod` have no placeholder anywhere in
 * `mock-data.ts`'s FLEET arrays — unlike CK/CW, which `withLiveOverrides`
 * swaps out of an EXISTING list entry, these two only exist here. `respond.ts`
 * splices this straight into `/api/rollouts`' `rollouts.items` alongside the
 * other live fixtures, so `/environments`, `/rollouts` and `/apps` all see the
 * same chain the single-rollout pages do.
 */
export function getHwEnvRollouts(): unknown[] {
	return (['staging', 'prod'] as const)
		.map((env) => getDetail(HW_NAMESPACE[env], HW_APP_NAME)?.rollout)
		.filter((r): r is Record<string, unknown> => r != null);
}

/**
 * `/permissions/all` answered `{}` for every namespace/name except
 * `default/hello-world` — which is why `checkout-api-prod-us-east-2/
 * checkout-api` had NO buttons on its rollout page even though Home offers
 * "Promote now" for it (task A.5). Every rollout in the demo is actionable
 * now, not just the three that mutate — a reader clicking into any fixture
 * from `/rollouts` or `/dependencies` should see real buttons too.
 */
export function getPermissionsAll(namespace: string, name: string) {
	return {
		permissions: { update: true, patch: true, approve: true },
		resource: { apiGroup: 'kuberik.com', kind: 'Rollout', name, namespace }
	};
}

// ─────────────────────────────────────────────────────────────────────────
// MUTATIONS — the two transitions the film presses a button for.
//
// ⭐ TIMINGS, DOCUMENTED (task A.4 — the film is cut to these numbers):
//
//   RETRY (checkout-worker-staging/checkout-worker):
//     t+0    the head history entry becomes a new attempt of the SAME
//            version: `bakeStatus` flips Failed → Deploying, its
//            `bakeStatusMessage`/`failedHealthChecks` are cleared (which is
//            also what clears `FailurePanel` — it only renders on
//            `bakeStatus === 'Failed'`), `bakeStartTime`/`timestamp` reset
//            to now. The status line reads "deploying" (`BAKE_WORD.Deploying`
//            — bake-status.ts's own word, not a new one).
//     t+4s   settles: `bakeStatus` → Succeeded, `bakeEndTime` set, and every
//            `Unhealthy` health check on this rollout flips to `Healthy`.
//
//   PROMOTE / CHANGE VERSION / FORCE DEPLOY (default/hello-world and
//   checkout-api-prod-us-east-2/checkout-api, same `/change-version` route
//   the real backend and `ChangeVersionModal` both use):
//     t+0    target = `body.version` if it names a real `availableReleases`
//            entry, else the newest one. A NEW history entry is prepended
//            (`bakeStatus: Deploying`) — the previous head entry is left
//            exactly as it was (`Succeeded`/`done`), so the pipeline reads
//            as "that stage completed, this one is now active" for free,
//            straight out of `lib/pipeline.ts`'s existing bake→stage mapping.
//            `currentVersion`/`wantedVersion` move to the target immediately.
//     t+3s   the one `Pending` health check (both fixtures ship exactly one)
//            flips to `Healthy` — the rollup goes `1 pending · 2 passing` →
//            `3 passing`.
//     t+6s   the new head entry's `bakeStatus` → `Succeeded` — the pipeline
//            reads done.
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⭐ RETRY'S TWO VISIBLE PHASES (S-7, 2026-10-08, coordinator). Was one flat
 * 0.9s window where "Deploying" and the health checks both resolved at
 * once — too fast to read as two things happening on film. Split into a
 * ~2.5s "pods are rolling out" phase and a ~2.5s "checks are being
 * re-evaluated" phase, same two-step shape `runGateSequence`'s own
 * `GATE_CHECK_MS`/`GATE_PROMOTE_MS` already use for exactly this reason.
 */
const RETRY_DEPLOY_STARTED_MS = 400;
const RETRY_CHECKS_PASSING_MS = 2_600;
const RETRY_SETTLE_MS = 5_000;
const PROMOTE_HEALTH_MS = 3_000;
const PROMOTE_DONE_MS = 6_000;

type HistoryEntry = Record<string, unknown> & {
	bakeStatus?: string;
	bakeStatusMessage?: string;
	failedHealthChecks?: unknown;
	bakeStartTime?: string;
	bakeEndTime?: string;
	timestamp?: string;
};

function rolloutOf(f: LiveFixture): { status: { history: HistoryEntry[]; [k: string]: unknown } } {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (f.detail as any).rollout;
}

/**
 * Every Deployment this fixture manages reads fully rolled out: `Current`,
 * no in-flight message, `readyReplicas === replicas`. Called when a deploy
 * SETTLES — see `retryRollout`'s own note for why a finished deploy beside a
 * half-ready workload is a state that does not exist.
 */
function allReplicasReady(kustomizationKey: string): void {
	for (const res of managedResourcesByKey.get(kustomizationKey) ?? []) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const r = res as any;
		if (r.groupVersionKind !== 'apps/v1/Deployment') continue;
		r.status = 'Current';
		r.message = '';
		const status = r.object?.status;
		const spec = r.object?.spec;
		if (status && typeof spec?.replicas === 'number') {
			status.replicas = spec.replicas;
			status.readyReplicas = spec.replicas;
		}
	}
}

/**
 * ⭐ A DEPLOY THAT SETTLES SAYS SO IN `Recent events`. (2026-09-13, eighth
 * film review.)
 *
 * The rail card is a LOG: it keeps whatever the fixture shipped and nothing
 * this module did was ever written into it, so four seconds after a Retry the
 * page read `deploy succeeded · 2/2 done` beside a last event that still said
 * `BakeFailed · HighErrorRate firing · rolled back` — the final frame of the
 * take contradicting its own headline. A real controller emits an event when
 * the bake completes; so does this one now.
 *
 * `Event` is in `applyChangeEvents`' `EVENT_TAG_KINDS` (it is deliberately
 * NOT in `KNOWN_KINDS` — see that set's own comment), which is exactly the
 * tag that invalidates `['events', ns, name, cluster]`, so the card refetches
 * instead of waiting out its poll.
 */
function recordSettleEvent(
	f: LiveFixture,
	namespace: string,
	name: string,
	cluster: string,
	at: Date,
	reason: string,
	message: string
): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const bundle = f.events as any;
	if (!bundle || !Array.isArray(bundle.events)) return;
	bundle.events.unshift({
		type: 'Normal',
		reason,
		involvedObject: { kind: 'Rollout', name },
		message,
		lastTimestamp: at.toISOString()
	});
	broadcastChanges([
		{
			type: 'add',
			kind: 'Event',
			namespace,
			name: `${name}.${reason.toLowerCase()}`,
			cluster,
			resourceVersion: nextRv(),
			ts: at.getTime()
		}
	]);
}

/**
 * ⭐ THE CANARY IS A RESOURCE, SO A NEW BUILD RE-RUNS IT. (2026-09-13.)
 *
 * The pipeline the rollout page draws is not derived from the Rollout at all
 * — it is the KruiseRollout in `managedResources`, and `canaryStatus` is what
 * says which stage is live (see `DeploymentPipelineCard` and `pipeline.ts`,
 * which both read `canaryStatus.currentStepState`). Promoting a build while
 * that object still says `Completed` draws a finished pipeline over a deploy
 * that has just started — the gate take's whole point is that the stages run
 * again for the new revision.
 *
 * `StepUpgrade` is kruise's own word for "this step is applying", and it is
 * simply NOT `Completed`, which is all either renderer asks.
 */
function kruiseRolloutOf(kustomizationKey: string): Record<string, any> | undefined {
	for (const res of managedResourcesByKey.get(kustomizationKey) ?? []) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const r = res as any;
		if (r.groupVersionKind === 'rollouts.kruise.io/v1beta1/Rollout') return r.object;
	}
	return undefined;
}

function restartCanary(kustomizationKey: string, revision: string): void {
	const kr = kruiseRolloutOf(kustomizationKey);
	const cs = kr?.status?.canaryStatus;
	if (!cs) return;
	cs.currentStepState = 'StepUpgrade';
	cs.canaryRevision = revision;
	kr.status.phase = 'Progressing';
}

function completeCanary(kustomizationKey: string, revision: string): void {
	const kr = kruiseRolloutOf(kustomizationKey);
	const cs = kr?.status?.canaryStatus;
	if (!cs) return;
	cs.currentStepState = 'Completed';
	cs.canaryRevision = revision;
	kr.status.phase = 'Healthy';
}

/**
 * ⭐ THE GATE SEQUENCE — THE PRODUCT'S ACTUAL PROMISE, WITH NOBODY CLICKING.
 * (2026-09-13, from the film's own review: the promote chapter said "promote
 * only when it's healthy" over a take where a person pressed Deploy while a
 * check was still pending. That is the opposite of what a gate is for.)
 *
 * `GET|POST /api/demo/gate?rollout=default/hello-world` runs this from the
 * page at rest — `f68d0ac` succeeded, `e2c9b47` waiting, `1 pending · 2
 * passing` with the pending probe counting down. Beats, from the call:
 *
 *   t+3.0s  the pending check passes -> `3/3 healthy`, `HealthChecksPassed`
 *           on top of the log. Nothing has moved yet; this is the gate
 *           going green.
 *   t+3.5s  the controller promotes on its own — `Promoted` event, actor
 *           `System`, history entry deploying, the canary restarted for the
 *           new revision. The checks stay `3/3 healthy`: they are what
 *           opened the gate and nothing has failed since.
 *   t+6.5s  the promote's own `PROMOTE_HEALTH_MS` step — a no-op here, since
 *           nothing is pending to flip. Left in place because it is
 *           `changeVersion`'s own beat, not this sequence's.
 *   t+9.5s  done: `deploy succeeded`, `BakeSucceeded`, workload settled,
 *           pipeline complete (`PROMOTE_DONE_MS`).
 *
 * ⛔ The last two beats are NOT re-implemented here — they are
 * `changeVersion`'s own, called with `automatic`. A second copy of the settle
 * path would be a second thing to keep true.
 *
 * Idempotent per reset: calling it twice does not start two sequences, and
 * `resetDemoState` clears the flag along with the timers it schedules.
 */
export function gateElapsedMs(): number | undefined {
	let started: number | undefined;
	for (const t of gateStartedAt.values()) started = started === undefined ? t : Math.min(started, t);
	return started === undefined ? undefined : Date.now() - started;
}

const GATE_CHECK_MS = 3_000;
const GATE_PROMOTE_MS = 3_500;

export function runGateSequence(namespace: string, name: string, clusterHint?: string): boolean {
	const key = fixtureKey(namespace, name);
	const f = live.get(key);
	if (!f) return false;
	if (gateStartedAt.has(key)) return true;
	gateStartedAt.set(key, Date.now());
	const cluster = clusterHint ?? f.def.cluster;
	// The pending check's own countdown syncs to THIS call's timing, not
	// whatever cadence it happened to be on — see "THE PENDING COUNTDOWN".
	armPendingProbe(f, GATE_CHECK_MS, namespace, cluster);

	schedule(() => {
		const at = demoNow();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pending = (f.healthChecks.healthChecks as any[]).find(
			(hc) => hc.status?.status === 'Pending'
		);
		if (pending) {
			pending.status.status = 'Healthy';
			pending.status.message = 'alert is not firing';
			pending.status.lastChangeTime = at.toISOString();
			delete pending.status.nextProbeAt;
			broadcastHealthChecks([pending], namespace, cluster, at);
		}
		recordSettleEvent(
			f,
			namespace,
			name,
			cluster,
			at,
			'HealthChecksPassed',
			'Every health check is passing, so the next build is free to move.'
		);
	}, GATE_CHECK_MS);

	schedule(() => {
		// ⛔ AND THE CARD STAYS `3/3 healthy` FROM HERE ON. (2026-09-13, second
		// pass on this sequence.) The first cut put the check that had just
		// passed back to `Pending` when the promotion started — a real
		// controller would re-evaluate it against the new build — and on
		// screen that read `healthy -> pending again -> deploying`, 0.6s after
		// the green that justified the move, i.e. the take's own evidence
		// blinking out from under it. The checks that opened the gate are the
		// PREVIOUS deploy's and they do not stop passing because a new build
		// started; the new build's own check has simply not failed. Nothing
		// goes amber after the gate opens.
		changeVersion(namespace, name, {}, cluster, { automatic: true, restartPipeline: true });
	}, GATE_PROMOTE_MS);

	return true;
}

/**
 * ⭐ THE STEPPED `promote` SCENARIO — ENVIRONMENT-TO-ENVIRONMENT, NOT
 * SELF-PROMOTION. (2026-09-21.) `runGateSequence` above tells the story of
 * dev promoting ITSELF once ITS OWN health check clears — real, and shipped
 * 2026-09-20, but not what the owner asked the film's "promote only when
 * it's healthy" chapter to show: *"It probably should refer to the
 * dependency gate of the previous environment."* This tells that story
 * instead — dev clearing its own check is what lets STAGING'S `after(dev)`
 * gate open, and the controller promotes `e2c9b47` into staging on its own.
 *
 * `GET|POST /api/demo/gate?rollout=default/hello-world&step=pass|promote|done`
 * (`respond.ts`) calls this ONE step at a time, synchronously — no
 * `setTimeout` anywhere in this function — so a capture script controls
 * every beat itself instead of racing a background timer. `rollout` is
 * always `default/hello-world` (the dev fixture); this function is the one
 * place that knows dev's downstream is `hello-world-staging`.
 *
 *   pass    — dev's one `Pending` health check → `Healthy`. Mirrors
 *             `runGateSequence`'s own `GATE_CHECK_MS` body exactly (same
 *             event, same wording) so the two modes read identically up to
 *             this point.
 *   promote — dev promotes itself to `e2c9b47` via the SAME `changeVersion`
 *             path `runGateSequence` already uses (`automatic`,
 *             `restartPipeline`) — dev's own settle timers still run in the
 *             background exactly as they do un-stepped; nothing about dev's
 *             OWN page depends on step timing. What's new: staging's own
 *             `after(dev)` gate is a fixture this module owns directly (not
 *             `changeVersion`'s concern), so it is opened HERE, synchronously,
 *             the instant dev's target is known — and staging's promotion is
 *             started by hand (not through `changeVersion`, which would
 *             schedule its OWN 3s/6s settle timers and reintroduce the wall-
 *             clock dependency this function exists to remove).
 *   done    — staging's deploy settles: bake succeeded, workload ready, the
 *             canary back to `Completed`, one more `BakeSucceeded` event.
 *
 * Idempotent per step per reset (`promoteStepsDone`, declared up with
 * `gateStartedAt` — cleared by `resetDemoState`) — calling the same step
 * twice does not double-append history or double-fire an event.
 */
export function stepPromoteGate(
	namespace: string,
	name: string,
	step: 'arm' | 'pass' | 'promote' | 'done',
	clusterHint?: string
): { ok: boolean; error?: string } {
	if (namespace !== NAMESPACE || name !== ROLLOUT_NAME) {
		return { ok: false, error: `stepped promote is only wired for ${NAMESPACE}/${ROLLOUT_NAME}` };
	}
	const dev = live.get(fixtureKey(NAMESPACE, ROLLOUT_NAME));
	const staging = live.get(fixtureKey(HW_NAMESPACE.staging, HW_APP_NAME));
	if (!dev || !staging) return { ok: false, error: 'promote fixtures not live' };
	const devCluster = clusterHint ?? dev.def.cluster;
	const stagingCluster = staging.def.cluster;

	// arm — the pending check's countdown restarts from GATE_CHECK_MS on the
	// demo clock, nothing else (2026-09-21, film critic 20: the countdown has
	// to be SEEN ticking 3 → 2 → 1). `runGateSequence` arms and then passes
	// on a wall-clock timer, which a capture running under load (virtual time
	// slower than wall time) sees as "3s … PASSING" with no 2 or 1; a capture
	// that arms, waits three of its own seconds, then calls `pass` sees every
	// number. Re-armable on purpose: not recorded in `promoteStepsDone`.
	if (step === 'arm') {
		armPendingProbe(dev, GATE_CHECK_MS, NAMESPACE, devCluster);
		return { ok: true };
	}

	const stepKey = `${step}`;
	if (promoteStepsDone.has(stepKey)) return { ok: true };

	if (step === 'pass') {
		const at = demoNow();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pending = (dev.healthChecks.healthChecks as any[]).find(
			(hc) => hc.status?.status === 'Pending'
		);
		if (pending) {
			pending.status.status = 'Healthy';
			pending.status.message = 'alert is not firing';
			pending.status.lastChangeTime = at.toISOString();
			delete pending.status.nextProbeAt;
			broadcastHealthChecks([pending], NAMESPACE, devCluster, at);
		}
		recordSettleEvent(
			dev,
			NAMESPACE,
			ROLLOUT_NAME,
			devCluster,
			at,
			'HealthChecksPassed',
			'Every health check is passing, so the next build is free to move.'
		);
		promoteStepsDone.add(stepKey);
		return { ok: true };
	}

	if (step === 'promote') {
		// dev promotes ITSELF — the same path `runGateSequence`'s own
		// `GATE_PROMOTE_MS` step calls. Its settle timers (health/done) still
		// run in the background; only STAGING's beat is made synchronous below.
		changeVersion(NAMESPACE, ROLLOUT_NAME, {}, devCluster, { automatic: true, restartPipeline: true });
		const devRollout = rolloutOf(dev);
		const target = devRollout.status.currentVersion as string | undefined;
		if (!target) return { ok: false, error: 'dev has no current version to promote' };

		// staging's own `after(dev)` gate opens: dev now runs `target`.
		const stagingRollout = rolloutOf(staging);
		const gates = (stagingRollout.status as unknown as { gates?: Array<{ name?: string; allowedVersions?: string[] }> }).gates;
		const gate = gates?.find((g) => g.name === HW_GATE_NAME.staging);
		if (gate) {
			const allowed = new Set(gate.allowedVersions ?? []);
			allowed.add(target);
			gate.allowedVersions = [...allowed];
		}

		// staging's controller promotes `target` on its own — started here
		// directly (not through `changeVersion`) so nothing about its settle
		// depends on a background timer; `done` below settles it explicitly.
		const at = demoNow();
		stagingRollout.status.previousVersion = stagingRollout.status.currentVersion;
		stagingRollout.status.currentVersion = target;
		stagingRollout.status.wantedVersion = target;
		recomputeReleaseCandidates(stagingRollout as unknown as Parameters<typeof recomputeReleaseCandidates>[0]);
		stagingRollout.status.history.unshift({
			version: { tag: target, version: target, revision: target },
			timestamp: at.toISOString(),
			message: `Promoted ${target}: checks passed`,
			triggeredBy: { kind: 'System', name: 'rollout-controller' },
			bakeStatus: 'Deploying',
			bakeStartTime: at.toISOString()
		});
		restartCanary(staging.def.kustomizationKey, target);
		recordSettleEvent(
			staging,
			HW_NAMESPACE.staging,
			HW_APP_NAME,
			stagingCluster,
			at,
			'Promoted',
			`dev is healthy, so ${target} is deploying to staging on its own.`
		);
		broadcastRollout(HW_NAMESPACE.staging, HW_APP_NAME, stagingCluster, at);
		promoteStepsDone.add(stepKey);
		return { ok: true };
	}

	// step === 'done'
	const at = demoNow();
	const stagingRollout = rolloutOf(staging);
	const head = stagingRollout.status.history[0];
	if (!head) return { ok: false, error: 'staging has no deploy in progress to settle' };
	head.bakeStatus = 'Succeeded';
	head.bakeEndTime = at.toISOString();
	allReplicasReady(staging.def.kustomizationKey);
	const target = (head.version as { tag?: string } | undefined)?.tag;
	if (target) completeCanary(staging.def.kustomizationKey, target);
	recordSettleEvent(
		staging,
		HW_NAMESPACE.staging,
		HW_APP_NAME,
		stagingCluster,
		at,
		'BakeSucceeded',
		`Checks passed; ${target} is the running build.`
	);
	broadcastRollout(HW_NAMESPACE.staging, HW_APP_NAME, stagingCluster, at);
	broadcastChanges([
		{
			type: 'update',
			kind: 'Deployment',
			namespace: HW_NAMESPACE.staging,
			name: HW_APP_NAME,
			cluster: stagingCluster,
			resourceVersion: nextRv(),
			ts: at.getTime()
		}
	]);
	promoteStepsDone.add(stepKey);
	return { ok: true };
}

function unhealthyChecks(f: LiveFixture): { metadata?: { name?: string } }[] {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (f.healthChecks.healthChecks as any[]).filter((hc) => hc.status?.status === 'Unhealthy');
}

/** Retry a stalled/failed deploy in place — see the timing block above. */
export function retryRollout(namespace: string, name: string, clusterHint?: string): boolean {
	const f = live.get(fixtureKey(namespace, name));
	if (!f) return false;
	const cluster = clusterHint ?? f.def.cluster;
	const rollout = rolloutOf(f);
	const head = rollout.status.history[0];
	if (!head) return false;
	const startedAt = demoNow();
	const startedIso = startedAt.toISOString();

	head.bakeStatus = 'Deploying';
	delete head.bakeStatusMessage;
	delete head.failedHealthChecks;
	head.bakeStartTime = startedIso;
	head.timestamp = startedIso;
	delete head.bakeEndTime;
	// `HistoryEntry.version` is `unknown` (the type's own `Record<string,
	// unknown>` half) — one safe read of its `tag`, reused by every event
	// message below instead of an unchecked `head.version?.tag` at each
	// call site (svelte-check: "Property 'tag' does not exist on type
	// '{}'").
	const headTag = (head.version as { tag?: string } | undefined)?.tag ?? name;

	/**
	 * ⭐ THE FAILING CHECK GOES TO `Pending`, NOT STRAIGHT TO HEALTHY AND NOT
	 * LEFT FAILING. (2026-09-13, from the live retry take.)
	 *
	 * Leaving it `Unhealthy` would hide the row for the whole four seconds —
	 * `visibleHealthChecks` drops a failure whose `lastErrorTime` predates
	 * the current deploy, and the retry has just moved that cutoff — so the
	 * card would go `2/3 · 1 failing` → `2/2` → `3/3` and the row a viewer is
	 * watching would blink out of existence mid-take. Healing it instantly
	 * would be worse: it would claim the alert cleared before anything had
	 * been re-evaluated. `Pending` is what is actually true in that window,
	 * it is a state the card already draws, and it keeps the row in place so
	 * the sequence reads FAILING → PENDING → PASSING.
	 */
	const retrying = unhealthyChecks(f);
	for (const hc of retrying) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const status = (hc as any).status;
		status.status = 'Pending';
		status.message = 'evaluating alert state';
		// Demo clock, same as every other stamp in this function — see "THE
		// PENDING COUNTDOWN". Ends when the check actually resolves
		// (RETRY_CHECKS_PASSING_MS), not the later overall bake settle.
		status.nextProbeAt = new Date(startedAt.getTime() + RETRY_CHECKS_PASSING_MS).toISOString();
		status.lastChangeTime = startedIso;
		delete status.lastErrorTime;
	}
	broadcastRollout(namespace, name, cluster, startedAt);
	broadcastHealthChecks(retrying, namespace, cluster, startedAt);
	// ⭐ THE RETRY ITSELF IS AN EVENT, NOT JUST ITS OUTCOME 4s LATER (U-30,
	// 2026-10-08). `recordSettleEvent` below only fired once the retry
	// SETTLES, so a reader who dismisses the "Deployment retry initiated"
	// toast and checks Recent events in the meantime — or whose retry never
	// gets to see this settle, e.g. a quick screenshot — found no trace the
	// retry happened at all. Record the initiation too, immediately, AFTER
	// the Rollout broadcast above so a subscriber's first frame is still the
	// rollout mutation (`state.test.ts`'s SSE ordering assertion).
	recordSettleEvent(
		f,
		namespace,
		name,
		cluster,
		startedAt,
		'Retry',
		`Retry requested for ${headTag}`
	);

	// ⭐ "DEPLOY STARTED" — the second of S-2's four ordered events, logged
	// a short, real beat after "Retry requested" (pods take a moment to
	// pick up the new attempt), not simultaneously with it.
	schedule(() => {
		const at = demoNow();
		recordSettleEvent(
			f,
			namespace,
			name,
			cluster,
			at,
			'ScalingReplicaSet',
			`Deploy started for ${headTag}`
		);
	}, RETRY_DEPLOY_STARTED_MS);

	// ⭐ HEALTH CHECKS RESOLVE BEFORE THE BAKE IS CALLED DONE (S-7, S-2,
	// 2026-10-08). Phase one (pods rolling out) ends here; the checks that
	// went `Pending` at t+0 flip to `Healthy` now, with their own event —
	// phase two (the bake counting that as success) still needs its own
	// beat below, same two-step shape `runGateSequence` uses.
	schedule(() => {
		const at = demoNow();
		for (const hc of retrying) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const status = (hc as any).status;
			status.status = 'Healthy';
			status.message = 'alert is not firing';
			status.lastChangeTime = at.toISOString();
			delete status.nextProbeAt;
		}
		broadcastHealthChecks(retrying, namespace, cluster, at);
		recordSettleEvent(
			f,
			namespace,
			name,
			cluster,
			at,
			'HealthChecksPassed',
			'Every health check is passing again.'
		);
	}, RETRY_CHECKS_PASSING_MS);

	schedule(() => {
		const settledAt = demoNow();
		head.bakeStatus = 'Succeeded';
		head.bakeEndTime = settledAt.toISOString();
		/**
		 * ⛔ AND THE PODS SETTLE WITH IT. The capture caught `deploy
		 * succeeded · 2/2 done` beside a Resources card still reading `1 not
		 * ready · 1/2 pods UPDATING` — the deploy finished and its own
		 * workload was still mid-rollout, which is not a state that exists.
		 * The fixture's 1-of-2 is correct BEFORE the retry (that is what a
		 * failed deploy looks like); at settle every replica is ready.
		 */
		allReplicasReady(f.def.kustomizationKey);
		// …and the log says how it ended — see `recordSettleEvent`.
		recordSettleEvent(
			f,
			namespace,
			name,
			cluster,
			settledAt,
			'BakeSucceeded',
			'Checks passed after the retry; the deploy is complete.'
		);
		broadcastRollout(namespace, name, cluster, settledAt);
		// A `Deployment` event is what reaches the `managed-resources` cache —
		// `applyChangeEvents` matches it by namespace+cluster (see its
		// `managedResourcesNamespaces` branch), so without this the pods stay
		// half-ready on screen until the next slow poll.
		broadcastChanges([
			{
				type: 'update',
				kind: 'Deployment',
				namespace: f.def.kustomizationKey.split('/')[0],
				name,
				cluster,
				resourceVersion: nextRv(),
				ts: settledAt.getTime()
			}
		]);
	}, RETRY_SETTLE_MS);

	return true;
}

export type ChangeVersionBody = {
	version?: string;
	pin?: boolean;
	force?: boolean;
	message?: string;
};

/** Promote / change version / force deploy — see the timing block above.
 * Used identically for a forward promote, an explicit "Change Version"
 * pick, and a force deploy: all three are the same `/change-version` POST
 * from the real UI, differing only in the request body. */
/**
 * ⭐ HOW A PROMOTE THAT NOBODY CLICKED DIFFERS FROM ONE SOMEBODY DID.
 * (2026-09-13, the film's promote chapter.)
 *
 * Not at all, mechanically — the controller writes the same fields and the
 * same beats follow. What differs is WHO the history entry says did it, and
 * that the PIPELINE starts over: an operator picking a build from the dialog
 * is deploying into a stage whose canary already ran, while a gate releasing
 * a build hands the canary a NEW revision to walk. `automatic` carries the
 * first; `restartPipeline` carries the second, and is the reason the demo's
 * KruiseRollout goes back to `Completed` at the settle step.
 */
type PromoteOptions = {
	/** History says `System`, not a person, and the log gets a `Promoted`
	 *  event saying the checks are why. Not reachable from the wire — the
	 *  `/change-version` route never sets it. */
	automatic?: boolean;
	/** The canary re-runs for the new revision: the active stage goes back to
	 *  in-flight. It does NOT touch the health checks — see the gate
	 *  sequence's own note on why they stay passing. */
	restartPipeline?: boolean;
	/** a person's approval released the build: the history row says so (r34 r3-approve) */
	approved?: { name: string; by?: string };
};

export function changeVersion(
	namespace: string,
	name: string,
	body: ChangeVersionBody,
	clusterHint?: string,
	opts?: PromoteOptions
): boolean {
	const f = live.get(fixtureKey(namespace, name));
	if (!f) return false;
	const cluster = clusterHint ?? f.def.cluster;
	// The pending check's own countdown syncs to THIS call's
	// `PROMOTE_HEALTH_MS` — see "THE PENDING COUNTDOWN".
	armPendingProbe(f, PROMOTE_HEALTH_MS, namespace, cluster);
	const rollout = rolloutOf(f);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const releases = (rollout.status.availableReleases as any[]) ?? [];
	const requested = body?.version;
	const target =
		(requested && releases.find((r) => r.tag === requested)?.tag) ||
		releases[releases.length - 1]?.tag ||
		rollout.status.currentVersion;
	const startedAt = demoNow();
	const startedIso = startedAt.toISOString();

	rollout.status.previousVersion = rollout.status.currentVersion;
	rollout.status.currentVersion = target;
	rollout.status.wantedVersion = target;
	/**
	 * ⭐ `body.pin` MUST ACTUALLY PIN (U-4, 2026-10-08). `rollout-cards.ts`'s
	 * `pinnedVersion` — the field the banner/card lock glyph reads — is
	 * `rollout.spec.wantedVersion`, NEVER `status.wantedVersion` above. A
	 * rollback with `{"pin":true}` used to write only the history row's
	 * "Pinned version" message and the status field every other deploy also
	 * writes, so the rollout never actually looked pinned: the banner read
	 * "it is not pinned there" and the controller's own next tick (the
	 * `calm`/`incident` scenario transforms, and any later automatic
	 * promote) was free to move it again. Setting/clearing `spec`'s own
	 * copy is what makes the pin — and therefore the banner, the card lock,
	 * and "automatic deploys are paused" — real. An ordinary deploy (no pin
	 * requested) clears whatever pin was there before it, same as the real
	 * controller: picking a new build is itself the "move forward again".
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const rolloutSpec = (rollout as any).spec ?? ((rollout as any).spec = {});
	if (body?.pin) {
		rolloutSpec.wantedVersion = target;
	} else {
		delete rolloutSpec.wantedVersion;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	recomputeReleaseCandidates(rollout as any);
	rollout.status.history.unshift({
		// `revision` rides along because `ChangeVersionModal`'s
		// `currentRevision` reads `history[0].version.revision` — without it,
		// the deploy dialog opened on the build this mutation just deployed
		// cannot ask GitHub for anything and prints an absence sentence where
		// the commits belong. These fixtures' tags ARE their shas.
		version: { tag: target, version: target, revision: target },
		timestamp: startedIso,
		...(opts?.approved ? { approval: opts.approved } : {}),
		message: opts?.approved
			? `Approved ${target}`
			: opts?.automatic
			? `Promoted ${target}: checks passed`
			: body?.pin
				? 'Pinned version'
				: body?.force
					? `Force deploy version ${target}`
					: '*Manual deployment*',
		triggeredBy: opts?.automatic
			? { kind: 'System', name: 'rollout-controller' }
			: // The signed-in person, by login — the identity the navbar chip
				// shows (`github-data.ts`'s `DEMO_LOGIN`). Was a literal `demo`,
				// which read as a placeholder in the one history row a take makes.
				{ kind: 'User', name: 'danielreed' },
		bakeStatus: 'Deploying',
		bakeStartTime: startedIso
	});
	if (opts?.restartPipeline) restartCanary(f.def.kustomizationKey, target);
	if (opts?.automatic) {
		recordSettleEvent(
			f,
			namespace,
			name,
			cluster,
			startedAt,
			'Promoted',
			`Checks passed, so ${target} is deploying on its own.`
		);
	}
	broadcastRollout(namespace, name, cluster, startedAt);
	if (opts?.restartPipeline) {
		broadcastChanges([
			{
				type: 'update',
				kind: 'Deployment',
				namespace: f.def.kustomizationKey.split('/')[0],
				name,
				cluster,
				resourceVersion: nextRv(),
				ts: startedAt.getTime()
			}
		]);
	}

	schedule(() => {
		const healthyAt = demoNow();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pending = (f.healthChecks.healthChecks as any[]).find(
			(hc) => hc.status?.status === 'Pending'
		);
		if (pending) {
			pending.status.status = 'Healthy';
			pending.status.message = 'alert is not firing';
			pending.status.lastChangeTime = healthyAt.toISOString();
			delete pending.status.nextProbeAt;
			broadcastHealthChecks([pending], namespace, cluster, healthyAt);
		}
	}, PROMOTE_HEALTH_MS);

	schedule(() => {
		const doneAt = demoNow();
		const head = rollout.status.history[0];
		head.bakeStatus = 'Succeeded';
		head.bakeEndTime = doneAt.toISOString();
		// The workload and the log settle with the deploy, same as the retry's
		// own settle step — see `allReplicasReady` and `recordSettleEvent`.
		allReplicasReady(f.def.kustomizationKey);
		if (opts?.restartPipeline) completeCanary(f.def.kustomizationKey, target);
		recordSettleEvent(
			f,
			namespace,
			name,
			cluster,
			doneAt,
			'BakeSucceeded',
			`Checks passed; ${target} is the running build.`
		);
		broadcastRollout(namespace, name, cluster, doneAt);
		broadcastChanges([
			{
				type: 'update',
				kind: 'Deployment',
				namespace: f.def.kustomizationKey.split('/')[0],
				name,
				cluster,
				resourceVersion: nextRv(),
				ts: doneAt.getTime()
			}
		]);
	}, PROMOTE_DONE_MS);

	return true;
}

/**
 * THE MOCK OF THE APPROVALS API (CONTRACT "Dashboard HTTP contract"; lib/api/approvals.ts is the wire doc). Each rollout keeps its
 * RolloutApprovals (`approvalsOf`): approve creates the dashboard's own deterministic-name one (`by: oidc:<viewer>`), revoke deletes it and
 * answers `{ stillApproved, approvals }` while ANOTHER one (a git-written approval) still names the version. The policy-owned gate's allow-list
 * is derived from them, as the controller does (design/APPROVALS-API.md §5.1). `byVerified` is true here: both renderings of a history row exist
 * in the fixtures (a git approval carries no `by`, a dashboard one carries `oidc:<name>`).
 */
export function approvalsOf(namespace: string, name: string): MockApproval[] {
	const k = fixtureKey(namespace, name);
	if (!approvalsByRollout.has(k)) approvalsByRollout.set(k, []);
	return approvalsByRollout.get(k)!;
}
/** the RolloutApproval name for (rollout, version): CONTRACT naming rule, steps 1-3 (a longer name only collides in the mock, which never mints one) */
export function approvalNameOf(rollout: string, version: string): string {
	return `${rollout}-${version.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.replace(/-+$/, '').slice(0, 63);
}

/** Seed the two renderings a History row has: an approval a person gave in the dashboard (`by: oidc:wyatt`) and one written from git (no `by`). hello-world's two older deploys carry them. */
function seedApprovals(): void {
	approvalsByRollout.clear();
	const f = live.get(fixtureKey('default', 'hello-world'));
	if (!f) return;
	const h = rolloutOf(f).status.history as (HistoryEntry & { approval?: { name: string; by?: string }; version?: { tag?: string } })[];
	const at = (i: number, by?: string) => {
		const e = h[i];
		const tag = e?.version?.tag;
		if (!e || !tag) return;
		const name = approvalNameOf('hello-world', tag);
		e.approval = by ? { name, by } : { name };
		approvalsOf('default', 'hello-world').push({ name, version: tag, ...(by ? { by } : {}), createdAt: e.timestamp ?? demoNow().toISOString() });
	};
	at(1, MOCK_APPROVERS.dashboard);
	at(2);
}

/**
 * home-incident / home-edge staging of the `stillApproved` story: payments-core's folded multi-region row needs approval in all five regions
 * until someone presses Approve; at THAT moment a git-style approval (no `by`) for the same build appears in ap-south, as if a colleague had
 * committed it concurrently, so Undo then answers `stillApproved` for ap-south (and a plain revert for the others). Mock only.
 */
const CONCURRENT_GIT_APPROVAL = { namespace: 'payments-core-prod-ap-south', name: 'payments-core', version: 'c0d3e88' };
function concurrentGitApproval(namespace: string, name: string, version: string): void {
	const c = CONCURRENT_GIT_APPROVAL;
	if (namespace !== c.namespace || name !== c.name || version !== c.version) return;
	const list = approvalsOf(namespace, name);
	const gitName = `${name}-${version}-git`;
	if (!list.some((a) => a.name === gitName)) list.push({ name: gitName, version, createdAt: demoNow().toISOString() });
}

/** `POST /api/demo/approvals` (respond.ts): a git-style approval (another RolloutApproval, no `by`) appears for a version, so an Undo of the dashboard's own approval answers `stillApproved`. */
export function seedGitApproval(namespace: string, name: string, version: string, approvalName?: string): boolean {
	approvalsOf(namespace, name).push({ name: approvalName ?? `${approvalNameOf(name, version)}-git`, version, createdAt: demoNow().toISOString() });
	return true;
}

/** Test/demo seam: give a live rollout a policy-owned approval gate (kind `approval`, an empty allow-list: nothing approved yet). */
export function armApprovalGate(namespace: string, name: string, allowed: string[] = []): boolean {
	const f = live.get(fixtureKey(namespace, name));
	if (!f) return false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const st = rolloutOf(f).status as any;
	st.gates = [...(st.gates ?? []).filter((g: ApprovalGate) => g.kind !== 'approval'), { name: 'approval-gate-x7k2q', kind: 'approval', passing: true, allowedVersions: [...allowed] }];
	return true;
}

/**
 * THE PINNED FLEET'S CONTROLLER. A pinned scenario's rollouts (home-incident, home-edge) are served from an immutable fixture, so an approval
 * there never reached a gate and a page that refetched read "held" again under a toast that said "approved". The real controller derives each
 * policy-owned gate's allow-list from the rollout's RolloutApprovals (design/APPROVALS-API.md §5.1); this does the same to a served body:
 * every `kind: approval` gate allows the versions `approvalsOf` holds. Detail (`{ rollout }`) and list (`{ rollouts: { items } }`) bodies.
 */
export function overlayApprovals(body: string | undefined): string | undefined {
	if (!body || !body.includes('allowedVersions')) return body;
	try {
		const j = JSON.parse(body) as { rollout?: { metadata?: { namespace?: string; name?: string }; status?: { gates?: ApprovalGate[] } }; rollouts?: { items?: { metadata?: { namespace?: string; name?: string }; status?: { gates?: ApprovalGate[] } }[] } };
		let changed = false;
		const one = (r: { metadata?: { namespace?: string; name?: string }; status?: { gates?: ApprovalGate[] } } | null | undefined) => {
			if (!r?.metadata?.namespace || !r.metadata.name) return;
			const versions = approvalsOf(r.metadata.namespace, r.metadata.name).map((a) => a.version);
			if (!versions.length) return;
			for (const g of approvalGatesOf(r.status?.gates ?? [])) { for (const v of versions) g.allowedVersions = approvalWrite(g.allowedVersions ?? [], v); changed = true; }
		};
		one(j.rollout);
		for (const r of j.rollouts?.items ?? []) one(r);
		return changed ? JSON.stringify(j) : body;
	} catch { return body; }
}

type ApprovalGate = { name?: string; kind?: string; allowedVersions?: string[] | null };
/** the rollout's approval gates: policy-owned (kind `approval`, an allow-list). The legacy name regex only applies to a gate with no `kind`. */
const approvalGatesOf = (gates: ApprovalGate[]): ApprovalGate[] => gates.filter((g) => g.allowedVersions != null && (g.kind != null ? g.kind === 'approval' : /approval/.test(g.name ?? '')));

export type ApproveResult =
	| { ok: true; status: 200; body: Record<string, unknown> }
	| { ok: false; status: number; error: string };

/**
 * `POST /api/rollouts/:ns/:name/approve`. approve: the RolloutApproval for (rollout, version) exists (idempotent), the approval gates allow the
 * version, and the build deploys the way any promote does (history row carrying `approval`, broadcast, settle). revoke: the dashboard's own approval
 * is deleted; another approval for the version keeps it approved (`stillApproved`); otherwise `approvalUnwrite` takes the version out of the gates
 * and the snapshot taken at approve restores the rest, so Undo inside its window leaves no trace. Every open tab hears the rollout change.
 */
const approvalUndo = new Map<string, { gates: unknown; history: unknown; previousVersion: unknown; currentVersion: unknown; wantedVersion: unknown }>();
/** The Go handler's rule: only a current release candidate can be approved (in `releaseCandidates`, or a catalogue release newer than `history[0]`). */
function isReleaseCandidate(rollout: { status: { history?: { version?: { tag?: string } | string }[]; releaseCandidates?: { tag?: string }[]; availableReleases?: unknown[] } }, version: string): boolean {
	const st = rollout.status;
	if (st.releaseCandidates?.some((r) => r.tag === version)) return true;
	const rel = (st.availableReleases ?? []) as { tag: string }[];
	const hv = st.history?.[0]?.version;
	const head = typeof hv === 'string' ? hv : hv?.tag;
	const at = head ? rel.findIndex((r) => r.tag === head) : -1;
	return rel.some((r, i) => r.tag === version && i > at);
}

export function approveRollout(
	namespace: string,
	name: string,
	body: { version?: string; revoke?: boolean },
	clusterHint?: string
): ApproveResult {
	const version = body?.version;
	if (!version) return { ok: false, status: 400, error: 'version is required' };
	const mine = approvalNameOf(name, version);
	const list = approvalsOf(namespace, name);
	const f = live.get(fixtureKey(namespace, name));
	if (!f) {
		/* the pinned fleet's list pages have no per-rollout mock state (the page's own overlay is the state): the approvals are still kept and answered, so Undo meets the same `stillApproved` */
		if (body?.revoke) {
			const i = list.findIndex((a) => a.name === mine);
			if (i >= 0) list.splice(i, 1);
			const others = list.filter((a) => a.version === version);
			return { ok: true, status: 200, body: others.length ? { stillApproved: true, approvals: others.map((a) => ({ name: a.name, ...(a.by ? { by: a.by } : {}) })) } : {} };
		}
		if (!list.some((a) => a.name === mine)) list.push({ name: mine, version, by: MOCK_APPROVER, createdAt: demoNow().toISOString() });
		concurrentGitApproval(namespace, name, version);
		return { ok: true, status: 200, body: { approval: { name: mine, version, by: MOCK_APPROVER } } };
	}
	const cluster = clusterHint ?? f.def.cluster;
	const rollout = rolloutOf(f);
	const key = fixtureKey(namespace, name);
	if (!body?.revoke && !isReleaseCandidate(rollout as never, version)) return { ok: false, status: 409, error: `version ${version} is not a current release candidate of ${name}` };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const gates = ((rollout.status as any).gates ?? []) as ApprovalGate[];
	if (body?.revoke) {
		const i = list.findIndex((a) => a.name === mine);
		if (i >= 0) list.splice(i, 1);
		const others = list.filter((a) => a.version === version);
		if (others.length) return { ok: true, status: 200, body: { stillApproved: true, approvals: others.map((a) => ({ name: a.name, ...(a.by ? { by: a.by } : {}) })) } };
		const snap = approvalUndo.get(key);
		approvalUndo.delete(key);
		for (const g of approvalGatesOf(gates)) g.allowedVersions = approvalUnwrite(g.allowedVersions ?? [], version);
		if (snap) {
			rollout.status.gates = snap.gates as typeof rollout.status.gates;
			rollout.status.history = snap.history as typeof rollout.status.history;
			rollout.status.previousVersion = snap.previousVersion as typeof rollout.status.previousVersion;
			rollout.status.currentVersion = snap.currentVersion as typeof rollout.status.currentVersion;
			rollout.status.wantedVersion = snap.wantedVersion as typeof rollout.status.wantedVersion;
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		recomputeReleaseCandidates(rollout as any);
		broadcastRollout(namespace, name, cluster, demoNow());
		return { ok: true, status: 200, body: {} };
	}
	const approval = approvalGatesOf(gates);
	if (!approval.length) return { ok: false, status: 409, error: 'nothing waits for approval here' };
	if (!list.some((a) => a.name === mine)) list.push({ name: mine, version, by: MOCK_APPROVER, createdAt: demoNow().toISOString() });
	concurrentGitApproval(namespace, name, version);
	approvalUndo.set(key, {
		gates: structuredClone(gates),
		history: structuredClone(rollout.status.history),
		previousVersion: rollout.status.previousVersion,
		currentVersion: rollout.status.currentVersion,
		wantedVersion: rollout.status.wantedVersion
	});
	for (const g of approval) g.allowedVersions = approvalWrite(g.allowedVersions ?? [], version);
	changeVersion(namespace, name, { version }, clusterHint, { approved: { name: mine, by: MOCK_APPROVER } });
	const a = list.find((x) => x.name === mine)!;
	return { ok: true, status: 200, body: { approval: { name: a.name, version: a.version, ...(a.by ? { by: a.by } : {}) } } };
}

/**
 * `GET|POST /api/demo/deps?step=…` (respond.ts) — one beat of the stepped
 * dependencies story; see `deps-story.ts` for the beats and why. Mutates the
 * scenario dependency rollouts in place and tells every open tab.
 */
export function stepDepsStory(
	step: DepsStep
): { ok: true; step: DepsStep; changed: number } | { ok: false; error: string } {
	const result = runDepsStep(step, scenarioDepRollouts as Record<string, unknown>[], demoNow);
	if (!result.ok) return result;
	const ts = peekDemoClock().getTime();
	broadcastChanges(
		result.changes.map((c) => ({ type: 'update' as const, ...c, resourceVersion: nextRv(), ts }))
	);
	return { ok: true, step: result.step, changed: result.changes.length };
}

/**
 * `GET|POST /api/demo/waves?step=…` (respond.ts) — one beat of the stepped waves story; see
 * `waves-story.ts`. Rebuilds hello-waves' Rollouts and Environments for the beat and tells every tab.
 */
export function stepWavesStory(step: WavesStep): { ok: true; step: WavesStep; changed: number } {
	setWavesStep(step);
	const fresh = mkHwvRollouts(scenario).map(scenarioRollout) as { metadata: { namespace: string; name: string } }[];
	const key = (r: { metadata?: { namespace?: string; name?: string } }) => `${r.metadata?.namespace}/${r.metadata?.name}`;
	const byKey = new Map(fresh.map((r) => [key(r), r]));
	scenarioDepRollouts = [
		...(scenarioDepRollouts as { metadata?: { namespace?: string; name?: string } }[]).map((r) => byKey.get(key(r)) ?? r),
		...fresh.filter((r) => !(scenarioDepRollouts as { metadata?: { namespace?: string; name?: string } }[]).some((x) => key(x) === key(r)))
	];
	replaceHwvEnvironments(mkHwvEnvironments(scenario) as Record<string, unknown>[]);
	const ts = peekDemoClock().getTime();
	const changes = wavesPlaces().flatMap((p) =>
		(['Rollout', 'Environment'] as const).map((kind) => ({
			type: 'update' as const,
			kind,
			namespace: p.namespace,
			name: 'hello-waves-app',
			cluster: p.cluster,
			resourceVersion: nextRv(),
			ts
		}))
	);
	broadcastChanges(changes);
	return { ok: true, step, changed: changes.length };
}
