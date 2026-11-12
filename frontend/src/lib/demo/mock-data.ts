/**
 * THE MOCK FIXTURES, AND NOTHING ELSE.
 *
 * Extracted verbatim from `frontend/dev-mock-api.ts` (2026-09-12) so that the
 * same data can be served three ways without being written three times:
 *
 *   - the Vite dev middleware (`dev-mock-api.ts`, `MOCK_API=1 vite dev`),
 *   - the in-browser `fetch` shim of the DEMO BUILD (`./install.ts`), which is
 *     what kuberik.com embeds under `/demo/` with no backend at all,
 *   - anything else that wants a realistic payload without a cluster.
 *
 * ⛔ NOTHING NODE-SPECIFIC MAY ENTER THIS FILE. It is bundled into the browser
 * by the demo build; a `node:fs` import here breaks that build. Request
 * handling lives in `./respond.ts`, the outage/slow/partial harness stays in
 * `dev-mock-api.ts` where the env vars are.
 *
 * ⚠️ THE FIXTURES ARE CLOCK-RELATIVE AND EVALUATE AT MODULE LOAD. Timestamps
 * are `Date.now() - n`, so "16 minutes ago" is 16 minutes before the page
 * loaded, not before the file was written. That is deliberate (a demo must
 * never show a stale "3 days ago"), and it is why nothing here may be snapshot
 * tested against a literal date.
 */
import type { Environment } from '../../types';
import { approvalPolicyMeta } from './gate-kind';
import { buildTopology, deployNameOf, placeKeyOf, upstreamOf } from '../view-models/sites-waves';


export const NAMESPACE = 'default';
export const ROLLOUT_NAME = 'hello-world';
export const APP_NAMESPACE = 'hello-world';
export const KUSTOMIZATION_NAME = 'hello-world';
export const KUSTOMIZATION_NAMESPACE = 'default';

export const mockRolloutResponse = {
	rollout: {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: {
			name: ROLLOUT_NAME,
			namespace: NAMESPACE,
			annotations: {
				'dashboard.rollout.kuberik.com/description':
					'Example application for testing rollout features.',
				'dashboard.rollout.kuberik.com/theme': 'dev'
			},
			labels: {
				environment: 'dev'
			}
		},
		spec: {
			releasesImagePolicy: `${NAMESPACE}/${ROLLOUT_NAME}`,
			healthCheckSelector: { matchLabels: { app: ROLLOUT_NAME } },
			versionHistoryLimit: 10,
			minBakeTime: '1s'
		},
		status: {
			/**
			 * ⭐ THE LINKED SOURCE REPOSITORY. (2026-09-13, tl-dashboard-demo-2.)
			 *
			 * Without it, `ChangeVersionModal`'s own guard
			 * (`{#if !rollout?.status?.source}`) prints "No source repository
			 * linked — the commit list is unavailable" in the middle of the
			 * deploy dialog — measured live on the demo's flagship rollout, in
			 * the exact dialog a film records when it deploys a newer build,
			 * and with the GitHub fixtures answering perfectly well behind it.
			 *
			 * The value must be the repo `github-data.ts` has commits FOR
			 * (`OWNER`/`APPS['hello-world']`), or the dialog asks for a range
			 * in a repository the mock has never heard of.
			 */
			source: 'github.com/exampleco/hello-world',
			wantedVersion: 'f68d0ac',
			currentVersion: 'f68d0ac',
			previousVersion: 'a1b2c3d',
			history: [
				{
					version: { tag: 'f68d0ac', version: 'f68d0ac', revision: 'f68d0ac' },
					timestamp: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 5 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'a1b2c3d', version: 'a1b2c3d', revision: 'a1b2c3d' },
					timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 115 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 114 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'e4f5a6b', version: 'e4f5a6b', revision: 'e4f5a6b' },
					timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
					message: 'Fix database connection pooling',
					triggeredBy: { kind: 'User', name: 'alice' },
					bakeStatus: 'Failed',
					bakeStatusMessage: 'Health check failed: readiness probe timeout',
					bakeStartTime: new Date(Date.now() - 295 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 290 * 60 * 1000).toISOString()
				},
				{
					version: { tag: '7c8d9e0', version: '7c8d9e0', revision: '7c8d9e0' },
					timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 23.9 * 60 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 23.8 * 60 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'b3c4d5e', version: 'b3c4d5e', revision: 'b3c4d5e' },
					timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
					message: 'Initial release',
					triggeredBy: { kind: 'User', name: 'bob' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 47.9 * 60 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 47.8 * 60 * 60 * 1000).toISOString()
				}
			]
		}
	},
	kustomizations: {
		items: [
			{
				apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
				kind: 'Kustomization',
				metadata: {
					name: KUSTOMIZATION_NAME,
					namespace: KUSTOMIZATION_NAMESPACE
				},
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
		metadata: { name: 'dev', namespace: NAMESPACE },
		// star: `environment` (not just `label`) IS THE FIELD EVERY ENV CHIP KEYS
		// OFF (see `getRolloutEnvironmentTheme`'s own doc comment). Without
		// it the film's own flagship rollout - default/hello-world, the
		// rollout-detail scene - drew NO environment chip at all, while
		// checkout-api's page correctly drew `PROD-US-EAST-2`. Found live by
		// another lane (tl-dashboard-demo-2, 2026-09-13).
		spec: { label: 'dev', environment: 'dev' }
	},
	kruiseRollout: null,
	rolloutTests: { items: [] }
};

export const mockManagedResources = {
	managedResources: [
		{
			groupVersionKind: 'apps/v1/Deployment',
			name: ROLLOUT_NAME,
			namespace: APP_NAMESPACE,
			status: 'Current',
			message: '',
			lastModified: new Date().toISOString(),
			object: {
				apiVersion: 'apps/v1',
				kind: 'Deployment',
				metadata: { name: ROLLOUT_NAME, namespace: APP_NAMESPACE },
				spec: { replicas: 1 },
				status: { readyReplicas: 1, replicas: 1 }
			}
		},
		// -- KruiseRollout so the deployment timeline renders --
		{
			groupVersionKind: 'rollouts.kruise.io/v1beta1/Rollout',
			name: ROLLOUT_NAME,
			namespace: APP_NAMESPACE,
			status: 'Current',
			message: '',
			lastModified: new Date().toISOString(),
			object: {
				apiVersion: 'rollouts.kruise.io/v1beta1',
				kind: 'Rollout',
				metadata: { name: ROLLOUT_NAME, namespace: APP_NAMESPACE },
				spec: {
					workloadRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: ROLLOUT_NAME },
					strategy: {
						canary: {
							steps: [
								{ replicas: 1, pause: { duration: 5 } },
								{ replicas: '100%' },
								{ replicas: '100%' }
							]
						}
					}
				},
				status: {
					phase: 'Healthy',
					canaryStatus: {
						currentStepIndex: 2,
						currentStepState: 'Completed',
						canaryRevision: 'f68d0ac',
						observedWorkloadGeneration: 1
					},
					conditions: [{ type: 'Progressing', status: 'True', reason: 'Completed' }]
				}
			}
		},
		// -- RolloutTest WITH link annotations (this is what we're testing!) --
		{
			groupVersionKind: 'rollout.kuberik.com/v1alpha1/RolloutTest',
			name: `${ROLLOUT_NAME}-test`,
			namespace: APP_NAMESPACE,
			status: 'Current',
			message: '',
			lastModified: new Date().toISOString(),
			object: {
				apiVersion: 'rollout.kuberik.com/v1alpha1',
				kind: 'RolloutTest',
				metadata: {
					name: `${ROLLOUT_NAME}-test`,
					namespace: APP_NAMESPACE,
					annotations: {
						'rollout.kuberik.com/link.Logs':
							'https://example.com/logs?service=hello-world&live=true',
						'rollout.kuberik.com/link.CI':
							'https://example.com/ci/test/runs?service=hello-world&version=f68d0ac'
					}
				},
				spec: {
					rolloutName: ROLLOUT_NAME,
					stepIndex: 2,
					jobTemplate: {
						template: {
							spec: {
								containers: [
									{
										name: 'test',
										env: [
											{ name: 'DD_SERVICE', value: ROLLOUT_NAME },
											{ name: 'DD_ENV', value: 'dev' },
											{ name: 'DD_VERSION', value: 'main-1770831919-f68d0ac3ed1185943c9105df735a099a2165c7ce' }
										]
									}
								]
							}
						}
					}
				},
				/**
				 * ⭐ `Succeeded` (reverted 2026-10-10, coordinator ruling: this
				 * fixture is visible in CALM, and calm must have zero
				 * failures — the incident scenario carries exactly one, on
				 * checkout-worker-staging. A FAILED hello-world test made
				 * calm not-calm). `conditions` stays — `LogsViewer`'s own
				 * `testRuns` reads the latest `lastTransitionTime` across
				 * them to decide a run is FINISHED (and show its age)
				 * rather than still "Running"; without one there was
				 * nothing to compute a finish time from, regardless of
				 * phase. The matching log-content fix (the test-runner
				 * narrative actually passing now) is in `respond.ts`'s own
				 * handler for this rollout, not here.
				 */
				status: {
					phase: 'Succeeded',
					retryCount: 0,
					activePods: 0,
					succeededPods: 1,
					failedPods: 0,
					jobName: `${ROLLOUT_NAME}-test-f68d0ac`,
					conditions: [
						{
							type: 'Succeeded',
							status: 'True',
							reason: 'TestsPassed',
							message: 'Test suite completed: 7/7 passed',
							// `hcAgo` isn't declared yet at this point in the module
							// (this fixture object is built before it) — matching
							// the sibling `lastModified` field two lines up, which
							// already reads plain wall-clock `Date.now()` rather
							// than the demo clock for the same reason.
							lastTransitionTime: new Date(Date.now() - 60_000).toISOString()
						}
					]
				}
			}
		}
	]
};

export const mockPermissions = {
	permissions: { update: true, patch: true },
	resource: {
		apiGroup: 'kuberik.com',
		kind: 'Rollout',
		name: ROLLOUT_NAME,
		namespace: NAMESPACE
	}
};

/**
 * ⭐ `hcNow` MUST BE RE-ANCHORABLE, NOT A FROZEN `const` (U-3, 2026-10-08).
 *
 * It was `const hcNow = new Date()` — fixed forever at whatever instant this
 * module first loaded (the dev server's own start time). Every `hcAgo(n)`
 * call anywhere in the demo (including the three LIVE fixtures' `mk*()`
 * factories, re-invoked on every `/api/demo/reset`) reads `hcNow.getTime()`
 * AT CALL TIME, so as long as `hcNow` itself never moves, a dev server left
 * running for an hour makes every *freshly stamped* mutation (a gate's
 * automatic promote, a retry, a rollback — anything built off `demoNow()`/
 * `peekDemoClock()` in `state.ts`, which are `hcNow` plus a small monotonic
 * offset) land an HOUR behind the browser's own real `Date.now()`. A deploy
 * that started "this second" therefore reads `STUCK · deploying >1h` and
 * `Promoted … 1 hour ago` the instant it starts — not a display bug, an
 * anchor that stopped tracking the wall clock it is implicitly compared
 * against. `reanchorClock()` lets `state.ts` re-point it at the real "now"
 * — on every explicit reset, and self-healing once a long-idle server's
 * drift grows past a mutation's own tolerance (see `demoNow()`'s own note)
 * — without touching the handful of fixtures that are deliberately clock-
 * RELATIVE rather than clock-ANCHORED (this file's own warning at the top).
 */
// eslint-disable-next-line prefer-const
export let hcNow = new Date();
export function reanchorClock(at: Date = new Date()): void {
	hcNow = at;
}
export const hcAgo = (mins: number) => new Date(hcNow.getTime() - mins * 60_000).toISOString();

/**
 * ⭐ A SHORT TAG, EXTENDED TO A PLAUSIBLE 40-CHAR GIT SHA (U-16, 2026-10-08).
 *
 * Every fixture's `tag` is a 7-char short sha; `revision` is supposed to be
 * what a real `git rev-parse` returns for it — 40 hex characters. The three
 * call sites below used to pad with LITERAL ZEROS (`${sha}0000...`.slice(0,
 * 40)`), which is valid hex but reads as a sha that is mostly zero once
 * anything downstream takes a different-length prefix of it: `/environments`
 * links a 12-char slice of this `revision`, and a 7-char tag plus 5 zeros is
 * `9a1f4c200000` — a dead link into `/changes`, since no release anywhere in
 * `github-data.ts` carries that identifier. Expanding deterministically from
 * the tag's own characters instead means ANY prefix length still reads as a
 * real hash with no visible run of zeros.
 */
export function expandSha(short: string): string {
	const base = (short.toLowerCase().match(/[0-9a-f]/g) ?? ['0']).join('') || '0';
	let seed = 0;
	for (let i = 0; i < base.length; i++) seed = (seed * 131 + base.codePointAt(i)!) % 2147483647;
	let out = base;
	while (out.length < 40) {
		seed = (seed * 1103515245 + 12345) % 2147483647;
		out += (seed % 16).toString(16);
	}
	return out.slice(0, 40);
}
// Mirrors the real HealthCheck CRDs in example/hello-world/cd/base/resources.yaml.
export const mockHealthChecks = {
	healthChecks: [
		{
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'HealthCheck',
			metadata: {
				name: 'hello-world-kustomization-health-check',
				namespace: APP_NAMESPACE,
				labels: { app: 'hello-world' },
				annotations: {
					'healthcheck.kuberik.com/kustomization': 'hello-world',
					'kuberik.com/display-name': 'Flux Deployment'
				}
			},
			spec: { class: 'kustomization' },
			status: {
				status: 'Healthy',
				message: 'Kustomization is reconciled · 1/1 ready',
				lastChangeTime: hcAgo(6)
			}
		},
		{
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'HealthCheck',
			metadata: {
				name: 'hello-world-prometheus-high-error-rate',
				namespace: APP_NAMESPACE,
				labels: { app: 'hello-world' },
				annotations: {
					'healthcheck.kuberik.com/prometheus-alert-labels': 'alertname=HighErrorRate,app=hello-python',
					'kuberik.com/display-name': 'High Error Rate Alert'
				}
			},
			spec: { class: 'prometheus-alert' },
			status: {
				// ⛔ WAS `'evaluating alert state · next probe in 12s'` — a STRING,
				// baked in at fixture-build time, that never moved no matter how
				// long the row sat on screen. `nextProbeAt` (armed fresh on every
				// `resetDemoState()` — see `state.ts`'s `armFreshPendingProbes`,
				// and re-armed to match a scheduled flip by `armPendingProbe`) is
				// what `HealthChecksCard`'s `pendingProbeClause` counts down from
				// against real wall-clock `$now` now; the countdown clause is
				// appended in the component, not here.
				status: 'Pending',
				message: 'evaluating alert state',
				lastChangeTime: hcAgo(0.4)
			}
		},
		{
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'HealthCheck',
			metadata: {
				name: 'hello-world-prometheus-app-down',
				namespace: APP_NAMESPACE,
				labels: { app: 'hello-world' },
				annotations: {
					'healthcheck.kuberik.com/prometheus-alert-labels': 'alertname=AppDown,app=hello-python',
					'kuberik.com/display-name': 'App Down Alert'
				}
			},
			spec: { class: 'prometheus-alert' },
			status: {
				status: 'Healthy',
				message: 'alert is not firing',
				lastChangeTime: hcAgo(4)
			}
		}
	]
};

// Synthetic fleet — multiple rollouts grouped into apps via Environment CRDs.
// Detail endpoints still only mock `default/hello-world`; the rest are
// list-only so the rollouts + apps + activity views look populated.
export type FleetSpec = {
	app: string;
	env: 'dev' | 'staging' | 'prod';
	bake: 'Succeeded' | 'Failed' | 'InProgress' | 'Deploying';
	currentVersion: string;
	previousVersion?: string;
	deployedAgoMin: number;
};

/**
 * ⚠️ FORCED-FAILURE STATE, ENV-GATED AND INERT BY DEFAULT.
 *
 * `FailurePanel` only renders when the head history entry has
 * `bakeStatus: 'Failed'` AND at least one health check is `Unhealthy`. The
 * fixture above is a HEALTHY rollout, so the whole failure banner — the single
 * most colour-heavy object on rollout detail — could not be reached from the
 * mock at all, and the last two contrast passes had to hand-edit this file to
 * see it. Hand-editing a fixture other agents are also serving is how a
 * screenshot gets polluted.
 *
 * `MOCK_FAIL=1 MOCK_API=1 vite dev` mutates the two fixtures in place. Without
 * the variable NOTHING below runs and the fixtures are byte-identical to what
 * they were.
 *
 * ⛔ `process` DOES NOT EXIST IN THE BROWSER. This file is bundled into the
 * DEMO BUILD (`VITE_DEMO=1` → `./install.ts`), where a bare `process.env.*`
 * reference throws at module load and takes the whole mock down with it —
 * `typeof process !== 'undefined'` is what keeps this guard inert there
 * instead of fatal, exactly as `MOCK_FAIL` already is inert in every OTHER
 * environment that simply doesn't set the variable.
 */
if (typeof process !== 'undefined' && process.env?.MOCK_FAIL) {
	(mockRolloutResponse.rollout.metadata.annotations as Record<string, string>)[
		'rollout-dashboard.kuberik.com/source-cluster'
	] = 'dev';
	const head = mockRolloutResponse.rollout.status.history[0] as Record<string, unknown>;
	head.bakeStatus = 'Failed';
	head.bakeStatusMessage =
		'Readiness probe timed out after 30s; 2/3 replicas never became ready; last restart 40s ago';
	// `FailurePanel` prefers `failedHealthChecks` over `bakeStatusMessage`.
	//   MOCK_FAIL=1  -> no failed checks, so the banner renders the
	//                   `bakeStatusMessage` split into a 3-item list.
	//   MOCK_FAIL=2  -> two failed checks, which renders the MULTI-CHECK list
	//                   AND the `N issues` chip, i.e. `AlertPanel`'s `extra`
	//                   snippet. Both message shapes are worth a look; neither
	//                   is reachable without this block.
	if (process.env.MOCK_FAIL !== '1') {
		(head as Record<string, unknown>).failedHealthChecks = [
			{
				name: 'hello-world-prometheus-high-error-rate',
				namespace: APP_NAMESPACE,
				message: 'error rate 12.4% over a 1% budget; upstream checkout-api returning 503'
			},
			{
				name: 'hello-world-prometheus-app-down',
				namespace: APP_NAMESPACE,
				message: 'no healthy endpoints for 4m'
			}
		];
	}
	for (const hc of mockHealthChecks.healthChecks) {
		if (hc.metadata.name.includes('prometheus')) {
			hc.status.status = 'Unhealthy';
			hc.status.message =
				'alert firing for 6m · error rate 12.4% over a 1% budget; upstream checkout-api returning 503';
		}
	}
}

export const FLEET: FleetSpec[] = [
	{ app: 'orders-api',      env: 'dev',     bake: 'Succeeded',  currentVersion: 'e936e6f', previousVersion: '01ab7c9', deployedAgoMin: 4 * 60 + 12 },
	// ⭐ (2026-10-10, squad-changes2 "live everywhere" ask) BUMPED FROM
	// `01ab7c9` TO `7c14e2a` — orders-api#89 (the viewer's own change,
	// `VIEWER_AUTHORED` in github-data.ts) landed here too, so EVERY tier
	// now runs a build `containedIn` names for it (dev `e936e6f`, staging
	// and prod both `7c14e2a` itself) and calm's `/changes` has at least
	// one PR reading "live everywhere" — the state the PR detail page's
	// own `live` row was otherwise never exercised against real demo data.
	// `bake`/`deployedAgoMin` unchanged in shape (still `Succeeded`, still
	// the oldest-deployed tier) — only the SHA moved forward one ladder
	// step, so no stuck/failed/in-motion invariant elsewhere in this file
	// shifts.
	{ app: 'orders-api',      env: 'staging', bake: 'Succeeded',  currentVersion: '7c14e2a', previousVersion: '01ab7c9', deployedAgoMin: 22 * 60 },
	// ⛔ WAS `InProgress` AT 2 MINUTES OLD. (2026-09-13, home group-size pass)
	// With `checkout-edge`/prod and `checkout-api`/prod-us-east-2 both
	// legitimately `InProgress` (documented invariants below, HF_LANES and
	// CK_BAKE), a THIRD running card here was the reason `In motion` sat at
	// 4 — one short of a full 3-column row and one over the group-size rule
	// (`/apps/[name]`'s reference, `.rg-solo`/`.cc-grid-solo`: a fleet group
	// renders whole rows, so its count must land on 3 or 6). This app just
	// finished a normal, unremarkable deploy instead.
	{ app: 'orders-api',      env: 'prod',    bake: 'Succeeded',  currentVersion: '7c14e2a', previousVersion: '01ab7c9', deployedAgoMin: 2 },
	// ⭐ CHAIN-ORDER FIX (2026-10-11, demo/chain-order): dev used to sit on
	// `3f1ed09` while staging already ran (and failed) the NEWER
	// `a02f1c4` — a build staging could not have gotten from anywhere but
	// dev, so dev must have run it first. Per tl-integrate: keep the
	// `3f1ed09` → `a02f1c4` build ids and staging's failing-build story
	// exactly as they are; only move dev forward to the same build,
	// succeeded, ahead of staging's own deploy.
	{ app: 'checkout-worker', env: 'dev',     bake: 'Succeeded',  currentVersion: 'a02f1c4', previousVersion: '3f1ed09', deployedAgoMin: 38 },
	{ app: 'checkout-worker', env: 'staging', bake: 'Failed',     currentVersion: 'a02f1c4', previousVersion: '3f1ed09', deployedAgoMin: 3 },
	// ⭐ (2026-10-12, squad-changes QA pass — item 4). `previousVersion` was
	// unset — `FLEET_BACKFILL_DEEPEST_MIN_AGO`'s own `backfillSha =
	// previousVersion ?? currentVersion` fallback then reused `4b9c2e1`
	// (THE VIEWER'S OWN CHANGE, `#28`, `VIEWER_AUTHORED` in
	// `github-data.ts`) for `FLEET_BACKFILL['recommender-svc/dev']`'s own
	// 26-day-deep backfill — forcing #28's own merge pin that far back too
	// (`github-data.ts`'s `EXPLICIT_MERGE_MINUTES_AGO`/the causality
	// floor), so it read "~25d" instead of a plausible "~1d". `88c0e51` is
	// the app's own ladder ROOT (`github-data.ts`) — its merge already
	// floors at 31+ days (comfortably covers the backfill depth) and is
	// not the viewer's change, so naming it here is free.
	{ app: 'recommender-svc', env: 'dev',     bake: 'Succeeded',  currentVersion: '4b9c2e1', previousVersion: '88c0e51', deployedAgoMin: 6 * 60 },
	{ app: 'recommender-svc', env: 'prod',    bake: 'Succeeded',  currentVersion: '88c0e51', deployedAgoMin: 2 * 24 * 60 }
];

/**
 * ⭐ DAYS-AGO → WEEKDAY RHYTHM, ANCHORED ON THE CAPTURE'S OWN PINNED "NOW"
 * (2026-09-13, promo-video density pass), NOT ON A LITERAL CALENDAR DATE.
 *
 * Every deploy timestamp above and in `HF_LANES`/`MR_LANES`/`EM_LANES` below
 * was written to exercise a SHAPE (a burst, a gap, a fan-out), never a
 * CALENDAR — the deepest entry in the whole fleet was `checkout-edge`'s own
 * oldest burst mark, 5260 minutes back (~3.65 days). `/activity` at 30D read
 * ~88% empty grid and 7D ~48%, and the promo video's best chart (1D) was the
 * only range any of this data actually filled.
 *
 * `DAY_WEIGHT[daysAgo % 7]` is how many backfilled deploys that day gets,
 * fleet-wide: the capture's pinned instant is a SATURDAY, so index 0 is
 * today (quiet), 2-4 are Thu/Wed/Tue (busy — the middle of a work week), 1
 * and 5 are Fri/Mon (moderate), 6 is Sunday (quiet). Indexing off `% 7`
 * rather than a real `Date` weekday means this rhythm survives even if the
 * capture's pinned `MOCK_NOW` instant is ever moved to a different weekday.
 */
const DAY_WEIGHT = [1, 2, 4, 4, 4, 2, 1] as const;

/**
 * Minutes-ago for a backfilled deploy `daysAgo` days back at `hour`:`minute`,
 * measured against THIS FILE'S OWN `hcNow` — never `Date.now()` at request
 * time — so a backfilled mark sits in the identical clock frame as every
 * hand-written timestamp around it (see the module doc's clock-relative
 * warning at the top of this file).
 */
function backAt(daysAgo: number, hour: number, minute = 0): number {
	const nowMinuteOfDay = hcNow.getUTCHours() * 60 + hcNow.getUTCMinutes();
	return daysAgo * 1440 + (nowMinuteOfDay - (hour * 60 + minute));
}

/**
 * Older, already-`Succeeded` texture for `/activity`'s 30D and 7D charts —
 * never touches the two entries `mkFleetRollout` already writes (the head
 * and, where one exists, the previous version), so no rank/stuck/failed
 * invariant elsewhere in this file moves. Reuses each row's own
 * `previousVersion` (falling back to `currentVersion`) rather than inventing
 * a build nothing else references. Every hour below avoids 03:00 — the
 * fleet's one deliberate off-hours incident is `FLEET_INCIDENT_KEY` below,
 * not this table.
 */
const FLEET_BACKFILL: Record<string, { daysAgo: number; hour: number; human?: HumanDeploy }[]> = {
	'orders-api/dev': [
		{ daysAgo: 25, hour: 10 },
		{ daysAgo: 18, hour: 14 },
		{ daysAgo: 11, hour: 15, human: { message: 'Increase connection pool size', person: 'alice' } }
	],
	'orders-api/staging': [
		{ daysAgo: 23, hour: 11 },
		{ daysAgo: 16, hour: 9 },
		{ daysAgo: 9, hour: 13 }
	],
	'orders-api/prod': [
		{ daysAgo: 20, hour: 16 },
		{ daysAgo: 13, hour: 10 },
		{ daysAgo: 6, hour: 14 }
	],
	'checkout-worker/dev': [
		{ daysAgo: 24, hour: 13 },
		{ daysAgo: 17, hour: 15, human: { message: 'Retry queue backoff tuning', person: 'sam' } },
		{ daysAgo: 10, hour: 11 }
	],
	'checkout-worker/staging': [
		{ daysAgo: 22, hour: 9 },
		{ daysAgo: 15, hour: 14 },
		{ daysAgo: 8, hour: 16 }
	],
	'recommender-svc/dev': [
		{ daysAgo: 26, hour: 15 },
		{ daysAgo: 19, hour: 10 },
		{ daysAgo: 12, hour: 13 }
	],
	'recommender-svc/prod': [
		{ daysAgo: 28, hour: 9 },
		{ daysAgo: 21, hour: 16 },
		{ daysAgo: 5, hour: 12 }
	]
};

/**
 * ⭐ (2026-10-12, squad-changes QA pass — causality). THE SAME "BACKFILL SHA
 * MUST BE OLD ENOUGH" RULE `DENSITY_LANES` ABOVE NEEDED, FOR `FLEET`'s OWN
 * BACKFILL. `mkFleetRollout`'s own `backfillSha` (`previousVersion ??
 * currentVersion`) reuses an EXISTING sha for the "older texture" rows
 * above, at `FLEET_BACKFILL[key]`'s own `daysAgo` depths — so whatever
 * `github-data.ts` picks as that sha's own merge time must be at least
 * this old, or the backfill (a real, dated deploy) predates the commit
 * that produced it. One lookup, by sha → the DEEPEST (oldest) minutes-ago
 * any `FLEET` row's backfill ever claims for it — `github-data.ts` reads
 * this directly rather than re-deriving `backfillSha`/`FLEET_BACKFILL`
 * lookups as a second copy.
 */
export const FLEET_BACKFILL_DEEPEST_MIN_AGO: ReadonlyMap<string, number> = (() => {
	const deepest = new Map<string, number>();
	for (const spec of FLEET) {
		const key = `${spec.app}/${spec.env}`;
		const backfillSha = spec.previousVersion ?? spec.currentVersion;
		for (const { daysAgo, hour } of FLEET_BACKFILL[key] ?? []) {
			const minAgo = backAt(daysAgo, hour);
			if (minAgo > (deepest.get(backfillSha) ?? -Infinity)) deepest.set(backfillSha, minAgo);
		}
	}
	return deepest;
})();

/**
 * ⭐ THE FLEET'S ONE DELIBERATE 03:00 EVENT, AND IT IS AN INCIDENT — "nothing
 * at 03:00 except an incident or two." `orders-api/dev`'s head (2026-09-13
 * FLEET entry above) is untouched `Succeeded`; this is a HISTORICAL entry
 * appended after it, 14 days back — well outside the 7-day window the
 * three-failures note above `FLEET` is about, so it cannot add a fourth
 * entry to that window's `Failed` tally.
 */
const FLEET_INCIDENT_KEY = 'orders-api/dev';
const FLEET_INCIDENT_DAYS_AGO = 14;

// ⛔ `FLEET_HEALTH_WITNESS` — a `DeploymentBlocked` condition on
// `recommender-svc/prod` and `orders-api/staging`, padding `Needs you now`
// toward 6 — WAS HERE AND IS REMOVED. (2026-09-13, tl-dashboard-demo-2's
// two-scenario resume note.) `state.ts`'s `healRolloutFailures` — the CALM/
// INCIDENT scenario transform — only ever heals `bakeStatus === 'Failed'`;
// it does not know about this file's `status.conditions` mechanism at all.
// A witness built that way is UNHEALABLE: it rendered `UNHEALTHY` in calm
// exactly as loudly as in incident, which is precisely the "whoever is
// looking at this will think it's all broken" failure the calm scenario
// exists to prevent — verified live (`POST …reset?scenario=calm` still
// showed both cards red). `Needs you now`'s remaining scenario-independent
// members are the two the coordinating lane's own comment already
// blesses as "waiting, not errors" (`checkout-edge`/prod and
// `checkout-api`/prod-us-east-2, both `stuck` on `InProgress` duration, not
// on `bakeStatus`/health) — 2 in calm, 3 once incident adds `checkout-
// worker`/staging. See the home group-size note above `FLEET` for why a
// THIRD one could not be added to make calm land on 3 without also adding
// a fourth `In motion` card (stuck implies `isRunning`): the two counts are
// coupled and a single `+1` failure toggle cannot make both N and N+1 land
// on {3, 6} at once. Reported to the coordinating lane rather than silently
// resolved.

/**
 * Every fleet build carries its git revision (the OCI `image.revision`
 * contract): the change pages, /changes and "your changes" join a build to
 * its commit by it, so without it every app but hello-world read "NO
 * RELEASE" for changes that had shipped. The short sha, as the curated
 * ladders in github-data.ts name them. Dependency fixtures (deps showcase,
 * film) are built elsewhere and are untouched.
 */
export const fleetVersion = (_app: string, v: string) => ({ tag: v, version: v, revision: v });

export const mkFleetRollout = (s: FleetSpec) => {
	const ns = `${s.app}-${s.env}`;
	const key = `${s.app}/${s.env}`;
	// Reuse whichever sha this row already has for its OLDER texture — never
	// invent a build nothing else references.
	const backfillSha = s.previousVersion ?? s.currentVersion;
	const backfill = (FLEET_BACKFILL[key] ?? []).map(({ daysAgo, hour, human }) => {
		const minAgo = backAt(daysAgo, hour);
		return {
			version: fleetVersion(s.app, backfillSha),
			timestamp: hcAgo(minAgo),
			// A System deploy carries no message — see `mkHfRollout`'s identical
			// note on why the old `'*Automatic deployment*'` boilerplate is gone.
			...(human
				? { message: human.message, triggeredBy: { kind: 'User', name: human.person } }
				: { triggeredBy: { kind: 'System', name: 'System' } }),
			bakeStatus: 'Succeeded' as const,
			bakeStartTime: hcAgo(minAgo),
			bakeEndTime: hcAgo(minAgo - 1)
		};
	});
	const incident =
		key === FLEET_INCIDENT_KEY
			? (() => {
					const minAgo = backAt(FLEET_INCIDENT_DAYS_AGO, 3);
					return [
						{
							version: fleetVersion(s.app, backfillSha),
							timestamp: hcAgo(minAgo),
											message: 'Hotfix — checkout latency spike',
							triggeredBy: { kind: 'User', name: 'oncall' },
							bakeStatus: 'Failed' as const,
							bakeStatusMessage: 'HighErrorRate firing · paged on-call',
							bakeStartTime: hcAgo(minAgo),
							bakeEndTime: hcAgo(minAgo - 4)
						}
					];
				})()
			: [];
	const history = [
		{
			version: fleetVersion(s.app, s.currentVersion),
			timestamp: hcAgo(s.deployedAgoMin),
			triggeredBy: { kind: 'System', name: 'System' },
			bakeStatus: s.bake,
			...(s.bake === 'Failed' && { bakeStatusMessage: 'HighErrorRate firing · rolled back' }),
			bakeStartTime: hcAgo(s.deployedAgoMin),
			bakeEndTime: hcAgo(s.deployedAgoMin - 1)
		},
		...(s.previousVersion ? [{
			version: fleetVersion(s.app, s.previousVersion),
			timestamp: hcAgo(s.deployedAgoMin + 6 * 60),
			triggeredBy: { kind: 'System', name: 'System' },
			bakeStatus: 'Succeeded' as const,
			bakeStartTime: hcAgo(s.deployedAgoMin + 6 * 60),
			bakeEndTime: hcAgo(s.deployedAgoMin + 6 * 60 - 1)
		}] : []),
		// Older texture, then (on one row only) the fleet's one 03:00 incident —
		// both strictly after the head/previous pair above, so neither touches
		// `history[0]`/`history[1]`, which every stuck/failed/rank invariant
		// elsewhere in this file reads.
		...backfill,
		...incident
	];
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: {
			name: s.app,
			namespace: ns,
			labels: { environment: s.env }
		},
		spec: {
			releasesImagePolicy: `${ns}/${s.app}`,
			versionHistoryLimit: 10,
			minBakeTime: '5m'
		},
		status: {
			// ⭐ EVERY FLEET APP NEEDS A SOURCE REPO, OR ITS CHANGE PAGE IS A
			// DEAD END (fix-dash, 2026-10-08). Without `status.source`,
			// `ChangeVersionModal` and `/changes/<app>/<build>` have no repo to
			// ask — `github-data.ts` already has a curated fixture for every
			// one of these app names (`OWNER = 'exampleco'`), keyed by the same
			// string.
			source: `github.com/exampleco/${s.app}`,
			wantedVersion: s.currentVersion,
			currentVersion: s.currentVersion,
			previousVersion: s.previousVersion,
			history
		}
	};
};
// ── SITES AND WAVES: the builders every app below shares ─────────────────
//
// The environment-controller (feat/sites-and-waves) orders an app by TIER (dev < test < staging
// < prod), then by WAVE within a tier. There is no `spec.relationship` any more. Each Environment
// reports `status.wave` (its site, wave, role, the wave's leader and selection, and the members of
// its own tier and of the tier before it) plus the `WaveReady` and `LockstepConsistent`
// conditions. These helpers build exactly that from one list of sites, so a scenario edits ONE
// table and every Environment of the app agrees with it.

/** One site of an app: where it runs, its wave, and the build it reports. */
export type WSite = {
	tier: string;
	site: string;
	wave: number;
	revision?: string;
	bake?: string;
	deregistered?: boolean;
};
const W_TIERS = ['dev', 'test', 'staging', 'prod'] as const;
function wLeader(all: WSite[], tier: string, wave: number): string | undefined {
	return all
		.filter((x) => x.tier === tier && x.wave === wave && !x.deregistered)
		.map((x) => x.site)
		.sort()[0];
}

/** `status.wave` of `me`: the lowest-named live site of a wave leads it. */
export function waveStatusFor(deployName: string, all: WSite[], me: WSite) {
	const tiers = W_TIERS.filter((t) => all.some((x) => x.tier === t));
	const up = tiers[(tiers as string[]).indexOf(me.tier) - 1];
	const leader = wLeader(all, me.tier, me.wave);
	const lead = all.find((x) => x.tier === me.tier && x.site === leader);
	const member = (x: WSite) => ({
		environment: x.tier,
		site: x.site,
		wave: x.wave,
		...(x.revision ? { revision: x.revision } : {}),
		...(x.bake ? { bakeStatus: x.bake } : {}),
		...(x.deregistered ? { deregistered: true } : {})
	});
	return {
		site: me.site,
		environment: me.tier,
		name: `kuberik-${deployName}`,
		wave: me.wave,
		role: me.site === leader ? 'Leader' : 'Follower',
		leader,
		...(lead?.revision ? { selectedRevision: lead.revision } : {}),
		members: [...(up ? all.filter((x) => x.tier === up) : []), ...all.filter((x) => x.tier === me.tier)].map(member)
	};
}

function rev7(r: string | undefined): string {
	return (r ?? '').slice(0, 7);
}

/**
 * The WaveReady blocker of `me`, in the controller's own words: a wave-N (N > 1) leader waits for
 * a site of the wave before it that has not finished baking (`WaitingFor <tier>/<site> bake on
 * <rev7>`). Followers and wave-1 leaders are not held by a wave.
 */
export function waveBlockerFor(all: WSite[], me: WSite): { reason: string; message: string } | null {
	if (me.wave <= 1 || wLeader(all, me.tier, me.wave) !== me.site) return null;
	const prev = all.filter((x) => x.tier === me.tier && x.wave === me.wave - 1 && !x.deregistered);
	const baking = prev.filter((x) => x.bake && x.bake !== 'Succeeded').pop();
	return baking ? { reason: 'WaitingFor', message: `${baking.tier}/${baking.site} bake on ${rev7(baking.revision)}` } : null;
}

function waveCond(type: string, status: 'True' | 'False', reason: string, message: string) {
	return { type, status, reason, message, lastTransitionTime: hcAgo(5) };
}
/** WaveReady: True/Ready, or False with the controller's reason and message. */
export function waveReadyCond(blocker?: { reason: string; message: string } | null) {
	return blocker
		? waveCond('WaveReady', 'False', blocker.reason, blocker.message)
		: waveCond('WaveReady', 'True', 'Ready', 'site may deploy the allowed versions');
}
export function lockstepCond(mismatch?: string) {
	return mismatch
		? waveCond('LockstepConsistent', 'False', 'LockstepMismatch', mismatch)
		: waveCond('LockstepConsistent', 'True', 'Consistent', 'all members agree on lockstep');
}


/** `sitedEnvironments` per app (`spec.name`), in the original order. */
export function sitedByApp<E extends Parameters<typeof sitedEnvironments>[0][number]>(
	envs: E[],
	rollouts: Parameters<typeof sitedEnvironments>[1]
): E[] {
	const out = new Map<E, E>();
	const apps = new Map<string, E[]>();
	for (const e of envs) apps.set(e.spec.name, [...(apps.get(e.spec.name) ?? []), e]);
	for (const list of apps.values()) {
		const sited = sitedEnvironments(list, rollouts);
		list.forEach((e, i) => out.set(e, sited[i]));
	}
	return envs.map((e) => out.get(e)!);
}

/**
 * Legacy `prod-<region>` Environments of ONE app, as tiers and sites. The region becomes `spec.site`,
 * the tier `prod`; waves rank the distinct builds the regions run, newest first (the sites on the
 * newest build are wave 1, the next-newest build wave 2, ...). The place key stays `prod-<region>`.
 * Environments that are not `prod-*` stay single-site. Every Environment gets `status.wave` and the
 * wave conditions, with the blocker the controller would write.
 */
export function sitedEnvironments<E extends { metadata: { namespace: string }; spec: { environment: string; name: string }; status: Record<string, unknown> }>(
	envs: E[],
	rollouts: { metadata: { namespace: string }; status: unknown }[]
): E[] {
	type Hist = { version: { tag: string; revision?: string }; timestamp?: string; bakeStatus?: string }[];
	const histOf = (r?: { status: unknown }) => ((r?.status as { history?: Hist } | undefined)?.history ?? []) as Hist;
	const rolloutOf = (e: E) => rollouts.find((r) => r.metadata.namespace === e.metadata.namespace);
	const first = new Map<string, number>();
	for (const e of envs)
		for (const h of histOf(rolloutOf(e))) {
			const t = Date.parse(h.timestamp ?? '');
			if (Number.isFinite(t) && (!first.has(h.version.tag) || t < first.get(h.version.tag)!)) first.set(h.version.tag, t);
		}
	const head = (e: E) => histOf(rolloutOf(e))[0];
	const prodTags = [...new Set(envs.filter((e) => e.spec.environment.startsWith('prod-')).map((e) => head(e)?.version.tag ?? ''))].sort(
		(a, b) => (first.get(b) ?? 0) - (first.get(a) ?? 0)
	);
	const sites: WSite[] = envs.map((e) => {
		const prod = e.spec.environment.startsWith('prod-');
		const h = head(e);
		return {
			tier: prod ? 'prod' : e.spec.environment,
			site: prod ? e.spec.environment.slice('prod-'.length) : 'default',
			wave: prod ? prodTags.indexOf(h?.version.tag ?? '') + 1 : 1,
			revision: h?.version.revision || h?.version.tag,
			bake: h?.bakeStatus
		};
	});
	return envs.map((e, i) => {
		const me = sites[i];
		const prod = me.tier === 'prod' && e.spec.environment.startsWith('prod-');
		return {
			...e,
			spec: { ...e.spec, environment: me.tier, ...(prod ? { site: me.site, wave: me.wave } : {}) },
			status: {
				...e.status,
				wave: waveStatusFor(e.spec.name, sites, me),
				conditions: [waveReadyCond(waveBlockerFor(sites, me)), lockstepCond()]
			}
		};
	});
}

export const mkFleetEnvironment = (s: FleetSpec) => ({
	apiVersion: 'environments.kuberik.com/v1alpha1',
	kind: 'Environment',
	metadata: { name: s.app, namespace: `${s.app}-${s.env}` },
	spec: {
		environment: s.env,
		name: s.app,
		rolloutRef: { name: s.app }
	},
	status: {
		currentVersion: s.currentVersion,
		lastStatusChangeTime: hcAgo(s.deployedAgoMin)
	}
});

// ─────────────────────────────────────────────────────────────────────────
// `checkout-edge` — the HIGH-FREQUENCY fixture (added 2026-08-23).
//
// WHY THIS EXISTS. Every rollout in the live kind clusters has a history of
// at most 5 entries, so the Gantt's merge path (`coalesceSegments`, which
// folds anything under 3px into the segment that FOLLOWS it) had never once
// run against a genuinely busy app. The previous round proved the fixed
// right-hand live-sha column survives high deploy frequency by SQUEEZING the
// panel to 200px — sound arithmetic, since a 10x narrower track is
// arithmetically the same as 10x the deploys, but it is not the same data.
// A squeezed track still has five segments in it.
//
// So this app has 30 deploys across three environments, and it is built to
// contain the cases that actually break a time chart:
//
//   · TWO DEPLOYS IN THE SAME MINUTE (dev, 4517m ago) — a ZERO-width
//     segment. Not "narrow": zero. It must merge, not divide by itself.
//   · A BURST THEN A LONG QUIET GAP (dev: 7 deploys inside 33 minutes, then
//     63 hours of nothing, then 10 more). The gap segment is ~900px and the
//     burst is ~8px total, on the same lane, at the same scale.
//   · THE LIVE BUILD AS THE NARROWEST SEGMENT ON ITS LANE (dev deployed 2
//     minutes ago -> 0.5px). This is the case the right-to-left merge walk
//     exists for: the group must take the LIVE build's identity, never the
//     dead one that owns 96% of the lane.
//   · A NON-MONOTONIC LANE (staging runs 93c04da, is replaced by two newer
//     builds, then rolls BACK to 93c04da). Ember is an ordinal ramp, so this
//     lane legitimately goes hot -> hotter -> cold, and that is the encoding
//     working, not a bug to "fix".
//   · SEGMENTS OLDER THAN THE `fit` WINDOW (prod's four oldest deploys) plus
//     one that STRADDLES the window's left edge and must still be drawn.
//
// The ladder is 25 builds, which is past Ember's 12-stop cap on purpose:
// rank >= 11 collapses to ash, so a real busy app is the case where the
// "everything old is ash" degradation is visible rather than theoretical.
//
// Reach it with:  MOCK_API=1 npx vite --port 5199
//                 https://localhost:5199/apps/checkout-edge
export const HF_APP = 'checkout-edge';

/** [sha, createdMinutesAgo] — newest first, so the index IS the rank. */
export const HF_BUILDS: [string, number][] = [
	['9a1f4c2', 12],
	['4d0b7e8', 35],
	['c62a913', 650],
	['7f38e0d', 662],
	['e51c9a4', 674],
	['20b6d7f', 683],
	['bd94f13', 691],
	['a07e5c8', 698],
	['36fd2b1', 704],
	['cb18a4e', 710],
	['81e3f09', 902],
	['5c7b2da', 910],
	['0d6c31b', 4497],
	['e8a52f7', 4506],
	['93c04da', 4514],
	['1b7fe25', 4521],
	['77ac9e3', 4526],
	['ae40b18', 4527],
	['62d1c05', 4530],
	['d09e6f4', 4610],
	['b7e0d41', 4910],
	['c3a9f22', 5110],
	['55f1a2c', 5160],
	['3e9d780', 5210],
	['2c8b409', 5260]
];

// OLDEST-FIRST, which is the real API's contract for `availableReleases` —
// `newerReleaseCount` computes lag as `length - 1 - indexOf(current)`. Seeded
// newest-first by mistake once, and the whole ledger inverted: every env read
// as stuck with 24 builds waiting, including the one running the newest build.
/**
 * ⭐ (2026-10-10, truth-bug fix) NO `commitMessage` HERE ANY MORE. This used
 * to carry its own `HF_COMMIT_TITLES[sha]` guess at each build's title,
 * independent of (and disagreeing with) `github-data.ts`'s own curated
 * titles for this exact ladder — the two disagreed on `4d0b7e8` ("Bump go
 * to 1.23" here vs. "Add circuit breaker for upstream checkout-api calls"
 * there, confirmed live in the Change version dialog vs. its own commit
 * list) and on `d09e6f4`, `c62a913`, `bd94f13`. `github-data.ts`'s
 * `checkout-edge` fixture now carries the SAME 25 titles
 * `HF_COMMIT_TITLES` used to (moved there, not re-invented) as its one
 * `curated()` ladder, and every surface that wants a build's title reads it
 * from there (`$lib/view-models/build-title.ts`) instead of from a field
 * only this fixture ever set.
 */
export const hfReleases = HF_BUILDS.map(([sha, createdMinAgo]) => ({
	tag: sha,
	version: sha,
	revision: expandSha(sha),
	created: hcAgo(createdMinAgo)
})).reverse();

/**
 * Optional 3rd tuple element for a hand-triggered deploy — a real person and
 * a real sentence, so that a month of backfilled history is not "System" /
 * `*Automatic deployment*` on every single row (2026-09-13, coordinating
 * lane's note: that boilerplate "renders verbatim anywhere a note is
 * printed", and a month where every entry is System reads like a fixture).
 * Omitted means the ordinary System-triggered, message-less case.
 */
export type HumanDeploy = { message: string; person: string };

/** [sha, deployedMinutesAgo] — OLDEST first here; reversed on the way out,
 *  because `status.history` is newest-first in the real API. */
/**
 * ⭐ A 4TH, OPTIONAL TUPLE SLOT — `forcedBake`. (2026-10-09, Lane H, squad-
 * rollout spec §1.) Every entry but the LANE'S OWN HEAD was hardcoded
 * `Succeeded` in `mkHfRollout` below, so there was no way to put a FAILED
 * deploy — followed by a rollback — in the middle of a lane's own history,
 * which the spec asks the ledger's ahistoric-looking "all healthy" lanes to
 * exercise at least once (`checkout-edge-prod`'s own `HF_LANES` entry,
 * below). `undefined` is a no-op: every existing 2- and 3-element tuple in
 * this file keeps mapping to `'Succeeded'` exactly as before.
 */
export type HfDeploy =
	| [string, number]
	| [string, number, HumanDeploy]
	| [string, number, HumanDeploy | undefined, 'Failed'];

export const HF_LANES: {
	env: 'dev' | 'staging' | 'prod';
	bake: 'Succeeded' | 'Failed' | 'InProgress' | 'Deploying';
	deploys: HfDeploy[];
}[] = [
	{
		env: 'dev',
		// Live 2 minutes ago and still Deploying -> a blue ring, and a live
		// segment 0.5px wide at 1440. The narrowest mark on the chart is the
		// one the reader most needs; that is the whole point of this lane.
		bake: 'Deploying',
		deploys: [
			// ⭐ CHAIN-ORDER FIX, ROUND 2 (2026-10-12, squad-changes QA pass
			// — item 1). `prod`'s FOUR further exclusive builds (`b7e0d41`,
			// `c3a9f22`, `55f1a2c`, `3e9d780` — `HF_LANES/prod` below) had
			// the SAME never-ran-here-first problem `d09e6f4` already got
			// fixed for below: dev never ran them, so prod's own "first
			// landed" proof (`firstLandingProven`, `pr-pipeline.ts`) was
			// provably correct from PROD's history alone, but disagreed
			// with any ACROSS-ENVIRONMENT "first deployed" reading (the
			// `/changes/<repo>/<sha>` page's own `PrCell.since` scan) —
			// QA's probe, `github-data.merge-order.test.ts`'s own
			// `qa7-first.test.ts`. Each one 20 minutes older than prod's own
			// deploy of it (`HF_LANES/prod`'s own minute), so dev always
			// ran it first.
			['3e9d780', 5220],
			['55f1a2c', 5170],
			['c3a9f22', 5120],
			['b7e0d41', 4920],
			// ⭐ CHAIN-ORDER FIX (2026-10-11, demo/chain-order): prod's own
			// oldest live deploy, `d09e6f4` (HF_LANES/prod below), predates
			// every entry this lane used to start with — it had never been
			// run here at all, so prod's "checking d09e6f4" read as a build
			// that skipped dev and staging entirely. One historical mark,
			// older than burst A, is the minimal fix: the build passed
			// through dev before prod ever saw it.
			['d09e6f4', 4610],
			// ── burst A: 7 deploys inside 33 minutes, ~3.1 days ago
			['62d1c05', 4520],
			['ae40b18', 4517],
			['77ac9e3', 4517], // ← same minute as the line above: zero-width
			['1b7fe25', 4511],
			['93c04da', 4504],
			['e8a52f7', 4496],
			['0d6c31b', 4487],
			// ── 63 hours of nothing ────────────────────────────────────────
			// ── burst B: 8 deploys inside an hour, ~11 hours ago
			['cb18a4e', 700],
			['36fd2b1', 694],
			['a07e5c8', 688],
			['bd94f13', 681],
			['20b6d7f', 673],
			['e51c9a4', 664],
			['7f38e0d', 652],
			['c62a913', 640],
			// ── and two more just now
			['4d0b7e8', 25],
			['9a1f4c2', 2]
		]
	},
	{
		env: 'staging',
		bake: 'Succeeded',
		deploys: [
			// Same chain-order fix (round 2) as dev's lane above — each 10
			// minutes older than prod's own deploy, so staging always ran
			// it before prod (and still after dev's own copy, 20 minutes
			// older, above).
			['3e9d780', 5210],
			['55f1a2c', 5160],
			['c3a9f22', 5110],
			['b7e0d41', 4910],
			// Same chain-order fix as dev's lane above — `d09e6f4` must exist
			// here too before prod can legitimately be checking it.
			['d09e6f4', 4605],
			['93c04da', 4400],
			['e8a52f7', 4395],
			['0d6c31b', 4392],
			['93c04da', 4386], // ← re-deployed after being replaced twice
			['5c7b2da', 900],
			['81e3f09', 892],
			['c62a913', 300]
		]
	},
	{
		env: 'prod',
		// InProgress since 4600 minutes ago trips `detectStuck`'s 1h bake
		// threshold, so prod carries the amber `stuck` chip — the object that
		// must stay the loudest thing on the page no matter how hot the ramp
		// gets at this density.
		bake: 'InProgress',
		// ⭐ THE LEDGER'S OWN "ONE FAILED DEPLOY FOLLOWED BY A ROLLBACK" CASE
		// (squad-rollout spec §1, 2026-10-09, Lane H). `checkout-edge-prod`
		// is this app's named exemplar in the squad-rollout spec, and every
		// deploy on it before this edit was a plain forward step — nothing
		// here exercised the ledger's danger `StatusMark`, its neutral
		// `UndoOutline` rollback mark, or a person-left note. `62d1c05`
		// (4515m, `forcedBake: 'Failed'`) and the rollback to `b7e0d41`
		// (4505m — an existing, already-seen build) sit just before the
		// lane's head (`d09e6f4`, 4490m, `InProgress`/stuck); see the
		// causality note on those entries below for why they moved.
		//
		// ⭐ (2026-10-11, AD round 6, item: "rolled back 4 releases spans only
		// 2 deploys") WAS a rollback TO `55f1a2c` — four ladder positions
		// back from `62d1c05` in `hfReleases`' own ordering (idx 6 → idx 2),
		// not the "two positions" this comment originally claimed. `by` in
		// `history-marks.ts`'s `deployActs` counts exactly that ladder
		// distance (`|nowIdx - prevIdx|` over `availableReleases`), so the
		// sentence it wrote — "Rolled back 4 releases" — was arithmetically
		// correct and still read as wrong: the two deploys that ever show it
		// (the Failed `62d1c05` entry and the one redeploy right after it)
		// bracket a FOUR-release jump with no visible third or fourth deploy
		// between them. `b7e0d41` is genuinely two ladder positions back
		// (idx 6 → idx 4) — the sentence now reads "Rolled back 2 releases",
		// matching the two deploys a reader can actually see. `b7e0d41`'s own
		// entry below (4900m) still carries the person's note, satisfying the
		// spec's "at least one person-triggered deploy with a note" on this
		// same lane; redeploying the SAME build twice in one lane (4505m,
		// then naturally again at 4900m) is the identical pattern the
		// `staging` lane above already uses for `93c04da`.
		deploys: [
			['2c8b409', 5250],
			['3e9d780', 5200],
			['55f1a2c', 5150],
			['c3a9f22', 5100],
			[
				'b7e0d41',
				4900,
				{ message: 'Warm the edge cache before the region cutover', person: 'anna-ward' }
			], // ← straddles the `fit` window's left edge
			// ⭐ (2026-10-25, rollout-tabs merge — causality) THE FAILED DEPLOY
			// AND ITS ROLLBACK COME AFTER `62d1c05`'S OWN CREATION. `62d1c05` is
			// created 4530m ago (`HF_BUILDS`; it first runs in dev at 4520m), so
			// the squad's original 5060m Failed entry predated its own build and
			// merge (`github-data.merge-order.test.ts`). It now fails at 4515m,
			// the rollback to the already-seen `b7e0d41` follows at 4505m, and
			// the lane's head `d09e6f4` (still `InProgress`, stuck) is deployed
			// after both, at 4490m — after its own dev (4610m) and staging
			// (4605m) landings, so chain order still holds.
			['62d1c05', 4515, undefined, 'Failed'],
			['b7e0d41', 4505], // ← the rollback: redeploys an existing, already-seen build
			['d09e6f4', 4490] // ← the lane's head
		]
	}
];

export const mkHfRollout = (lane: (typeof HF_LANES)[number]) => {
	const ns = `${HF_APP}-${lane.env}`;
	const ordered = [...lane.deploys].reverse(); // newest first
	const history = ordered.map(([sha, minAgo, human, forcedBake], i) => ({
		version: fleetVersion(HF_APP, sha),
		timestamp: hcAgo(minAgo),
		// ⭐ (2026-10-10) NO `commitMessage` HERE — see `hfReleases`'s own note
		// above. `history/+page.svelte` now reads this build's title from
		// `github-data.ts` (the SAME ladder this app's shas already are),
		// through a real commit-range query, not through a field this
		// fixture sets by hand.
		// A System deploy carries no message — `'*Automatic deployment*'` was
		// controller boilerplate that rendered verbatim everywhere a note is
		// printed. A `HumanDeploy` tuple gets its own real sentence and person.
		...(human
			? { message: human.message, triggeredBy: { kind: 'User', name: human.person } }
			: { triggeredBy: { kind: 'System', name: 'System' } }),
		// `forcedBake` only ever applies past the lane's own head (`i !== 0`
		// is implicit: the head's bake state is `lane.bake`, below) — see
		// `HfDeploy`'s own note.
		bakeStatus: i === 0 ? lane.bake : (forcedBake ?? ('Succeeded' as const)),
		...(i !== 0 && forcedBake === 'Failed'
			? { bakeStatusMessage: 'HealthCheck failed: edge-cache-warmup timed out' }
			: {}),
		bakeStartTime: hcAgo(minAgo),
		...(i === 0 && lane.bake === 'InProgress' ? {} : { bakeEndTime: hcAgo(Math.max(minAgo - 1, 0)) })
	}));
	const [currentVersion] = ordered[0];
	const previousVersion = ordered[1]?.[0];
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: { name: HF_APP, namespace: ns, labels: { environment: lane.env } },
		spec: {
			releasesImagePolicy: `${ns}/${HF_APP}`,
			// Deliberately larger than the 10 the other fixtures use: a busy app
			// that truncates its own history at 10 cannot exercise the merge.
			versionHistoryLimit: 40,
			minBakeTime: '5m'
		},
		status: {
			// See `mkFleetRollout`'s identical note (fix-dash, 2026-10-08) —
			// `checkout-edge`'s own change page was empty for lack of this.
			source: `github.com/exampleco/${HF_APP}`,
			wantedVersion: currentVersion,
			currentVersion,
			previousVersion,
			availableReleases: hfReleases,
			history
		}
	};
};

export const mkHfEnvironment = (lane: (typeof HF_LANES)[number]) => ({
	apiVersion: 'environments.kuberik.com/v1alpha1',
	kind: 'Environment',
	metadata: { name: HF_APP, namespace: `${HF_APP}-${lane.env}` },
	spec: { environment: lane.env, name: HF_APP, rolloutRef: { name: HF_APP } },
	status: {
		currentVersion: [...lane.deploys].reverse()[0][0],
		lastStatusChangeTime: hcAgo([...lane.deploys].reverse()[0][1])
	}
});


// ─────────────────────────────────────────────────────────────────────────
// `payments-core` — the MULTI-REGION fixture (added 2026-08-23).
//
// WHY THIS EXISTS. `RegionSet.svelte` is the one genuinely new atom the
// deploy-board spec asked for, and it is the component that MAKES the
// "production regions are a SET" rule structural rather than advisory. Not
// one app in either kind cluster has more than a single prod-tier
// Environment, so `isFanOut` has been false on every render the component
// has ever had, and every line of it — the auto-fit tile grid, the summary,
// `splitRegions` promoting an adverse region out into its own row — had
// only ever been exercised by unit tests against fake objects.
//
// Three stages and six prod regions, in DELIBERATELY DIFFERENT states,
// because "is the prod fleet consistent?" is only a question worth asking
// when the answer can be no:
//
//   · FOUR regions converged on `9b7e410` — the fan-out working.
//   · ONE region (`sa-east`) a build behind. Behind is DRIFT, not an alarm:
//     it stays a tile, it carries no colour, and it is the single straggler
//     that makes the set row's promote target unambiguous.
//   · ONE region (`eu-central`) running `d0ff17e`, which is on NO
//     environment's `availableReleases`. That is the diverged case, and it
//     is why the fixture exists in this exact shape: it is promoted OUT of
//     the tile set into its own full ledger row, prints `DIVERGED` where a
//     rank chip would be, and takes the verdict line off the lag story
//     entirely. Its deploy is recent, so it cannot be confused with a build
//     that merely aged out of the retention window.
//
// The stages are deliberately quiet (dev and test converged, staging one
// behind) so that the loudest thing on the page is the prod fan-out, which
// is the object under test.
//
// Reach it with:  MOCK_API=1 npx vite --port 5199
//                 https://localhost:5199/apps/payments-core
export const MR_APP = 'payments-core';

/** [sha, createdMinutesAgo] — newest first, so the index IS the rank. */
export const MR_BUILDS: [string, number][] = [
	['f4a2c19', 40],
	['c0d3e88', 300],
	['9b7e410', 1500],
	['2a55f0c', 2900],
	['71ce0b3', 4300],
	['e6b4d92', 5800],
	['8ad1f57', 7200],
	['3c92e04', 9000],
	['b58a7d1', 11000],
	['47f0c6a', 13000]
];

/** The off-line build. It is NOT in MR_BUILDS, so no environment lists it
 *  as available — which is exactly what makes `eu-central` diverged rather
 *  than behind. Created 5 hours ago, i.e. well inside the window the
 *  release line still covers, so `divergedFromLine` cannot mistake it for
 *  a build that simply aged out. */
export const MR_OFF_LINE: [string, number] = ['d0ff17e', 300];

export const MR_CREATED = new Map<string, number>([...MR_BUILDS, MR_OFF_LINE]);

export const mrVersion = (sha: string) => ({
	tag: sha,
	version: sha,
	revision: expandSha(sha),
	created: hcAgo(MR_CREATED.get(sha) ?? 0)
});

// OLDEST-FIRST, the real API's contract for `availableReleases`.
export const mrReleases = MR_BUILDS.map(([sha]) => mrVersion(sha)).reverse();

export type MrLane = {
	env: string;
	bake: 'Succeeded' | 'Failed' | 'InProgress' | 'Deploying';
	/** [sha, deployedMinutesAgo] — OLDEST first; reversed on the way out. */
	deploys: ([string, number] | [string, number, HumanDeploy])[];
};

// ⭐ CHAIN-ORDER FIX (2026-10-12, squad-changes QA pass — item 1). `71ce0b3`
// and `2a55f0c` used to run ONLY in `staging`/`prod-*` (and, for `2a55f0c`,
// only as far back as `staging`) — `dev`/`test` had never run either, so a
// prod region's own "first landed" proof (`firstLandingProven`,
// `pr-pipeline.ts`, correct from PROD's own retained history alone)
// disagreed with any reading that also looks at `dev`/`test` (the
// `/changes/<repo>/<sha>` page's own `PrCell.since` scan — QA's probe,
// `qa7-first.test.ts`'s "KPI-vs-PAGE" mismatches). Each environment runs
// both builds a little before the NEXT one — `dev` first, then `test`,
// then `staging`, all comfortably before the EARLIEST prod region's own
// deploy of each (`71ce0b3`'s earliest is `prod-us-east`'s 4200m,
// `2a55f0c`'s is `prod-us-east`'s 2800m) — `staging`'s own pre-existing
// `2a55f0c` entry (2880m) already predated that and is unchanged.
export const MR_LANES: MrLane[] = [
	// ── stages: a LINE. Reading order is promotion order.
	{
		env: 'dev',
		bake: 'Succeeded',
		deploys: [['71ce0b3', 4260], ['2a55f0c', 2900], ['9b7e410', 1490], ['c0d3e88', 290], ['f4a2c19', 30]]
	},
	{
		env: 'test',
		bake: 'Succeeded',
		deploys: [['71ce0b3', 4250], ['2a55f0c', 2890], ['9b7e410', 1480], ['c0d3e88', 280], ['f4a2c19', 25]]
	},
	{
		env: 'staging',
		bake: 'Succeeded',
		deploys: [['71ce0b3', 4240], ['2a55f0c', 2880], ['9b7e410', 1460], ['c0d3e88', 260]]
	},

	// ── production: a SET. Four converged, one behind, one off the line.
	{ env: 'prod-us-east', bake: 'Succeeded', deploys: [['71ce0b3', 4200], ['2a55f0c', 2800], ['9b7e410', 1400]] },
	{ env: 'prod-us-west', bake: 'Succeeded', deploys: [['71ce0b3', 4180], ['2a55f0c', 2780], ['9b7e410', 1380]] },
	{ env: 'prod-eu-west', bake: 'Succeeded', deploys: [['71ce0b3', 4160], ['2a55f0c', 2760], ['9b7e410', 1360]] },
	{ env: 'prod-ap-south', bake: 'Succeeded', deploys: [['71ce0b3', 4140], ['2a55f0c', 2740], ['9b7e410', 1340]] },
	// Behind by one build. Still a tile: drift is not an alarm.
	{ env: 'prod-sa-east', bake: 'Succeeded', deploys: [['71ce0b3', 4120], ['2a55f0c', 2720]] },
	// Off the release line. Promoted OUT of the set into its own row.
	{ env: 'prod-eu-central', bake: 'Succeeded', deploys: [['71ce0b3', 4100], ['2a55f0c', 2700], [MR_OFF_LINE[0], 290]] }
];

// ─────────────────────────────────────────────────────────────────────────
// `edge-mesh` — the TWELVE-REGION fixture.
//
// The spec's hard requirement for the region set is that it "must hold at
// 12 regions with no horizontal scroll". `regions.test.ts` proves the grid
// template can never overflow, which is the arithmetic; this is the pixels.
// Two regions behind rather than one, deliberately: with two stragglers
// there is no single-rollout promote target, so this fixture is also the
// case where the set row correctly carries NO action at all.
export const EM_APP = 'edge-mesh';
export const EM_BUILDS: [string, number][] = [
	['5e1a903', 55],
	['a92c6f4', 900],
	['16d8b70', 2600],
	['cf03e2d', 5200]
];
export const EM_CREATED = new Map<string, number>(EM_BUILDS);
export const emVersion = (sha: string) => ({
	tag: sha,
	version: sha,
	revision: expandSha(sha),
	created: hcAgo(EM_CREATED.get(sha) ?? 0)
});
export const emReleases = EM_BUILDS.map(([sha]) => emVersion(sha)).reverse();
export const EM_REGIONS = [
	'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
	'eu-west-1', 'eu-central-1', 'eu-north-1',
	'ap-south-1', 'ap-southeast-2', 'ap-northeast-1',
	'sa-east-1', 'af-south-1'
];
export const EM_LANES: MrLane[] = [
	{ env: 'dev', bake: 'Succeeded', deploys: [['16d8b70', 2590], ['a92c6f4', 890], ['5e1a903', 50]] },
	...EM_REGIONS.map((region, i): MrLane => ({
		env: `prod-${region}`,
		bake: 'Succeeded',
		// The last two regions are one build behind the other ten.
		deploys:
			i < 10
				? [['cf03e2d', 5100 - i], ['16d8b70', 2500 - i], ['a92c6f4', 800 - i]]
				: [['cf03e2d', 5100 - i], ['16d8b70', 2500 - i]]
	}))
];

/**
 * ⭐ DENSITY BACKFILL — checkout-edge/payments-core/edge-mesh's 25 LANES,
 * WEEKDAY-SHAPED. (2026-09-13, promo-video density pass; see `DAY_WEIGHT`'s
 * own note above `FLEET` for the full "why".)
 *
 * Round-robins ONE new deploy per lane per pass across all 25 lanes here
 * (`HF_LANES` + `MR_LANES` + `EM_LANES`), days 30 down to 4, so no single
 * lane gets an implausible pile and every lane still reads as its own app.
 * Each lane reuses ITS OWN oldest known sha (captured before this mutates
 * anything), so no build is invented and the 25-build/10-build ladders each
 * fixture documents are untouched. Every hour is nudged off 03:00 — the
 * fleet's one deliberate incident lives on `orders-api/dev` in `FLEET`
 * above, not here.
 *
 * ⛔ APPENDED, NEVER PREPENDED. All three `*_LANES.deploys` arrays are
 * OLDEST-FIRST (`HfDeploy`'s own doc comment), and the backfilled tuples
 * here are all OLDER than every hand-written entry in every lane (days
 * 4-30 vs. the deepest hand-written entry at ~3.65 days) — so they are
 * `unshift`ed onto the FRONT, strictly before the fixture's own oldest
 * entry, and the HEAD (the array's LAST element, reversed to `ordered[0]`
 * in `mkHfRollout`/`mkRegionRollout`) never moves.
 */
// ⭐ (2026-10-12, squad-changes QA pass — causality). THE BACKFILL SHA MUST
// BE OLD ENOUGH TO OUTLIVE ITS OWN BACKFILL DEPTH. This used to reuse each
// LANE's own oldest hand-written entry (`lane.deploys[0][0]`) — fine for
// the apps with no real build clock, but `checkout-edge`/`payments-core`/
// `edge-mesh` (`HF_LANES`/`MR_LANES`/`EM_LANES`) have one
// (`REAL_BUILD_CREATED_MIN_AGO`, `github-data.ts`), and most lanes' own
// "oldest" entry is itself only 3-25 days old — backfilling it 30 days
// into the past (the loop below, `d` from 30 down to 4) claimed a build was
// deployed before the commit that produced it had merged. Every one of
// these three apps' own ladder root (`app.ladder[0]`, `github-data.ts` —
// duplicated here as a bare string, since this module cannot import that
// one without a cycle) is old enough for the FULL 30-day depth (its own
// merge floors at 31+ days, `landmarkChanges`'s root-commit block) — so
// EVERY lane of these three apps backfills using that one root sha,
// instead of its own (possibly much younger) oldest entry.
const HF_ROOT_SHA = '2c8b409'; // checkout-edge ladder[0]
const MR_ROOT_SHA = '47f0c6a'; // payments-core ladder[0]
const EM_ROOT_SHA = 'cf03e2d'; // edge-mesh ladder[0]
const DENSITY_LANES: { deploys: HfDeploy[]; sha: string }[] = [
	...HF_LANES.map((lane) => ({ deploys: lane.deploys, sha: HF_ROOT_SHA })),
	...MR_LANES.map((lane) => ({ deploys: lane.deploys, sha: MR_ROOT_SHA })),
	...EM_LANES.map((lane) => ({ deploys: lane.deploys, sha: EM_ROOT_SHA }))
];

/**
 * A handful of the 30-day backfill's entries get a real person and a real
 * sentence instead of the ordinary System/no-message case — otherwise a
 * month of history reads as though nobody ever touched these apps by hand.
 * Applied to every 9th lane (0, 9, 18 of the 25) so they land on different
 * apps rather than piling onto one.
 */
const DENSITY_HUMAN_TOUCHES: HumanDeploy[] = [
	// ⭐ The first is the SIGNED-IN person, named the way the product names
	// people everywhere else — by GitHub login, the same string the navbar chip
	// and every commit author row print. (2026-09-18: was an invented
	// persona. Spelled out rather than imported from `github-data.ts`'s
	// `DEMO_LOGIN` because that module imports THIS one.)
	{ message: 'Bump memory limits ahead of the traffic spike', person: 'danielreed' },
	{ message: 'Pin a dependency after an upstream regression', person: 'marcus' },
	{ message: 'Rotate logging credentials', person: 'noah' }
];
{
	// Per-lane batches, built oldest (`d = 30`) to newest (`d = 4`) so each
	// batch is already in the required oldest-first order and can be
	// unshifted onto its lane's array as one contiguous, correctly-ordered
	// run once the loop finishes.
	const batches = DENSITY_LANES.map(() => [] as HfDeploy[]);
	let cursor = 0;
	for (let d = 30; d >= 4; d--) {
		const weight = DAY_WEIGHT[d % 7];
		for (let k = 0; k < weight; k++) {
			const i = cursor % DENSITY_LANES.length;
			const rawHour = (8 + cursor * 5 + k * 3) % 24;
			const hour = rawHour === 3 ? 4 : rawHour;
			batches[i].push([DENSITY_LANES[i].sha, backAt(d, hour, (cursor * 11) % 60)]);
			cursor++;
		}
	}
	let humanCursor = 0;
	for (let i = 0; i < batches.length && humanCursor < DENSITY_HUMAN_TOUCHES.length; i += 9) {
		const batch = batches[i];
		if (!batch.length) continue;
		const mid = Math.floor(batch.length / 2);
		const [sha, minAgo] = batch[mid];
		batch[mid] = [sha, minAgo, DENSITY_HUMAN_TOUCHES[humanCursor]];
		humanCursor++;
	}
	batches.forEach((batch, i) => {
		if (batch.length) DENSITY_LANES[i].deploys.unshift(...batch);
	});
}

/** Shared builder for the two multi-region fixtures. Same shape as
 *  `mkHfRollout`, but the history entries carry `created` on the version —
 *  which the live API does and the older fixtures do not, and which is what
 *  lets the ladder rank an off-line build by its real release time rather
 *  than by when someone happened to deploy it. */
export function mkRegionRollout(app: string, releases: unknown[], toVersion: (sha: string) => unknown) {
	return (lane: MrLane) => {
		const ns = `${app}-${lane.env}`;
		const ordered = [...lane.deploys].reverse(); // newest first
		const history = ordered.map(([sha, minAgo, human], i) => ({
			version: toVersion(sha),
			timestamp: hcAgo(minAgo),
			// A System deploy carries no message (see `mkHfRollout`'s identical
			// note); a `HumanDeploy` tuple gets its own real sentence and person.
			...(human
				? { message: human.message, triggeredBy: { kind: 'User', name: human.person } }
				: { triggeredBy: { kind: 'System', name: 'System' } }),
			bakeStatus: i === 0 ? lane.bake : ('Succeeded' as const),
			bakeStartTime: hcAgo(minAgo),
			...(i === 0 && lane.bake === 'InProgress' ? {} : { bakeEndTime: hcAgo(Math.max(minAgo - 1, 0)) })
		}));
		const [currentVersion] = ordered[0];
		const previousVersion = ordered[1]?.[0];
		return {
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'Rollout',
			metadata: { name: app, namespace: ns, labels: { environment: lane.env } },
			spec: {
				releasesImagePolicy: `${ns}/${app}`,
				versionHistoryLimit: 20,
				minBakeTime: '5m'
			},
			status: {
				// See `mkFleetRollout`'s identical note (fix-dash, 2026-10-08).
				source: `github.com/exampleco/${app}`,
				wantedVersion: currentVersion,
				currentVersion,
				previousVersion,
				availableReleases: releases,
				history
			}
		};
	};
}

export const mkRegionEnvironment = (app: string) => (lane: MrLane) => ({
	apiVersion: 'environments.kuberik.com/v1alpha1',
	kind: 'Environment',
	metadata: { name: app, namespace: `${app}-${lane.env}` },
	spec: { environment: lane.env, name: app, rolloutRef: { name: app } },
	status: {
		currentVersion: [...lane.deploys].reverse()[0][0],
		lastStatusChangeTime: hcAgo([...lane.deploys].reverse()[0][1])
	}
});

export const mockMrRollouts = MR_LANES.map(mkRegionRollout(MR_APP, mrReleases, mrVersion));
export const mockMrEnvironments = MR_LANES.map(mkRegionEnvironment(MR_APP));
export const mockEmRollouts = EM_LANES.map(mkRegionRollout(EM_APP, emReleases, emVersion));
export const mockEmEnvironments = EM_LANES.map(mkRegionEnvironment(EM_APP));

export const mockHfRollouts = HF_LANES.map(mkHfRollout);
export const mockHfEnvironments = HF_LANES.map(mkHfEnvironment);

/**
 * ⭐ DESIGN REVIEW 4, ITEM A (2026-10-09, TL "GO" decision, changes-slug
 * lane) — FOUR NEW SERVICES, ONE SHARED REPO. Every `FleetSpec` row above
 * derives `status.source` from its OWN app name (`mkFleetRollout`, "every
 * fleet app needs a source repo" note) — one app, one repo, always — which
 * is exactly why no `/changes/<repo>/...` page could ever show more than
 * one service: nothing in the fleet shared a repo. These four rollouts are
 * BRAND NEW identities (never an existing app's name) that all point at
 * `github.com/exampleco/platform-telemetry` (added additively to
 * `github-data.ts`'s own `APPS` map, which is what gives this repo a real
 * PR to resolve), so `/changes/github.com/exampleco/platform-telemetry/…`
 * renders a real `LandingGrid` — the one shape this lane's own component
 * work had never been checked against live data.
 *
 * The MIX exercises the budget rules directly: `telemetry-forwarder`'s prod
 * is FAILED (needs a person — fills, the row's lead), `telemetry-indexer`'s
 * prod is HELD by a real blocking gate (also fills, also a lead), `telemetry-
 * worker`'s dev is CHECKING (`InProgress` — never fills, even as a lead),
 * and every other cell is LIVE on the new build (no hue at all).
 */
const TM_REPO = 'github.com/exampleco/platform-telemetry';
const TM_OLD = '7b3c9f1';
const TM_NEW = '4a8d2e6';

type TmCellSpec = {
	app: string;
	env: 'dev' | 'prod';
	version: string;
	bake: 'Succeeded' | 'Failed' | 'InProgress';
	deployedAgoMin: number;
	/** A blocking manual-approval gate (held) — only the one cell needs it. */
	heldAt?: string;
};

const TM_CELLS: TmCellSpec[] = [
	{ app: 'telemetry-collector', env: 'dev', version: TM_NEW, bake: 'Succeeded', deployedAgoMin: 40 },
	{ app: 'telemetry-collector', env: 'prod', version: TM_NEW, bake: 'Succeeded', deployedAgoMin: 20 },
	{ app: 'telemetry-forwarder', env: 'dev', version: TM_NEW, bake: 'Succeeded', deployedAgoMin: 35 },
	// ⭐ THE ONE "FAILED" CELL, INCIDENT-ONLY (TL correction, 2026-10-09).
	// Calm's whole promise is "nothing is failing" (the owner reviews Home
	// in calm, mid-redesign) — `healRolloutFailures` (state.ts) heals this
	// entry back to `Succeeded` there, same as every other fleet-array
	// `Failed` entry. `telemetry-forwarder-prod/telemetry-forwarder` only
	// SURVIVES as `Failed` in `incident`, beside `checkout-worker`'s own
	// failure — state.ts's `TM_ALWAYS_FAILED_KEY` exemption is now
	// `scenario === 'incident'`-gated, the same precedent `checkout-
	// worker-staging`'s bespoke `FIXTURES` entry already set.
	{ app: 'telemetry-forwarder', env: 'prod', version: TM_NEW, bake: 'Failed', deployedAgoMin: 6 },
	{ app: 'telemetry-indexer', env: 'dev', version: TM_NEW, bake: 'Succeeded', deployedAgoMin: 42 },
	// HELD — a real manual-approval gate blocks `TM_NEW`; `gates` (below)
	// is what `pr-pipeline.ts`'s own `status.gates` classification reads.
	{
		app: 'telemetry-indexer',
		env: 'prod',
		version: TM_OLD,
		bake: 'Succeeded',
		deployedAgoMin: 180,
		heldAt: TM_NEW
	},
	// CHECKING — `InProgress`, never fills (principle 12); the row's own
	// lead regardless, since no other cell in this row needs a person.
	{ app: 'telemetry-worker', env: 'dev', version: TM_NEW, bake: 'InProgress', deployedAgoMin: 2 },
	{ app: 'telemetry-worker', env: 'prod', version: TM_OLD, bake: 'Succeeded', deployedAgoMin: 200 }
];

function mkTmRollout(s: TmCellSpec) {
	const ns = `${s.app}-${s.env}`;
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: { name: s.app, namespace: ns, labels: { environment: s.env } },
		spec: {
			releasesImagePolicy: `${ns}/${s.app}`,
			versionHistoryLimit: 10,
			minBakeTime: '5m'
		},
		status: {
			source: TM_REPO,
			wantedVersion: s.version,
			currentVersion: s.version,
			availableReleases: [TM_OLD, TM_NEW].map((v, i) => ({
				tag: v,
				version: v,
				revision: v,
				created: hcAgo(240 - i * 120)
			})),
			history: [
				{
					version: { tag: s.version, version: s.version, revision: s.version },
					timestamp: hcAgo(s.deployedAgoMin),
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: s.bake,
					...(s.bake === 'Failed' && {
						bakeStatusMessage: 'HighErrorRate firing · rolled back'
					}),
					bakeStartTime: hcAgo(s.deployedAgoMin),
					bakeEndTime: hcAgo(Math.max(0, s.deployedAgoMin - 1))
				}
			],
			...(s.heldAt && {
				gates: [
					{
						name: `${s.app}-manual-approval`,
						kind: 'approval',
						allowedVersions: [TM_OLD],
						passing: false
					}
				]
			})
		}
	};
}
function mkTmEnvironment(s: TmCellSpec) {
	return {
		apiVersion: 'environments.kuberik.com/v1alpha1',
		kind: 'Environment',
		metadata: { name: s.app, namespace: `${s.app}-${s.env}` },
		spec: { environment: s.env, name: s.app, rolloutRef: { name: s.app } },
		status: { currentVersion: s.version, lastStatusChangeTime: hcAgo(s.deployedAgoMin) }
	};
}
export const mockTmRollouts = TM_CELLS.map(mkTmRollout);
export const mockTmEnvironments = TM_CELLS.map(mkTmEnvironment);

export const mockFleetRollouts = [
	...FLEET.map(mkFleetRollout),
	...mockHfRollouts,
	...mockMrRollouts,
	...mockEmRollouts,
	...mockTmRollouts
];
// Every fleet app is sited here, once, for all of them: legacy `prod-<region>` names become the prod
// tier's sites (payments-core, edge-mesh), everything else is a single `default` site.
export const mockFleetEnvironments = sitedByApp(
	[
		...FLEET.map(mkFleetEnvironment),
		...mockHfEnvironments,
		...mockMrEnvironments,
		...mockEmEnvironments,
		...mockTmEnvironments
	],
	mockFleetRollouts
);

// -------------------------------------------------------------------------
// THE DEPENDENCIES FIXTURE (added 2026-08-29).
//
// WHY THIS EXISTS. `RolloutDependency` is new, and the live hub carries
// exactly ONE shape of it: `hello-frontend-app` with a single `api` contract
// present in all three environments, satisfied, whose only blocked release is
// the app's OLDEST build. That is the QUIET case, and it is the right default
// for a page whose whole discipline is "never draw the norm" - but it means
// the adverse half of
// `/rollouts/<cluster>/<ns>/<name>/dependencies` cannot be seen on live data
// at all, and neither can any of the shapes a real fleet will produce.
//
// So there are two fixtures, and they are deliberately opposite:
//
//   A. `hello-frontend-app` - THE LIVE SHAPE, COPIED. Three environments, one
//      contract, gated everywhere, satisfied, blocking only `rel-2`. This is
//      the regression fixture for SILENCE: the page must render two lines per
//      contract and nothing else. If a future change makes this fixture draw
//      a mark, that change is marking the norm.
//
//   B. `checkout-api` - EVERY SHAPE LIVE DATA LACKS, in one rollout:
//        · SEVEN environments, so the chain is exercised past the 3 the
//          cluster has and the 320px column is measured at a real N;
//        · a genuinely UNSATISFIED dependency (`Satisfied=False`) whose
//          blocked release is NEWER than what the environment runs - the one
//          state the page is built to surface;
//        · THREE contracts on one rollout, so the block list has to sort
//          (adverse first) rather than just render;
//        · a provider in ANOTHER NAMESPACE (`platform-prod`), so the "in
//          <namespace>" clause and the cross-namespace provider link render;
//        · a contract that gates only SOME environments, so the `no gate in`
//          line renders - the asymmetry case, which the live cluster does not
//          have and which a future cluster might;
//        · a provider with NO deployed contract version, so the
//          "no contract version read yet" branch renders instead of a cause
//          the data cannot evidence;
//        · a blocked tag that is NOT on the ladder, which must still be drawn
//          rather than silently dropped.
//
// The JSON below matches the API byte for byte, including the two fields the
// dashboard resolves SERVER-SIDE and the frontend therefore never re-derives:
// `spec.contract` and `spec.providerRef.namespace` are always populated.
// -------------------------------------------------------------------------

export const DEP_APP = 'hello-frontend-app';
export const DEP_ENVS = ['dev', 'staging', 'prod'] as const;
/** Oldest first, exactly as the hub serves `availableReleases`. */
// ⛔ `created` IS CLOCK-RELATIVE — PART OF THE SAME SWEEP (2026-10-09).
// Harmless today (every `hello-frontend-app` environment runs `rel-66`,
// the newest release, so `detectStuckPromotion`'s `candidateCount === 0`
// guard returns before `created` is ever read) — fixed so it cannot
// become the next `CK_RELEASES` the moment this fixture's "current"
// versions change.
export const DEP_RELEASES = [
	{ tag: 'rel-2', version: '2.1.0-2', revision: 'e87f059fd602466f1c13e293210b3d2e430504c8', created: hcAgo(20 * 60) },
	{ tag: 'rel-63', version: '2.63.0-63', revision: '66e4133a4289eec3b88439b2069b617c8435975f', created: hcAgo(12 * 60) },
	{ tag: 'rel-64', version: '2.64.0-64', revision: '83755067c4c76bc112258b901108ec03699f7f4d', created: hcAgo(6 * 60) },
	{ tag: 'rel-66', version: '2.66.0-66', revision: '9f10e494d560c1db68aef5203e3afdc5fd9e1e10', created: hcAgo(60) }
];

export const depHistory = (tags: string[], agoMin: number, bake = 'Succeeded') =>
	tags.map((t, i) => {
		const rel = DEP_RELEASES.find((r) => r.tag === t)!;
		return {
			id: tags.length - i,
			version: { tag: rel.tag, version: rel.version, revision: rel.revision, created: rel.created },
			timestamp: hcAgo(agoMin + i * 90),
			bakeStatus: i === 0 ? bake : 'Succeeded',
			bakeStatusMessage: 'Bake time completed successfully (no errors within bake time).'
		};
	});

export const mkDepRollout = (env: string) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'Rollout',
	metadata: { name: DEP_APP, namespace: `hello-dep-${env}`, labels: { environment: env } },
	spec: { releasesImagePolicy: `hello-dep-${env}/${DEP_APP}`, versionHistoryLimit: 10, minBakeTime: '5m' },
	status: {
		// See `mkFleetRollout`'s identical note (fix-dash, 2026-10-08).
		source: `github.com/exampleco/${DEP_APP}`,
		wantedVersion: 'rel-66',
		currentVersion: 'rel-66',
		availableReleases: DEP_RELEASES,
		history: depHistory(['rel-66', 'rel-64', 'rel-63', 'rel-2'], 30)
	}
});

/** Single-site chain (`hello-frontend-app`): every tier is the `default` site, wave 1. */
const depSites = (): WSite[] =>
	DEP_ENVS.map((tier) => ({
		tier,
		site: 'default',
		wave: 1,
		revision: DEP_RELEASES.find((r) => r.tag === 'rel-66')!.revision,
		bake: 'Succeeded'
	}));

export const mkDepEnvironment = (env: string) => ({
	apiVersion: 'environments.kuberik.com/v1alpha1',
	kind: 'Environment',
	metadata: { name: DEP_APP, namespace: `hello-dep-${env}` },
	spec: {
		environment: env,
		name: 'hello-dep-frontend-app',
		rolloutRef: { name: DEP_APP }
	},
	status: {
		currentVersion: 'rel-66',
		lastStatusChangeTime: hcAgo(30),
		wave: waveStatusFor('hello-dep-frontend-app', depSites(), depSites().find((x) => x.tier === env)!),
		conditions: [waveReadyCond(), lockstepCond()]
	}
});

/**
 * ⛔ THE DEGENERATE `environmentInfos` THE HUB ACTUALLY SERVES FOR THIS APP,
 * AND IT IS THE REGRESSION FIXTURE FOR A SHIPPED FALSEHOOD.
 *
 * This used to be three fully-populated entries with `After` edges and four
 * history rows each, i.e. the shape `hello-world-app` has. That is NOT what
 * `hello-frontend-app` serves. Measured on the hub, every one of its three
 * namespaces returns exactly one self-entry with no relationship and no
 * history:
 *
 *     "environmentInfos": [ { "environment": "dev" } ]
 *
 * because the environment-controller's GitHub-deployments backend has
 * recorded nothing under this app's `spec.name`. The dependencies page read
 * that as an OBSERVATION and rendered a one-node chain whose single node
 * printed `not deployed` — for an app running `2.66.0-66` in all three
 * environments. **A fixture more generous than production is a fixture that
 * cannot see production's bugs**, and this one hid that defect for as long as
 * it existed.
 *
 * The page now builds its chain from the ROLLOUTS and takes only the ORDER
 * from the `After` edges (`Environment.spec.relationship`, which IS populated
 * — see `mkDepEnvironment`). With this fixture restored to the live shape,
 * `/rollouts/dev/hello-dep-dev/hello-frontend-app/dependencies` must still
 * render THREE nodes, each on `2.66.0-66`. If it ever renders one again, or
 * says `never deployed`, this fixture is what catches it.
 *
 * The seven-node populated case is not lost: `CK_ENV_INFOS` below is fully
 * populated and exercises it.
 */
export const DEP_ENV_INFOS_BY_ENV: Record<string, unknown[]> = Object.fromEntries(
	DEP_ENVS.map((env) => [env, [{ environment: env }]])
);

/** Fixture A - the live shape, copied field for field. */
export const mkLiveDependency = (env: string) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'RolloutDependency',
	metadata: {
		name: 'hello-frontend-needs-api',
		namespace: `hello-dep-${env}`,
		annotations: { 'rollout-dashboard.kuberik.com/source-cluster': env === 'prod' ? 'prod' : 'dev' }
	},
	spec: {
		contract: 'api',
		providerRef: { name: 'hello-api-app', namespace: `hello-dep-${env}` },
		rolloutRef: { name: DEP_APP }
	},
	status: {
		providedVersion: '1.66.0',
		providedTag: 'rel-66',
		admittedVersions: ['rel-63', 'rel-64', 'rel-66'],
		blockedReleases: [{ tag: 'rel-2', requiredVersion: '1.1.0', reason: 'ConstraintNotSatisfied' }],
		gateName: 'dependency-hello-frontend-needs-api',
		conditions: [
			{ type: 'Ready', status: 'True', reason: 'GateSynced', message: 'Gate dependency-hello-frontend-needs-api allows 3 release(s)' },
			{ type: 'Satisfied', status: 'True', reason: 'DependencySatisfied', message: 'No release is waiting on contract "api"' }
		]
	}
});

// ── FIXTURE B - `checkout-api`, seven environments, three contracts ──────

export const CK_APP = 'checkout-api';
/** Seven, in `After` order. Two of them are prod REGIONS, which are a SET. */
export const CK_ENVS = [
	'dev',
	'staging',
	'prod-eu-central',
	'prod-us-east-1',
	'prod-us-east-2',
	'prod-ap-southeast-2',
	'prod-af-south-1'
] as const;

/** Oldest first, again matching the hub's own ordering. */
/**
 * ⛔ `created` IS CLOCK-RELATIVE NOW, NOT A CALENDAR DATE. (2026-10-09,
 * follow-up to the U-2 class fix — coordinator decision: "the calm
 * scenario must read calm.")
 *
 * These used to be fixed ISO timestamps from whenever this fixture was
 * authored (`2026-08-01`..`2026-08-28`). `detectStuckPromotion`
 * (`$lib/utils`) reads the NEWEST candidate's `created` — which, with no
 * `releaseCandidates` published here, falls back to `availableReleases`'
 * last entry (`newestCandidate`, `promotion.ts`) — as "how long has this
 * been waiting". A fixed calendar date does not track the demo's own
 * clock (`hcAgo`/`hcNow`, reanchored to the real wall clock on every
 * reset): as real time passed, `b-45`'s `created` silently aged past the
 * 24h threshold, and EVERY checkout-api environment with a newer build
 * available (every one but `dev`) read "stuck, no progress for 41d" —
 * not because anything was actually wedged, but because the release
 * calendar had quietly rotted. `prod-eu-central` was the one exception,
 * excused for a REAL reason (its own `promotion-prod-eu-central` gate
 * genuinely refuses `b-44`/`b-45` — `staging`, its upstream, has not
 * deployed them yet) — the fixture's intended story for this app was
 * always "mostly current, one environment waiting on its own upstream",
 * never "five things wedged at once". `hcAgo`, like `ckHistory`'s own
 * deploy timestamps below, keeps every build under the 24h window no
 * matter when the dev server starts, so this cannot rot again.
 */
// ⭐ ROUND 5 QA-5, ITEM 2 (TL, dead build links) — `revision` ADDED. These six
// entries used to carry no `revision` field at all, so `revisionFor`
// (version-utils.ts) returned `null` and every `/changes` link built off a
// `CK_RELEASES` entry fell back to the raw `version` string ("4.40.0-40") —
// a key `github-data.ts`'s `respondCommit` could never recognise, since its
// own `ALL_CHANGES` records this app's ladder by `tag` ("b-40"). `expandSha`
// (this file, used identically by `mrVersion`/`emVersion`) turns the tag into
// a deterministic hex string that both LOOKS like a real sha and that
// `github-data.ts` now derives the same way, so the two sides agree again.
export const CK_RELEASES = [
	{ tag: 'b-40', version: '4.40.0-40', revision: expandSha('b-40'), created: hcAgo(20 * 60) },
	{ tag: 'b-41', version: '4.41.0-41', revision: expandSha('b-41'), created: hcAgo(17 * 60) },
	{ tag: 'b-42', version: '4.42.0-42', revision: expandSha('b-42'), created: hcAgo(14 * 60) },
	{ tag: 'b-43', version: '4.43.0-43', revision: expandSha('b-43'), created: hcAgo(10 * 60) },
	{ tag: 'b-44', version: '4.44.0-44', revision: expandSha('b-44'), created: hcAgo(6 * 60) },
	{ tag: 'b-45', version: '4.45.0-45', revision: expandSha('b-45'), created: hcAgo(2 * 60) }
];

/**
 * What each environment is running. dev is on head; staging and the first two
 * regions are HELD BEHIND IT BY A CONTRACT, which is what makes the hop counts
 * on the chain and the blocked rows in the contract block tell one story.
 */
export const CK_LIVE: Record<string, string> = {
	dev: 'b-45',
	staging: 'b-43',
	'prod-eu-central': 'b-43',
	'prod-us-east-1': 'b-42',
	'prod-us-east-2': 'b-42',
	'prod-ap-southeast-2': 'b-40',
	'prod-af-south-1': 'b-40'
};
export const CK_BAKE: Record<string, string> = {
	dev: 'Succeeded',
	staging: 'Succeeded',
	'prod-eu-central': 'Succeeded',
	'prod-us-east-1': 'Succeeded',
	'prod-us-east-2': 'InProgress',
	'prod-ap-southeast-2': 'Succeeded',
	'prod-af-south-1': 'Failed'
};

export const ckHistory = (env: string) => {
	const head = CK_RELEASES.findIndex((r) => r.tag === CK_LIVE[env]);
	const tags = CK_RELEASES.slice(0, head + 1).reverse();
	return tags.map((r, i) => ({
		id: tags.length - i,
		version: { tag: r.tag, version: r.version, revision: r.revision, created: r.created },
		// ⛔ WAS `hcAgo(60 + i * 240)`, briefly `hcAgo(1500 + i * 240)` as a
		// same-day workaround for a capture-clock drift that has since been
		// fixed at the harness (`shot.mjs` now derives its pin from the
		// fixture's own newest timestamp instead of a hardcoded instant, so
		// `hcAgo(n)` is exactly "n minutes ago" on screen again — see the
		// coordinating lane's note). `90` is the number the STORY wants:
		// `prod-us-east-2` is the film's "checking >1h" card, so its head
		// entry (the only `InProgress` env here) sits just past
		// `detectStuck`'s 1h threshold, not a full day into the past. Every
		// env's spacing (`i * 240`) — and therefore every hop-count
		// relationship the dependencies tab reads from
		// `CK_LIVE`/`CK_RELEASES` — is unchanged, since only the shared
		// OFFSET moved, not the per-env version arrangement.
		timestamp: hcAgo(90 + i * 240),
		bakeStatus: i === 0 ? CK_BAKE[env] : 'Succeeded',
		...(i === 0 && CK_BAKE[env] === 'Failed'
			? { bakeStatusMessage: 'HighErrorRate firing in af-south-1' }
			: {})
	}));
};

export const mkCkRollout = (env: string) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'Rollout',
	metadata: { name: CK_APP, namespace: `${CK_APP}-${env}`, labels: { environment: env } },
	spec: { releasesImagePolicy: `${CK_APP}-${env}/${CK_APP}`, versionHistoryLimit: 20, minBakeTime: '5m' },
	status: {
		// See `mkFleetRollout`'s identical note (fix-dash, 2026-10-08) — the
		// checkout-api repo/change page was empty for lack of this.
		source: `github.com/exampleco/${CK_APP}`,
		wantedVersion: CK_LIVE[env],
		currentVersion: CK_LIVE[env],
		availableReleases: CK_RELEASES,
		history: ckHistory(env),
		gates: ckGates(env)
	}
});

/**
 * ⭐ THE GATE SUMMARIES THE CONTROLLER PUBLISHES ON THE ROLLOUT. (2026-10-05)
 *
 * This fixture published none, so every edge into a `checkout-api` node read
 * `unknown` — the Dependencies graph drew "State not reported" on the
 * staging → prod promotion while hello-world (which does publish) drew real
 * state. `promotion-<env>` (environment-controller, named by the Environment's
 * `rolloutGateRef` below) allows exactly the builds the upstream environment
 * has deployed — its own history. `passing` is whether no newer build is
 * refused.
 *
 * ⛔ THE CONTRACT GATES ARE DELIBERATELY NOT PUBLISHED HERE. Doing so is
 * truthful, but it makes `blockingStory` raise an amber "waiting for
 * payments-svc" banner on `prod-us-east-2`'s Overview — the film's promote
 * scene — so it is a story decision, not a fixture fix. The graph reads those
 * edges off the `RolloutDependency` itself (`rolloutNeighbourhood`).
 */
function ckGates(env: string) {
	const newer = CK_RELEASES.slice(CK_RELEASES.findIndex((r) => r.tag === CK_LIVE[env]) + 1).map(
		(r) => r.tag
	);
	/* a `promotion-<env>` gate summary: kind promotion is what the backend says of an Environment-owned gate (the mock has no RolloutGate object behind it) */
	const gate = (name: string, allowed: string[]) => ({
		kind: 'promotion',
		name,
		allowedVersions: allowed,
		passing: newer.every((t) => allowed.includes(t))
	});
	const ups = ckUpstreamPlaces(CK_BASE_ENVS, env);
	return [
		...(ups.length ? [gate(`promotion-${env}`, ckAllowedFrom(CK_LIVE[env], ups, (u) => ckHistory(u).filter((h) => h.bakeStatus === 'Succeeded').map((h) => h.version.tag)))] : []),
		...ckOtherGates(env)
	];
}

/**
 * ⭐ THE GATES ON checkout-api STAGING THAT ARE NOT ANOTHER ROLLOUT. (2026-10-08,
 * the rollout Gates tab — its filmed page.) The tab draws every kind of gate,
 * so the page the film shows carries one of each kind that has no far end:
 *
 *   · `Business hours`, a deploy window (`RolloutSchedule`, Allow,
 *     Europe/Zagreb) — OPEN for the whole story, so it never becomes a second
 *     cause beside the contract ("one failure", the film's own rule);
 *   · `release-approval`, an external, hand-authored `RolloutGate` (no owner)
 *     whose allow-list already holds every build up to b-45 — approved, so it
 *     too holds nothing.
 *
 * Both PASS, so `blockingStory` / the Overview banner / every count on every
 * other page is byte-identical to before: the only thing that holds staging
 * is still `payments-svc`. `deps-story.ts`'s `recomputeCkGates` keeps them
 * when it rewrites the promotion gate.
 */
export const CK_SCHEDULE_GATE = 'schedule-gate-ck7qx';
export const CK_APPROVAL_GATE = 'release-approval';
export const CK_SCHEDULE = 'checkout-business-hours';

export function ckOtherGates(env: string) {
	if (env !== 'staging') return [];
	return [
		{ name: CK_SCHEDULE_GATE, kind: 'schedule', passing: true },
		{ name: CK_APPROVAL_GATE, kind: 'approval', allowedVersions: CK_RELEASES.map((r) => r.tag), passing: true }
	];
}

/** The `RolloutGate` objects behind `ckOtherGates`, as the detail route serves them. */
export function ckGateObjects(env: string) {
	if (env !== 'staging') return [];
	const ns = `${CK_APP}-${env}`;
	return [
		{
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'RolloutGate',
			metadata: {
				name: CK_SCHEDULE_GATE,
				namespace: ns,
				labels: {
					'gate.kuberik.com/schedule-name': CK_SCHEDULE,
					'gate.kuberik.com/schedule-kind': 'RolloutSchedule',
					'gate.kuberik.com/rollout-name': CK_APP
				},
				annotations: { 'gate.kuberik.com/pretty-name': 'Business hours' },
				ownerReferences: [
					{ apiVersion: 'kuberik.com/v1alpha1', kind: 'RolloutSchedule', name: CK_SCHEDULE, uid: 'ck-sched-uid' }
				]
			},
			spec: { rolloutRef: { name: CK_APP }, passing: true }
		},
		{
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'RolloutGate',
			metadata: { name: CK_APPROVAL_GATE, namespace: ns, ...approvalPolicyMeta(ns, CK_APP, 'prod-needs-approval', 'Release approval') },
			spec: { rolloutRef: { name: CK_APP }, passing: true, allowedVersions: CK_RELEASES.map((r) => r.tag) }
		}
	];
}

/** The next 16:00 UTC (18:00 in Zagreb in summer) after the demo's anchor. */
function nextCloseOfBusiness(): string {
	const t = new Date(hcNow);
	t.setUTCHours(16, 0, 0, 0);
	if (t.getTime() <= hcNow.getTime()) t.setUTCDate(t.getUTCDate() + 1);
	return t.toISOString();
}

/** `RolloutSchedule`s matching `namespace` (the `/schedules` routes' fixture). */
export function mockSchedules(namespace?: string) {
	const all = [
		{
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'RolloutSchedule',
			metadata: {
				name: CK_SCHEDULE,
				namespace: `${CK_APP}-staging`,
				annotations: { 'gate.kuberik.com/pretty-name': 'Business hours' }
			},
			spec: {
				action: 'Allow',
				timezone: 'Europe/Zagreb',
				rolloutSelector: { matchLabels: { environment: 'staging' } },
				rules: [{ name: 'weekdays', timeRange: { start: '09:00', end: '18:00' }, daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }]
			},
			status: {
				active: true,
				nextTransition: nextCloseOfBusiness(),
				managedGates: [CK_SCHEDULE_GATE],
				matchingRollouts: 1
			}
		}
	];
	return namespace ? all.filter((x) => x.metadata.namespace === namespace) : all;
}

/**
 * ⭐ THE SITES AND WAVES OF checkout-api. (2026-11-03, waves lane B)
 *
 * The seven places are tiers and sites now: dev and staging are single-site, `prod` has five sites
 * in three waves, which is what the old `prod-<region>` names stood for:
 *
 *   wave 1  eu-central (leader, b-43)  and  us-east-1 (follower, on b-42: it follows the pick)
 *   wave 2  us-east-2                  baking b-42 (InProgress)
 *   wave 3  af-south-1 (leader)        its bake of b-40 FAILED, and the next pick waits on wave 2
 *           ap-southeast-2 (follower)  on b-40 (Succeeded): wave 3 sits behind wave 2, which is baking b-42
 *
 * The PLACE KEY of a prod site is `prod-<site>` (the tier has several live sites), so every
 * namespace, URL and fixture keeps the name it always had.
 */
export const CK_SITE: Record<string, { tier: string; site: string; wave: number }> = {
	dev: { tier: 'dev', site: 'default', wave: 1 },
	staging: { tier: 'staging', site: 'default', wave: 1 },
	'prod-eu-central': { tier: 'prod', site: 'eu-central', wave: 1 },
	'prod-us-east-1': { tier: 'prod', site: 'us-east-1', wave: 1 },
	'prod-us-east-2': { tier: 'prod', site: 'us-east-2', wave: 2 },
	'prod-af-south-1': { tier: 'prod', site: 'af-south-1', wave: 3 },
	'prod-ap-southeast-2': { tier: 'prod', site: 'ap-southeast-2', wave: 3 }
};
/** The place whose history stands for a tier in `status.environmentInfos` (one entry per TIER). */
export const CK_TIER_PLACE: Record<string, string> = { dev: 'dev', staging: 'staging', prod: 'prod-eu-central' };
export const CK_DEPLOY_NAME = 'checkout-api-service';

/** Every site with the build and bake `live` reports for it. */
export function ckWSites(
	live: (env: string) => { tag: string; bake: string } = (env) => ({ tag: CK_LIVE[env], bake: CK_BAKE[env] })
): (WSite & { place: string })[] {
	return CK_ENVS.map((env) => {
		const l = live(env);
		const rel = CK_RELEASES.find((r) => r.tag === l.tag);
		return { ...CK_SITE[env], place: env, revision: rel?.revision, bake: l.bake };
	});
}

/** `status.wave` and the wave conditions of one place, from the live builds `live` reports. */
export function ckWaveFor(env: string, live?: Parameters<typeof ckWSites>[0]) {
	const sites = ckWSites(live);
	const me = sites.find((x) => x.place === env)!;
	return {
		wave: waveStatusFor(CK_DEPLOY_NAME, sites, me),
		conditions: [waveReadyCond(waveBlockerFor(sites, me)), lockstepCond()]
	};
}

/**
 * ⛔ `status.rolloutGateRef` AND THE TOPOLOGY ARE BOTH REQUIRED. (2026-09-20)
 *
 * `buildRolloutGraph`'s promotion-edge loop skips an Environment with no gate, so `checkout-api`'s
 * seven environments produced ZERO promotion edges and the Dependencies map drew a two-node
 * neighbourhood. On the live hub the field is populated, so a fixture without it is LESS than
 * production: the failure mode `DEP_ENV_INFOS`' own note records ("a fixture more generous than
 * production is a fixture that cannot see production's bugs"). The edges now come from the
 * tiers and waves (`upstreamOf`), not from a `relationship` field.
 */
export const mkCkEnvironment = (env: string) => {
	const w = CK_SITE[env];
	const { wave, conditions } = ckWaveFor(env);
	return {
		apiVersion: 'environments.kuberik.com/v1alpha1',
		kind: 'Environment',
		metadata: { name: CK_APP, namespace: `${CK_APP}-${env}` },
		spec: {
			environment: w.tier,
			name: CK_DEPLOY_NAME,
			rolloutRef: { name: CK_APP },
			...(w.tier === 'prod' ? { site: w.site, wave: w.wave } : {})
		},
		status: {
			currentVersion: CK_LIVE[env],
			lastStatusChangeTime: hcAgo(60),
			wave,
			conditions,
			...(env !== 'dev' ? { rolloutGateRef: { name: `promotion-${env}` } } : {})
		}
	};
};

/** The Environment objects without status, enough to read the topology from. */
const CK_BASE_ENVS = CK_ENVS.map((env) => ({
	metadata: { name: CK_APP, namespace: `${CK_APP}-${env}` },
	spec: { environment: CK_SITE[env].tier, name: CK_DEPLOY_NAME, site: CK_SITE[env].site, wave: CK_SITE[env].wave, rolloutRef: { name: CK_APP } }
}));

/**
 * The places `env` takes its version from, by `upstreamOf` (a follower: its leader; a wave-N leader:
 * the sites of the wave before; a wave-1 leader: the last wave of the tier before). `envs` is any
 * list of Environment objects; only checkout-api's are read.
 */
export function ckUpstreamPlaces(envs: unknown[], env: string): string[] {
	return upstreamPlaces(envs, CK_DEPLOY_NAME, env);
}

/** `upstreamOf` over the Environments of one deployment name, as place keys. */
export function upstreamPlaces(envs: unknown[], specName: string, place: string): string[] {
	const list = (envs as Environment[]).filter((e) => e.spec?.name === specName && !hasDuplicateCond(e));
	if (!list.length) return [];
	const topo = buildTopology(list).get(deployNameOf(list[0]));
	const mine = list.find((e) => placeKeyOf(e, list) === place);
	const node = topo?.tiers.flatMap((t) => t.sites).find((x) => x.env === mine);
	if (!topo || !node) return [];
	return upstreamOf(topo, node).flatMap((x) => (x.env ? [placeKeyOf(x.env, list)] : []));
}
const hasDuplicateCond = (e: Environment) =>
	!!e.status?.conditions?.some((c) => c.type === 'WaveReady' && c.status === 'False' && c.reason === 'DuplicateSite');

/**
 * What a promotion gate allows: the builds EVERY upstream place has deployed AND baked (the
 * intersection of their Succeeded histories), plus the build the place itself runs: the controller keeps the running release
 * allowed.
 */
export function ckAllowedFrom(running: string, ups: string[], tagsOf: (place: string) => string[]): string[] {
	const sets = ups.map((u) => new Set(tagsOf(u)));
	const all = [...(sets[0] ?? [])].filter((t) => sets.every((x) => x.has(t)));
	return all.includes(running) ? all : [...all, running];
}

/** The chain as `status.environmentInfos` reports it: one entry per TIER, no relationship. */
export const CK_ENV_INFOS = ['dev', 'staging', 'prod'].map((tier) => ({
	environment: tier,
	history: ckHistory(CK_TIER_PLACE[tier])
}));

export const ckDep = (args: {
	env: string;
	contract: string;
	provider: string;
	providerNamespace: string;
	providedVersion?: string;
	providedTag?: string;
	admitted: string[];
	blocked: { tag: string; requiredVersion?: string; reason?: string }[];
	satisfied: boolean;
}) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'RolloutDependency',
	metadata: {
		name: `${CK_APP}-needs-${args.contract}`,
		namespace: `${CK_APP}-${args.env}`,
		// ⛔ WAS `'prod'` FOR EVERY ENVIRONMENT. A `RolloutDependency` lives in
		// its consumer's namespace on its consumer's cluster, and the rollouts
		// here are stamped from their namespace (`stampSourceCluster`), so
		// staging's dependency pointed at a `prod/checkout-api-staging` rollout
		// that does not exist — the graph's "not in this dashboard" ghost.
		annotations: { 'rollout-dashboard.kuberik.com/source-cluster': fixtureClusterOf(`${CK_APP}-${args.env}`) }
	},
	spec: {
		contract: args.contract,
		providerRef: { name: args.provider, namespace: args.providerNamespace },
		rolloutRef: { name: CK_APP }
	},
	status: {
		...(args.providedVersion ? { providedVersion: args.providedVersion } : {}),
		...(args.providedTag ? { providedTag: args.providedTag } : {}),
		admittedVersions: args.admitted,
		blockedReleases: args.blocked,
		gateName: `dependency-${CK_APP}-needs-${args.contract}`,
		conditions: [
			{ type: 'Ready', status: 'True', reason: 'GateSynced', message: `Gate allows ${args.admitted.length} release(s)` },
			args.satisfied
				? { type: 'Satisfied', status: 'True', reason: 'DependencySatisfied', message: `No release is waiting on contract "${args.contract}"` }
				: { type: 'Satisfied', status: 'False', reason: 'ReleasesBlocked', message: `${args.blocked.length} release(s) waiting on contract "${args.contract}"` }
		]
	}
});

// -- FIXTURE C - A ROLLOUT WITH A CONTRACT GATE AND NO `Environment` ------
//
// The case the tab used to hide from. `standalone-api` is bound to no
// Environment resource, so it has no `environmentInfos` and no promotion
// chain at all - and a `RolloutDependency` is the ONLY thing holding it
// back. The tab must appear (`show: hasEnvironment || hasDependencies`) and
// the page must render the contract section alone without looking broken.
export const SA_APP = 'standalone-api';
export const SA_NS = 'standalone-prod';
// ⛔ `created` IS CLOCK-RELATIVE — SAME FIX AS `CK_RELEASES`/`PAY_RELEASES`
// AND SAME REASON (2026-10-09). `mkSaRollout` below publishes no
// `status.gates` either — "a `RolloutDependency` is the ONLY thing
// holding it back" (the comment above) means `promotionBlock` never sees
// a block, so a fixed calendar `created` aged into a false `stuck` on
// Home exactly like checkout-api's regions did.
// See `CK_RELEASES`'s identical note just above (ROUND 5 QA-5, ITEM 2) —
// same missing-`revision` dead-link cause, same `expandSha` fix.
export const SA_RELEASES = [
	{ tag: 's-10', version: '1.10.0-10', revision: expandSha('s-10'), created: hcAgo(16 * 60) },
	{ tag: 's-11', version: '1.11.0-11', revision: expandSha('s-11'), created: hcAgo(8 * 60) },
	{ tag: 's-12', version: '1.12.0-12', revision: expandSha('s-12'), created: hcAgo(90) }
];
export const mkSaRollout = () => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'Rollout',
	metadata: { name: SA_APP, namespace: SA_NS },
	spec: { releasesImagePolicy: `${SA_NS}/${SA_APP}`, versionHistoryLimit: 10, minBakeTime: '5m' },
	status: {
		// See `mkFleetRollout`'s identical note (fix-dash, 2026-10-08).
		source: `github.com/exampleco/${SA_APP}`,
		wantedVersion: 's-10',
		currentVersion: 's-10',
		availableReleases: SA_RELEASES,
		history: [
			{
				// `requires` IS THE FLOOR THE PROVIDER PAGE READS. It rides on the
				// release a consumer HAS DEPLOYED, exactly as the live hub serves it
				// on `hello-frontend-app` (`{ api: '^1.66.0' }`).
				version: { tag: 's-10', version: '1.10.0-10', requires: { ledger: '>=5.0.0' } },
				timestamp: hcAgo(2400),
				bakeStatus: 'Succeeded'
			}
		]
	}
});
export const mockSaDependency = {
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'RolloutDependency',
	metadata: {
		name: `${SA_APP}-needs-ledger`,
		namespace: SA_NS,
		annotations: { 'rollout-dashboard.kuberik.com/source-cluster': 'prod' }
	},
	spec: {
		contract: 'ledger',
		providerRef: { name: 'ledger-core', namespace: 'platform-prod' },
		rolloutRef: { name: SA_APP }
	},
	status: {
		providedVersion: '5.1.0',
		providedTag: 'led-510',
		admittedVersions: ['s-10'],
		blockedReleases: [
			{ tag: 's-12', requiredVersion: '^6.0.0', reason: 'ConstraintNotSatisfied' },
			{ tag: 's-11', requiredVersion: '>=5.4.0', reason: 'ProviderVersionTooOld' }
		],
		gateName: `dependency-${SA_APP}-needs-ledger`,
		conditions: [
			{ type: 'Ready', status: 'True', reason: 'GateSynced', message: 'Gate allows 1 release(s)' },
			{
				type: 'Satisfied',
				status: 'False',
				reason: 'ReleasesBlocked',
				message: '2 release(s) waiting on contract "ledger"'
			}
		]
	}
};


// -------------------------------------------------------------------------
// FIXTURE D - THE PROVIDER SIDE (added 2026-08-30).
//
// WHY THIS EXISTS. Every fixture above is written from the CONSUMER end, and
// so was every selector in the app: `spec.rolloutRef`. Nothing anywhere
// selected `spec.providerRef`, so the rollouts that other services are
// standing on had no fixture, no page and no tab. The live hub has exactly
// one such rollout (`hello-api-app`) and it is the QUIET case - one consumer,
// satisfied. These three are the shapes it lacks:
//
//   · `ledger-core`   BLOCKING ONLY. Two DIFFERENT consumer services
//                     (`standalone-api`, `payments-svc`) are held on it, so
//                     the card has to group by service and the banner has to
//                     take its plural branch. It consumes nothing, and it is
//                     bound to NO `Environment`, which is precisely the
//                     rollout the old `show:` predicate hid the tab from.
//   · `payments-svc` BOTH ENDS AT ONCE. Held by `ledger-core` (so the
//                     blocked-by card and the amber banner render) AND
//                     holding `checkout-api` in five namespaces plus
//                     `fulfillment-svc` in one (so the blocking card renders
//                     beneath it). It is the fixture for the rule that the
//                     two banners never stack.
//   · `fulfillment-svc` A consumer with NO `Environment`, so its place
//                     renders as a NAMESPACE handle rather than a tier chip
//                     - the branch that refuses to invent an environment.
//                     (Renamed from `orders-api` 2026-10-08 — that name
//                     collided with the real FLEET app of the same name.)
//
// The causal chain is real and is the point: `ledger-core` is on 5.1.0, so
// `payments-svc` cannot ship `3.0.0`, so `checkout-api` cannot ship `b-45`.
// Every number below is consistent with the gates already written above -
// `pay-241`/`2.4.1` and `led-510`/`5.1.0` are the values fixtures B and C
// already publish as `providedVersion`.
//
// "A rollout that is NEITHER" needs no fixture: it is `hello-world-app`, the
// mock's main response, and it is the norm this page must stay silent on.
// -------------------------------------------------------------------------

// ⛔ THE PROVIDER IS `payments-svc`, NOT `payments-core`, AND THAT IS A
// MEASUREMENT. `MR_APP` above is an unrelated multi-region fixture app already
// called `payments-core`, and `groupRolloutsByApp` keys on the rollout NAME, so
// adding a second service with that name made ONE app out of two: the provider
// page's promotion chain rendered the multi-region app's nine environments and
// the contract card counted `in 1 of 10 environments`. Two unrelated services
// sharing a name is a fixture mistake, not a page defect - renamed rather than
// worked around.
export const PLATFORM_NS = 'platform-prod';
/**
 * The staging cluster's own payments-svc. `checkout-api` in staging depends on
 * `payments` like the prod regions do, and a `RolloutDependency` can only name
 * a provider on its own cluster — before this, staging's gate pointed across
 * clusters at `platform-prod` and the graph could only draw one end of it.
 * Same build as prod (`pay-241`), so every number on the page is unchanged.
 */
export const PLATFORM_STAGING_NS = 'platform-staging';
/**
 * The dev cluster's platform namespace, home of `search-api` — fixture B.3's
 * provider. Its `RolloutDependency` sits in `checkout-api-dev` on the dev
 * cluster, and a provider is always on its consumer's cluster, so the old
 * `platform-prod` here produced a "Waiting on" link to
 * `/rollouts/dev/platform-prod/search-api`, a page that does not exist.
 */
export const PLATFORM_DEV_NS = 'platform-dev';

/**
 * ⛔ `created` IS CLOCK-RELATIVE, NOT A CALENDAR DATE — SAME FIX AS
 * `CK_RELEASES`, SAME REASON. (2026-10-09, same follow-up: "the calm
 * scenario must read calm.") `ledger-core`, `payments-svc` (both
 * namespaces) and `fulfillment-svc` (`mkPlainRollout`, below) publish NO
 * `status.gates` at all — they are providers/consumers in the dependency
 * story, held only by a `RolloutDependency` contract never wired onto
 * `rollout.status.gates` (same deliberate split `ckGates`'s own doc
 * comment documents for checkout-api). So `promotionBlock(r).blocked` is
 * always `false` for every one of them, and `detectStuckPromotion` always
 * took its documented "gateless but stagnant" branch, reading the
 * fixed, now-months-old `created` dates below as "how long has this been
 * waiting" — the exact same clock-rot that put checkout-api under
 * Home's "Needs you now". None of these four is a deliberate
 * needs-a-person beat (`held-sentence.test.ts`/`deps-story.ts` only ever
 * cast `ledger-core`/`payments-svc` as the thing something ELSE is
 * waiting ON, never as a card an operator should click) — they read
 * "held, waiting on an upstream deploy" on `/dependencies` and the Gates
 * tab via the `RolloutDependency` join, completely unaffected by this
 * change, same as `prod-eu-central`'s real hold survived the
 * `CK_RELEASES` fix.
 */
export const SEARCH_RELEASES = [{ tag: 'srch-100', version: '1.0.0', created: hcAgo(60) }];

export const PAY_RELEASES = [
	{ tag: 'pay-239', version: '2.3.9', created: hcAgo(18 * 60) },
	{ tag: 'pay-241', version: '2.4.1', created: hcAgo(10 * 60) },
	{ tag: 'pay-300', version: '3.0.0', created: hcAgo(3 * 60) }
];

export const LEDGER_RELEASES = [
	{ tag: 'led-510', version: '5.1.0', created: hcAgo(14 * 60) },
	{ tag: 'led-600', version: '6.0.0', created: hcAgo(4 * 60) }
];

export const ORD_RELEASES = [
	{ tag: 'o-12', version: '1.12.0-12', created: hcAgo(12 * 60) },
	{ tag: 'o-13', version: '1.13.0-13', created: hcAgo(2 * 60) }
];

/**
 * ⭐ IDENTITY-SVC'S OWN RELEASES. (qa11, 2026-10-11.) FIXTURE B.2 (below,
 * `...['dev', 'staging'].map(...)`) points `checkout-api`'s identity
 * contract at `providerRef: { name: 'identity-svc', namespace:
 * 'checkout-api-<env>' }` and reports it deployed at `id-720`/`7.2.0` — but
 * `mockProviderRollouts` never had an `identity-svc` Rollout to match, so
 * the dependencies tab's "Open identity-svc" link pointed at a rollout
 * this dashboard had never heard of and 404'd. `id-720` here is the exact
 * tag FIXTURE B.2's own `providedTag` names, so the provider page it opens
 * actually shows the version the contract claims is running.
 */
export const ID_RELEASES = [
	{ tag: 'id-700', version: '7.0.0', created: hcAgo(20 * 60) },
	{ tag: 'id-720', version: '7.2.0', created: hcAgo(6 * 60) }
];

export const mkPlainRollout = (args: {
	name: string;
	namespace: string;
	releases: { tag: string; version: string; created: string }[];
	current: string;
	requires?: Record<string, string>;
}) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'Rollout',
	metadata: { name: args.name, namespace: args.namespace },
	spec: {
		releasesImagePolicy: `${args.namespace}/${args.name}`,
		versionHistoryLimit: 10,
		minBakeTime: '5m'
	},
	status: {
		wantedVersion: args.current,
		currentVersion: args.current,
		availableReleases: args.releases,
		history: [
			{
				id: 1,
				version: {
					...args.releases.find((r) => r.tag === args.current)!,
					...(args.requires ? { requires: args.requires } : {})
				},
				timestamp: hcAgo(300),
				bakeStatus: 'Succeeded'
			}
		]
	}
});

export const mkPlainDependency = (args: {
	name: string;
	namespace: string;
	consumer: string;
	contract: string;
	provider: string;
	providerNamespace: string;
	providedVersion: string;
	providedTag: string;
	admitted: string[];
	blocked: { tag: string; requiredVersion?: string; reason?: string }[];
}) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'RolloutDependency',
	metadata: {
		name: args.name,
		namespace: args.namespace,
		annotations: { 'rollout-dashboard.kuberik.com/source-cluster': 'prod' }
	},
	spec: {
		contract: args.contract,
		providerRef: { name: args.provider, namespace: args.providerNamespace },
		rolloutRef: { name: args.consumer }
	},
	status: {
		providedVersion: args.providedVersion,
		providedTag: args.providedTag,
		admittedVersions: args.admitted,
		blockedReleases: args.blocked,
		gateName: `dependency-${args.name}`,
		conditions: [
			{ type: 'Ready', status: 'True', reason: 'GateSynced', message: `Gate allows ${args.admitted.length} release(s)` },
			{
				type: 'Satisfied',
				status: 'False',
				reason: 'ReleasesBlocked',
				message: `${args.blocked.length} release(s) waiting on contract "${args.contract}"`
			}
		]
	}
});

export const mockProviderRollouts = [
	mkPlainRollout({
		name: 'payments-svc',
		namespace: PLATFORM_NS,
		releases: PAY_RELEASES,
		current: 'pay-241',
		requires: { ledger: '>=5.0.0' }
	}),
	mkPlainRollout({
		name: 'payments-svc',
		namespace: PLATFORM_STAGING_NS,
		releases: PAY_RELEASES,
		current: 'pay-241'
	}),
	mkPlainRollout({
		name: 'ledger-core',
		namespace: PLATFORM_NS,
		releases: LEDGER_RELEASES,
		current: 'led-510'
	}),
	// ⭐ RENAMED FROM `orders-api` (TL, 2026-10-08, U-12/U-28). This provider
	// fixture collided by name with the real FLEET app `orders-api`
	// (orders-api-dev/staging/prod) — same app name, different namespace —
	// which read on Home/Apps as a fourth, nonsensical "environment" of the
	// real app. `fulfillment-svc` is a consumer with no `Environment` of its
	// own (the dependencies tab's "namespace handle" case); nothing in the
	// deps story or the Gates tab keys off the literal string `orders-api`
	// for this fixture's role, only its `metadata.namespace`/consumer name,
	// both updated together below and in `deps-story.ts`.
	mkPlainRollout({
		name: 'fulfillment-svc',
		namespace: 'orders-prod',
		releases: ORD_RELEASES,
		current: 'o-12',
		requires: { payments: '^2.0.0' }
	}),
	// FIXTURE B.2's provider — `identity-svc`, one per env `checkout-api`'s
	// identity contract gates (`dev`, `staging`; see `ID_RELEASES`'s own
	// note above). Deployed at `id-720`, the exact tag the dependency's
	// `providedTag` claims, so "Open identity-svc" from either environment
	// lands on a real rollout instead of a dead link.
	mkPlainRollout({
		name: 'identity-svc',
		namespace: `${CK_APP}-dev`,
		releases: ID_RELEASES,
		current: 'id-720'
	}),
	mkPlainRollout({
		name: 'identity-svc',
		namespace: `${CK_APP}-staging`,
		releases: ID_RELEASES,
		current: 'id-720'
	}),
	// FIXTURE B.3's provider: a real rollout the "Waiting on" link can open,
	// with a release available and NOTHING deployed — the state its
	// dependency reports as `ProviderHasNoDeployedRelease`.
	{
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: { name: 'search-api', namespace: PLATFORM_DEV_NS },
		spec: {
			releasesImagePolicy: `${PLATFORM_DEV_NS}/search-api`,
			versionHistoryLimit: 10,
			minBakeTime: '5m'
		},
		status: {
			availableReleases: SEARCH_RELEASES,
			// nothing deployed: every release is a candidate (the controller's rule), listed so its age is kept fresh like every other candidate
			releaseCandidates: [...SEARCH_RELEASES].reverse(),
			history: []
		}
	} as unknown as ReturnType<typeof mkPlainRollout>
];

export const mockProviderDependencies = [
	// `payments-svc` is HELD by `ledger-core`: 3.0.0 wants ledger ^6.0.0 and
	// ledger-core has deployed 5.1.0. This is what makes `checkout-api`'s block
	// upstream have a cause rather than being an isolated red row.
	mkPlainDependency({
		name: 'payments-svc-needs-ledger',
		namespace: PLATFORM_NS,
		consumer: 'payments-svc',
		contract: 'ledger',
		provider: 'ledger-core',
		providerNamespace: PLATFORM_NS,
		providedVersion: '5.1.0',
		providedTag: 'led-510',
		admitted: ['pay-239', 'pay-241'],
		blocked: [{ tag: 'pay-300', requiredVersion: '^6.0.0', reason: 'ConstraintNotSatisfied' }]
	}),
	// A SECOND, DIFFERENT consumer service on `payments-svc`, in a namespace
	// with no `Environment` - so the card groups by service and one group's
	// place renders as a namespace handle.
	mkPlainDependency({
		name: 'fulfillment-svc-needs-payments',
		namespace: 'orders-prod',
		consumer: 'fulfillment-svc',
		contract: 'payments',
		provider: 'payments-svc',
		providerNamespace: PLATFORM_NS,
		providedVersion: '2.4.1',
		providedTag: 'pay-241',
		admitted: ['o-12'],
		blocked: [{ tag: 'o-13', requiredVersion: '^3.0.0', reason: 'ConstraintNotSatisfied' }]
	})
];

export const mockDependencies = [
	// FIXTURE A - the live shape, one gate per environment, all satisfied.
	...DEP_ENVS.map(mkLiveDependency),

	// FIXTURE C - the no-Environment rollout.
	mockSaDependency,

	// FIXTURE B.1 - THE ADVERSE ONE. `payments` is unsatisfied in staging and
	// in two prod regions, and the builds it blocks are NEWER than what each
	// of them runs, so every one of them is a build somebody wants. The
	// provider lives in ANOTHER NAMESPACE.
	...['staging', 'prod-eu-central', 'prod-us-east-1'].map((env) =>
		ckDep({
			env,
			contract: 'payments',
			provider: 'payments-svc',
			// A dependency resolves its provider on its OWN cluster, so
			// staging's is the staging copy of payments-svc (`PLATFORM_STAGING_NS`).
			providerNamespace: env === 'staging' ? PLATFORM_STAGING_NS : 'platform-prod',
			providedVersion: '2.4.1',
			providedTag: 'pay-241',
			admitted: ['b-40', 'b-41', 'b-42', 'b-43'],
			blocked: [
				{ tag: 'b-45', requiredVersion: '^3.0.0', reason: 'ConstraintNotSatisfied' },
				{ tag: 'b-44', requiredVersion: '3.0.0', reason: 'ProviderVersionTooOld' }
			],
			satisfied: false
		})
	),
	// The other four regions are gated too, but on builds they are already
	// past, so they stay quiet. `prod-af-south-1` is behind ALL of them, so
	// its blocked builds ARE wanted - the case where one region in a fleet is
	// the only one holding a blocked candidate.
	...['prod-us-east-2', 'prod-ap-southeast-2'].map((env) =>
		ckDep({
			env,
			contract: 'payments',
			provider: 'payments-svc',
			providerNamespace: 'platform-prod',
			providedVersion: '2.4.1',
			providedTag: 'pay-241',
			admitted: ['b-40', 'b-41', 'b-42'],
			blocked: [{ tag: 'b-43', requiredVersion: '~2.9.0', reason: 'ConstraintNotSatisfied' }],
			satisfied: false
		})
	),

	// FIXTURE B.2 - THE ASYMMETRY. `identity` gates only dev and staging, so
	// five of the seven environments have no gate at all. Satisfied, and its
	// only blocked build is one dev is already past, so the block renders its
	// two lines plus the `no gate in` line and NOTHING else.
	...['dev', 'staging'].map((env) =>
		ckDep({
			env,
			contract: 'identity',
			provider: 'identity-svc',
			providerNamespace: `${CK_APP}-${env}`,
			providedVersion: '7.2.0',
			providedTag: 'id-720',
			admitted: ['b-41', 'b-42', 'b-43', 'b-44', 'b-45'],
			blocked: [{ tag: 'b-40', requiredVersion: '8.0.0', reason: 'ConstraintNotSatisfied' }],
			satisfied: true
		})
	),

	// FIXTURE B.3 - NO CONTRACT VERSION READ YET, and a blocked tag that is
	// NOT on the ladder. The page must state the observable rather than name
	// a cause, and must still draw the unknown tag rather than drop it.
	ckDep({
		env: 'dev',
		contract: 'search',
		provider: 'search-api',
		providerNamespace: PLATFORM_DEV_NS,
		admitted: [],
		blocked: [{ tag: 'b-46-rc1', requiredVersion: '>=1.0.0', reason: 'ProviderHasNoDeployedRelease' }],
		satisfied: false
	}),

	// FIXTURE D - the two gates that give the PROVIDER side something to draw.
	...mockProviderDependencies
];


export const mockDepRollouts = [
	...DEP_ENVS.map(mkDepRollout),
	...CK_ENVS.map(mkCkRollout),
	mkSaRollout(),
	...mockProviderRollouts
];
export const mockDepEnvironments = [...DEP_ENVS.map(mkDepEnvironment), ...CK_ENVS.map(mkCkEnvironment)];

/** Detail responses, keyed `namespace/name`, for the fixture apps. */
export const mockDepDetails: Record<string, unknown> = Object.fromEntries([
	// FIXTURE D - the provider rollouts. NO `environment` key on any of them:
	// they are bound to no Environment, which is the case the dependencies tab
	// used to hide from entirely.
	...mockProviderRollouts.map((r) => [
		`${r.metadata.namespace}/${r.metadata.name}`,
		{
			rollout: r,
			kustomizations: { items: [] },
			ociRepositories: { items: [] },
			rolloutGates: { items: [] },
			kruiseRollout: null,
			rolloutTests: { items: [] }
		}
	]),
	[
		`${SA_NS}/${SA_APP}`,
		{
			rollout: mkSaRollout(),
			kustomizations: { items: [] },
			ociRepositories: { items: [] },
			rolloutGates: { items: [] },
			// NO `environment` key at all - this rollout is bound to none.
			kruiseRollout: null,
			rolloutTests: { items: [] }
		}
	],
	...DEP_ENVS.map((env) => [
		`hello-dep-${env}/${DEP_APP}`,
		{
			rollout: mkDepRollout(env),
			kustomizations: { items: [] },
			ociRepositories: { items: [] },
			rolloutGates: { items: [] },
			environment: {
				...mkDepEnvironment(env),
				status: {
					...mkDepEnvironment(env).status,
					environmentInfos: DEP_ENV_INFOS_BY_ENV[env]
				}
			},
			kruiseRollout: null,
			rolloutTests: { items: [] }
		}
	]),
	...CK_ENVS.map((env) => [
		`${CK_APP}-${env}/${CK_APP}`,
		{
			rollout: mkCkRollout(env),
			kustomizations: { items: [] },
			ociRepositories: { items: [] },
			rolloutGates: { items: ckGateObjects(env) },
			environment: {
				...mkCkEnvironment(env),
				status: { ...mkCkEnvironment(env).status, environmentInfos: CK_ENV_INFOS }
			},
			kruiseRollout: null,
			rolloutTests: { items: [] }
		}
	])
]);

export const mockClusters = [
	{ name: 'dev',     url: 'https://kuberik-dev.example.com' },
	{ name: 'staging', url: 'https://kuberik-staging.example.com' },
	{ name: 'prod',    url: 'https://kuberik-prod.example.com' }
];

// The hub stamps EVERY item it returns with the cluster it came from, and the
// frontend builds `/rollouts/{cluster}/{ns}/{name}` links from that stamp. Most
// fixtures here predate the stamp, so their cards linked to `/rollouts//ns/name`
// and the detail page said "This rollout does not exist". Derive a cluster from
// the namespace for anything un-annotated; fixtures that carry their own stamp
// keep it.
export const SOURCE_CLUSTER = 'rollout-dashboard.kuberik.com/source-cluster';
/** The cluster a fixture namespace is stamped with — `stampSourceCluster`'s rule. */
export function fixtureClusterOf(ns: string): string {
	return /prod/.test(ns) ? 'prod' : /staging|test/.test(ns) ? 'staging' : 'dev';
}
export function stampSourceCluster<T extends { metadata?: { namespace?: string; annotations?: Record<string, string> } }>(
	item: T
): T {
	const ann = item.metadata?.annotations ?? {};
	if (ann[SOURCE_CLUSTER]) return item;
	const cluster = fixtureClusterOf(item.metadata?.namespace ?? '');
	return { ...item, metadata: { ...item.metadata, annotations: { ...ann, [SOURCE_CLUSTER]: cluster } } };
}

// -- FIXTURE E - `hello-waves`, THE SITES AND WAVES DEMO ------------------
//
// Mirrors the live demo (`.work/waves-demo/REPORT.md`, rollout-dashboard branch demo/hello-waves):
//
//   dev      dev-local                      spoke
//   staging  eu-west-1                      spoke
//   prod     eu-west-1   wave 1 LEADER      hub
//            us-east-1   wave 1 follower    spoke
//            ap-south-1  wave 2             hub
//
// One namespace per site (`hello-waves-{dev,staging,prod-eu-west-1,prod-us-east-1,prod-ap-south-1}`).
// The rollout and the Environment are both called `hello-waves-app`, as in the manifests.
//
// It is the only app whose state follows the SCENARIO, because the story is "what the controller says
// while a build is in flight":
//
//   calm      every site Ready on one build.
//   incident  the leader is baking a new build, the follower is deploying it, and ap-south-1 waits:
//             `WaitingFor: prod/us-east-1 bake on <rev7>`.
//   wide      `lockstep: true`. The wave-1 leader holds its pick until ap-south-1 baked it
//             (`LockstepWaiting: prod/ap-south-1 bake on <rev7>`), ap-south-1 has not taken the flag yet
//             (`LockstepConsistent=False/LockstepMismatch`), and a scratch namespace on the hub claims
//             the us-east-1 site that the spoke already owns (`DuplicateSite`, no role, an empty gate).
//
// A DuplicateSite object is not a place: it is attached to its owner and never counted.

export type HwvScenario = 'calm' | 'incident' | 'wide';
export const HWV_APP = 'hello-waves-app';
export const HWV_DEPLOY = 'hello-waves-app';
export const HWV_SCRATCH_NS = 'hello-waves-prod-us-east-1-scratch';
/** The spoke's cluster id the duplicate's message names. */
export const HWV_SPOKE_ID = '7f3a9c1e';

export const HWV_RELEASES = [
	{ tag: '4ff7a58', version: '4ff7a58', revision: expandSha('4ff7a58'), created: hcAgo(18 * 60) },
	{ tag: '0f1f88a', version: '0f1f88a', revision: expandSha('0f1f88a'), created: hcAgo(6 * 60) },
	{ tag: 'c6f19d2', version: 'c6f19d2', revision: expandSha('c6f19d2'), created: hcAgo(40) }
];

type HwvPlace = { ns: string; tier: string; site: string; wave: number; cluster: string };
export const HWV_PLACES: HwvPlace[] = [
	{ ns: 'hello-waves-dev', tier: 'dev', site: 'dev-local', wave: 1, cluster: 'dev' },
	{ ns: 'hello-waves-staging', tier: 'staging', site: 'eu-west-1', wave: 1, cluster: 'dev' },
	{ ns: 'hello-waves-prod-eu-west-1', tier: 'prod', site: 'eu-west-1', wave: 1, cluster: 'prod' },
	{ ns: 'hello-waves-prod-us-east-1', tier: 'prod', site: 'us-east-1', wave: 1, cluster: 'dev' },
	{ ns: 'hello-waves-prod-ap-south-1', tier: 'prod', site: 'ap-south-1', wave: 2, cluster: 'prod' }
];

export const HWV_BEATS = ['arm', 'staging', 'wave1', 'wave1-done', 'wave2', 'done'] as const;
export type HwvBeat = (typeof HWV_BEATS)[number];
/** The stepped waves story's current beat (waves-story.ts). `null` until a beat is fired: the scenario rules. */
let hwvBeat: HwvBeat | null = null;
export const setHwvBeat = (b: HwvBeat | null) => {
	hwvBeat = b;
};

type Live = { tag: string; bake: string; msg?: string };
/** Per beat, what each site (dev, staging, prod's sites) runs: c6f19d2 is NEW, 0f1f88a the build prod still runs. */
function hwvBeatLive(beat: HwvBeat, key: string): Live {
	const NEW = 'c6f19d2';
	const OLD = '0f1f88a';
	const ok = (tag: string): Live => ({ tag, bake: 'Succeeded' });
	const checking: Live = { tag: NEW, bake: 'InProgress', msg: 'checking' };
	const deploying: Live = { tag: NEW, bake: 'Deploying', msg: 'Waiting for health checks to become healthy before starting bake.' };
	switch (beat) {
		case 'arm':
			return key === 'dev' ? ok(NEW) : key === 'staging' ? checking : ok(OLD);
		case 'staging':
			return key === 'dev' || key === 'staging' ? ok(NEW) : ok(OLD);
		case 'wave1':
			return key === 'dev' || key === 'staging' ? ok(NEW) : key === 'eu-west-1' ? checking : key === 'us-east-1' ? deploying : ok(OLD);
		case 'wave1-done':
			return key === 'ap-south-1' ? ok(OLD) : ok(NEW);
		case 'wave2':
			return key === 'ap-south-1' ? checking : ok(NEW);
		case 'done':
			return ok(NEW);
	}
}

/** What each site runs and how its bake stands, per scenario. */
function hwvLive(scenario: HwvScenario, p: HwvPlace): Live {
	const NEW = 'c6f19d2';
	const OLD = '0f1f88a';
	const key = p.tier === 'prod' ? p.site : p.tier;
	if (hwvBeat) return hwvBeatLive(hwvBeat, key);
	if (scenario === 'incident') {
		if (key === 'eu-west-1') return { tag: NEW, bake: 'InProgress' };
		if (key === 'us-east-1') return { tag: NEW, bake: 'Deploying', msg: 'Waiting for health checks to become healthy before starting bake.' };
		if (key === 'ap-south-1') return { tag: OLD, bake: 'Succeeded' };
	}
	if (scenario === 'wide') {
		if (p.tier === 'prod') return { tag: OLD, bake: key === 'ap-south-1' ? 'InProgress' : 'Succeeded' };
	}
	return { tag: NEW, bake: 'Succeeded' };
}

const hwvSites = (scenario: HwvScenario): (WSite & { place: HwvPlace })[] =>
	HWV_PLACES.map((p) => {
		const l = hwvLive(scenario, p);
		return {
			tier: p.tier,
			site: p.site,
			wave: p.wave,
			revision: HWV_RELEASES.find((r) => r.tag === l.tag)!.revision,
			bake: l.bake,
			place: p
		};
	});

/** The place key of a hello-waves namespace: the tier, or `prod-<site>` while prod has several sites. */
export const hwvPlaceKey = (p: HwvPlace) => (p.tier === 'prod' ? `prod-${p.site}` : p.tier);

function hwvHistory(tag: string, bake: string, msg?: string) {
	const head = HWV_RELEASES.findIndex((r) => r.tag === tag);
	const tags = HWV_RELEASES.slice(0, head + 1).reverse();
	return tags.map((r, i) => ({
		id: tags.length - i,
		version: { tag: r.tag, version: r.version, revision: r.revision, created: r.created },
		// A build lands at the same age on every site (newest 8 minutes ago), so the order in which a
		// tag first appeared anywhere is the release order.
		timestamp: hcAgo(8 + (HWV_RELEASES.length - 1 - HWV_RELEASES.indexOf(r)) * 180),
		bakeStatus: i === 0 ? bake : 'Succeeded',
		...(i === 0 && msg ? { bakeStatusMessage: msg } : {})
	}));
}

const hwvRolloutOf = (ns: string, tier: string, cluster: string, status: Record<string, unknown>) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'Rollout',
	metadata: {
		name: HWV_APP,
		namespace: ns,
		labels: { environment: tier },
		annotations: { [SOURCE_CLUSTER]: cluster }
	},
	spec: { releasesImagePolicy: `${ns}/${HWV_APP}`, versionHistoryLimit: 5, minBakeTime: '3m' },
	status: { source: 'github.com/exampleco/hello-waves', availableReleases: HWV_RELEASES, ...status }
});

/** The Environments of hello-waves in `scenario`, the DuplicateSite one included in `wide`. */
export function mkHwvEnvironments(scenario: HwvScenario) {
	const sites = hwvSites(scenario);
	const envs = sites.map((x) => {
		const p = x.place;
		const l = hwvLive(scenario, p);
		const key = hwvPlaceKey(p);
		let blocker = waveBlockerFor(sites, x);
		let mismatch: string | undefined;
		if (scenario === 'wide' && p.tier === 'prod') {
			if (p.site === 'eu-west-1') blocker = { reason: 'LockstepWaiting', message: 'prod/ap-south-1 bake on ' + rev7(x.revision) };
			if (p.site === 'ap-south-1')
				mismatch = 'wave-1 leader prod/eu-west-1 has lockstep=true; disagreeing sites: prod/ap-south-1';
		}
		return {
			apiVersion: 'environments.kuberik.com/v1alpha1',
			kind: 'Environment',
			metadata: { name: HWV_APP, namespace: p.ns, annotations: { [SOURCE_CLUSTER]: p.cluster } },
			spec: {
				environment: p.tier,
				name: HWV_DEPLOY,
				site: p.site,
				...(p.tier === 'prod' ? { wave: p.wave } : {}),
				...(scenario === 'wide' && p.tier === 'prod' && p.site !== 'ap-south-1' ? { lockstep: true } : {}),
				rolloutRef: { name: HWV_APP }
			},
			status: {
				currentVersion: l.tag,
				lastStatusChangeTime: hcAgo(6),
				wave: waveStatusFor(HWV_DEPLOY, sites, x),
				conditions: [waveReadyCond(blocker), lockstepCond(mismatch)],
				...(p.tier !== 'dev' ? { rolloutGateRef: { name: `promotion-${key}` } } : {})
			}
		};
	});
	if (scenario === 'wide') {
		envs.push({
			apiVersion: 'environments.kuberik.com/v1alpha1',
			kind: 'Environment',
			metadata: { name: HWV_APP, namespace: HWV_SCRATCH_NS, annotations: { [SOURCE_CLUSTER]: 'prod' } },
			spec: { environment: 'prod', name: HWV_DEPLOY, site: 'us-east-1', wave: 1, rolloutRef: { name: HWV_APP } },
			status: {
				currentVersion: '0f1f88a',
				lastStatusChangeTime: hcAgo(12),
				// No role, no leader, no members: the controller never evaluated this site.
				wave: { site: 'us-east-1', wave: 1 },
				conditions: [
					waveCond(
						'WaveReady',
						'False',
						'DuplicateSite',
						`site us-east-1 of prod for kuberik-${HWV_DEPLOY} is owned by cluster ${HWV_SPOKE_ID} namespace hello-waves-prod-us-east-1 name ${HWV_APP}`
					)
				],
				rolloutGateRef: { name: 'promotion-prod-us-east-1-scratch' }
			}
		} as unknown as (typeof envs)[number]);
	}
	return envs;
}

/** The Rollouts of hello-waves in `scenario`, gates computed from the topology. */
export function mkHwvRollouts(scenario: HwvScenario) {
	const sites = hwvSites(scenario);
	const envs = mkHwvEnvironments(scenario);
	const hist = new Map(
		sites.map((x) => {
			const l = hwvLive(scenario, x.place);
			return [hwvPlaceKey(x.place), hwvHistory(l.tag, l.bake, l.msg)] as const;
		})
	);
	const rollouts = sites.map((x) => {
		const p = x.place;
		const l = hwvLive(scenario, p);
		const key = hwvPlaceKey(p);
		const ups = upstreamPlaces(envs, HWV_DEPLOY, key);
		const allowed = ckAllowedFrom(
			l.tag,
			ups,
			(u) => (hist.get(u) ?? []).filter((h) => h.bakeStatus === 'Succeeded').map((h) => h.version.tag)
		);
		const newer = HWV_RELEASES.slice(HWV_RELEASES.findIndex((r) => r.tag === l.tag) + 1).map((r) => r.tag);
		return hwvRolloutOf(p.ns, p.tier, p.cluster, {
			wantedVersion: l.tag,
			currentVersion: l.tag,
			history: hist.get(key),
			gates: ups.length ? [{ name: `promotion-${key}`, kind: 'promotion', allowedVersions: allowed, passing: newer.every((t) => allowed.includes(t)) }] : []
		});
	});
	if (scenario === 'wide') {
		// The scratch copy: a Rollout that was applied by hand, held shut by its DuplicateSite gate.
		rollouts.push(
			hwvRolloutOf(HWV_SCRATCH_NS, 'prod', 'prod', {
				wantedVersion: '0f1f88a',
				currentVersion: '0f1f88a',
				history: hwvHistory('0f1f88a', 'Succeeded'),
				gates: [{ name: 'promotion-prod-us-east-1-scratch', kind: 'promotion', allowedVersions: [], passing: false }]
			})
		);
	}
	return rollouts;
}
