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
					'Example application for testing rollout features.'
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

const mockHealthChecks = {
	healthChecks: [
		{
			name: ROLLOUT_NAME,
			namespace: APP_NAMESPACE,
			kind: 'Deployment',
			apiVersion: 'apps/v1',
			status: 'Healthy',
			message: 'Deployment is available'
		}
	]
};

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
							rollouts: { items: [mockRolloutResponse.rollout] }
						})
					);
				}

				// GET /api/rollouts/:namespace/:name
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}`) {
					return res.end(JSON.stringify(mockRolloutResponse));
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
