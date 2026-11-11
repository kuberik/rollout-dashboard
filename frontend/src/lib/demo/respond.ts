/**
 * ONE REQUEST ROUTER FOR THE MOCK, SERVED TWO WAYS.
 *
 * `respond(method, url, opts)` is a PURE function of the request line: it
 * returns either a JSON body or a stream, and knows nothing about Node's
 * `req`/`res`, about `fetch`, or about the environment variables that drive
 * the outage harness. That is what lets the same routing table back both
 *
 *   - `dev-mock-api.ts` — the Vite dev middleware (`MOCK_API=1 vite dev`),
 *     which adapts the result onto a Node response, and
 *   - `./install.ts` — the DEMO BUILD's in-browser `fetch` shim, which adapts
 *     the same result onto a `Response` (a `ReadableStream` body for the
 *     streaming routes, which is exactly what `eventsource-client` reads —
 *     it calls `globalThis.fetch` rather than the platform `EventSource`, so
 *     one shim covers SSE as well).
 *
 * ⛔ NOTHING NODE-SPECIFIC MAY ENTER THIS FILE — see `./mock-data.ts`.
 */

import { applySlicesMode, sliceDetailRollout } from './mock-slices';
import {
	NAMESPACE,
	ROLLOUT_NAME,
	APP_NAMESPACE,
	mockRolloutResponse,
	mockFleetEnvironments,
	mockDepDetails,
	mockClusters,
	stampSourceCluster,
	hcAgo,
	mockSchedules,
	HF_APP
} from './mock-data';
import {
	registerStreamSubscriber,
	hasFixture,
	getDetail,
	getHealthChecks,
	getEvents,
	getManagedResources,
	getPermissionsAll,
	retryRollout,
	approveRollout,
	changeVersion,
	runGateSequence,
	stepPromoteGate,
	stepDepsStory,
	resetDemoState,
	demoClockSnapshot,
	getScenarioFleetRollouts,
	getScenarioDepRollouts,
	getHwEnvRollouts,
	freshenStaticRollout,
	type ChangeVersionBody,
	type Scenario
} from './state';
import { respondGithub } from './github-data';
import {
	deriveGenericDetail,
	deriveGenericEvents,
	deriveGenericHealthChecks,
	CW_NAME,
	CW_NAMESPACE
} from './mock-details';
import {
	DEPS_STEPS,
	depsStoryStep,
	depsStoryTouched,
	getStoryDepEnvironments,
	getStoryDependencies,
	liveCkEnvironmentInfos,
	type DepsStep
} from './deps-story';
import { mkHwEnvironment } from './mock-promote';

/** the detail response, in the served shape and stamped with its source cluster like the list items */
const sliceDetailRollout2 = <B>(body: B): B => sliceDetailRollout(body, stampSourceCluster as never);

/** Pushes one already-framed chunk (SSE frames include their own `\n\n`). */
export type MockSend = (chunk: string) => void;

/**
 * A long-lived response. `start` is called once with the sink, writes whatever
 * it wants to write immediately, and returns a teardown the adapter MUST call
 * when the client goes away — the dev middleware on `req.on('close')`, the
 * browser shim on `AbortSignal` or `ReadableStream.cancel`. Forgetting it is
 * how the dev proxy leaked 1038 subscribers (see `vite.config.ts`).
 */
export type MockStream = { start: (send: MockSend) => () => void };

export type MockResult = {
	status: number;
	headers: Record<string, string>;
	/** Exactly one of these is set. */
	body?: string;
	stream?: MockStream;
};

export type MockOptions = {
	/**
	 * `MOCK_PARTIAL` — the hub FAILS SOFT: 200 with one spoke's rollouts
	 * missing and the spoke named in `clusterErrors`.
	 */
	partial?: boolean;
	/**
	 * `MOCK_FAIL` — adds the one `Normal` + one `Warning` event pair that the
	 * base fixture never produces, so `EventsCard`'s info glyph has a
	 * reachable state.
	 */
	fail?: boolean;
	/**
	 * ⭐ THE REQUEST BODY, RAW — mutations (`/retry`, `/change-version`) carry
	 * JSON (the chosen version, the pin toggle, …). Kept as a raw string here
	 * rather than a parsed object so this file never has to assume anything
	 * about the shape until a specific route needs it — `dev-mock-api.ts`
	 * buffers the Node request body for non-GET methods, `install.ts` reads
	 * `init.body`/`Request.text()`. Absent on GET/HEAD and on any body-less
	 * request either adapter couldn't read.
	 */
	body?: string;
};

/** Parses `opts.body` as JSON, tolerating absent/empty/malformed bodies (a
 * mutation with no body, or `{}`, is still a valid request — every mutation
 * route below has a sensible default for a missing field). */
function parseBody(body: string | undefined): Record<string, unknown> {
	if (!body) return {};
	try {
		const parsed = JSON.parse(body);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SSE_HEADERS = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache',
	Connection: 'keep-alive'
};

const json = (value: unknown, status = 200): MockResult => ({
	status,
	headers: JSON_HEADERS,
	body: JSON.stringify(value)
});

/**
 * ⭐ THE TWO MANIFESTS THE DIFF PAGE NEEDS TO RENDER A REAL DIFF (spec §1).
 * Keyed by build tag, each value is the `files` map the real API returns —
 * one Deployment manifest, a deliberate one-line change between the two
 * (`replicas` 4→6 ahead of the region cutover the note on `b7e0d41`
 * describes, plus the `image:` tag itself) so `createPatch` has something
 * real to show on the Deployment, and a second, untouched ConfigMap file
 * proves the diff page correctly finds files with NO change between the
 * two builds.
 */
/**
 * squad-rollout diff (AD round 6): hello-world-prod's ONLY build. A first
 * deploy has nothing to compare against, so the diff page shows everything
 * this build created as added lines; it needs the manifest to do that.
 */
const HELLO_PROD_MANIFESTS: Record<string, Record<string, string>> = {
	a1b2c3d: {
		'deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-world
  namespace: hello-world-prod
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: hello-world
          image: ghcr.io/exampleco/hello-world:a1b2c3d
          ports:
            - containerPort: 8080
            - name: metrics
              containerPort: 9090
`,
		'service.yaml': `apiVersion: v1
kind: Service
metadata:
  name: hello-world
  namespace: hello-world-prod
spec:
  selector:
    app: hello-world
  ports:
    - port: 80
      targetPort: 8080
`
	}
};

const CK_EDGE_PROD_MANIFESTS: Record<string, Record<string, string>> = {
	// squad-rollout diff (AD round 5): the build before b7e0d41, so
	// /diff/b7e0d41 shows a TWO-resource change (Deployment image + the
	// ConfigMap's cache TTL, anna-ward's "warm the edge cache" deploy) and
	// the page's jump rail has something to do.
	// squad-rollout diff: the build before 55f1a2c in the current history.
	// 55f1a2c is "Bump dependency lockfile", so only the image moves and the
	// ConfigMap shows as unchanged (the page's "unchanged" case).
	'3e9d780': {
		'deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-edge
  namespace: checkout-edge-prod
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: checkout-edge
          image: ghcr.io/exampleco/checkout-edge:3e9d780
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
`,
		'configmap.yaml': `apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-edge-config
  namespace: checkout-edge-prod
data:
  CACHE_TTL_SECONDS: "15"
  LOG_LEVEL: info
`
	},
	'55f1a2c': {
		'deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-edge
  namespace: checkout-edge-prod
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: checkout-edge
          image: ghcr.io/exampleco/checkout-edge:55f1a2c
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
`,
		'configmap.yaml': `apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-edge-config
  namespace: checkout-edge-prod
data:
  CACHE_TTL_SECONDS: "15"
  LOG_LEVEL: info
`
	},
	b7e0d41: {
		'deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-edge
  namespace: checkout-edge-prod
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: checkout-edge
          image: ghcr.io/exampleco/checkout-edge:b7e0d41
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
`,
		'configmap.yaml': `apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-edge-config
  namespace: checkout-edge-prod
data:
  CACHE_TTL_SECONDS: "30"
  LOG_LEVEL: info
`
	},
	d09e6f4: {
		'deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-edge
  namespace: checkout-edge-prod
spec:
  replicas: 6
  template:
    spec:
      containers:
        - name: checkout-edge
          image: ghcr.io/exampleco/checkout-edge:d09e6f4
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
`,
		'configmap.yaml': `apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-edge-config
  namespace: checkout-edge-prod
data:
  CACHE_TTL_SECONDS: "60"
  LOG_LEVEL: info
`
	}
};

/**
 * ⭐ THE INCIDENT'S OWN TWO MANIFESTS (AD round 3, item 2 — "link the live
 * row to its own diff… check the href math against the manifest handler and
 * fix whichever side is wrong"). `checkout-edge-prod` was the only rollout
 * this handler ever answered for — every other rollout's "View diff" link,
 * including `checkout-worker-staging`'s own FAILED live build (the thing a
 * reviewer of the incident scenario clicks first), correctly computed the
 * right href and still landed on the honest "no manifest" empty, because
 * this map simply never had an entry for it. The href math was never wrong;
 * the fixture's own coverage was one rollout too narrow. `a02f1c4`'s own
 * commit title ("Add retry budget to payment webhook",
 * `FLEET_COMMIT_TITLES`/`mock-details.ts`) names the one real line this
 * diff shows — a retry-budget env var that did not exist on `3f1ed09`.
 */
const CW_MANIFESTS: Record<string, Record<string, string>> = {
	'3f1ed09': {
		'deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-worker
  namespace: checkout-worker-staging
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: checkout-worker
          image: ghcr.io/exampleco/checkout-worker:3f1ed09
          env:
            - name: PAYMENT_WEBHOOK_URL
              value: https://payments.internal/webhook
`
	},
	a02f1c4: {
		'deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-worker
  namespace: checkout-worker-staging
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: checkout-worker
          image: ghcr.io/exampleco/checkout-worker:a02f1c4
          env:
            - name: PAYMENT_WEBHOOK_URL
              value: https://payments.internal/webhook
            - name: PAYMENT_WEBHOOK_RETRY_BUDGET
              value: "3"
`
	}
};

/**
 * ⭐ THE HUB'S PATH FORM, FOLDED AWAY ONCE.
 *
 * `/api/clusters/{cluster}/<rest>` is what every URL builder emits since
 * 33601e1 (see `src/lib/api/urls.ts`). The fixtures were written against the
 * deprecated query form, so the prefix is stripped here and every match below
 * stays written against the bare path. `/api/events/stream` is hub-wide and
 * never carries it.
 */
export function stripClusterPrefix(url: string): string {
	return url.replace(/^\/api\/clusters\/[^/]+(?=\/)/, '/api');
}

/**
 * The `<cluster>` segment of `/api/clusters/<cluster>/<rest>`, before
 * `stripClusterPrefix` throws it away — `state.ts`'s mutations need it so a
 * `changes` event they broadcast carries the SAME cluster name the page's
 * own query key was built with (`apiPath(cluster, …)`), rather than each
 * fixture's own hardcoded default (which is only a fallback for a request
 * with no `/clusters/` prefix at all, e.g. a single-cluster dev server).
 */
export function extractClusterHint(rawUrl: string): string | undefined {
	return rawUrl.match(/^\/api\/clusters\/([^/]+)(?=\/)/)?.[1];
}

/**
 * `hasFixture`'s three rollouts are kept LIVE in the fleet list too — a
 * reader who promotes `checkout-api` and then goes back to `/rollouts`
 * should see the build they just deployed, not the frozen fixture. Every
 * other rollout in `rollouts` is untouched.
 */
type Stampable = { metadata?: { namespace?: string; annotations?: Record<string, string> } };
function withLiveOverrides(rollouts: unknown[]): Stampable[] {
	return rollouts.map((r) => {
		const meta = (r as { metadata?: { namespace?: string; name?: string } })?.metadata;
		if (meta?.namespace && meta?.name && hasFixture(meta.namespace, meta.name)) {
			const liveRollout = (getDetail(meta.namespace, meta.name) as { rollout?: unknown })?.rollout;
			if (liveRollout) return liveRollout as Stampable;
		}
		return r as Stampable;
	});
}

/**
 * Every rollout `/api/rollouts` ever lists, by `namespace/name` — the
 * fallback source for U-1's generic detail/events/health-checks derivation.
 * Reads through `getScenarioFleetRollouts`/`getScenarioDepRollouts` (not the
 * raw `mockFleetRollouts`/`mockDepRollouts` exports) so a reader who already
 * promoted a rollout and then opens a DIFFERENT rollout's detail page for
 * the first time still sees the live, scenario'd build — never the frozen
 * one underneath it.
 */
function findListRollout(namespace: string, name: string): Record<string, unknown> | undefined {
	const all = [...getScenarioFleetRollouts(), ...getScenarioDepRollouts()] as {
		metadata?: { namespace?: string; name?: string };
	}[];
	return all.find((r) => r.metadata?.namespace === namespace && r.metadata?.name === name) as
		| Record<string, unknown>
		| undefined;
}

/** The Environment fixture matching a generic rollout's namespace, if any —
 * every `mk*Environment` helper in `mock-data.ts` keys its `metadata.name`/
 * `metadata.namespace` identically to the rollout it belongs to. */
function findListEnvironment(namespace: string): Record<string, unknown> | undefined {
	const all = [...mockFleetEnvironments, ...getStoryDepEnvironments()] as {
		metadata?: { namespace?: string };
	}[];
	return all.find((e) => e.metadata?.namespace === namespace) as Record<string, unknown> | undefined;
}

export function respond(method: string, rawUrl: string, opts: MockOptions = {}): MockResult {
	const clusterHint = extractClusterHint(rawUrl);
	const url = stripClusterPrefix(rawUrl);
	const reqPath = url.split('?')[0];

	// ⭐ GITHUB, MOCKED — another lane's `github-data.ts` answers every GitHub
	// question (`/api/auth/github/status`, commit ranges, `/api/github/changes`,
	// PR/commit-pull lookups) with a connected, populated fixture universe.
	// Tried FIRST: none of its routes overlap this file's `/api/rollouts*`
	// space, and answering here means the navbar stops wearing a permanent
	// "Not configured" badge for the whole film. `null` means "not a GitHub
	// route" — fall through to everything below exactly as before.
	{
		const githubResult = respondGithub(method, reqPath, new URLSearchParams(url.split('?')[1] ?? ''));
		if (githubResult) return githubResult;
	}

	// GET /api/rollouts — the fleet/dependency arrays are read through
	// `getScenarioFleetRollouts`/`getScenarioDepRollouts` (state.ts), never
	// `mockFleetRollouts`/`mockDepRollouts` directly: those are the raw,
	// unscenario'd exports, and serving them here would put a `Failed`
	// rollout back on every page even while `calm` is active.
	if (url === '/api/rollouts') {
		// Some rollouts are served in slices mode (see ./mock-slices.ts).
		const slicesMode = applySlicesMode(withLiveOverrides([
					mockRolloutResponse.rollout,
					...getScenarioFleetRollouts(),
					...getScenarioDepRollouts(),
					// `hello-world-staging`/`hello-world-prod` — the `promote`
					// scenario's chain (mock-promote.ts). No FLEET placeholder to
					// override; these ARE the live fixtures already.
					...getHwEnvRollouts()
				]));
		return json({
			rollouts: { items: slicesMode.rollouts.map(stampSourceCluster) },
			releaseSources: { items: slicesMode.sources.map((x) => stampSourceCluster(x as never)) },
			releaseSlices: { items: slicesMode.slices.map((x) => stampSourceCluster(x as never)) },
			environments: {
				items: [
					...mockFleetEnvironments,
					...getStoryDepEnvironments(),
					// dev/staging/prod, so `groupRolloutsByApp` chains all three of
					// `hello-world`'s environments on `/environments` — see
					// `mock-promote.ts`'s own doc comment.
					mkHwEnvironment('dev'),
					mkHwEnvironment('staging'),
					mkHwEnvironment('prod')
				].map(stampSourceCluster)
			},
			// The `rolloutDependencies` sibling collection, exactly as the
			// hub serves it. See THE DEPENDENCIES FIXTURE in ./mock-data.ts
			// for what each entry is there to exercise.
			// Live copies: `/api/demo/deps?step=` (deps-story.ts) moves them.
			rolloutDependencies: { items: getStoryDependencies() },
			kustomizations: { items: [] },
			kruiseRollouts: { items: [] },
			clusters: opts.partial ? mockClusters.slice(0, 2) : mockClusters,
			clusterErrors: opts.partial
				? [
						{
							name: 'prod',
							url: 'https://kuberik-prod.example.com',
							error:
								'Get "https://kuberik-prod.example.com/api/rollouts": dial tcp 10.96.0.31:443: i/o timeout'
						}
					]
				: []
		});
	}

	/**
	 * ⭐ GET /api/events/stream — OPEN, IDLE, AND HEARTBEATING.
	 *
	 * `src/lib/api/events.ts` keeps one of these per tab and treats a closed
	 * one as "degraded", which falls every query back to its slow poll. There
	 * is nothing to push in a mock (the fixtures never change), so the honest
	 * shape is a stream that connects, announces every cluster healthy once,
	 * and then only heartbeats: a `clusters` snapshot the health helpers can
	 * read, and a message inside the 100s watchdog window so the client does
	 * not tear the connection down and re-invalidate every query on a timer.
	 *
	 * ⭐ AS OF `./state.ts` (2026-09-12) THIS IS NO LONGER IDLE. Every open
	 * connection registers with `registerStreamSubscriber` so a mutation
	 * (retry, change-version) can push a real `changes` event to it — see
	 * `state.ts`'s own top comment. The teardown below unregisters ON TOP OF
	 * clearing the heartbeat interval; dropping either half reproduces the
	 * exact leak `vite.config.ts`'s dev-proxy note warns about.
	 */
	if (reqPath === '/api/events/stream') {
		return {
			status: 200,
			headers: SSE_HEADERS,
			stream: {
				start(send) {
					const health = Object.fromEntries(mockClusters.map((c) => [c.name, true]));
					send(`event: clusters\ndata: ${JSON.stringify(health)}\n\n`);
					const unregister = registerStreamSubscriber(send);
					const interval = setInterval(() => {
						send(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
					}, 30_000);
					return () => {
						clearInterval(interval);
						unregister();
					};
				}
			}
		};
	}

	// GET /api/rollouts/:namespace/:name/events. `MOCK_FAIL` keeps its own
	// exact three-entry set on hello-world (unchanged in content, only its
	// timestamps moved onto the pinned clock — see `hcAgo`'s own doc); every
	// other rollout with a live fixture (task B) answers its own BASE events
	// unconditionally now — nothing in the base fixture ever produced a
	// `Normal` event before this, so `EventsCard`'s info glyph had no
	// reachable state outside the outage harness.
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/events$/);
		if (m) {
			const [, evNs, evName] = m;
			if (opts.fail && evNs === NAMESPACE && evName === ROLLOUT_NAME) {
				return json({
					events: [
						{
							type: 'Normal',
							reason: 'ScalingReplicaSet',
							involvedObject: { kind: 'Deployment', name: ROLLOUT_NAME },
							message: `Scaled up replica set ${ROLLOUT_NAME}-6f8b9c4d7 to 3`,
							lastTimestamp: hcAgo(4)
						},
						{
							type: 'Warning',
							reason: 'Unhealthy',
							involvedObject: { kind: 'Pod', name: `${ROLLOUT_NAME}-6f8b9c4d7-x2k9p` },
							message: 'Readiness probe failed: HTTP probe failed with statuscode: 503',
							lastTimestamp: hcAgo(2)
						},
						{
							type: 'Normal',
							reason: 'Pulled',
							involvedObject: { kind: 'Pod', name: `${ROLLOUT_NAME}-6f8b9c4d7-m4j7q` },
							message: `Container image "hello-world:f68d0ac" already present on machine`,
							lastTimestamp: hcAgo(1.5)
						}
					]
				});
			}
			if (hasFixture(evNs, evName)) return json(getEvents(evNs, evName));
			const listRollout = findListRollout(evNs, evName);
			if (listRollout) return json(deriveGenericEvents(listRollout));
		}
	}

	/**
	 * ⭐ GET /api/rollouts/:namespace/:name/manifest/:tag — the diff page's
	 * own fetch, and the ONLY handler for it anywhere in this file (Lane H,
	 * squad-rollout spec §1, 2026-10-09; nothing served this route before —
	 * every diff page load fell through to a 404, which the diff page's own
	 * guard already turns into the honest "no manifest" EMPTY state, not an
	 * error). `checkout-edge-prod/checkout-edge`'s own last two deploys
	 * (`d09e6f4`, the live build, and `b7e0d41`, the one right before it —
	 * see `HF_LANES`'s `prod` lane in `./mock-data.ts`) get a REAL two-file
	 * k8s manifest each, with a deliberate one-line `image:`/`replicas`
	 * difference between them, so `/diff/d09e6f4` actually renders a diff
	 * in the demo. `checkout-worker-staging/checkout-worker`'s own live pair
	 * (`a02f1c4`/`3f1ed09`, `CW_MANIFESTS` above) gets the same treatment —
	 * the incident scenario's own star rollout, whose "View diff" link used
	 * to compute a perfectly correct href and still land on the empty state
	 * because this handler had never heard of it (AD round 3, item 2). Every
	 * other build on every other rollout answers `{}` — no `files` key —
	 * which the diff page's own `noManifest` guard reads as the §3.15
	 * empty, truthfully: this fixture never recorded a manifest for them.
	 */
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/manifest\/([^/]+)$/);
		if (m) {
			const [, mNs, mName, mTag] = m;
			if (mName === HF_APP && mNs === `${HF_APP}-prod`) {
				const manifest = CK_EDGE_PROD_MANIFESTS[mTag];
				if (manifest) return json({ files: manifest });
			}
			if (mName === 'hello-world' && mNs === 'hello-world-prod') {
				const manifest = HELLO_PROD_MANIFESTS[mTag];
				if (manifest) return json({ files: manifest });
			}
			if (mName === CW_NAME && mNs === CW_NAMESPACE) {
				const manifest = CW_MANIFESTS[mTag];
				if (manifest) return json({ files: manifest });
			}
			return json({});
		}
	}

	// GET /api/rollouts/:namespace/:name — the three LIVE fixtures (state.ts)
	// first, then the frozen dependency/multi-region/high-frequency fixtures
	// `mock-data.ts` already exports.
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)$/);
		if (m) {
			const [, rNs, rName] = m;
			if (hasFixture(rNs, rName)) return json(sliceDetailRollout2(getDetail(rNs, rName)));
			const detail = mockDepDetails[`${rNs}/${rName}`] as Record<string, unknown> | undefined;
			// A rollout the dependencies story has moved is served LIVE, its
			// promotion chain read from the live histories too.
			if (detail && depsStoryTouched(rNs, rName)) {
				const rollouts = getScenarioDepRollouts() as { metadata?: { namespace?: string; name?: string } }[];
				const live = rollouts.find((r) => r.metadata?.namespace === rNs && r.metadata?.name === rName);
				const env = detail.environment as { status?: Record<string, unknown> } | undefined;
				return json(sliceDetailRollout2({
					...detail,
					rollout: live ?? detail.rollout,
					...(env
						? {
								environment: {
									...env,
									status: {
										...env.status,
										environmentInfos: liveCkEnvironmentInfos(rollouts as Record<string, never>[])
									}
								}
							}
						: {})
				}));
			}
			if (detail) {
				// `detail.rollout` here is the SAME object `mockDepRollouts` was
				// built from (never cloned, never scenario-mapped — see
				// `freshenStaticRollout`'s own doc comment in state.ts), so
				// neither `getScenarioDepRollouts` nor `getDetail` ever
				// freshens it. Clone before mutating: this object is shared
				// with `mockDepRollouts`'s construction and other requests.
				const clone = structuredClone(detail) as { rollout?: unknown };
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				freshenStaticRollout(clone.rollout as any);
				return json(sliceDetailRollout2(clone));
			}
			const listRollout = findListRollout(rNs, rName);
			if (listRollout) return json(sliceDetailRollout2(deriveGenericDetail(listRollout, findListEnvironment(rNs))));
		}
	}

	// GET /api/rollouts/:namespace/:name/permissions/all — task A.5: EVERY
	// rollout answers the hello-world shape now, not just hello-world itself
	// (this used to be the reason `checkout-api-prod-us-east-2/checkout-api`
	// had no buttons at all on its own page).
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/permissions\/all$/);
		if (m) return json(getPermissionsAll(m[1], m[2]));
	}

	// POST /api/rollouts/:namespace/:name/approve — the approval contract (src/lib/api/approvals.ts).
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/approve$/);
		if (m && method !== 'GET') {
			/* the pinned fleet's list pages (payments-core's regions, telemetry-indexer ...) have no per-rollout mock state: the page's own overlay is the state, the request is accepted */
			if (!hasFixture(m[1], m[2])) return json({});
			const r = approveRollout(m[1], m[2], parseBody(opts.body) as { version?: string; revoke?: boolean }, clusterHint);
			return r.ok ? json({}) : json({ error: r.error }, r.status);
		}
	}

	// POST /api/rollouts/:namespace/:name/retry — task A.4/A.1.
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/retry$/);
		if (m && method !== 'GET' && hasFixture(m[1], m[2])) {
			retryRollout(m[1], m[2], clusterHint);
			return json({});
		}
	}

	// POST /api/rollouts/:namespace/:name/change-version — the same route the
	// real backend and `ChangeVersionModal` use for a forward promote, an
	// explicit version pick, AND a force deploy (differ only in the body).
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/change-version$/);
		if (m && method !== 'GET' && hasFixture(m[1], m[2])) {
			changeVersion(m[1], m[2], parseBody(opts.body) as ChangeVersionBody, clusterHint);
			return json({});
		}
	}

	// POST /api/rollouts/:namespace/:name/force-deploy — the real backend's
	// OWN separate route (`main.go`, see `history-marks.ts`'s doc comment:
	// `/pin`, `/force-deploy` and `/change-version` are three distinct
	// handlers), even though nothing in THIS frontend ever calls it directly
	// — `ChangeVersionModal` always POSTs `/change-version` with its own
	// `force`-shaped body. Mapped onto the same mutation with `force: true`
	// forced on (tl-dashboard-demo-2: "the product's own force-deploy path
	// must work in the demo") so a script or a future UI control that DOES
	// call this route the way the real backend expects gets the same
	// deterministic transition `/change-version` already produces, not a
	// silent no-op.
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/force-deploy$/);
		if (m && method !== 'GET' && hasFixture(m[1], m[2])) {
			changeVersion(m[1], m[2], { ...parseBody(opts.body), force: true } as ChangeVersionBody, clusterHint);
			return json({});
		}
	}

	// GET/POST /api/demo/reset[?scenario=calm|incident|wide] — restores every
	// live fixture byte-for-byte and cancels every pending transition timer
	// (task A.1). GET as well as POST so a plain browser address-bar visit
	// works, not just curl. `?scenario=` SWITCHES the active scenario; a
	// plain reset with no query keeps whatever scenario is already active —
	// see `resetDemoState`'s own doc comment in state.ts. `wide` (round 5
	// QA-5 item 2) is review-only — see `Scenario`'s own doc comment.
	if (reqPath === '/api/demo/reset') {
		const requested = new URLSearchParams(url.split('?')[1] ?? '').get('scenario');
		const scenarioParam: Scenario | undefined =
			requested === 'calm' || requested === 'incident' || requested === 'wide'
				? requested
				: undefined;
		resetDemoState(scenarioParam);
		return json({ ok: true });
	}

	// GET/POST /api/demo/gate?rollout=<namespace>/<name> — the scripted gate
	// sequence (state.ts's `runGateSequence` carries the beats and the
	// reason). GET as well as POST for the same reason `reset` takes both: a
	// capture script and an address bar should both be able to fire it.
	// Idempotent per reset, so a double call does not run two sequences.
	//
	// ⭐ `&step=pass|promote|done` — the `promote` SCENARIO'S EXPLICIT BEATS
	// (2026-09-21). With `step` present, this calls `stepPromoteGate` instead
	// of `runGateSequence`: ONE beat, synchronously, no `setTimeout` — a
	// capture script drives `pass` → screenshot → `promote` → screenshot →
	// `done` → screenshot with no dependency on the server's wall clock.
	// Without `step` (every existing take), behaviour is BYTE-IDENTICAL to
	// before: `runGateSequence`'s own timers still carry the beats.
	if (reqPath === '/api/demo/gate') {
		const params = new URLSearchParams(url.split('?')[1] ?? '');
		const rollout = params.get('rollout') ?? `${NAMESPACE}/${ROLLOUT_NAME}`;
		const step = params.get('step');
		const [ns, nm] = rollout.split('/');
		if (!ns || !nm || !hasFixture(ns, nm)) {
			return json({ ok: false, error: `no such rollout: ${rollout}` }, 404);
		}
		if (step === 'arm' || step === 'pass' || step === 'promote' || step === 'done') {
			const result = stepPromoteGate(ns, nm, step, clusterHint);
			return json({ ...result, rollout, step }, result.ok ? 200 : 400);
		}
		if (step !== null) {
			return json({ ok: false, error: `unknown step: ${step}` }, 400);
		}
		runGateSequence(ns, nm, clusterHint);
		return json({ ok: true, rollout });
	}

	// GET/POST /api/demo/deps?step=ledger|payments|staging|regions — the
	// stepped dependencies story: "nothing moves before its dependencies",
	// enacted one synchronous beat at a time (deps-story.ts has the beats).
	// In order; repeating the current step is a no-op; `/api/demo/reset`
	// returns to `arm`. `?step` omitted reports where the story is.
	if (reqPath === '/api/demo/deps') {
		const step = new URLSearchParams(url.split('?')[1] ?? '').get('step');
		if (step === null) return json({ ok: true, step: depsStoryStep(), steps: DEPS_STEPS });
		if (!(DEPS_STEPS as readonly string[]).includes(step)) {
			return json({ ok: false, error: `unknown step: ${step}`, steps: DEPS_STEPS }, 400);
		}
		const result = stepDepsStory(step as DepsStep);
		return json(result, result.ok ? 200 : 409);
	}

	// GET /api/demo/now — the demo's own clock, anchored to the pinned
	// `MOCK_NOW` instant plus whatever this module has stamped since. The
	// capture harness pins the page's clock from this.
	if (reqPath === '/api/demo/now') {
		return json(demoClockSnapshot());
	}

	// GET /api/rollouts/:namespace/:name/rollout-tests
	if (reqPath === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/rollout-tests`) {
		const managedResources = getManagedResources(NAMESPACE, ROLLOUT_NAME) ?? [];
		const rolloutTestObject = managedResources.find(
			(r) => (r as { groupVersionKind?: string }).groupVersionKind === 'rollout.kuberik.com/v1alpha1/RolloutTest'
		) as { object?: unknown } | undefined;
		return json({
			rolloutTests: { items: rolloutTestObject ? [rolloutTestObject.object] : [] },
			kruiseRollout: null
		});
	}

	// GET /api/rollouts/:namespace/:name/schedules and GET /api/schedules —
	// the `RolloutSchedule` fixture (`mockSchedules`: checkout-api staging's
	// open `Business hours` window, the Gates tab's filmed page). Same shapes
	// as `main.go`; no ClusterRolloutSchedules in the demo.
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/schedules$/);
		if (m) {
			return json({
				rolloutSchedules: { items: mockSchedules(m[1]) },
				clusterRolloutSchedules: { items: [] }
			});
		}
		if (reqPath === '/api/schedules') {
			const ns = new URLSearchParams(url.split('?')[1] ?? '').get('namespace') ?? 'all';
			const all = ns === 'all' || ns === '*' || ns === '';
			return json({
				rolloutSchedules: { items: mockSchedules(all ? undefined : ns) },
				clusterRolloutSchedules: { items: [] }
			});
		}
	}

	// GET /api/rollouts/:namespace/:name/health-checks — any live fixture.
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/health-checks$/);
		if (m) {
			if (hasFixture(m[1], m[2])) return json(getHealthChecks(m[1], m[2]));
			const listRollout = findListRollout(m[1], m[2]);
			if (listRollout) return json(deriveGenericHealthChecks(listRollout));
		}
	}

	// GET /api/rollouts/:namespace/:name/pods/logs (SSE stream)
	if (url.startsWith(`/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/pods/logs`)) {
		// ⭐ THE SOURCE FILTER, HONOURED (logs round 7, AD round 3, item 1:
		// "the Tests source shows only its own lines. Today it's mostly
		// app-pod lines"). `createLogsStreamUrl` has always put `filterType`
		// on the wire as `?type=pod|test` (src/lib/api/logs.ts) — this
		// handler just never read it, so BOTH views got the same mixed
		// stream and the Tests pane only looked populated because the
		// 30-line app-pod burst outnumbered its own 8 lines nearly 4:1.
		// `pod` is the default for every OTHER caller of this route (no
		// `type` param at all) — never `test`, so an unfiltered request
		// still reads as "pods", not "everything".
		const typeFilter = new URLSearchParams(url.split('?')[1] ?? '').get('type') ?? 'pod';
		return {
			status: 200,
			headers: SSE_HEADERS,
			stream: {
				start(send) {
					const pods = [
						{ name: `${ROLLOUT_NAME}-6f8b9c4d7-x2k9p`, namespace: APP_NAMESPACE, type: 'pod' },
						{ name: `${ROLLOUT_NAME}-6f8b9c4d7-m4j7q`, namespace: APP_NAMESPACE, type: 'pod' },
						{ name: `${ROLLOUT_NAME}-test-f68d0ac-zt5rn`, namespace: APP_NAMESPACE, type: 'test' }
					];

					// Send pods event first
					send(`event: pods\ndata: ${JSON.stringify(pods)}\n\n`);

					// Sample log lines for realistic output
					const sampleLogs = [
						{ level: 'INFO', msg: 'Starting server on :8080 with configuration loaded from /etc/config/app.yaml, environment=production, region=eu-west-1, instance_id=i-0a1b2c3d4e5f6g7h8' },
						{ level: 'INFO', msg: 'Connected to database postgresql://db.internal.cluster.local:5432/hello_world?sslmode=require&connect_timeout=10&application_name=hello-world-api-server' },
						{ level: 'DEBUG', msg: 'Loading configuration from /etc/config/app.yaml: database.pool_size=25, database.max_idle=5, cache.ttl=300s, cache.backend=redis, tracing.enabled=true, tracing.sample_rate=0.1' },
						{ level: 'INFO', msg: 'Health check endpoint registered at /healthz | Readiness probe: /ready | Liveness probe: /alive | Startup probe: /startup (timeout: 30s)' },
						{ level: 'INFO', msg: 'Metrics endpoint registered at /metrics (prometheus format) | Custom metrics: http_requests_total, http_request_duration_seconds, db_query_duration_seconds, cache_hit_ratio' },
						{ level: 'INFO', msg: 'Ready to accept connections on 0.0.0.0:8080 (HTTP) and 0.0.0.0:8443 (HTTPS) | TLS certificate loaded from /etc/tls/tls.crt, key from /etc/tls/tls.key' },
						{ level: 'INFO', msg: 'GET /api/v1/users?page=1&limit=50&sort=created_at&order=desc 200 12ms | request_id=req_a1b2c3d4 | user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" | ip=10.244.3.15' },
						{ level: 'DEBUG', msg: 'Cache hit for key: users:list:page=1:limit=50:sort=created_at:order=desc | cache_backend=redis | ttl_remaining=245s | size=12.4KB | compression=gzip' },
						{ level: 'INFO', msg: 'POST /api/v1/orders 201 45ms | request_id=req_e5f6g7h8 | order_id=ord_9f8e7d6c | total=149.99 | currency=EUR | items=3 | payment_method=stripe' },
						{ level: 'WARN', msg: 'Slow query detected: SELECT o.*, u.name, u.email FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status = $1 AND o.created_at > $2 ORDER BY o.created_at DESC LIMIT 100 -- execution_time=320ms threshold=200ms rows_returned=87' },
						{ level: 'INFO', msg: 'GET /api/v1/products?category=electronics&brand=samsung&min_price=100&max_price=2000&in_stock=true&sort=popularity 200 8ms | results=142 | cache=HIT' },
						{ level: 'ERROR', msg: 'Failed to connect to redis at redis-master.cache.svc.cluster.local:6379 - ECONNREFUSED | retry_attempt=3/5 | backoff=8s | last_successful_connection=2m30s ago | pending_operations=12' },
						{ level: 'INFO', msg: 'Retrying redis connection in 5s... | connection_pool: active=0/25 idle=0/5 | fallback_mode=local_cache | degraded_features=[session_store, rate_limiter, pub_sub]' },
						{ level: 'INFO', msg: 'Redis connection re-established to redis-master.cache.svc.cluster.local:6379 | latency=2.3ms | pool_recovered: active=3/25 idle=5/5 | replaying 12 buffered operations' },
						{ level: 'DEBUG', msg: 'Processing webhook payload: {"event":"order.completed","id":"ord_9f8e7d6c","customer_id":"cust_x1y2z3","amount":149.99,"currency":"EUR","items":[{"sku":"SKU-001","qty":1},{"sku":"SKU-042","qty":2}],"metadata":{"source":"web","campaign":"summer-sale"}}' },
						{ level: 'INFO', msg: 'GET /healthz 200 1ms | checks: database=ok(2ms) redis=ok(1ms) disk=ok(89% free) memory=ok(654MB/1024MB) goroutines=142 uptime=4h23m' },
						{ level: 'INFO', msg: 'Graceful shutdown initiated (SIGTERM received), draining 23 active connections... | in_flight_requests=23 | drain_timeout=30s | active_websockets=5 | background_jobs=3' },
						{ level: 'INFO', msg: 'All connections drained successfully in 2.4s, shutting down HTTP server | total_requests_served=1,284,567 | uptime=4h23m12s | avg_response_time=18ms' },
						{ level: 'WARN', msg: 'High memory usage detected: 892MB / 1024MB (87%) | heap_alloc=756MB heap_sys=892MB stack_inuse=12MB gc_pause_avg=4.2ms num_goroutines=342 | consider increasing memory limit' },
						{ level: 'INFO', msg: 'GC completed: freed 245MB in 12ms | before=892MB after=647MB | next_gc_target=780MB | total_gc_cycles=1847 | cpu_fraction=0.02%' },
					];

					// ⭐ ALL PASSING (reverted 2026-10-10, coordinator ruling: this
					// is hello-world's test run, visible on the CALM scenario —
					// calm must have zero failures; exactly one failure belongs
					// to the incident's own rollout, checkout-worker-staging,
					// not here). Matches the `RolloutTest` fixture's own
					// terminal condition in mock-data.ts ("Test suite completed:
					// 7/7 passed") — the two have to agree, which is the whole
					// reason this file was wrong before (phase Succeeded over a
					// log that narrated a FAILED test).
					const testLogs = [
						{ level: 'INFO', msg: 'Running test suite: integration' },
						{ level: 'INFO', msg: 'Test: health check endpoint ... PASSED (2ms)' },
						{ level: 'INFO', msg: 'Test: create user ... PASSED (145ms)' },
						{ level: 'WARN', msg: 'Test: update user with invalid email ... PASSED (12ms) [expected 400]' },
						{ level: 'INFO', msg: 'Test: list orders with pagination ... PASSED (89ms)' },
						{ level: 'INFO', msg: 'Test: concurrent writes ... PASSED (156ms)' },
						{ level: 'INFO', msg: 'Test: delete expired sessions ... PASSED (234ms)' },
						{ level: 'INFO', msg: 'Test suite completed: 7/7 passed' },
					];

					let logIndex = 0;
					// ⭐ ANCHORED TO `Date.now()`, NOT `hcNow` (logs round 7,
					// sr-histo's own finding): `hcNow` drifts behind the real
					// clock on a long-running dev server between resets
					// (~10 min measured live), which read as a false silent
					// gap between the backlog's last line and the live
					// trickle's first one. `peekDemoClock()` was tried next
					// (the capture harness pins the PAGE clock to the demo
					// clock) and then explicitly reverted — squad-rollout
					// lead's ruling: the owner reviews in a plain browser,
					// where a demo-clock line can trail the real clock by
					// minutes and read as dead; the capture case belongs on
					// the histogram's own side instead (window end =
					// `max(now, newest line)`, sr-histo's fix, not this
					// handler's). The 30-line backlog spans `now - 60s …
					// now`; new streamed lines below continue from there via
					// `streamedCount` (see that block's own doc — also
					// `Date.now()`-stamped, same round).
					const baseTime = Date.now() - 60000; // Start logs 1 min before now

					// `steadySampleLogs` (used by the backlog loop right below
					// AND the trickle further down, same fix both places —
					// see item 7's own doc near the trickle) excludes
					// `sampleLogs`' boot (0-5) and shutdown (15-16) lines.
					const steadySampleLogs = sampleLogs.slice(6, 15);

					// Send a burst of initial historical logs — app-pod lines only
					// on the `pod` source, never mixed into `test`. Boot
					// sequence plays ONCE, at the very start (the oldest,
					// truest "pod start" in this backlog) — `i <
					// sampleLogs.length` — then steady traffic only, same
					// "boot lines once" fix item 7 gave the trickle, applied
					// to the backlog too (logs round 9 screenshot review).
					const initialCount = 30;
					if (typeFilter !== 'test') {
						for (let i = 0; i < initialCount; i++) {
							const pod = pods[i % 2]; // Alternate between the two app pods
							const sample =
								i < sampleLogs.length
									? sampleLogs[i]
									: steadySampleLogs[(i - sampleLogs.length) % steadySampleLogs.length];
							const ts = baseTime + i * 2000;
							const logLine = {
								pod: pod.name,
								container: 'app',
								type: pod.type,
								line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
								timestamp: ts
							};
							send(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
						}
					}

					// Send the test run's own logs — only on the `test` source.
					// ⭐ `i * 2000`, NOT `(initialCount + i) * 2000` (logs round 7,
					// sr-histo's own finding): the old offset started the test
					// run's 8 lines at `baseTime + 60s`, i.e. AT `Date.now()`
					// (`baseTime` is `now - 60s`) and ran them 16s into the
					// FUTURE — a fixed "window ending at now" histogram clamps
					// a future timestamp into its last bucket, so the Tests
					// source drew almost nothing. This run finished a while
					// ago (the Sources pane already says so), so its own last
					// line belongs in the PAST: `i * 2000` ends the 8-line run
					// at `baseTime + 14s`, i.e. `now - 46s`.
					if (typeFilter === 'test') {
						for (let i = 0; i < testLogs.length; i++) {
							const ts = baseTime + i * 2000;
							const logLine = {
								pod: pods[2].name,
								container: 'test-runner',
								type: 'test',
								line: `${new Date(ts).toISOString()} ${testLogs[i].level} ${testLogs[i].msg}`,
								timestamp: ts
							};
							send(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
						}
					}

					// Stream new logs periodically — `streamedCount` is a
					// per-connection counter (see the anchoring note above) for
					// which sample plays next, cycling every 2s. The TIMESTAMP
					// is `Date.now()` (see `baseTime`'s own doc for why, and
					// for why not `hcNow`/`peekDemoClock()`) — lines genuinely
					// arriving live, right now, are stamped with the real
					// instant they actually arrive, not a precomputed offset
					// from `baseTime`.
					// Each source streams only its OWN new lines: `pod` keeps
					// cycling `sampleLogs`, `test` replays the finished run's own
					// `testLogs` (a real test runner does not invent new lines
					// once its suite has completed — looping its OWN transcript
					// is the honest way to keep that source looking "Live" rather
					// than borrowing the app pod's unrelated traffic).
					// ⭐ STEADY-STATE ONLY (logs round 8, item 7 — same fix as
					// calm/incident's own trickles, see either one's doc):
					// `sampleLogs` indices 0-5 are this pod's BOOT sequence,
					// 15-16 are a graceful SHUTDOWN — neither belongs on a
					// running pod's live tail, which should never re-announce
					// "Starting server…" or "Graceful shutdown initiated…"
					// every couple of trickle ticks while restarts stay at 0.
					// (`steadySampleLogs` is declared ahead of the backlog
					// loop above, which now also reads it.)
					const interval = setInterval(() => {
						const ts = Date.now();
						if (typeFilter === 'test') {
							const sample = testLogs[logIndex % testLogs.length];
							const logLine = {
								pod: pods[2].name,
								container: 'test-runner',
								type: 'test',
								line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
								timestamp: ts
							};
							send(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
						} else {
							const pod = pods[logIndex % 2];
							const sample = steadySampleLogs[logIndex % steadySampleLogs.length];
							const logLine = {
								pod: pod.name,
								container: 'app',
								type: pod.type,
								line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
								timestamp: ts
							};
							send(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
						}
						logIndex++;
					}, 2000);

					return () => clearInterval(interval);
				}
			}
		};
	}

	// GET /api/rollouts/checkout-edge-prod/checkout-edge/pods/logs (SSE
	// stream) — Lane L, logs redesign (2026-10-09, SPEC.md §2). The spec's
	// own "the bar, as built" subject: a calm, multi-pod (3 replicas)
	// rollout, so the Sources pane and the "N pods" rollup have more than
	// one row to show. A couple of WARN lines (slow query, high memory) are
	// mixed into otherwise-healthy output — calm does not mean silent.
	if (url.startsWith('/api/rollouts/checkout-edge-prod/checkout-edge/pods/logs')) {
		return {
			status: 200,
			headers: SSE_HEADERS,
			stream: {
				start(send) {
					// ageSeconds/restarts are the optional, additive `PodInfo`
					// fields the AD's round-2 "also" bullets ask the Pods
					// rows to show when present (see that type's own doc in
					// $lib/api/logs.ts) — calm is the demo's one fixture that
					// actually carries them, so the "12m · 0 restarts" shape
					// has somewhere real to render.
					const pods = [
						{
							name: 'checkout-edge-d09e6f4-7c9f6b5d8-2kxpn',
							namespace: 'checkout-edge-prod',
							type: 'pod',
							ageSeconds: 720,
							restarts: 0
						},
						{
							name: 'checkout-edge-d09e6f4-7c9f6b5d8-9qr4t',
							namespace: 'checkout-edge-prod',
							type: 'pod',
							ageSeconds: 705,
							restarts: 0
						},
						{
							name: 'checkout-edge-d09e6f4-7c9f6b5d8-f2m8w',
							namespace: 'checkout-edge-prod',
							type: 'pod',
							ageSeconds: 692,
							restarts: 0
						}
					];
					send(`event: pods\ndata: ${JSON.stringify(pods)}\n\n`);

					const lines = [
						{ level: 'INFO', msg: 'Starting checkout-edge build d09e6f4, env=prod region=eu-west-1' },
						{ level: 'INFO', msg: 'Loaded config from /etc/config/app.yaml: edge_cache.ttl=60s, routes=142' },
						{ level: 'INFO', msg: 'Connected to upstream checkout-api.prod-us-east-2.svc.cluster.local:443' },
						{ level: 'INFO', msg: 'Edge cache warmup: primed 1,284 routes in 820ms' },
						{ level: 'INFO', msg: 'Health check endpoint registered at /healthz' },
						{ level: 'INFO', msg: 'Ready to accept connections on 0.0.0.0:8080' },
						{ level: 'INFO', msg: 'GET /checkout/session 200 14ms | request_id=req_7f2a9c | cache=HIT' },
						{ level: 'INFO', msg: 'POST /checkout/complete 200 92ms | order_id=ord_4b1e02 | total=84.50 | currency=USD' },
						{ level: 'WARN', msg: 'Slow upstream response from checkout-api: 640ms (threshold 500ms) | path=/v1/pricing' },
						{ level: 'INFO', msg: 'GET /checkout/session 200 11ms | request_id=req_3d8e71 | cache=HIT' },
						{ level: 'INFO', msg: 'POST /checkout/complete 200 88ms | order_id=ord_91af3c | total=212.00 | currency=USD' },
						{ level: 'DEBUG', msg: 'Cache hit for key: pricing:eu-west-1:v3 | ttl_remaining=41s' },
						{ level: 'WARN', msg: 'Edge cache memory at 81% (819MB/1024MB) | eviction_policy=lru | consider raising limit' },
						{ level: 'INFO', msg: 'GET /checkout/session 200 9ms | request_id=req_a0119f | cache=HIT' },
						{ level: 'INFO', msg: 'Readiness probe OK | checks: upstream=ok(12ms) cache=ok(1ms) disk=ok(74% free)' }
					];

					// ⭐ REAL VARIANCE, NOT A METRONOME (art director round 1,
					// must-fix #2, then round 4: "bursts and quiet spells…
					// today the histogram is a flat wall of near-max bars").
					// The round-1 fix cycled a micro-pattern every 40 lines
					// (one 9s gap, one burst, 32 ordinary lines) — at a
					// roughly CONSTANT underlying rate the whole way
					// through, which is exactly what reads as a flat wall
					// once there are enough lines to fill 90 buckets: every
					// bucket lands close to the SAME average, because the
					// variance was all inside one bucket's own width, not
					// across many. This drives the stride off ELAPSED TIME
					// in a 3-minute macro cycle instead: ~95s QUIET (one
					// line every 2.2-4.5s, ~0.2-0.45 lines/s — a real idle
					// stretch, not a smaller number squeezed into the same
					// bucket), a 9s probe gap at the quiet stretch's own
					// tail, then ~76s BUSY (one line every 0.35-0.87s,
					// ~1.1-2.9 lines/s). Over a 14-minute backlog that is
					// ~4.5 full quiet/busy cycles — SEVERAL buckets of real
					// valley, several of real spike, not one of each lost
					// in the crowd. Deterministic throughout (time- and
					// count-indexed, never `Math.random()`), and loops on
					// ELAPSED TIME rather than a fixed line count so the
					// 14-minute target stays exact regardless of how dense
					// any given stretch turns out to be.
					const CALM_BACKLOG_MS = 14 * 60_000;
					const offsets: number[] = [];
					{
						let t = 0;
						while (t < CALM_BACKLOG_MS) {
							const cyclePos = t % 180_000;
							let stride: number;
							if (cyclePos < 95_000) {
								stride = 2200 + (offsets.length % 7) * 350; // quiet
							} else if (cyclePos < 104_000) {
								stride = 9000; // the probe gap
							} else {
								stride = 350 + (offsets.length % 5) * 130; // busy
							}
							t += stride;
							offsets.push(t);
						}
					}
					const initialCount = offsets.length;
					const baseTime = Date.now() - offsets[offsets.length - 1];
					// ⭐ `steadyLines` (lines minus the 6-line boot sequence,
					// see its own doc below) is declared here, ahead of the
					// backlog loop that now ALSO uses it — a ~14-minute
					// backlog cycling the full `lines` array via `i %
					// lines.length` repeats "Starting checkout-edge build…"
					// roughly every 15 lines throughout HISTORY, the exact
					// same crash-loop reading item 7 already fixed for the
					// live trickle, just in the replay instead of the tail.
					// `i < lines.length ? lines[i] : steadyLines[...]` plays
					// the boot sequence once, at the very start (the
					// oldest, truest "pod start" moment in this backlog),
					// then steady traffic only for the rest of it.
					const steadyLines = lines.slice(6);
					for (let i = 0; i < initialCount; i++) {
						const pod = pods[i % pods.length];
						const sample =
							i < lines.length ? lines[i] : steadyLines[(i - lines.length) % steadyLines.length];
						const ts = baseTime + offsets[i];
						send(
							`event: log\ndata: ${JSON.stringify({
								pod: pod.name,
								container: 'app',
								type: 'pod',
								line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
								timestamp: ts
							})}\n\n`
						);
					}
					// ⭐ STEADY-STATE ONLY (logs round 8, item 7: "boot lines once
					// per pod start, not every 15s — today it reads as a crash
					// loop with 0 restarts"). The trickle used to cycle the
					// SAME `lines` array the backlog draws from, index 0-5 of
					// which are the pod's own BOOT sequence ("Starting
					// checkout-edge build…", "Ready to accept connections…")
					// — those belong once, at startup (the backlog loop above
					// now plays them exactly once too, same round, see its
					// own doc), not every ~37s just because the trickle
					// happened to cycle back to index 0. `steadyLines` itself
					// is declared ahead of the backlog loop above, which now
					// also reads it.
					let streamedCount = 0;
					const interval = setInterval(() => {
						const pod = pods[streamedCount % pods.length];
						streamedCount += 1;
						const sample = steadyLines[streamedCount % steadyLines.length];
						const ts = Date.now();
						send(
							`event: log\ndata: ${JSON.stringify({
								pod: pod.name,
								container: 'app',
								type: 'pod',
								line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
								timestamp: ts
							})}\n\n`
						);
					}, 2500);
					return () => clearInterval(interval);
				}
			}
		};
	}

	// GET /api/rollouts/checkout-worker-staging/checkout-worker/pods/logs
	// (SSE stream) — Lane L, logs redesign. The incident subject
	// (SPEC.md §2's "the bar, as built"): a failed rollout, two pods, with
	// real 5xx/upstream-timeout ERROR lines so the Error level pill, the
	// danger left-rule and the Card rollup's "N errors" link all have
	// something to show on 5251.
	if (url.startsWith('/api/rollouts/checkout-worker-staging/checkout-worker/pods/logs')) {
		return {
			status: 200,
			headers: SSE_HEADERS,
			stream: {
				start(send) {
					const pods = [
						// ⭐ AGE/RESTARTS HERE TOO (logs round 8, item 6) — calm
						// got these in round 5; the incident's own pods were
						// left without them, which is the one inconsistency
						// item 3's "age/restarts show on every source when
						// known" (round 5) didn't actually close. `restarts:
						// 0` is honest, not a glossing-over: the failures here
						// are the APPLICATION erroring against payments-svc,
						// never a pod crash — a crash-looping pod would be a
						// different, worse incident this fixture is not
						// telling.
						{
							name: 'checkout-worker-a02f1c4-5d6f7b9c8-h7k2x',
							namespace: 'checkout-worker-staging',
							type: 'pod',
							ageSeconds: 245,
							restarts: 0
						},
						{
							name: 'checkout-worker-a02f1c4-5d6f7b9c8-n9p1v',
							namespace: 'checkout-worker-staging',
							type: 'pod',
							ageSeconds: 238,
							restarts: 0
						}
					];
					send(`event: pods\ndata: ${JSON.stringify(pods)}\n\n`);

					// ⭐ CALM, THEN CLIMBING (logs round 7, squad-rollout lead:
					// "the deploy at ~6m ago starts it, errors climb toward
					// now" — then round 8 (AD round 4): "an error share that
					// climbs from ~0 to ~40% over the last 6 min… today the
					// histogram is a flat wall of near-max bars"). Two line
					// pools: `calmLines` is the ordinary queue-worker
					// traffic this service was ALWAYS producing (including
					// two successful job completions — this rollout did
					// work before it broke); `errorCluster` is the SAME
					// 5-line payments-svc failure sequence the fixture
					// always had. The first 8 of the backlog's ~14 minutes
					// are calm-only; the last 6 are the incident, with the
					// error SHARE (not the line rate) climbing linearly
					// from 0% to 40% as a function of ELAPSED TIME into the
					// incident window — a reader scanning the histogram
					// left to right sees red grow as a fraction of each
					// bucket, not the whole bucket turn red at once. The
					// underlying line RATE (errors and calm lines both)
					// follows the SAME quiet/busy macro wave the calm
					// scenario uses (a 2.5-minute cycle: ~80s quiet at
					// 0.3-0.55 lines/s, then ~70s busy at 0.9-2 lines/s) —
					// this service has the same real variance the calm one
					// does, it is simply also increasingly erroring.
					// Deterministic throughout (time- and count-indexed,
					// never `Math.random()`).
					const calmLines = [
						{ level: 'INFO', msg: 'Starting checkout-worker build a02f1c4, env=staging' },
						{ level: 'INFO', msg: 'Connected to queue checkout-jobs.staging.svc.cluster.local:5672' },
						{ level: 'INFO', msg: 'Health check endpoint registered at /healthz' },
						{ level: 'INFO', msg: 'Ready to accept jobs' },
						{ level: 'INFO', msg: 'Processing job settle-order ord_22f9ab' },
						{ level: 'INFO', msg: 'Job settle-order ord_22f9ab completed in 340ms' },
						{ level: 'INFO', msg: 'Processing job settle-order ord_77c413' },
						{ level: 'INFO', msg: 'Job settle-order ord_77c413 completed in 210ms' },
						{ level: 'INFO', msg: 'Processing job settle-order ord_9b004e' }
					];
					const errorCluster = [
						{ level: 'ERROR', msg: 'Upstream timeout calling payments-svc.staging.svc.cluster.local:443 after 5000ms | job=settle-order ord_22f9ab | attempt=1/3' },
						{ level: 'WARN', msg: 'Retrying job settle-order ord_22f9ab in 2s (attempt 2/3)' },
						{ level: 'ERROR', msg: 'payments-svc returned 503 Service Unavailable | job=settle-order ord_22f9ab | attempt=2/3' },
						{ level: 'ERROR', msg: 'payments-svc returned 502 Bad Gateway | job=settle-order ord_22f9ab | attempt=3/3' },
						{ level: 'ERROR', msg: 'Job settle-order ord_22f9ab failed permanently after 3 attempts, moving to dead-letter queue' },
						{ level: 'ERROR', msg: 'Upstream timeout calling payments-svc.staging.svc.cluster.local:443 after 5000ms | job=settle-order ord_77c413 | attempt=1/3' },
						{ level: 'ERROR', msg: 'payments-svc returned 504 Gateway Timeout | job=settle-order ord_77c413 | attempt=2/3' },
						{ level: 'WARN', msg: 'Queue depth rising: 342 pending jobs (threshold 200) | consumer_lag=28s' },
						{ level: 'ERROR', msg: 'Job settle-order ord_77c413 failed permanently after 3 attempts, moving to dead-letter queue' }
					];
					const CALM_MINUTES = 8;
					const INCIDENT_MINUTES = 6;
					const INCIDENT_BACKLOG_MS = (CALM_MINUTES + INCIDENT_MINUTES) * 60_000;
					// Declared ahead of the backlog loop below, which now
					// also reads it (logs round 9 screenshot review — same
					// "boot lines once" fix item 7 gave the trickle, applied
					// to the backlog: `calmLines` indices 0-3 are the boot
					// sequence, and a ~14-minute backlog cycling the full
					// array repeats "Starting checkout-worker build…"
					// throughout history, not just once).
					const steadyCalmLines = calmLines.slice(4);
					const offsets: number[] = [];
					const picks: { level: string; msg: string }[] = [];
					{
						let t = 0;
						let lineIndex = 0;
						while (t < INCIDENT_BACKLOG_MS) {
							// Same quiet/busy macro wave the calm scenario uses
							// (see that generator's own doc) — this service has
							// real variance too, independent of whether it is
							// also erroring.
							const cyclePos = t % 150_000;
							const stride =
								cyclePos < 80_000
									? 1800 + (lineIndex % 6) * 280 // quiet: ~0.3-0.55 lines/s
									: 500 + (lineIndex % 5) * 160; // busy: ~0.9-2 lines/s
							t += stride;
							offsets.push(t);
							if (t < CALM_MINUTES * 60_000) {
								picks.push(
									lineIndex < calmLines.length
										? calmLines[lineIndex]
										: steadyCalmLines[(lineIndex - calmLines.length) % steadyCalmLines.length]
								);
							} else {
								// Error SHARE climbs linearly 0% -> 40% over the
								// incident window, as a function of elapsed time
								// (not line count) — `lineIndex % 100` against a
								// shifting threshold is a deterministic stand-in
								// for "this fraction of lines are errors right
								// now" that needs no RNG.
								const incidentProgress = (t - CALM_MINUTES * 60_000) / (INCIDENT_MINUTES * 60_000);
								const errorShare = Math.min(0.4, incidentProgress * 0.4);
								picks.push(
									lineIndex % 100 < errorShare * 100
										? // `lineIndex % length`, not `floor(lineIndex/7) %
										// length` (fixed, logs round 8 screenshot review):
										// the error-share threshold admits a RUN of
										// consecutive `lineIndex` values near the end of the
										// incident window, and a slow-changing divisor over
										// that run picked the SAME cluster message 5-6 times
										// in a row ("Upstream timeout…" repeated down the
										// well) — the opposite of the "real variance" this
										// round's own must-fix asked for. Stepping the index
										// directly cycles through all 9 messages within any
										// run, however long.
										errorCluster[lineIndex % errorCluster.length]
										: steadyCalmLines[lineIndex % steadyCalmLines.length]
								);
							}
							lineIndex++;
						}
					}
					const initialCount = offsets.length;
					const baseTime = Date.now() - offsets[offsets.length - 1];
					for (let i = 0; i < initialCount; i++) {
						const pod = pods[i % pods.length];
						const sample = picks[i];
						const ts = baseTime + offsets[i];
						send(
							`event: log\ndata: ${JSON.stringify({
								pod: pod.name,
								container: 'app',
								type: 'pod',
								line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
								timestamp: ts
							})}\n\n`
						);
					}
					// The live trickle continues the incident at its OWN worst
					// (climbing) rate — a Live stream on a failing rollout
					// should keep failing, not calm back down on its own.
					// `steadyCalmLines` (declared ahead of the backlog loop
					// above, which now also reads it) excludes `calmLines`'
					// own boot sequence (indices 0-3: "Starting
					// checkout-worker build…" through "Ready to accept
					// jobs") for the SAME reason item 7 gave the trickle:
					// "boot lines once per pod start, not every 15s".
					let streamedCount = 0;
					const interval = setInterval(() => {
						const pod = pods[streamedCount % pods.length];
						streamedCount += 1;
						const sample =
							streamedCount % 2 === 0
								? errorCluster[streamedCount % errorCluster.length]
								: steadyCalmLines[streamedCount % steadyCalmLines.length];
						const ts = Date.now();
						send(
							`event: log\ndata: ${JSON.stringify({
								pod: pod.name,
								container: 'app',
								type: 'pod',
								line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
								timestamp: ts
							})}\n\n`
						);
					}, 2200);
					return () => clearInterval(interval);
				}
			}
		};
	}

	// GET /api/rollouts/:namespace/:name/pods/logs for EVERY OTHER LISTED
	// ROLLOUT (U-14, 2026-10-08). This route used to answer ONLY hello-world
	// (above) — every other rollout's Logs tab got no `pods`/`log` SSE event
	// ever, so `LogsViewer`'s `connectionState` (derived from whether any
	// such event has arrived) stayed `connecting` forever: "Connecting to
	// pods…" with a big "0", no error, no way out. One small, generic
	// stream — a `pods` snapshot plus a short burst of log lines named after
	// the rollout's own current build — is enough to resolve that state for
	// any rollout a reader can actually open, same as `deriveGenericDetail`
	// resolves U-1's dead detail pages from the same list data.
	{
		const m = reqPath.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)\/pods\/logs$/);
		if (m) {
			const [, logNs, logName] = m;
			const listRollout = findListRollout(logNs, logName) as
				| { status?: { history?: { version?: { tag?: string } }[] } }
				| undefined;
			if (listRollout) {
				const tag = listRollout.status?.history?.[0]?.version?.tag ?? 'build';
				return {
					status: 200,
					headers: SSE_HEADERS,
					stream: {
						start(send) {
							const pods = [{ name: `${logName}-${tag}-0`, namespace: logNs, type: 'pod' }];
							send(`event: pods\ndata: ${JSON.stringify(pods)}\n\n`);
							const sampleLogs = [
								{ level: 'INFO', msg: `Starting server for ${logName}, build ${tag}` },
								{ level: 'INFO', msg: 'Health check endpoint registered at /healthz' },
								{ level: 'INFO', msg: 'Ready to accept connections on 0.0.0.0:8080' }
							];
							// ⭐ A STEADY-STATE LINE OF ITS OWN (logs round 8,
							// item 7: "boot lines once per pod start, not
							// every 15s") — `sampleLogs` above is this pod's
							// boot sequence, once, for the backlog; the
							// trickle needs something that is not "Starting
							// server…" repeating forever on a pod with 0
							// restarts.
							const steadyLine = { level: 'INFO', msg: 'GET /healthz 200 1ms' };
							const baseTime = Date.now() - 6000;
							for (let i = 0; i < sampleLogs.length; i++) {
								const ts = baseTime + i * 2000;
								send(
									`event: log\ndata: ${JSON.stringify({
										pod: pods[0].name,
										container: 'app',
										type: 'pod',
										line: `${new Date(ts).toISOString()} ${sampleLogs[i].level} ${sampleLogs[i].msg}`,
										timestamp: ts
									})}\n\n`
								);
							}
							const interval = setInterval(() => {
								const ts = Date.now();
								const sample = steadyLine;
								send(
									`event: log\ndata: ${JSON.stringify({
										pod: pods[0].name,
										container: 'app',
										type: 'pod',
										line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
										timestamp: ts
									})}\n\n`
								);
							}, 4000);
							return () => clearInterval(interval);
						}
					}
				};
			}
		}
	}

	// GET /api/kustomizations/:namespace/:name/managed-resources — any live
	// fixture's own Kustomization (hello-world's is the pre-existing one;
	// checkout-api/checkout-worker each got a synthetic one — see
	// `mock-details.ts` — purely so this route, and therefore the rollout
	// page's "Resources" card, has something to answer).
	{
		const m = reqPath.match(/^\/api\/kustomizations\/([^/]+)\/([^/]+)\/managed-resources$/);
		if (m) {
			const resources = getManagedResources(m[1], m[2]);
			if (resources) return json({ managedResources: resources });
		}
	}

	// Fallback: empty JSON for any unhandled API route. Mutations (promote,
	// retry, pin) land here too: they answer 200 with nothing, the optimistic
	// UI settles, and the next read serves the same unchanged fixture.
	void method;
	return json({});
}
