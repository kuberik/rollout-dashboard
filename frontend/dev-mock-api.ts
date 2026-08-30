/**
 * Vite dev server plugin that mocks the backend API for visual testing.
 *
 * Usage: In vite.config.ts, import and add to the plugins array:
 *
 *   import { mockApiPlugin } from './dev-mock-api';
 *   // ...
 *   plugins: [mockApiPlugin(), mkcert(), ...]
 *
 * Then run `npm run dev` and navigate to:
 *   https://localhost:5173/rollouts/default/hello-world
 *
 * Remove the plugin from vite.config.ts when done testing.
 */

import type { Plugin } from 'vite';

const NAMESPACE = 'default';
const ROLLOUT_NAME = 'hello-world';
const APP_NAMESPACE = 'hello-world';
const KUSTOMIZATION_NAME = 'hello-world';
const KUSTOMIZATION_NAMESPACE = 'default';

const mockRolloutResponse = {
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
			wantedVersion: 'f68d0ac',
			currentVersion: 'f68d0ac',
			previousVersion: 'a1b2c3d',
			history: [
				{
					version: { tag: 'f68d0ac', version: 'f68d0ac' },
					timestamp: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
					message: '*Automatic deployment*',
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 5 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'a1b2c3d', version: 'a1b2c3d' },
					timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
					message: '*Automatic deployment*',
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 115 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 114 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'e4f5a6b', version: 'e4f5a6b' },
					timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
					message: 'Fix database connection pooling',
					triggeredBy: { kind: 'User', name: 'alice' },
					bakeStatus: 'Failed',
					bakeStatusMessage: 'Health check failed: readiness probe timeout',
					bakeStartTime: new Date(Date.now() - 295 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 290 * 60 * 1000).toISOString()
				},
				{
					version: { tag: '7c8d9e0', version: '7c8d9e0' },
					timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
					message: '*Automatic deployment*',
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 23.9 * 60 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 23.8 * 60 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'b3c4d5e', version: 'b3c4d5e' },
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
		spec: { label: 'dev' }
	},
	kruiseRollout: null,
	rolloutTests: { items: [] }
};

const mockManagedResources = {
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
				status: {
					phase: 'Succeeded',
					retryCount: 0,
					activePods: 0,
					succeededPods: 1,
					failedPods: 0,
					jobName: `${ROLLOUT_NAME}-test-f68d0ac`
				}
			}
		}
	]
};

const mockPermissions = {
	permissions: { update: true, patch: true },
	resource: {
		apiGroup: 'kuberik.com',
		kind: 'Rollout',
		name: ROLLOUT_NAME,
		namespace: NAMESPACE
	}
};

const hcNow = new Date();
const hcAgo = (mins: number) => new Date(hcNow.getTime() - mins * 60_000).toISOString();
// Mirrors the real HealthCheck CRDs in example/hello-world/cd/base/resources.yaml.
const mockHealthChecks = {
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
				status: 'Pending',
				message: 'evaluating alert state · next probe in 12s',
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
type FleetSpec = {
	app: string;
	env: 'dev' | 'staging' | 'prod';
	bake: 'Succeeded' | 'Failed' | 'InProgress' | 'Deploying';
	currentVersion: string;
	previousVersion?: string;
	deployedAgoMin: number;
};
const FLEET: FleetSpec[] = [
	{ app: 'orders-api',      env: 'dev',     bake: 'Succeeded',  currentVersion: 'e936e6f', previousVersion: '01ab7c9', deployedAgoMin: 4 * 60 + 12 },
	{ app: 'orders-api',      env: 'staging', bake: 'Succeeded',  currentVersion: '01ab7c9', previousVersion: '7d2918a', deployedAgoMin: 22 * 60 },
	{ app: 'orders-api',      env: 'prod',    bake: 'InProgress', currentVersion: '7c14e2a', previousVersion: '01ab7c9', deployedAgoMin: 2 },
	{ app: 'checkout-worker', env: 'dev',     bake: 'Succeeded',  currentVersion: '3f1ed09', deployedAgoMin: 38 },
	{ app: 'checkout-worker', env: 'staging', bake: 'Failed',     currentVersion: 'a02f1c4', previousVersion: '3f1ed09', deployedAgoMin: 3 },
	{ app: 'recommender-svc', env: 'dev',     bake: 'Succeeded',  currentVersion: '4b9c2e1', deployedAgoMin: 6 * 60 },
	{ app: 'recommender-svc', env: 'prod',    bake: 'Succeeded',  currentVersion: '88c0e51', deployedAgoMin: 2 * 24 * 60 }
];

const mkFleetRollout = (s: FleetSpec) => {
	const ns = `${s.app}-${s.env}`;
	const history = [
		{
			version: { tag: s.currentVersion, version: s.currentVersion },
			timestamp: hcAgo(s.deployedAgoMin),
			message: '*Automatic deployment*',
			triggeredBy: { kind: 'System', name: 'System' },
			bakeStatus: s.bake,
			...(s.bake === 'Failed' && { bakeStatusMessage: 'HighErrorRate firing · rolled back' }),
			bakeStartTime: hcAgo(s.deployedAgoMin),
			bakeEndTime: hcAgo(s.deployedAgoMin - 1)
		},
		...(s.previousVersion ? [{
			version: { tag: s.previousVersion, version: s.previousVersion },
			timestamp: hcAgo(s.deployedAgoMin + 6 * 60),
			message: '*Automatic deployment*',
			triggeredBy: { kind: 'System', name: 'System' },
			bakeStatus: 'Succeeded' as const,
			bakeStartTime: hcAgo(s.deployedAgoMin + 6 * 60),
			bakeEndTime: hcAgo(s.deployedAgoMin + 6 * 60 - 1)
		}] : [])
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
			wantedVersion: s.currentVersion,
			currentVersion: s.currentVersion,
			previousVersion: s.previousVersion,
			history
		}
	};
};
const mkFleetEnvironment = (s: FleetSpec) => ({
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
const HF_APP = 'checkout-edge';

/** [sha, createdMinutesAgo] — newest first, so the index IS the rank. */
const HF_BUILDS: [string, number][] = [
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
const hfReleases = HF_BUILDS.map(([sha, createdMinAgo]) => ({
	tag: sha,
	version: sha,
	revision: `${sha}000000000000000000000000000000000`.slice(0, 40),
	created: hcAgo(createdMinAgo)
})).reverse();

/** [sha, deployedMinutesAgo] — OLDEST first here; reversed on the way out,
 *  because `status.history` is newest-first in the real API. */
type HfDeploy = [string, number];

const HF_LANES: {
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
		deploys: [
			['2c8b409', 5250],
			['3e9d780', 5200],
			['55f1a2c', 5150],
			['c3a9f22', 5100],
			['b7e0d41', 4900], // ← straddles the `fit` window's left edge
			['d09e6f4', 4600] // ← oldest LIVE deploy, so it defines `fit`
		]
	}
];

const mkHfRollout = (lane: (typeof HF_LANES)[number]) => {
	const ns = `${HF_APP}-${lane.env}`;
	const ordered = [...lane.deploys].reverse(); // newest first
	const history = ordered.map(([sha, minAgo], i) => ({
		version: { tag: sha, version: sha },
		timestamp: hcAgo(minAgo),
		message: i === 0 ? 'Automatic promotion' : '*Automatic deployment*',
		triggeredBy: { kind: 'System', name: 'System' },
		bakeStatus: i === 0 ? lane.bake : ('Succeeded' as const),
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
			wantedVersion: currentVersion,
			currentVersion,
			previousVersion,
			availableReleases: hfReleases,
			history
		}
	};
};

const mkHfEnvironment = (lane: (typeof HF_LANES)[number]) => ({
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
const MR_APP = 'payments-core';

/** [sha, createdMinutesAgo] — newest first, so the index IS the rank. */
const MR_BUILDS: [string, number][] = [
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
const MR_OFF_LINE: [string, number] = ['d0ff17e', 300];

const MR_CREATED = new Map<string, number>([...MR_BUILDS, MR_OFF_LINE]);

const mrVersion = (sha: string) => ({
	tag: sha,
	version: sha,
	revision: `${sha}000000000000000000000000000000000`.slice(0, 40),
	created: hcAgo(MR_CREATED.get(sha) ?? 0)
});

// OLDEST-FIRST, the real API's contract for `availableReleases`.
const mrReleases = MR_BUILDS.map(([sha]) => mrVersion(sha)).reverse();

type MrLane = {
	env: string;
	bake: 'Succeeded' | 'Failed' | 'InProgress' | 'Deploying';
	/** [sha, deployedMinutesAgo] — OLDEST first; reversed on the way out. */
	deploys: [string, number][];
};

const MR_LANES: MrLane[] = [
	// ── stages: a LINE. Reading order is promotion order.
	{ env: 'dev', bake: 'Succeeded', deploys: [['9b7e410', 1490], ['c0d3e88', 290], ['f4a2c19', 30]] },
	{ env: 'test', bake: 'Succeeded', deploys: [['9b7e410', 1480], ['c0d3e88', 280], ['f4a2c19', 25]] },
	{ env: 'staging', bake: 'Succeeded', deploys: [['2a55f0c', 2880], ['9b7e410', 1460], ['c0d3e88', 260]] },

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
const EM_APP = 'edge-mesh';
const EM_BUILDS: [string, number][] = [
	['5e1a903', 55],
	['a92c6f4', 900],
	['16d8b70', 2600],
	['cf03e2d', 5200]
];
const EM_CREATED = new Map<string, number>(EM_BUILDS);
const emVersion = (sha: string) => ({
	tag: sha,
	version: sha,
	revision: `${sha}000000000000000000000000000000000`.slice(0, 40),
	created: hcAgo(EM_CREATED.get(sha) ?? 0)
});
const emReleases = EM_BUILDS.map(([sha]) => emVersion(sha)).reverse();
const EM_REGIONS = [
	'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
	'eu-west-1', 'eu-central-1', 'eu-north-1',
	'ap-south-1', 'ap-southeast-2', 'ap-northeast-1',
	'sa-east-1', 'af-south-1'
];
const EM_LANES: MrLane[] = [
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

/** Shared builder for the two multi-region fixtures. Same shape as
 *  `mkHfRollout`, but the history entries carry `created` on the version —
 *  which the live API does and the older fixtures do not, and which is what
 *  lets the ladder rank an off-line build by its real release time rather
 *  than by when someone happened to deploy it. */
function mkRegionRollout(app: string, releases: unknown[], toVersion: (sha: string) => unknown) {
	return (lane: MrLane) => {
		const ns = `${app}-${lane.env}`;
		const ordered = [...lane.deploys].reverse(); // newest first
		const history = ordered.map(([sha, minAgo], i) => ({
			version: toVersion(sha),
			timestamp: hcAgo(minAgo),
			message: i === 0 ? 'Automatic promotion' : '*Automatic deployment*',
			triggeredBy: { kind: 'System', name: 'System' },
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
				wantedVersion: currentVersion,
				currentVersion,
				previousVersion,
				availableReleases: releases,
				history
			}
		};
	};
}

const mkRegionEnvironment = (app: string) => (lane: MrLane) => ({
	apiVersion: 'environments.kuberik.com/v1alpha1',
	kind: 'Environment',
	metadata: { name: app, namespace: `${app}-${lane.env}` },
	spec: { environment: lane.env, name: app, rolloutRef: { name: app } },
	status: {
		currentVersion: [...lane.deploys].reverse()[0][0],
		lastStatusChangeTime: hcAgo([...lane.deploys].reverse()[0][1])
	}
});

const mockMrRollouts = MR_LANES.map(mkRegionRollout(MR_APP, mrReleases, mrVersion));
const mockMrEnvironments = MR_LANES.map(mkRegionEnvironment(MR_APP));
const mockEmRollouts = EM_LANES.map(mkRegionRollout(EM_APP, emReleases, emVersion));
const mockEmEnvironments = EM_LANES.map(mkRegionEnvironment(EM_APP));

const mockHfRollouts = HF_LANES.map(mkHfRollout);
const mockHfEnvironments = HF_LANES.map(mkHfEnvironment);

const mockFleetRollouts = [
	...FLEET.map(mkFleetRollout),
	...mockHfRollouts,
	...mockMrRollouts,
	...mockEmRollouts
];
const mockFleetEnvironments = [
	...FLEET.map(mkFleetEnvironment),
	...mockHfEnvironments,
	...mockMrEnvironments,
	...mockEmEnvironments
];

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

const DEP_APP = 'hello-frontend-app';
const DEP_ENVS = ['dev', 'staging', 'prod'] as const;
/** Oldest first, exactly as the hub serves `availableReleases`. */
const DEP_RELEASES = [
	{ tag: 'rel-2', version: '2.1.0-2', revision: 'e87f059fd602466f1c13e293210b3d2e430504c8', created: '2026-07-29T15:20:18Z' },
	{ tag: 'rel-63', version: '2.63.0-63', revision: '66e4133a4289eec3b88439b2069b617c8435975f', created: '2026-07-29T16:53:38Z' },
	{ tag: 'rel-64', version: '2.64.0-64', revision: '83755067c4c76bc112258b901108ec03699f7f4d', created: '2026-07-29T16:54:14Z' },
	{ tag: 'rel-66', version: '2.66.0-66', revision: '9f10e494d560c1db68aef5203e3afdc5fd9e1e10', created: '2026-07-29T16:58:53Z' }
];

const depHistory = (tags: string[], agoMin: number, bake = 'Succeeded') =>
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

const mkDepRollout = (env: string) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'Rollout',
	metadata: { name: DEP_APP, namespace: `hello-dep-${env}`, labels: { environment: env } },
	spec: { releasesImagePolicy: `hello-dep-${env}/${DEP_APP}`, versionHistoryLimit: 10, minBakeTime: '5m' },
	status: {
		wantedVersion: 'rel-66',
		currentVersion: 'rel-66',
		availableReleases: DEP_RELEASES,
		history: depHistory(['rel-66', 'rel-64', 'rel-63', 'rel-2'], 30)
	}
});

/**
 * `spec.relationship` IS THE `After` EDGE, AND IT IS WHERE THE ORDER COMES
 * FROM NOW. The hub serves it on every one of this app's environments
 * (`staging After dev`, `prod After staging`) even though its
 * `status.environmentInfos` is empty — which is exactly why the chain can be
 * ordered correctly from data the old code never looked at.
 */
const DEP_AFTER: Record<string, string | null> = { dev: null, staging: 'dev', prod: 'staging' };

const mkDepEnvironment = (env: string) => ({
	apiVersion: 'environments.kuberik.com/v1alpha1',
	kind: 'Environment',
	metadata: { name: DEP_APP, namespace: `hello-dep-${env}` },
	spec: {
		environment: env,
		name: 'hello-dep-frontend-app',
		rolloutRef: { name: DEP_APP },
		...(DEP_AFTER[env] ? { relationship: { environment: DEP_AFTER[env], type: 'After' } } : {})
	},
	status: { currentVersion: 'rel-66', lastStatusChangeTime: hcAgo(30) }
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
const DEP_ENV_INFOS_BY_ENV: Record<string, unknown[]> = Object.fromEntries(
	DEP_ENVS.map((env) => [env, [{ environment: env }]])
);

/** Fixture A - the live shape, copied field for field. */
const mkLiveDependency = (env: string) => ({
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

const CK_APP = 'checkout-api';
/** Seven, in `After` order. Two of them are prod REGIONS, which are a SET. */
const CK_ENVS = [
	'dev',
	'staging',
	'prod-eu-central',
	'prod-us-east-1',
	'prod-us-east-2',
	'prod-ap-southeast-2',
	'prod-af-south-1'
] as const;

/** Oldest first, again matching the hub's own ordering. */
const CK_RELEASES = [
	{ tag: 'b-40', version: '4.40.0-40', created: '2026-08-01T09:00:00Z' },
	{ tag: 'b-41', version: '4.41.0-41', created: '2026-08-04T09:00:00Z' },
	{ tag: 'b-42', version: '4.42.0-42', created: '2026-08-09T09:00:00Z' },
	{ tag: 'b-43', version: '4.43.0-43', created: '2026-08-16T09:00:00Z' },
	{ tag: 'b-44', version: '4.44.0-44', created: '2026-08-24T09:00:00Z' },
	{ tag: 'b-45', version: '4.45.0-45', created: '2026-08-28T09:00:00Z' }
];

/**
 * What each environment is running. dev is on head; staging and the first two
 * regions are HELD BEHIND IT BY A CONTRACT, which is what makes the hop counts
 * on the chain and the blocked rows in the contract block tell one story.
 */
const CK_LIVE: Record<string, string> = {
	dev: 'b-45',
	staging: 'b-43',
	'prod-eu-central': 'b-43',
	'prod-us-east-1': 'b-42',
	'prod-us-east-2': 'b-42',
	'prod-ap-southeast-2': 'b-42',
	'prod-af-south-1': 'b-40'
};
const CK_BAKE: Record<string, string> = {
	dev: 'Succeeded',
	staging: 'Succeeded',
	'prod-eu-central': 'Succeeded',
	'prod-us-east-1': 'Succeeded',
	'prod-us-east-2': 'InProgress',
	'prod-ap-southeast-2': 'Succeeded',
	'prod-af-south-1': 'Failed'
};

const ckHistory = (env: string) => {
	const head = CK_RELEASES.findIndex((r) => r.tag === CK_LIVE[env]);
	const tags = CK_RELEASES.slice(0, head + 1).reverse();
	return tags.map((r, i) => ({
		id: tags.length - i,
		version: { tag: r.tag, version: r.version, created: r.created },
		timestamp: hcAgo(60 + i * 240),
		bakeStatus: i === 0 ? CK_BAKE[env] : 'Succeeded',
		...(i === 0 && CK_BAKE[env] === 'Failed'
			? { bakeStatusMessage: 'HighErrorRate firing in af-south-1' }
			: {})
	}));
};

const mkCkRollout = (env: string) => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'Rollout',
	metadata: { name: CK_APP, namespace: `${CK_APP}-${env}`, labels: { environment: env } },
	spec: { releasesImagePolicy: `${CK_APP}-${env}/${CK_APP}`, versionHistoryLimit: 20, minBakeTime: '5m' },
	status: {
		wantedVersion: CK_LIVE[env],
		currentVersion: CK_LIVE[env],
		availableReleases: CK_RELEASES,
		history: ckHistory(env)
	}
});

const mkCkEnvironment = (env: string) => ({
	apiVersion: 'environments.kuberik.com/v1alpha1',
	kind: 'Environment',
	metadata: { name: CK_APP, namespace: `${CK_APP}-${env}` },
	spec: { environment: env, name: 'checkout-api-service', rolloutRef: { name: CK_APP } },
	status: { currentVersion: CK_LIVE[env], lastStatusChangeTime: hcAgo(60) }
});

/** The seven-node chain, a LINE through staging then a fan-out into regions. */
const CK_ENV_INFOS = CK_ENVS.map((env) => ({
	environment: env,
	...(env === 'dev'
		? {}
		: env === 'staging'
			? { relationship: { environment: 'dev', type: 'After' } }
			: { relationship: { environment: 'staging', type: 'After' } }),
	history: ckHistory(env)
}));

const ckDep = (args: {
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
		annotations: { 'rollout-dashboard.kuberik.com/source-cluster': 'prod' }
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
const SA_APP = 'standalone-api';
const SA_NS = 'standalone-prod';
const SA_RELEASES = [
	{ tag: 's-10', version: '1.10.0-10', created: '2026-08-10T09:00:00Z' },
	{ tag: 's-11', version: '1.11.0-11', created: '2026-08-20T09:00:00Z' },
	{ tag: 's-12', version: '1.12.0-12', created: '2026-08-27T09:00:00Z' }
];
const mkSaRollout = () => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'Rollout',
	metadata: { name: SA_APP, namespace: SA_NS },
	spec: { releasesImagePolicy: `${SA_NS}/${SA_APP}`, versionHistoryLimit: 10, minBakeTime: '5m' },
	status: {
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
const mockSaDependency = {
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
//                     `orders-api` in one (so the blocking card renders
//                     beneath it). It is the fixture for the rule that the
//                     two banners never stack.
//   · `orders-api`    A consumer with NO `Environment`, so its place renders
//                     as a NAMESPACE handle rather than a tier chip - the
//                     branch that refuses to invent an environment.
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
const PLATFORM_NS = 'platform-prod';

const PAY_RELEASES = [
	{ tag: 'pay-239', version: '2.3.9', created: '2026-07-20T09:00:00Z' },
	{ tag: 'pay-241', version: '2.4.1', created: '2026-08-02T09:00:00Z' },
	{ tag: 'pay-300', version: '3.0.0', created: '2026-08-26T09:00:00Z' }
];

const LEDGER_RELEASES = [
	{ tag: 'led-510', version: '5.1.0', created: '2026-07-15T09:00:00Z' },
	{ tag: 'led-600', version: '6.0.0', created: '2026-08-28T09:00:00Z' }
];

const ORD_RELEASES = [
	{ tag: 'o-12', version: '1.12.0-12', created: '2026-08-05T09:00:00Z' },
	{ tag: 'o-13', version: '1.13.0-13', created: '2026-08-27T09:00:00Z' }
];

const mkPlainRollout = (args: {
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

const mkPlainDependency = (args: {
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

const mockProviderRollouts = [
	mkPlainRollout({
		name: 'payments-svc',
		namespace: PLATFORM_NS,
		releases: PAY_RELEASES,
		current: 'pay-241',
		requires: { ledger: '>=5.0.0' }
	}),
	mkPlainRollout({
		name: 'ledger-core',
		namespace: PLATFORM_NS,
		releases: LEDGER_RELEASES,
		current: 'led-510'
	}),
	mkPlainRollout({
		name: 'orders-api',
		namespace: 'orders-prod',
		releases: ORD_RELEASES,
		current: 'o-12',
		requires: { payments: '^2.0.0' }
	})
];

const mockProviderDependencies = [
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
		name: 'orders-api-needs-payments',
		namespace: 'orders-prod',
		consumer: 'orders-api',
		contract: 'payments',
		provider: 'payments-svc',
		providerNamespace: PLATFORM_NS,
		providedVersion: '2.4.1',
		providedTag: 'pay-241',
		admitted: ['o-12'],
		blocked: [{ tag: 'o-13', requiredVersion: '^3.0.0', reason: 'ConstraintNotSatisfied' }]
	})
];

const mockDependencies = [
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
			providerNamespace: 'platform-prod',
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
		providerNamespace: 'platform-prod',
		admitted: [],
		blocked: [{ tag: 'b-46-rc1', requiredVersion: '>=1.0.0', reason: 'ProviderHasNoDeployedRelease' }],
		satisfied: false
	}),

	// FIXTURE D - the two gates that give the PROVIDER side something to draw.
	...mockProviderDependencies
];


const mockDepRollouts = [
	...DEP_ENVS.map(mkDepRollout),
	...CK_ENVS.map(mkCkRollout),
	mkSaRollout(),
	...mockProviderRollouts
];
const mockDepEnvironments = [...DEP_ENVS.map(mkDepEnvironment), ...CK_ENVS.map(mkCkEnvironment)];

/** Detail responses, keyed `namespace/name`, for the fixture apps. */
const mockDepDetails: Record<string, unknown> = Object.fromEntries([
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
			rolloutGates: { items: [] },
			environment: {
				...mkCkEnvironment(env),
				status: { ...mkCkEnvironment(env).status, environmentInfos: CK_ENV_INFOS }
			},
			kruiseRollout: null,
			rolloutTests: { items: [] }
		}
	])
]);

const mockClusters = [
	{ name: 'dev',     url: 'https://kuberik-dev.example.com' },
	{ name: 'staging', url: 'https://kuberik-staging.example.com' },
	{ name: 'prod',    url: 'https://kuberik-prod.example.com' }
];

export function mockApiPlugin(): Plugin {
	return {
		name: 'mock-api',
		configureServer(server) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			server.middlewares.use((req: any, res: any, next: () => void) => {
				if (!req.url?.startsWith('/api/')) return next();

				res.setHeader('Content-Type', 'application/json');

				// GET /api/rollouts
				if (req.url === '/api/rollouts') {
					return res.end(
						JSON.stringify({
							rollouts: {
								items: [mockRolloutResponse.rollout, ...mockFleetRollouts, ...mockDepRollouts]
							},
							environments: { items: [...mockFleetEnvironments, ...mockDepEnvironments] },
							// The `rolloutDependencies` sibling collection, exactly as the
							// hub serves it. See THE DEPENDENCIES FIXTURE above for what
							// each entry is there to exercise.
							rolloutDependencies: { items: mockDependencies },
							kustomizations: { items: [] },
							kruiseRollouts: { items: [] },
							clusters: mockClusters,
							clusterErrors: []
						})
					);
				}

				// GET /api/rollouts/:namespace/:name
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}`) {
					return res.end(JSON.stringify(mockRolloutResponse));
				}

				// GET /api/rollouts/:namespace/:name for the DEPENDENCIES fixtures.
				// Matched with the query string stripped, because the detail route
				// carries `?cluster=<name>` on a multi-cluster payload and this
				// mock advertises three clusters.
				{
					const path = req.url.split('?')[0];
					const m = path.match(/^\/api\/rollouts\/([^/]+)\/([^/]+)$/);
					if (m) {
						const detail = mockDepDetails[`${m[1]}/${m[2]}`];
						if (detail) return res.end(JSON.stringify(detail));
					}
				}

				// GET /api/rollouts/:namespace/:name/permissions/all
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/permissions/all`) {
					return res.end(JSON.stringify(mockPermissions));
				}

				// GET /api/rollouts/:namespace/:name/rollout-tests
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/rollout-tests`) {
					const rolloutTestObject = mockManagedResources.managedResources.find(
						(r) => r.groupVersionKind === 'rollout.kuberik.com/v1alpha1/RolloutTest'
					);
					return res.end(
						JSON.stringify({
							rolloutTests: { items: rolloutTestObject ? [rolloutTestObject.object] : [] },
							kruiseRollout: null
						})
					);
				}

				// GET /api/rollouts/:namespace/:name/health-checks
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/health-checks`) {
					return res.end(JSON.stringify(mockHealthChecks));
				}

				// GET /api/rollouts/:namespace/:name/pods/logs (SSE stream)
				if (req.url?.startsWith(`/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/pods/logs`)) {
					res.setHeader('Content-Type', 'text/event-stream');
					res.setHeader('Cache-Control', 'no-cache');
					res.setHeader('Connection', 'keep-alive');

					const pods = [
						{ name: `${ROLLOUT_NAME}-6f8b9c4d7-x2k9p`, namespace: APP_NAMESPACE, type: 'pod' },
						{ name: `${ROLLOUT_NAME}-6f8b9c4d7-m4j7q`, namespace: APP_NAMESPACE, type: 'pod' },
						{ name: `${ROLLOUT_NAME}-test-f68d0ac-zt5rn`, namespace: APP_NAMESPACE, type: 'test' }
					];

					// Send pods event first
					res.write(`event: pods\ndata: ${JSON.stringify(pods)}\n\n`);

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

					const testLogs = [
						{ level: 'INFO', msg: 'Running test suite: integration' },
						{ level: 'INFO', msg: 'Test: health check endpoint ... PASSED (2ms)' },
						{ level: 'INFO', msg: 'Test: create user ... PASSED (145ms)' },
						{ level: 'WARN', msg: 'Test: update user with invalid email ... PASSED (12ms) [expected 400]' },
						{ level: 'INFO', msg: 'Test: list orders with pagination ... PASSED (89ms)' },
						{ level: 'ERROR', msg: 'Test: concurrent writes ... FAILED: expected 200 but got 409 Conflict' },
						{ level: 'INFO', msg: 'Test: delete expired sessions ... PASSED (234ms)' },
						{ level: 'INFO', msg: 'Test suite completed: 6/7 passed, 1 failed' },
					];

					let logIndex = 0;
					const baseTime = Date.now() - 60000; // Start logs 1 min ago

					// Send a burst of initial historical logs
					const initialCount = 30;
					for (let i = 0; i < initialCount; i++) {
						const pod = pods[i % 2]; // Alternate between the two app pods
						const sample = sampleLogs[i % sampleLogs.length];
						const ts = baseTime + i * 2000;
						const logLine = {
							pod: pod.name,
							container: 'app',
							type: pod.type,
							line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
							timestamp: ts
						};
						res.write(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
					}

					// Send some test pod logs
					for (let i = 0; i < testLogs.length; i++) {
						const ts = baseTime + (initialCount + i) * 2000;
						const logLine = {
							pod: pods[2].name,
							container: 'test-runner',
							type: 'test',
							line: `${new Date(ts).toISOString()} ${testLogs[i].level} ${testLogs[i].msg}`,
							timestamp: ts
						};
						res.write(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
					}

					// Stream new logs periodically
					const interval = setInterval(() => {
						const pod = pods[logIndex % 2];
						const sample = sampleLogs[logIndex % sampleLogs.length];
						const ts = Date.now();
						const logLine = {
							pod: pod.name,
							container: 'app',
							type: pod.type,
							line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
							timestamp: ts
						};
						res.write(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
						logIndex++;
					}, 2000);

					req.on('close', () => clearInterval(interval));
					return;
				}

				// GET /api/kustomizations/:namespace/:name/managed-resources
				if (
					req.url ===
					`/api/kustomizations/${KUSTOMIZATION_NAMESPACE}/${KUSTOMIZATION_NAME}/managed-resources`
				) {
					return res.end(JSON.stringify(mockManagedResources));
				}

				// Fallback: return empty JSON for any unhandled API routes
				return res.end(JSON.stringify({}));
			});
		}
	};
}
