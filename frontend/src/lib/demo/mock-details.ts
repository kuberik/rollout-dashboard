/**
 * DETAIL FIXTURES FOR THE FILM'S OTHER TWO STOPS (2026-09-12, demo-mode).
 *
 * `mock-data.ts` gives every rollout a LIST entry, but only `default/hello-
 * world` ever had a full detail page — health checks, resources, events,
 * permissions. The promo film also visits `checkout-api-prod-us-east-2/
 * checkout-api` (Home's "Promote now" target with no buttons today, because
 * `/permissions/all` only ever answered for hello-world — see `respond.ts`)
 * and `checkout-worker-staging/checkout-worker` (Home's failed card, whose
 * "Retry deploy" link has nowhere real to land). Both get the same furniture
 * hello-world's page has, built here rather than in `mock-data.ts` so the
 * region above `export const FLEET` (owned jointly with other fixtures)
 * stays untouched.
 *
 * ⛔ NOTHING NODE-SPECIFIC MAY ENTER THIS FILE — same rule as `mock-data.ts`,
 * for the same reason (bundled into the browser by the demo build).
 *
 * `./state.ts` is what actually SERVES these — it clones each `mk*()` output
 * once at module load as the pristine baseline and mutates a live copy from
 * there. Nothing here is mutated in place; every export is a plain object or
 * a factory function that returns a fresh one.
 */

import { hcAgo, hcNow, mockDepDetails, CK_APP, fleetVersion } from './mock-data';

// ── checkout-api-prod-us-east-2/checkout-api ──────────────────────────────
// The rollout, environment and dependency wiring already exist (fixture B in
// mock-data.ts, `mkCkRollout('prod-us-east-2')` — currentVersion b-42,
// availableReleases up to b-45, bake InProgress). What was missing is
// everything else a detail PAGE reads: a Kustomization to hang "Resources"
// off, health checks, recent events and (see `respond.ts`) permissions.

export const CK_NAMESPACE = 'checkout-api-prod-us-east-2';
export const CK_NAME = CK_APP; // 'checkout-api'
export const CK_CLUSTER = 'prod';
/** No explicit `metadata.namespace` — the rollout page defaults an
 *  unnamespaced kustomization reference to the ROLLOUT's own namespace (see
 *  `+page.svelte`'s `managedResourcesQuery`), which is exactly `CK_NAMESPACE`
 *  here, so this key is stable without repeating the string. */
export const CK_KUSTOMIZATION_NAME = CK_NAME;

/** The exact base bundle the dependencies fixture already serves for this
 * rollout, plus the one thing it never needed until now: a Kustomization to
 * hang a "Resources" card off. `structuredClone`d fresh per call so nothing
 * here can share a reference with the dependencies fixture's own frozen copy. */
export function mkCkDetail(): Record<string, unknown> {
	const base = structuredClone(mockDepDetails[`${CK_NAMESPACE}/${CK_NAME}`]) as Record<
		string,
		unknown
	>;
	base.kustomizations = {
		items: [
			{
				apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
				kind: 'Kustomization',
				metadata: { name: CK_KUSTOMIZATION_NAME, namespace: CK_NAMESPACE },
				spec: {},
				status: { conditions: [] }
			}
		]
	};
	return base;
}

export function mkCkManagedResources() {
	return [
		{
			groupVersionKind: 'apps/v1/Deployment',
			name: CK_NAME,
			namespace: CK_NAMESPACE,
			/**
			 * ⛔ WAS `InProgress` / `3 of 4 ready`, AND IT LEAKED INTO THE CALM
			 * SCENARIO. (2026-09-13, from a capture of the promote beat.)
			 *
			 * This rollout's story is that its CHECK has been running over an
			 * hour — a wait, not a wound. The pods were telling a different
			 * story 300px to the right: the Resources card read `1 not ready`,
			 * `3/4 pods UPDATING`, `Waiting for rollout to finish`, which on a
			 * page with nothing failing is the product saying something is
			 * wrong when nothing is. `calm`'s transform (state.ts) heals bake
			 * statuses and health checks; it cannot reach a Deployment's
			 * replica counts, and it should not have to — the honest fix is a
			 * fixture whose pods match its own story.
			 *
			 * Deliberately healthy in BOTH scenarios: checkout-api is never
			 * the incident's subject (that is checkout-worker, and only its
			 * own head entry and its own check differ between the two).
			 */
			status: 'Current',
			message: '',
			lastModified: hcNow.toISOString(),
			object: {
				apiVersion: 'apps/v1',
				kind: 'Deployment',
				metadata: { name: CK_NAME, namespace: CK_NAMESPACE },
				spec: { replicas: 4 },
				status: { readyReplicas: 4, replicas: 4 }
			}
		}
	];
}

/** ONE Pending, TWO passing — the promote demo flips the pending one at +3s
 * (see `state.ts`'s `changeVersion`), so the rollup reads `1 pending · 2
 * passing` → `3 passing`, identical in shape to hello-world's own fixture. */
export function mkCkHealthChecks() {
	return {
		healthChecks: [
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: 'checkout-api-kustomization-health-check',
					namespace: CK_NAMESPACE,
					labels: { app: CK_NAME },
					annotations: {
						'healthcheck.kuberik.com/kustomization': CK_NAME,
						'kuberik.com/display-name': 'Flux Deployment'
					}
				},
				spec: { class: 'kustomization' },
				status: {
					status: 'Healthy',
					message: 'Kustomization is reconciled · 4/4 ready',
					lastChangeTime: hcAgo(9)
				}
			},
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: 'checkout-api-prometheus-latency',
					namespace: CK_NAMESPACE,
					labels: { app: CK_NAME },
					annotations: {
						'healthcheck.kuberik.com/prometheus-alert-labels': 'alertname=HighLatency,app=checkout-api',
						'kuberik.com/display-name': 'Latency Alert'
					}
				},
				spec: { class: 'prometheus-alert' },
				status: {
					// See `mock-data.ts`'s identical note: the countdown is derived
					// live from `nextProbeAt` (`state.ts`) now, never baked into the
					// message string.
					status: 'Pending',
					message: 'evaluating alert state',
					lastChangeTime: hcAgo(0.3)
				}
			},
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: 'checkout-api-prometheus-app-down',
					namespace: CK_NAMESPACE,
					labels: { app: CK_NAME },
					annotations: {
						'healthcheck.kuberik.com/prometheus-alert-labels': 'alertname=AppDown,app=checkout-api',
						'kuberik.com/display-name': 'App Down Alert'
					}
				},
				spec: { class: 'prometheus-alert' },
				status: { status: 'Healthy', message: 'alert is not firing', lastChangeTime: hcAgo(30) }
			}
		]
	};
}

export function mkCkEvents() {
	return {
		events: [
			{
				type: 'Normal',
				reason: 'ScalingReplicaSet',
				involvedObject: { kind: 'Deployment', name: CK_NAME },
				message: `Scaled up replica set ${CK_NAME}-7d9f6b5c8 to 4`,
				lastTimestamp: hcAgo(9)
			},
			{
				type: 'Normal',
				reason: 'Pulled',
				involvedObject: { kind: 'Pod', name: `${CK_NAME}-7d9f6b5c8-k2n9x` },
				message: 'Container image "checkout-api:b-42" already present on machine',
				lastTimestamp: hcAgo(8.5)
			},
			/**
			 * ⛔ THE `Warning` / `Unhealthy` / `probe failed … 503` EVENT THAT
			 * USED TO SIT HERE IS GONE. (2026-09-13, same capture as the
			 * replica counts above.) `Recent events` is the rail card next to
			 * a rollout whose only trouble is a slow CHECK; a readiness probe
			 * returning 503 is a failure, printed in adverse ink, on a page
			 * the calm scenario promises has none. The events now say what
			 * actually happened to this deploy: it rolled out, it came up, and
			 * the check has been running since.
			 */
			{
				type: 'Normal',
				reason: 'Started',
				involvedObject: { kind: 'Pod', name: `${CK_NAME}-7d9f6b5c8-k2n9x` },
				message: 'Started container app',
				lastTimestamp: hcAgo(5.8)
			},
			{
				type: 'Normal',
				reason: 'ScalingReplicaSet',
				involvedObject: { kind: 'Deployment', name: CK_NAME },
				message: `Scaled down replica set ${CK_NAME}-6c4b1a20 to 0`,
				lastTimestamp: hcAgo(5)
			}
		]
	};
}

// ── checkout-worker-staging/checkout-worker ───────────────────────────────
// Home's failed card and its "Retry deploy" link point here. The LIST entry
// (`mkFleetRollout` over the `FLEET` spec `{ app: 'checkout-worker', env:
// 'staging', bake: 'Failed', currentVersion: 'a02f1c4', previousVersion:
// '3f1ed09', deployedAgoMin: 3 }`) is owned by another lane; every value
// below matches it exactly rather than re-deriving a different history.

export const CW_NAMESPACE = 'checkout-worker-staging';
export const CW_NAME = 'checkout-worker';
export const CW_CLUSTER = 'staging';
const CW_FAILED_CHECK_NAME = 'checkout-worker-prometheus-high-error-rate';

export function mkCwRollout() {
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: {
			name: CW_NAME,
			namespace: CW_NAMESPACE,
			labels: { environment: 'staging' },
			annotations: { 'rollout-dashboard.kuberik.com/source-cluster': CW_CLUSTER }
		},
		spec: {
			releasesImagePolicy: `${CW_NAMESPACE}/${CW_NAME}`,
			healthCheckSelector: { matchLabels: { app: CW_NAME } },
			versionHistoryLimit: 10,
			minBakeTime: '1s'
		},
		status: {
			// ⭐ (2026-10-10, dead-link fix) WITHOUT `source`, every change
			// link this detail page draws (the history row, "Retry deploy",
			// the failed build's own link) falls back to the REPO-LESS
			// `app:checkout-worker` key — `repoBody` passes that straight
			// through unchanged, so the link becomes `/changes/checkout-
			// worker/a02f1c4` (no `github.com/<owner>` segment) and 404s.
			// `github-data.ts`'s `checkout-worker` fixture already curates
			// this exact ladder (`['3f1ed09', 'a02f1c4']`) under
			// `github.com/exampleco/checkout-worker` — same convention
			// `mkFleetRollout` uses for the LIST entry this page's detail
			// data must agree with (see this file's own header comment).
			source: `github.com/exampleco/${CW_NAME}`,
			wantedVersion: 'a02f1c4',
			currentVersion: 'a02f1c4',
			previousVersion: '3f1ed09',
			availableReleases: [
				{ ...fleetVersion(CW_NAME, '3f1ed09'), created: hcAgo(3 + 6 * 60) },
				{ ...fleetVersion(CW_NAME, 'a02f1c4'), created: hcAgo(3) }
			],
			history: [
				{
					version: fleetVersion(CW_NAME, 'a02f1c4'),
					timestamp: hcAgo(3),
					// ⭐ (2026-10-10, truth-bug fix) NO `commitMessage` HERE ANY
					// MORE — it used to hardcode "Add retry budget to payment
					// webhook" here, independently of `github-data.ts`'s own
					// title for this sha ("Add dead-letter queue for failed
					// checkout events", the exact mismatch an art director
					// found between this row and this build's own diff page).
					// `github-data.ts`'s `checkout-worker` ladder is now the
					// one place this title is written, and it agrees with
					// `respond.ts`'s own `CW_MANIFESTS` diff for this pair.
					message: '*Automatic deployment*',
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Failed',
					/**
					 * ⛔ WAS `'HighErrorRate firing · rolled back'` (U-10,
					 * 2026-10-08). `currentVersion` above is still `a02f1c4` —
					 * the failed build — and the page's primary action is
					 * "Rollback", which only makes sense if the rollback has
					 * NOT happened yet. The message claimed the opposite of
					 * what `status` and the banner both say, measured live on
					 * the incident scenario's own detail page.
					 */
					bakeStatusMessage: 'HighErrorRate firing · paged on-call',
					failedHealthChecks: [
						{
							name: CW_FAILED_CHECK_NAME,
							namespace: CW_NAMESPACE,
							message: 'error rate 8.9% over a 1% budget; queue depth climbing'
						}
					],
					bakeStartTime: hcAgo(3),
					bakeEndTime: hcAgo(2)
				},
				{
					version: fleetVersion(CW_NAME, '3f1ed09'),
					timestamp: hcAgo(3 + 6 * 60),
					message: '*Automatic deployment*',
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: hcAgo(3 + 6 * 60),
					bakeEndTime: hcAgo(3 + 6 * 60 - 1)
				}
			]
		}
	};
}

export function mkCwDetail(): Record<string, unknown> {
	return {
		rollout: mkCwRollout(),
		kustomizations: {
			items: [
				{
					apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
					kind: 'Kustomization',
					metadata: { name: CW_NAME, namespace: CW_NAMESPACE },
					spec: {},
					status: { conditions: [] }
				}
			]
		},
		ociRepositories: { items: [] },
		rolloutGates: { items: [] },
		environment: {
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'Environment',
			metadata: { name: CW_NAME, namespace: CW_NAMESPACE },
			spec: { label: 'staging' }
		},
		kruiseRollout: null,
		rolloutTests: { items: [] }
	};
}

export function mkCwManagedResources() {
	return [
		{
			groupVersionKind: 'apps/v1/Deployment',
			name: CW_NAME,
			namespace: CW_NAMESPACE,
			status: 'InProgress',
			message: 'Waiting for rollout to finish',
			lastModified: hcNow.toISOString(),
			object: {
				apiVersion: 'apps/v1',
				kind: 'Deployment',
				metadata: { name: CW_NAME, namespace: CW_NAMESPACE },
				spec: { replicas: 2 },
				status: { readyReplicas: 1, replicas: 2 }
			}
		}
	];
}

/** ONE Unhealthy (matching `failedHealthChecks` above) + two passing — the
 * retry demo flips the unhealthy one at +4s (see `state.ts`'s `retryRollout`). */
export function mkCwHealthChecks() {
	return {
		healthChecks: [
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: 'checkout-worker-kustomization-health-check',
					namespace: CW_NAMESPACE,
					labels: { app: CW_NAME },
					annotations: {
						'healthcheck.kuberik.com/kustomization': CW_NAME,
						'kuberik.com/display-name': 'Flux Deployment'
					}
				},
				spec: { class: 'kustomization' },
				status: {
					status: 'Healthy',
					message: 'Kustomization is reconciled · 1/2 ready',
					lastChangeTime: hcAgo(3)
				}
			},
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: CW_FAILED_CHECK_NAME,
					namespace: CW_NAMESPACE,
					labels: { app: CW_NAME },
					annotations: {
						'healthcheck.kuberik.com/prometheus-alert-labels':
							'alertname=HighErrorRate,app=checkout-worker',
						'kuberik.com/display-name': 'High Error Rate Alert'
					}
				},
				spec: { class: 'prometheus-alert' },
				/**
				 * ⭐ `lastErrorTime` IS WHAT MAKES THIS ROW EXIST ON THE PAGE.
				 * (2026-09-13, from the live retry take.)
				 *
				 * Rollout detail hides a failing check whose `lastErrorTime`
				 * predates the current deployment — the controller's own
				 * "witness" semantics: an error from before this deploy is not
				 * blocking it (see `visibleHealthChecks`). Without the field at
				 * all, the filter cannot date the failure and drops the row, so
				 * the card read `2/2 healthy` and listed the two checks that
				 * were fine while the failure panel above it named a third
				 * check the card pretended not to have. The capture caught
				 * exactly that, and then the row APPEARING after the retry —
				 * the worst possible order.
				 *
				 * One minute after the deploy (which is `hcAgo(3)`), so the
				 * error belongs to THIS deployment and the card shows it
				 * FAILING, `2/3`, before the retry.
				 */
				status: {
					status: 'Unhealthy',
					// ⛔ WAS "firing for 3m" beside `lastErrorTime: hcAgo(2)` (U-10,
					// 2026-10-08) — one failure printing two different ages for
					// how long it has been going on. Matches `lastErrorTime` now.
					message: 'alert firing for 2m · error rate 8.9% over a 1% budget; queue depth climbing',
					lastChangeTime: hcAgo(2),
					lastErrorTime: hcAgo(2),
					// r39: a Threshold observation (rollout-controller status.observations[]) so the Attention card's figure variant renders in mock mode
					observations: [{ name: 'error rate', kind: 'Threshold', value: '8.9', limit: '1', direction: 'Above', unit: '%', window: '5m', healthy: false, observedTime: hcAgo(2) }]
				}
			},
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: 'checkout-worker-prometheus-app-down',
					namespace: CW_NAMESPACE,
					labels: { app: CW_NAME },
					annotations: {
						'healthcheck.kuberik.com/prometheus-alert-labels': 'alertname=AppDown,app=checkout-worker',
						'kuberik.com/display-name': 'App Down Alert'
					}
				},
				spec: { class: 'prometheus-alert' },
				status: { status: 'Healthy', message: 'alert is not firing', lastChangeTime: hcAgo(120) }
			}
		]
	};
}

export function mkCwEvents() {
	return {
		events: [
			{
				type: 'Normal',
				reason: 'ScalingReplicaSet',
				involvedObject: { kind: 'Deployment', name: CW_NAME },
				message: `Scaled up replica set ${CW_NAME}-59c8d7f6b to 2`,
				lastTimestamp: hcAgo(3)
			},
			{
				type: 'Warning',
				reason: 'Unhealthy',
				involvedObject: { kind: 'Pod', name: `${CW_NAME}-59c8d7f6b-q8m2p` },
				message: 'Readiness probe failed: HTTP probe failed with statuscode: 503',
				lastTimestamp: hcAgo(2.5)
			},
			{
				type: 'Warning',
				reason: 'BakeFailed',
				involvedObject: { kind: 'Rollout', name: CW_NAME },
				// ⛔ WAS "rolled back to 3f1ed09" (U-10, 2026-10-08) — claiming a
				// rollback already happened while `currentVersion` is still the
				// failed build (`a02f1c4`) and the page's primary action is
				// still "Rollback". The event now says what is actually true
				// at this instant: the build failed and is waiting on one.
				message: 'HighErrorRate firing · deploy failed, awaiting rollback',
				lastTimestamp: hcAgo(2)
			}
		]
	};
}

/** Base hello-world events (Task B) — always served, MOCK_FAIL keeps its own
 * separate (unchanged) event set in `respond.ts`. Real entries within the
 * last ~16 minutes, phrased like kubelet/controller events, Normal and
 * Warning both represented so `EventsCard`'s info glyph has a reachable
 * state without needing the outage harness. */
export function mkHelloWorldEvents(rolloutName: string) {
	return {
		events: [
			{
				type: 'Normal',
				reason: 'ScalingReplicaSet',
				involvedObject: { kind: 'Deployment', name: rolloutName },
				message: `Scaled up replica set ${rolloutName}-6f8b9c4d7 to 1`,
				lastTimestamp: hcAgo(16)
			},
			{
				type: 'Normal',
				reason: 'Pulled',
				involvedObject: { kind: 'Pod', name: `${rolloutName}-6f8b9c4d7-x2k9p` },
				message: `Container image "${rolloutName}:f68d0ac" already present on machine`,
				lastTimestamp: hcAgo(15.5)
			},
			{
				type: 'Normal',
				reason: 'Started',
				involvedObject: { kind: 'Pod', name: `${rolloutName}-6f8b9c4d7-x2k9p` },
				message: 'Started container app',
				lastTimestamp: hcAgo(15.3)
			},
			{
				type: 'Warning',
				reason: 'Unhealthy',
				involvedObject: { kind: 'Pod', name: `${rolloutName}-6f8b9c4d7-x2k9p` },
				message: 'Readiness probe failed: HTTP probe failed with statuscode: 503',
				lastTimestamp: hcAgo(12)
			},
			{
				type: 'Normal',
				reason: 'Pulled',
				involvedObject: { kind: 'Pod', name: `${rolloutName}-6f8b9c4d7-m4j7q` },
				message: `Container image "${rolloutName}:f68d0ac" already present on machine`,
				lastTimestamp: hcAgo(3)
			}
		]
	};
}

// ── GENERIC DETAIL FALLBACK FOR EVERY OTHER LISTED ROLLOUT (U-1, 2026-10-08) ──
//
// 31 of 51 rollouts the fleet/dep lists hand out (`FLEET`, `HF_LANES`,
// `MR_LANES`, `EM_LANES` in `mock-data.ts` — orders-api, checkout-worker-dev,
// recommender-svc, checkout-edge, payments-core, edge-mesh) had a LIST entry
// but no DETAIL fixture: the hand-written allowlist above only ever covered
// hello-world plus the two apps a specific film beat visits
// (checkout-api-prod-us-east-2, checkout-worker-staging). Every other
// rollout's detail page fell through `respond.ts`'s final `json({})` and
// rendered "This rollout does not exist".
//
// Rather than hand-write 31 more fixtures, derive the detail bundle from the
// SAME rollout object the list already serves (so the detail page can never
// disagree with the card that links to it) plus its matching Environment.
// `respond.ts` calls these three functions as the last resort for the
// detail, events and health-checks routes, after every named fixture has
// had its turn.
export function deriveGenericDetail(
	rollout: Record<string, unknown>,
	environment?: Record<string, unknown>
): Record<string, unknown> {
	const meta = (rollout.metadata ?? {}) as { name?: string; namespace?: string };
	const name = meta.name ?? 'rollout';
	const namespace = meta.namespace ?? 'default';
	return {
		rollout,
		kustomizations: {
			items: [
				{
					apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
					kind: 'Kustomization',
					metadata: { name, namespace },
					spec: {},
					status: {
						conditions: [
							{
								type: 'Ready',
								status: 'True',
								reason: 'ReconciliationSucceeded',
								message: 'Applied revision'
							}
						]
					}
				}
			]
		},
		ociRepositories: { items: [] },
		rolloutGates: { items: [] },
		kruiseRollout: null,
		rolloutTests: { items: [] },
		...(environment ? { environment } : {})
	};
}

/** The latest history entry, if any — every generic derivation below reads
 * the same one entry so a rollout's health/events/age agree with each other
 * and with the card that links here. */
function latestHistoryEntry(rollout: Record<string, unknown>):
	| { version?: { tag?: string }; bakeStatus?: string; bakeStatusMessage?: string; timestamp?: string }
	| undefined {
	const status = (rollout.status ?? {}) as { history?: unknown[] };
	const history = status.history ?? [];
	return history[0] as
		| { version?: { tag?: string }; bakeStatus?: string; bakeStatusMessage?: string; timestamp?: string }
		| undefined;
}

export function deriveGenericHealthChecks(rollout: Record<string, unknown>) {
	const meta = (rollout.metadata ?? {}) as { name?: string; namespace?: string };
	const name = meta.name ?? 'rollout';
	const namespace = meta.namespace ?? 'default';
	const head = latestHistoryEntry(rollout);
	const failed = head?.bakeStatus === 'Failed';
	const inProgress = head?.bakeStatus === 'InProgress';
	return {
		healthChecks: [
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: `${name}-kustomization-health-check`,
					namespace,
					labels: { app: name },
					annotations: {
						'healthcheck.kuberik.com/kustomization': name,
						'kuberik.com/display-name': 'Flux Deployment'
					}
				},
				spec: { class: 'kustomization' },
				status: failed
					? {
							status: 'Unhealthy',
							message: head?.bakeStatusMessage ?? 'deploy failed',
							lastChangeTime: hcAgo(3),
							// r39: a Count observation, so the figure variant's "number + name" form renders in mock mode
							observations: [{ name: 'pods not ready', kind: 'Count', value: '3', healthy: false }]
						}
					: inProgress
						? { status: 'Pending', message: 'reconciling', lastChangeTime: hcAgo(1) }
						: { status: 'Healthy', message: 'Kustomization is reconciled', lastChangeTime: hcAgo(5) }
			}
		]
	};
}

export function deriveGenericEvents(rollout: Record<string, unknown>) {
	const meta = (rollout.metadata ?? {}) as { name?: string; namespace?: string };
	const name = meta.name ?? 'rollout';
	const head = latestHistoryEntry(rollout);
	const tag = head?.version?.tag ?? 'unknown';
	const events: Record<string, unknown>[] = [
		{
			type: 'Normal',
			reason: 'ScalingReplicaSet',
			involvedObject: { kind: 'Deployment', name },
			message: `Scaled up replica set ${name}-${tag} to 1`,
			lastTimestamp: hcAgo(6)
		},
		{
			type: 'Normal',
			reason: 'Pulled',
			involvedObject: { kind: 'Pod', name: `${name}-${tag}-0` },
			message: `Container image "${name}:${tag}" already present on machine`,
			lastTimestamp: hcAgo(5.5)
		}
	];
	if (head?.bakeStatus === 'Failed') {
		events.push({
			type: 'Warning',
			reason: 'Unhealthy',
			involvedObject: { kind: 'Pod', name: `${name}-${tag}-0` },
			message: head.bakeStatusMessage ?? 'Readiness probe failed',
			lastTimestamp: hcAgo(3)
		});
	}
	return { events };
}
