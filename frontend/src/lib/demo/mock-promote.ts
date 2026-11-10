/**
 * THE `promote` SCENARIO — dev → staging, environment-to-environment.
 * (2026-09-21, demo-mode.)
 *
 * The promo film's "promote only when it's healthy" chapter used to show
 * `default/hello-world` promoting ITSELF (dev's own health check clearing,
 * then dev deploying the newer build it already had queued) — a real beat,
 * shipped 2026-09-20, but not the one the owner asked for: *"It probably
 * should refer to the dependency gate of the previous environment."* The
 * beat this file exists to make possible is ENVIRONMENT-TO-ENVIRONMENT: the
 * NEXT environment's rollout is held by its own `after(<previous env>)`
 * promotion gate until the previous environment is healthy, and when that
 * gate opens the controller promotes the build into the next environment on
 * its own — nobody clicks anything.
 *
 * `default/hello-world` (state.ts's own `FIXTURES` entry, cluster `dev`) is
 * reused unchanged as the DEV rollout. This file adds its two peers —
 * `hello-world-staging/hello-world` and `hello-world-prod/hello-world` — plus
 * the `Environment` objects (dev's included, so all three ever appear in the
 * SAME `groupRolloutsByApp` group on `/environments`) that give the
 * promotion chain its `After` edges and `rolloutGateRef`s.
 *
 * ⛔ NOTHING NODE-SPECIFIC MAY ENTER THIS FILE — same rule as `mock-data.ts`
 * and `mock-details.ts`: it is bundled into the browser by the demo build.
 *
 * ⭐ SELF-CONTAINED ON PURPOSE. `mock-data.ts`'s own FLEET region (below
 * `export const FLEET`) is another lane's actively-edited territory — see
 * `state.ts`'s own `FIXTURES` comment. This file only imports the handful of
 * stable, top-of-file exports (`hcAgo`, `hcNow`, `NAMESPACE`, `ROLLOUT_NAME`,
 * `SOURCE_CLUSTER`) so nothing here can be knocked over by that rewrite.
 */

import { hcAgo, hcNow, NAMESPACE, ROLLOUT_NAME, SOURCE_CLUSTER } from './mock-data';

export type HwEnv = 'dev' | 'staging' | 'prod';

export const HW_APP_NAME = ROLLOUT_NAME; // 'hello-world'
export const HW_NAMESPACE: Record<HwEnv, string> = {
	dev: NAMESPACE, // 'default' — the existing live fixture, untouched.
	staging: 'hello-world-staging',
	prod: 'hello-world-prod'
};
export const HW_CLUSTER: Record<HwEnv, string> = { dev: 'dev', staging: 'staging', prod: 'prod' };
/** The tier a tier takes its version from (the gate's pretty-name only). `dev` is the root.
 *  Not an Environment field any more: the controller derives the order from the tiers themselves. */
const HW_UP: Record<HwEnv, string | null> = {
	dev: null,
	staging: 'dev',
	prod: 'staging'
};
/** `status.rolloutGateRef.name` — the promotion gate THIS environment owns. */
export const HW_GATE_NAME: Record<HwEnv, string | null> = {
	dev: null,
	staging: 'promotion-staging',
	prod: 'promotion-prod'
};

/** Oldest first — the rollout's own `availableReleases`, matching `state.ts`'s
 *  `buildHwDetail()` byte-for-byte so a build id means the same thing on
 *  every one of this app's three pages. */
export const HW_RELEASES = [
	{ tag: 'a1b2c3d', version: 'a1b2c3d', revision: 'a1b2c3d', created: hcAgo(120) },
	{ tag: 'f68d0ac', version: 'f68d0ac', revision: 'f68d0ac', created: hcAgo(16) },
	{ tag: 'e2c9b47', version: 'e2c9b47', revision: 'e2c9b47', created: hcAgo(5) }
];

/** dev is queued to promote `e2c9b47` itself (state.ts's existing gate
 *  fixture — one `Pending` health check). staging and prod are both still
 *  running what dev ran BEFORE that: `f68d0ac`/`a1b2c3d`, each one hop
 *  behind the environment in front of it — the ordinary shape of a chain
 *  that promotes forward one environment at a time. */
export const HW_CURRENT: Record<HwEnv, string> = {
	dev: 'f68d0ac',
	staging: 'f68d0ac',
	prod: 'a1b2c3d'
};
// ⭐ (2026-10-12, squad-changes QA pass; revised twice more same day once
// upstream's `demo/chain-order` fix made `mkHwRollout`'s own
// previous-version history entry apply to EVERY env via this SAME map,
// not just prod). `prod.previous` was `a1b2c3d` (same as `prod.current`)
// — nonsensical on its own, fixed by naming `7c8d9e0` instead.
//
// ⛔ `staging.previous` CANNOT follow prod's lead and also become
// `7c8d9e0` — tried that, and `chain-order.test.ts` caught it immediately:
// `prod`'s own CURRENT build is `a1b2c3d`, and rule 1 requires it to
// appear somewhere in `staging`'s own history (its immediate predecessor
// in the chain) — swapping staging's "previous" entry to `7c8d9e0` erases
// the one place `a1b2c3d` lived there. `staging.previous` stays `a1b2c3d`
// — the REAL fix for the causality violation this originally caused is on
// `a1b2c3d`/`e4f5a6b`'s own `EXPLICIT_MERGE_MINUTES_AGO` pins
// (`github-data.ts`), not here: both are now pinned older than
// `staging`'s own `hcAgo(ago.staging + 6*60)` (~385 minutes ago) deploy of
// this exact entry.
export const HW_PREVIOUS: Record<HwEnv, string> = {
	dev: 'a1b2c3d',
	staging: 'a1b2c3d',
	prod: '7c8d9e0'
};
/** What each environment's OWN promotion gate allows through today — the
 *  environment controller's own rule: "passing only for versions already
 *  deployed after `<After>`". staging's gate has not yet been asked to admit
 *  `e2c9b47`, because dev has not deployed it yet; prod's has not been asked
 *  to admit anything past what staging has already run. */
export const HW_GATE_ALLOWED: Record<HwEnv, string[]> = {
	dev: [],
	staging: ['a1b2c3d', 'f68d0ac'],
	prod: ['a1b2c3d']
};

const ago: Record<HwEnv, number> = { dev: 16, staging: 25, prod: 130 };

/**
 * `status.wave` of the single-site chain: every tier is the `default` site, wave 1, its own
 * leader. Members cover the tier itself and the tier before it, as the controller reports them.
 */
function hwWave(env: HwEnv) {
	const member = (t: HwEnv) => ({
		environment: t,
		site: 'default',
		wave: 1,
		revision: HW_CURRENT[t],
		bakeStatus: 'Succeeded'
	});
	const up = HW_UP[env] as HwEnv | null;
	return {
		site: 'default',
		environment: env,
		name: 'kuberik-hello-world-app',
		wave: 1,
		role: 'Leader',
		leader: 'default',
		selectedRevision: HW_CURRENT[env],
		members: [...(up ? [member(up)] : []), member(env)]
	};
}

/**
 * ⭐ THE ONE PLACE THAT SAYS "AFTER DEV" — `classifyGate`'s own promotion
 * branch (`blocking-story.ts`) derives that exact label from
 * the tier order, so this function does not invent a
 * second spelling; it only supplies the environment name the model reads.
 *
 * Used BOTH as the fleet-wide `environments.items` entry (so `/environments`
 * and `groupRolloutsByApp` can chain all three) and as the per-rollout
 * detail bundle's own `environment` field (what `blockStory`'s
 * `gateContext` pushes in on the single-rollout page) — one object, two
 * call sites, so neither can drift from the other the way `respond.ts`'s
 * own history warns about.
 */
export function mkHwEnvironment(env: HwEnv) {
	const gate = HW_GATE_NAME[env];
	return {
		apiVersion: 'environments.kuberik.com/v1alpha1',
		kind: 'Environment',
		metadata: {
			name: HW_APP_NAME,
			namespace: HW_NAMESPACE[env],
			annotations: { [SOURCE_CLUSTER]: HW_CLUSTER[env] }
		},
		spec: {
			label: env,
			environment: env,
			name: 'hello-world-app',
			rolloutRef: { name: HW_APP_NAME }
		},
		status: {
			currentVersion: HW_CURRENT[env],
			lastStatusChangeTime: hcAgo(ago[env]),
			...(gate ? { rolloutGateRef: { name: gate } } : {}),
			wave: hwWave(env)
		}
	};
}

/**
 * ⭐ THE GATE'S OWN WORDS — real annotations on the `RolloutGate` OBJECT
 * (`gate.kuberik.com/pretty-name` / `-description`), the SAME mechanism
 * `getGatePrettyName`/`getGateDescription` already read on every other
 * gate popover in the product. Nothing new to render: staging's popover
 * already shows a per-gate name and a description line when they are
 * present, and this is what makes THIS gate say why dev — the thing it is
 * actually waiting on — has not deployed yet.
 *
 * `staging` alone carries the health-check aside. `prod` does not: prod's
 * hold is not part of the demo's stepped beat and gets the generic,
 * still-true "after staging" label with no invented second reason.
 */
function mkHwRolloutGate(env: 'staging' | 'prod') {
	const gate = HW_GATE_NAME[env]!;
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'RolloutGate',
		metadata: {
			name: gate,
			namespace: HW_NAMESPACE[env],
			annotations: {
				'gate.kuberik.com/pretty-name': `after ${HW_UP[env]}`,
				...(env === 'staging'
					? {
							'gate.kuberik.com/description':
								"dev has 1 health check pending, so it hasn't deployed this build yet."
						}
					: {})
			},
			ownerReferences: [
				{
					apiVersion: 'environments.kuberik.com/v1alpha1',
					kind: 'Environment',
					name: HW_APP_NAME,
					controller: true
				}
			]
		},
		status: { status: 'NotPassing' }
	};
}

/**
 * ⭐ CHAIN-ORDER (2026-10-11, demo/chain-order; superseded same day by
 * shared/held-predicate's `held.ts`). This file used to truncate each
 * environment's own `availableReleases` at its predecessor's `currentVersion`
 * so staging would not count `e2c9b47` — undeployed anywhere — as "1 newer
 * waiting". `held.ts`'s coordinator ruling makes that truncation the wrong
 * fix: staging legitimately has a newer candidate sitting out there, it is
 * just not HELD on it — `heldVerdict` now reads the gate's own `After: dev`
 * relationship and classifies this as plain chain sequencing ("behind,
 * waits for dev"), never "held", regardless of candidate count. Truncating
 * the data hid the candidate instead of fixing the label, which is why
 * `held-predicate.test.ts`'s own reference case 1 ("hello-world (calm): not
 * reached dev, never held") expects staging to still be BEHIND dev with
 * `waitsForEnv: 'dev'` — impossible if its candidate list is empty. Back to
 * the one shared `HW_RELEASES` catalog for every environment; `held.ts` is
 * what tells `staging`/`prod` apart from `held`, not this file.
 */
function mkHwRollout(env: 'staging' | 'prod') {
	const namespace = HW_NAMESPACE[env];
	const gate = HW_GATE_NAME[env]!;
	const current = HW_CURRENT[env];
	const at = hcAgo(ago[env]);
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: {
			name: HW_APP_NAME,
			namespace,
			annotations: {
				[SOURCE_CLUSTER]: HW_CLUSTER[env],
				'dashboard.rollout.kuberik.com/description':
					'Example application for testing rollout features.',
				'dashboard.rollout.kuberik.com/theme': env
			},
			labels: { environment: env }
		},
		spec: {
			releasesImagePolicy: `${namespace}/${HW_APP_NAME}`,
			healthCheckSelector: { matchLabels: { app: HW_APP_NAME } },
			versionHistoryLimit: 10,
			minBakeTime: '1s'
		},
		status: {
			source: 'github.com/exampleco/hello-world',
			wantedVersion: current,
			currentVersion: current,
			previousVersion: HW_PREVIOUS[env],
			availableReleases: HW_RELEASES,
			// `respond.ts`'s per-fixture wrapper calls `recomputeReleaseCandidates`
			// on every entry (the CK/CW pattern) — left unset here so that ONE
			// function stays the source of truth for the newest-first list.
			gates: [{ name: gate, passing: false, allowedVersions: [...HW_GATE_ALLOWED[env]] }],
			history: [
				{
					version: { tag: current, version: current, revision: current },
					timestamp: at,
					// ⭐ (2026-10-10, truth-bug fix) NO `commitMessage` HERE ANY
					// MORE — it hardcoded "Initial release" regardless of
					// which build `current` actually names (`f68d0ac` for
					// staging/dev, `a1b2c3d` for prod — NEITHER is the ladder's
					// first commit, which is the only one `github-data.ts`
					// calls "Initial release"). The row's own title comes from
					// a real commit-range query now (`history/+page.svelte`),
					// so it is always this build's own title, not the one sha
					// this field happened to be written for.
					triggeredBy: { kind: 'System', name: 'rollout-controller' },
					bakeStatus: 'Succeeded',
					bakeStartTime: at,
					// ⭐ NOT THE SAME INSTANT AS `bakeStartTime`. `deployWait`
					// (the row's own "Healthy in Nm" line) requires
					// `bakeEndTime > timestamp` strictly — equal timestamps
					// read as "no measurable bake" and it returns null, which
					// is why this row's line 2 had nothing to say either. One
					// minute, the same convention `mkFleetRollout`/
					// `mkHfRollout` use (`hcAgo(minAgo - 1)`).
					bakeEndTime: hcAgo(ago[env] - 1)
				},
				// ⭐ CHAIN-ORDER FIX (2026-10-11, demo/chain-order): this
				// history only ever had ONE entry — the head — even though
				// `previousVersion` says there WAS a build before it. A
				// later stage's "running/checking" build must be able to
				// point at an entry in its predecessor's own history; a
				// one-entry history can never satisfy that for anything
				// but the very first deploy. Mirrors `mkFleetRollout`'s own
				// previous-version entry, one ladder step further back.
				{
					version: {
						tag: HW_PREVIOUS[env],
						version: HW_PREVIOUS[env],
						revision: HW_PREVIOUS[env]
					},
					timestamp: hcAgo(ago[env] + 6 * 60),
					triggeredBy: { kind: 'System', name: 'rollout-controller' },
					bakeStatus: 'Succeeded',
					bakeStartTime: hcAgo(ago[env] + 6 * 60),
					bakeEndTime: hcAgo(ago[env] + 6 * 60 - 1)
				}
			]
		}
	};
}

function mkHwHealthChecks(env: 'staging' | 'prod') {
	const namespace = HW_NAMESPACE[env];
	// Both environments are stable on their own current build — the story on
	// THIS page is the gate, not a health check of its own. Only dev's
	// existing fixture (state.ts) carries a `Pending` check.
	return {
		healthChecks: [
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: `hello-world-${env}-kustomization-health-check`,
					namespace,
					labels: { app: HW_APP_NAME },
					annotations: {
						'healthcheck.kuberik.com/kustomization': HW_APP_NAME,
						'kuberik.com/display-name': 'Flux Deployment'
					}
				},
				spec: { class: 'kustomization' },
				status: {
					status: 'Healthy',
					message: 'Kustomization is reconciled · 1/1 ready',
					lastChangeTime: hcAgo(ago[env])
				}
			},
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: `hello-world-${env}-prometheus-high-error-rate`,
					namespace,
					labels: { app: HW_APP_NAME },
					annotations: {
						'healthcheck.kuberik.com/prometheus-alert-labels':
							'alertname=HighErrorRate,app=hello-python',
						'kuberik.com/display-name': 'High Error Rate Alert'
					}
				},
				spec: { class: 'prometheus-alert' },
				status: {
					status: 'Healthy',
					message: 'alert is not firing',
					lastChangeTime: hcAgo(ago[env] - 1)
				}
			},
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: {
					name: `hello-world-${env}-prometheus-app-down`,
					namespace,
					labels: { app: HW_APP_NAME },
					annotations: {
						'healthcheck.kuberik.com/prometheus-alert-labels': 'alertname=AppDown,app=hello-python',
						'kuberik.com/display-name': 'App Down Alert'
					}
				},
				spec: { class: 'prometheus-alert' },
				status: {
					status: 'Healthy',
					message: 'alert is not firing',
					lastChangeTime: hcAgo(ago[env] - 2)
				}
			}
		]
	};
}

function mkHwEvents(env: 'staging' | 'prod') {
	const namespace = HW_NAMESPACE[env];
	const current = HW_CURRENT[env];
	return {
		events: [
			{
				type: 'Normal',
				reason: 'ScalingReplicaSet',
				involvedObject: { kind: 'Deployment', name: HW_APP_NAME },
				message: `Scaled up replica set ${HW_APP_NAME}-${env}-6f8b9c4d7 to 1`,
				lastTimestamp: hcAgo(ago[env])
			},
			{
				type: 'Normal',
				reason: 'Pulled',
				involvedObject: { kind: 'Pod', name: `${HW_APP_NAME}-${env}-6f8b9c4d7-x2k9p` },
				message: `Container image "hello-world:${current}" already present on machine`,
				lastTimestamp: hcAgo(ago[env] - 0.5)
			}
		],
		// The namespace rides along so `state.ts`'s own event-record helper
		// (which needs it to broadcast the right `changes` frame) does not
		// have to re-derive it from the fixture's own constants map.
		__namespace: namespace
	};
}

function mkHwManagedResources(env: 'staging' | 'prod') {
	const namespace = HW_NAMESPACE[env];
	const current = HW_CURRENT[env];
	return [
		{
			groupVersionKind: 'apps/v1/Deployment',
			name: HW_APP_NAME,
			namespace,
			status: 'Current',
			message: '',
			lastModified: hcNow.toISOString(),
			object: {
				apiVersion: 'apps/v1',
				kind: 'Deployment',
				metadata: { name: HW_APP_NAME, namespace },
				spec: { replicas: 1 },
				status: { readyReplicas: 1, replicas: 1 }
			}
		},
		{
			groupVersionKind: 'rollouts.kruise.io/v1beta1/Rollout',
			name: HW_APP_NAME,
			namespace,
			status: 'Current',
			message: '',
			lastModified: hcNow.toISOString(),
			object: {
				apiVersion: 'rollouts.kruise.io/v1beta1',
				kind: 'Rollout',
				metadata: { name: HW_APP_NAME, namespace },
				spec: {
					workloadRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: HW_APP_NAME },
					strategy: {
						canary: { steps: [{ replicas: 1, pause: { duration: 5 } }, { replicas: '100%' }] }
					}
				},
				status: {
					phase: 'Healthy',
					canaryStatus: {
						currentStepIndex: 1,
						currentStepState: 'Completed',
						canaryRevision: current,
						observedWorkloadGeneration: 1
					},
					conditions: [{ type: 'Progressing', status: 'True', reason: 'Completed' }]
				}
			}
		}
	];
}

export function mkHwDetail(env: 'staging' | 'prod'): Record<string, unknown> {
	const namespace = HW_NAMESPACE[env];
	return {
		rollout: mkHwRollout(env),
		kustomizations: {
			items: [
				{
					apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
					kind: 'Kustomization',
					metadata: { name: HW_APP_NAME, namespace },
					spec: {},
					status: { conditions: [] }
				}
			]
		},
		ociRepositories: { items: [] },
		rolloutGates: { items: [mkHwRolloutGate(env)] },
		environment: mkHwEnvironment(env)
	};
}

export function mkHwHealthChecksFor(env: 'staging' | 'prod'): {
	healthChecks: Record<string, unknown>[];
} {
	return mkHwHealthChecks(env) as { healthChecks: Record<string, unknown>[] };
}
export function mkHwEventsFor(env: 'staging' | 'prod'): { events: Record<string, unknown>[] } {
	const { __namespace, ...rest } = mkHwEvents(env) as {
		__namespace: string;
		events: Record<string, unknown>[];
	};
	void __namespace;
	return rest;
}
export function mkHwManagedResourcesFor(env: 'staging' | 'prod'): Record<string, unknown>[] {
	return mkHwManagedResources(env) as Record<string, unknown>[];
}
